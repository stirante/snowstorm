// The game preview: particle-sim (the game's particle rules, Go on molang-go) simulates the effect and
// bedrock-renderer (the game's Fancy / Vibrant Visuals pipelines, WebGPU) draws its particles on a transparent
// canvas over the three.js view, which keeps the grid, axes and reference models. Engine 'wintersky' is the original.
import {generateFile} from './export'
import {Config, Scene} from './emitter'
import {EventSubEffects} from './event_sub_effects'

const BASE = '/snow';
const ENGINES = ['fancy', 'vibrant', 'wintersky'];

export const Game = {
	engine: storedEngine(),
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
let effectText = '', effectId = '', textures = {}, idle = 0, opening = null;

function storedEngine() {
	let v = null;
	try { v = localStorage.getItem('snowstorm_engine'); } catch (e) {}
	if (!navigator.gpu) return 'wintersky';
	return ENGINES.includes(v) ? v : 'fancy';
}
function storedTime() {
	try { let t = parseFloat(localStorage.getItem('snowstorm_time')); return Number.isFinite(t) ? t : 0; } catch (e) { return 0; }
}
const vendor = file => new URL('vendor/' + file, document.baseURI).href;

function loadScript(src) {
	return new Promise((resolve, reject) => {
		let s = document.createElement('script');
		s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('cannot load ' + src));
		document.head.append(s);
	});
}

async function loadSim() {
	if (!window.Go) await loadScript(vendor('particle-sim/wasm_exec.js'));
	let go = new window.Go();
	let bytes = await (await fetch(vendor('particle-sim/particle-sim.wasm'))).arrayBuffer();
	let {instance} = await WebAssembly.instantiate(bytes, go.importObject);
	go.run(instance);
	return window.particleSim;
}

async function loadRenderer() {
	let mod = await import(/* webpackIgnore: true */ vendor('renderer/bedrock_renderer_web.js'));
	await mod.default();
	await mod.init();
	return mod;
}

export function isGame() {
	return Game.engine !== 'wintersky';
}

export async function initGame(three_view) {
	view = three_view;
	canvas = document.createElement('canvas');
	canvas.className = 'game_canvas';
	view.canvas.parentNode.insertBefore(canvas, view.canvas.nextSibling);
	await setEngine(Game.engine);
}

export async function setEngine(engine) {
	Game.engine = engine;
	try { localStorage.setItem('snowstorm_engine', engine); } catch (e) {}
	closeViewport();
	Scene.space.visible = !isGame();
	if (!isGame()) return;
	Game.status = 'Loading the game renderer…';
	try {
		if (!sim) sim = await loadSim();
		if (!br) br = await loadRenderer();
		effectText = '';
		syncEffect();
		await openViewport();
		Game.status = '';
	} catch (e) {
		console.error(e);
		Game.status = 'Game preview failed: ' + (e.message || e) + ' (Wintersky shown)';
		Game.engine = 'wintersky';
		Scene.space.visible = true;
	}
}

export function setTime(t) {
	Game.time = t;
	try { localStorage.setItem('snowstorm_time', String(t)); } catch (e) {}
	if (viewport != null) br.set_time(viewport, t);
}

function sceneJSON() {
	let [w, h] = canvasSize();
	return JSON.stringify({size: [w, h], camera: camera(), mode: Game.engine, rp: [BASE], background: 'transparent', clouds: false,
		time: Game.time, objects: [], particles: []});
}

function canvasSize() {
	let dpr = Math.min(window.devicePixelRatio || 1, 2);
	let w = view.canvas.clientWidth || 300, h = view.canvas.clientHeight || 200;
	return [Math.max(16, Math.round(w * dpr)), Math.max(16, Math.round(h * dpr))];
}

function camera() {
	let p = view.camera.position, t = view.controls.target;
	return {pos: [p.x, p.y, p.z], look_at: [t.x, t.y, t.z], fov: view.camera.fov};
}

async function openViewport() {
	if (opening) return opening;
	opening = (async () => {
		await uploadTextures();
		let text = sceneJSON();
		let req = JSON.parse(br.required_files(text, BASE));
		if (req.error) throw new Error(req.error);
		[canvas.width, canvas.height] = JSON.parse(text).size;
		viewport = br.open(canvas, text, BASE);
		for (let w of br.take_warnings()) console.warn('renderer:', w);
		canvas.style.display = '';
	})();
	try { await opening; } finally { opening = null; }
}

