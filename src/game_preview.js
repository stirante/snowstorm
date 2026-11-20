// The preview: particle-sim (the game's particle rules, Go on molang-go) simulates the effect and bedrock-renderer
// (the game's Fancy / Vibrant Visuals pipelines, WebGPU) draws the whole view on the preview canvas: the environment,
// the guides and the particles. The camera is orbit.js.
import {generateFile} from './export'
import {Config, Scene} from './emitter'
import {EventSubEffects} from './event_sub_effects'
import {OptionValues} from './options'
import {Orbit, camera} from './orbit'

const FX = '/fx';
const VANILLA = '/v';
const SCANS = '/scan';
const VANILLA_URL = 'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/';
const MODES = ['fancy', 'vibrant'];

export const ENVIRONMENTS = [
	{id: 'grid', label: 'Grid'},
	{id: 'floor', label: 'Grass floor'},
	{id: 'plains', label: 'Plains', scan: true},
	{id: 'cherry_grove', label: 'Cherry grove', scan: true},
	{id: 'desert', label: 'Desert', scan: true},
	{id: 'snowy_plains', label: 'Snowy plains', scan: true},
	{id: 'jungle', label: 'Jungle', scan: true},
	{id: 'swamp', label: 'Swamp', scan: true},
];

export const QUALITIES = [
	{id: 'fast', label: 'Fast', title: 'One pixel per CSS pixel'},
	{id: 'sharp', label: 'Sharp', title: 'One pixel per screen pixel'},
];
const MAX_SIDE = 4096;

// The edited effect's Vibrant Visuals texture set: none, uniform MERS values (0-255) or a MER / MERS image.
export const Mers = {
	mode: stored('snowstorm_mers_mode', 'none'),
	values: storedValues(),
	subsurface: false,
	image: null,
	image_name: '',
	version: 0,
};

export const Game = {
	engine: storedEngine(),
	quality: storedQuality(),
	environment: stored('snowstorm_environment', 'grid'),
	time: storedTime(),
	status: '',
	warnings: [],
	paused: true,
	loop_mode: 'auto',
	collision: true,
	elapsed: 0,
	particles: 0,
};

let sim = null, br = null, viewport = null, canvas = null, view = null;
let effectText = '', effectId = '', textures = {}, idle = 0, opening = null, sceneKey = '';
let scans = null;
const tried = new Set();
const solids = {};

function stored(key, fallback) {
	try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
}
function store(key, value) {
	try { localStorage.setItem(key, value); } catch (e) {}
}
function storedQuality() {
	let v = stored('snowstorm_quality', 'sharp');
	return QUALITIES.some(q => q.id === v) ? v : 'sharp';
}
function storedEngine() {
	let v = stored('snowstorm_engine', 'fancy');
	return MODES.includes(v) ? v : 'fancy';
}
function storedValues() {
	try {
		let v = JSON.parse(localStorage.getItem('snowstorm_mers_values'));
		if (Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)) return v;
	} catch (e) {}
	return [0, 0, 255, 0];
}
function storedTime() {
	let t = parseFloat(stored('snowstorm_time', '0'));
	return Number.isFinite(t) ? t : 0;
}
const local = file => new URL(file, document.baseURI).href;

function loadScript(src) {
	return new Promise((resolve, reject) => {
		let s = document.createElement('script');
		s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('cannot load ' + src));
		document.head.append(s);
	});
}

async function loadSim() {
	if (!window.Go) await loadScript(local('vendor/particle-sim/wasm_exec.js'));
	let go = new window.Go();
	let bytes = await (await fetch(local('vendor/particle-sim/particle-sim.wasm'))).arrayBuffer();
	let {instance} = await WebAssembly.instantiate(bytes, go.importObject);
	go.run(instance);
	return window.particleSim;
}

async function loadRenderer() {
	let mod = await import(/* webpackIgnore: true */ local('vendor/renderer/bedrock_renderer_web.js'));
	await mod.default();
	await mod.init();
	return mod;
}

async function loadScans() {
	let list = await (await fetch(local('scans/scans.json'))).json();
	let out = {};
	for (let s of list) out[s.name] = s;
	return out;
}

export async function initGame(preview_view) {
	view = preview_view;
	canvas = view.canvas;
	await setEngine(Game.engine);
}

export async function setEngine(engine) {
	Game.engine = engine;
	store('snowstorm_engine', engine);
	closeViewport();
	if (!navigator.gpu) {
		Game.status = 'The preview needs WebGPU (a current Chrome, Edge or Safari).';
		return;
	}
	Game.status = 'Loading the game renderer…';
	try {
		if (!sim) sim = await loadSim();
		if (!br) br = await loadRenderer();
		if (!scans) scans = await loadScans();
		effectText = '';
		syncEffect();
		await openViewport();
		Game.status = '';
	} catch (e) {
		console.error(e);
		Game.status = 'Preview failed: ' + (e.message || e);
	}
}

