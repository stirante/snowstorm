// The preview: bedrock-renderer simulates the effect (particle-sim, the game's particle rules, built into its WASM)
// and draws it with the game's Fancy / Vibrant Visuals pipelines (WebGPU) on the preview canvas, with the environment
// and the guides. The camera is orbit.js.
import {generateFile} from './export'
import {Config, Scene} from './emitter'
import {EventSubEffects} from './event_sub_effects'
import {OptionValues} from './options'
import {Orbit, camera, unblock} from './orbit'

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

let br = null, viewport = null, canvas = null, view = null;
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
		sentCamera = '';
		await applyCollision();
		await unblockCamera();
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

async function unblockCamera() {
	let env = environment();
	if (!env.scan || !scans[env.id]) return;
	let {origin, size} = scans[env.id], cells = await solidOf(env.id);
	unblock((x, y, z) => {
		let [i, j, k] = [x - origin[0], y - origin[1], z - origin[2]];
		return i >= 0 && j >= 0 && k >= 0 && i < size[0] && j < size[1] && k < size[2] && cells[i + size[0] * (k + size[2] * j)] !== 0;
	});
}

async function applyCollision() {
	let env = environment();
	br.sim_set_floor(Game.collision && !env.scan);
	br.sim_clear_solid();
	if (env.scan && Game.collision && scans[env.id]) {
		let {origin, size} = scans[env.id];
		br.sim_set_solid(...origin, ...size, await solidOf(env.id));
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
		br.sim_set_texture(id, textureKey(id));
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
	let add = (json, label) => { try { return br.sim_add(json); } catch (e) { errors.push(label + (e.message || String(e))); return ''; } };
	effectId = add(text, '');
	for (let id in EventSubEffects) {
		let json = EventSubEffects[id]?.json;
		if (json) add(JSON.stringify(json), id + ': ');
	}
	restart();
	Game.warnings.unshift(...errors);
	return true;
}

export function restart() {
	if (!br) return;
	br.sim_reset(1);
	Game.elapsed = 0;
	idle = 0;
	Game.warnings = Game.warnings.filter(w => w.startsWith('Renderer: '));
	applyCollision().catch(e => { Game.status = e.message || String(e); });
	if (effectId) br.sim_spawn(effectId, 0, 0, 0, JSON.stringify(vars()));
	collectWarnings();
}

function collectWarnings() {
	let found = br.sim_warnings();
	for (let w of br.take_warnings()) if (!/^(sky|sun|moon|cloud)/i.test(w)) found.push('Renderer: ' + w);
	for (let w of found) if (!Game.warnings.includes(w)) Game.warnings.push(w);
}

let sentCamera = '';

function draw() {
	let [w, h] = canvasSize();
	if (w !== canvas.width || h !== canvas.height) {
		canvas.width = w; canvas.height = h;
		br.resize(viewport, w, h);
	}
	let cam = JSON.stringify(camera());
	if (cam !== sentCamera) {
		br.set_camera(viewport, cam);
		sentCamera = cam;
	}
	br.sim_draw(viewport);
	br.render(viewport);
}

// One drawn frame: the game ticks once per frame with the real frame time (clamped to 0.1 s by the simulator).
export function frame(dt) {
	if (!br || viewport == null || opening) return;
	if (syncEffect() || texturesChanged() || currentKey() !== sceneKey) {
		reopen();
		return;
	}
	if (!Game.paused) {
		br.sim_set_view_distance(Orbit.distance);
		br.sim_step(dt);
		Game.elapsed += dt;
		if (br.sim_emitters() === 0 && Game.loop_mode !== 'once') {
			idle += dt;
			if (Game.loop_mode === 'looping' || idle > 0.6) restart();
		} else idle = 0;
	}
	Game.particles = br.sim_count();
	collectWarnings();
	draw();
}

// The canvas of a frame drawn now (a WebGPU canvas keeps its picture only within the task that drew it).
export function screenshotURL() {
	if (viewport == null) return null;
	draw();
	return canvas.toDataURL();
}