function closeViewport() {
	if (viewport != null) br.close(viewport);
	viewport = null;
	if (canvas) canvas.style.display = 'none';
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
	let changed = false;
	for (let [id, config] of Object.entries(configs())) {
		let img = imageOf(config);
		if (!img || textures[id] === img.src) continue;
		let c = document.createElement('canvas');
		c.width = img.naturalWidth; c.height = img.naturalHeight;
		c.getContext('2d').drawImage(img, 0, 0);
		let blob = await new Promise(r => c.toBlob(r, 'image/png'));
		br.add_asset(BASE + '/' + textureKey(id) + '.png', new Uint8Array(await blob.arrayBuffer()));
		textures[id] = img.src;
		changed = true;
	}
	return changed;
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
	let file = generateFile();
	let text = JSON.stringify(file);
	let subs = JSON.stringify(Object.keys(EventSubEffects).map(k => EventSubEffects[k]?.json || null));
	if (text + subs === effectText) return false;
	effectText = text + subs;
	for (let id in EventSubEffects) {
		let json = EventSubEffects[id]?.json;
		let r = json && sim.add(JSON.stringify(json));
		if (r && r.error) console.warn(id, r.error);
	}
	let r = sim.add(text);
	effectId = r.id || '';
	restart();
	if (r.error) Game.warnings.unshift(r.error);
	return true;
}

export function restart() {
	if (!sim) return;
	sim.reset(1);
	sim.setFloor(Game.collision);
	Game.elapsed = 0;
	idle = 0;
	Game.warnings = [];
	if (effectId) sim.spawn(effectId, 0, 0, 0, JSON.stringify(vars()));
	collectWarnings();
}

function collectWarnings() {
	for (let w of JSON.parse(sim.warnings()) || []) if (!Game.warnings.includes(w)) Game.warnings.push(w);
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

function rendererQuads(quads) {
	let out = [];
	for (let p of quads) {
		if (!textures[p.effect]) continue;
		if (!(Math.abs(p.size[0]) > 1e-4 && Math.abs(p.size[1]) > 1e-4)) continue;
		let f = facing(p.mode, p.dir);
		let q = {texture: textureKey(p.effect), pos: p.pos, size: [Math.abs(p.size[0]), Math.abs(p.size[1])], uv: p.uv,
			color: p.color.map(x => Math.min(1, Math.max(0, x))), rotation: p.rotation + (f.turn || 0),
			material: BASE_MATERIALS.includes(p.material) ? p.material : 'particles_blend', emissive: p.lit ? 0 : 1};
		if (f.facing) { q.facing = f.facing; q.direction = f.direction; }
		if ([...q.pos, ...q.uv, q.rotation].every(Number.isFinite)) out.push(q);
	}
	return out;
}

// One drawn frame: the game ticks once per frame with the real frame time (clamped to 0.1 s by the simulator).
export function frame(dt) {
	if (!isGame() || !sim || viewport == null || opening) return;
	if (syncEffect() || texturesChanged()) {
		closeViewport();
		openViewport().catch(e => { Game.status = 'Renderer: ' + (e.message || e); });
		return;
	}
	if (!Game.paused) {
		sim.setViewDistance(view.camera.position.distanceTo(view.controls.target));
		sim.step(dt);
		Game.elapsed += dt;
		if (sim.emitters() === 0 && Game.loop_mode !== 'once') {
			idle += dt;
			if (Game.loop_mode === 'looping' || idle > 0.6) restart();
		} else idle = 0;
	}
	Game.particles = sim.count();
	let [w, h] = canvasSize();
	if (w !== canvas.width || h !== canvas.height) {
		canvas.width = w; canvas.height = h;
		br.resize(viewport, w, h);
	}
	br.set_camera(viewport, JSON.stringify(camera()));
	br.set_particles(viewport, JSON.stringify(rendererQuads(JSON.parse(sim.quads()) || [])));
	collectWarnings();
	br.render(viewport);
}