export async function setEnvironment(id) {
	Game.environment = id;
	store('snowstorm_environment', id);
	if (!br) return;
	restart();
	await reopen();
}

export function setQuality(q) {
	Game.quality = q;
	store('snowstorm_quality', q);
}

export function setMers(changes) {
	Object.assign(Mers, changes);
	Mers.version++;
	store('snowstorm_mers_mode', Mers.mode);
	store('snowstorm_mers_values', JSON.stringify(Mers.values));
}

export function setTime(t) {
	Game.time = t;
	store('snowstorm_time', String(t));
	if (viewport != null) br.set_time(viewport, t);
}

function environment() {
	return ENVIRONMENTS.find(e => e.id === Game.environment) || ENVIRONMENTS[0];
}

function objects(env) {
	let out = [];
	if (env.id === 'floor') out.push({block: 'grass_block', from: [-24, -1, -24], to: [23, -1, 23]});
	else if (OptionValues.minecraft_block_visible && !env.scan) out.push({block: 'grass_block', from: [0, -1, 0], to: [0, -1, 0]});
	if (env.scan && scans[env.id]) out.push({structure: env.id + '.mcstructure', pos: scans[env.id].origin});
	return out;
}

function guides() {
	let g = {};
	if (OptionValues.grid_visible && !environment().scan) g.grid = {center: [0, 0], half: 32, y: 0};
	if (OptionValues.axis_helper_visible) g.axes = [0, 0, 0];
	if (OptionValues.minecraft_player_visible) g.player = [0, 0, 0];
	return g;
}

function sceneObject() {
	let env = environment();
	let scene = {size: canvasSize(), camera: camera(), mode: Game.engine, rp: [FX, VANILLA], time: Game.time,
		clouds: false, objects: objects(env), particles: [], guides: guides()};
	if (env.id === 'grid') scene.background = 'transparent';
	if (env.scan && scans[env.id]) scene.biome = scans[env.id].biome;
	return scene;
}

// What the open viewport was built from: when it changes (environment, View menu toggles) the viewport is rebuilt.
function currentKey() {
	return JSON.stringify([Game.environment, guides(), OptionValues.minecraft_block_visible, Mers.version, Config.identifier]);
}

function canvasSize() {
	let dpr = Math.min(window.devicePixelRatio || 1, 3);
	let scale = {fast: 1, sharp: dpr}[Game.quality] || dpr;
	let w = canvas.clientWidth || 300, h = canvas.clientHeight || 200;
	scale = Math.min(scale, MAX_SIDE / Math.max(w, h));
	return [Math.max(16, Math.round(w * scale)), Math.max(16, Math.round(h * scale))];
}

function remoteUrl(path) {
	let rest = p => path.slice(p.length + 1).split('/').map(encodeURIComponent).join('/');
	if (path.startsWith(VANILLA + '/')) return VANILLA_URL + rest(VANILLA);
	if (/^\/scan\/[a-z_]+\.mcstructure$/.test(path)) return local('scans/' + rest(SCANS));
	return null;
}

async function fetchMissing(text) {
	for (let round = 0; round < 16; round++) {
		let req = JSON.parse(br.required_files(text, SCANS));
		let fresh = req.missing.filter(p => !tried.has(p) && remoteUrl(p));
		if (!fresh.length) return req.error;
		Game.status = `Loading ${fresh.length} game files…`;
		await Promise.all(fresh.map(async p => {
			tried.add(p);
			try {
				let r = await fetch(remoteUrl(p));
				if (r.ok) br.add_asset(p, new Uint8Array(await r.arrayBuffer()));
			} catch (e) {}
		}));
	}
	return JSON.parse(br.required_files(text, SCANS)).error;
}

async function openViewport() {
	if (opening) return opening;
	opening = (async () => {
		await uploadTextures();
		writeTextureSet();
		sceneKey = currentKey();
		let scene = sceneObject();
		let text = JSON.stringify(scene);
		let error = await fetchMissing(text);
		if (error) throw new Error(error);
		Game.status = '';
		[canvas.width, canvas.height] = scene.size;
		viewport = br.open(canvas, text, SCANS);
		await applyCollision();
	})();
	try { await opening; } finally { opening = null; }
}

async function reopen() {
	closeViewport();
	Game.warnings = Game.warnings.filter(w => !w.startsWith('Renderer: '));
	try {
		await openViewport();
	} catch (e) {
		console.error(e);
		Game.status = 'Renderer: ' + (e.message || e);
	}
}

function closeViewport() {
	if (viewport != null) br.close(viewport);
	viewport = null;
}

async function solidOf(name) {
	if (!solids[name]) {
		let r = await fetch(local('scans/' + name + '.solid'));
		if (!r.ok) throw new Error('cannot load the collision of ' + name);
		solids[name] = new Uint8Array(await r.arrayBuffer());
	}
	return solids[name];
}

async function applyCollision() {
	let env = environment();
	sim.setFloor(Game.collision && !env.scan);
	sim.setSolid(null);
	if (env.scan && Game.collision && scans[env.id]) {
		let {origin, size} = scans[env.id];
		sim.setSolid(...origin, ...size, await solidOf(env.id));
	}
}

// Every effect texture goes to the renderer as tex/<effect>.png; quads are pointed there by their effect id.
function textureKey(id) {
	return 'tex/' + id.replace(/[^a-z0-9_.-]/gi, '_');
}

function imageOf(config) {
	let img = config && config.texture && config.texture.image;
	return img && img.complete && img.naturalWidth ? img : null;
}

function configs() {
	let out = {};
	if (Config.identifier) out[Config.identifier] = Config;
	for (let id in Scene.child_configs || {}) out[id] = Scene.child_configs[id];
	return out;
}

async function uploadTextures() {
	for (let [id, config] of Object.entries(configs())) {
		let img = imageOf(config);
		if (!img || textures[id] === img.src) continue;
		let c = document.createElement('canvas');
		c.width = img.naturalWidth; c.height = img.naturalHeight;
		c.getContext('2d').drawImage(img, 0, 0);
		let blob = await new Promise(r => c.toBlob(r, 'image/png'));
		br.add_asset(FX + '/' + textureKey(id) + '.png', new Uint8Array(await blob.arrayBuffer()));
		textures[id] = img.src;
	}
}

function mersKey(values) {
	return values[3] > 0 || Mers.subsurface ? 'metalness_emissive_roughness_subsurface' : 'metalness_emissive_roughness';
}

function textureSetJSON(color, mers) {
	let set = {color};
	if (Mers.mode === 'uniform') set[mersKey(Mers.values)] = Mers.values[3] > 0 ? Mers.values : Mers.values.slice(0, 3);
	if (Mers.mode === 'image' && Mers.image) set[mersKey([0, 0, 0, 0])] = mers;
	return {format_version: '1.21.30', 'minecraft:texture_set': set};
}

// The renderer reads <texture>.texture_set.json next to a particle texture (Vibrant Visuals only).
function writeTextureSet() {
	if (!Config.identifier) return;
	let base = FX + '/' + textureKey(Config.identifier), name = base.split('/').pop();
	br.remove_asset(base + '.texture_set.json');
	br.remove_asset(base + '_mers.png');
	if (Mers.mode === 'none' || (Mers.mode === 'image' && !Mers.image)) return;
	if (Mers.mode === 'image') br.add_asset(base + '_mers.png', Mers.image);
	br.add_asset(base + '.texture_set.json', new TextEncoder().encode(JSON.stringify(textureSetJSON(name, name + '_mers'))));
}

// The texture set for the pack: named after the effect's texture, its MER(S) image as <texture>_mer(s).png.
export function exportTextureSet() {
	let name = (Config.particle_texture_path || 'textures/particle/particle').split('/').pop() || 'particle';
	let mers = name + (mersKey(Mers.values).endsWith('subsurface') ? '_mers' : '_mer');
	return {name, mers, json: JSON.stringify(textureSetJSON(name, mers), null, 2)};
}

function texturesChanged() {
	for (let [id, config] of Object.entries(configs())) {
		let img = imageOf(config);
		if (img && textures[id] !== img.src) return true;
	}
	return false;
}

function vars() {
	let out = {};
	for (let [k, v] of Object.entries(view.placeholder_variables || {})) {
		if (k.startsWith('variable.') || k.startsWith('v.')) out[k.replace(/^(variable|v)\./, '')] = v;
	}
	return out;
}

// The edited effect and its event sub-effects, re-read whenever the exported JSON changes.
function syncEffect() {
	let text = JSON.stringify(generateFile());
	let subs = JSON.stringify(Object.keys(EventSubEffects).map(k => EventSubEffects[k]?.json || null));
	if (text + subs === effectText) return false;
	effectText = text + subs;
	let errors = [];
	for (let id in EventSubEffects) {
		let json = EventSubEffects[id]?.json;
		let r = json && sim.add(JSON.stringify(json));
		if (r && r.error) errors.push(id + ': ' + r.error);
	}
	let r = sim.add(text);
	effectId = r.id || '';
	if (r.error) errors.unshift(r.error);
	restart();
	Game.warnings.unshift(...errors);
	return true;
}

export function restart() {
	if (!sim) return;
	sim.reset(1);
	Game.elapsed = 0;
	idle = 0;
	Game.warnings = Game.warnings.filter(w => w.startsWith('Renderer: '));
	applyCollision().catch(e => { Game.status = e.message || String(e); });
	if (effectId) sim.spawn(effectId, 0, 0, 0, JSON.stringify(vars()));
	collectWarnings();
}

function collectWarnings() {
	let found = JSON.parse(sim.warnings()) || [];
	if (br) for (let w of br.take_warnings()) if (!/^(sky|sun|moon|cloud)/i.test(w)) found.push('Renderer: ' + w);
	for (let w of found) if (!Game.warnings.includes(w)) Game.warnings.push(w);
}

const PLANES = {emitter_transform_xy: [0, 0, 1], emitter_transform_xz: [0, 1, 0], emitter_transform_yz: [1, 0, 0]};
const BASE_MATERIALS = ['particles_alpha', 'particles_opaque', 'particles_blend', 'particles_add'];

function facing(mode, d) {
	if (!mode || mode === 'rotate_xyz' || mode === 'lookat_xyz') return {};
	if (mode === 'rotate_y' || mode === 'lookat_y') return {facing: 'axis', direction: [0, 1, 0]};
	if (PLANES[mode]) return {facing: 'direction', direction: PLANES[mode]};
	if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < 1e-8) return {};
	if (mode === 'direction_z') return {facing: 'direction', direction: d};
	return {facing: 'axis', direction: d, turn: mode === 'direction_x' || mode === 'lookat_direction' ? 90 : 0};
}

const clamp01 = x => Math.min(1, Math.max(0, x));

// One quad of particleSim.quadsPacked() (layout: particle-sim's PackQuads) as the renderer's particle.
function packedQuad(d, i, strings) {
	let effect = strings[d[i + 23]];
	if (!textures[effect]) return null;
	if (!(Math.abs(d[i + 3]) > 1e-4 && Math.abs(d[i + 4]) > 1e-4)) return null;
	let pos = [d[i], d[i + 1], d[i + 2]], uv = [d[i + 5], d[i + 6], d[i + 7], d[i + 8]], rotation = d[i + 13];
	if (![...pos, ...uv, rotation].every(Number.isFinite)) return null;
	let material = strings[d[i + 22]];
	let f = facing(strings[d[i + 21]], [d[i + 14], d[i + 15], d[i + 16]]);
	let q = {texture: textureKey(effect), pos, size: [Math.abs(d[i + 3]), Math.abs(d[i + 4])], uv,
		color: [clamp01(d[i + 9]), clamp01(d[i + 10]), clamp01(d[i + 11]), clamp01(d[i + 12])], rotation: rotation + (f.turn || 0),
		material: BASE_MATERIALS.includes(material) ? material : 'particles_blend', emissive: d[i + 19] ? 0 : 1};
	if (f.facing) { q.facing = f.facing; q.direction = f.direction; }
	return q;
}

function rendererQuads() {
	let {data, strings, stride} = sim.quadsPacked();
	let out = [];
	for (let i = 0; i + stride <= data.length; i += stride) {
		let q = packedQuad(data, i, strings);
		if (q) out.push(q);
	}
	return out;
}

function draw() {
	let [w, h] = canvasSize();
	if (w !== canvas.width || h !== canvas.height) {
		canvas.width = w; canvas.height = h;
		br.resize(viewport, w, h);
	}
	br.set_camera(viewport, JSON.stringify(camera()));
	br.set_particles(viewport, JSON.stringify(rendererQuads()));
	br.render(viewport);
}

// One drawn frame: the game ticks once per frame with the real frame time (clamped to 0.1 s by the simulator).
export function frame(dt) {
	if (!sim || viewport == null || opening) return;
	if (syncEffect() || texturesChanged() || currentKey() !== sceneKey) {
		reopen();
		return;
	}
	if (!Game.paused) {
		sim.setViewDistance(Orbit.distance);
		sim.step(dt);
		Game.elapsed += dt;
		if (sim.emitters() === 0 && Game.loop_mode !== 'once') {
			idle += dt;
			if (Game.loop_mode === 'looping' || idle > 0.6) restart();
		} else idle = 0;
	}
	Game.particles = sim.count();
	collectWarnings();
	draw();
}

// The canvas of a frame drawn now (a WebGPU canvas keeps its picture only within the task that drew it).
export function screenshotURL() {
	if (viewport == null) return null;
	draw();
	return canvas.toDataURL();
}
