// The preview camera: an orbit around a target, driven by mouse, wheel and touch on the renderer's canvas.
// Left drag / one finger turns, right or middle drag / shift drag / two fingers pan, wheel / pinch zooms.
export const Orbit = {
	target: [0, 0.8, 0],
	yaw: Math.atan2(-6, -6),
	pitch: Math.asin(2.2 / Math.hypot(6, 2.2, 6)),
	distance: Math.hypot(6, 2.2, 6),
	fov: 45,
};

const pointers = new Map();
let pinch = 0;

export function position() {
	let c = Math.cos(Orbit.pitch);
	let [x, y, z] = Orbit.target;
	return [x + Orbit.distance * c * Math.sin(Orbit.yaw), y + Orbit.distance * Math.sin(Orbit.pitch), z + Orbit.distance * c * Math.cos(Orbit.yaw)];
}

function seesTarget(solid) {
	let p = position(), t = Orbit.target;
	for (let k = 0.05; k <= 1; k += 0.025) {
		if (solid(...[0, 1, 2].map(i => Math.floor(t[i] + (p[i] - t[i]) * k)))) return false;
	}
	return true;
}

// When blocks stand between the camera and the target (a scanned area), turns and then raises it to the first clear view.
export function unblock(solid) {
	if (seesTarget(solid)) return;
	let {yaw, pitch} = Orbit;
	for (let up = 0; up < 7; up++) {
		for (let turn = 0; turn < 8; turn++) {
			Orbit.yaw = yaw + turn * Math.PI / 4;
			Orbit.pitch = Math.min(1.5, pitch + up * 0.2);
			if (seesTarget(solid)) return;
		}
	}
	Orbit.yaw = yaw;
	Orbit.pitch = 1.5;
}

export function camera() {
	return {pos: position(), look_at: [...Orbit.target], fov: Orbit.fov};
}

function turn(dx, dy, height) {
	let k = 2 * Math.PI / Math.max(height, 1);
	Orbit.yaw -= dx * k;
	Orbit.pitch = Math.max(-1.55, Math.min(1.55, Orbit.pitch + dy * k));
}

function pan(dx, dy, height) {
	let scale = 2 * Orbit.distance * Math.tan(Orbit.fov * Math.PI / 360) / Math.max(height, 1);
	let right = [Math.cos(Orbit.yaw), 0, -Math.sin(Orbit.yaw)];
	let s = Math.sin(Orbit.pitch);
	let up = [-s * Math.sin(Orbit.yaw), Math.cos(Orbit.pitch), -s * Math.cos(Orbit.yaw)];
	for (let i = 0; i < 3; i++) Orbit.target[i] += (-dx * right[i] + dy * up[i]) * scale;
}

function zoom(factor) {
	Orbit.distance = Math.max(0.5, Math.min(400, Orbit.distance * factor));
}

function spread() {
	let [a, b] = [...pointers.values()];
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function centre() {
	let ps = [...pointers.values()];
	return {x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length};
}

export function attach(canvas) {
	canvas.style.touchAction = 'none';
	canvas.addEventListener('contextmenu', e => e.preventDefault());
	canvas.addEventListener('pointerdown', e => {
		canvas.setPointerCapture(e.pointerId);
		pointers.set(e.pointerId, {x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey});
		if (pointers.size === 2) pinch = spread();
	});
	canvas.addEventListener('pointermove', e => {
		let p = pointers.get(e.pointerId);
		if (!p) return;
		let h = canvas.clientHeight;
		if (pointers.size >= 2) {
			let before = centre();
			p.x = e.clientX; p.y = e.clientY;
			let after = centre(), d = spread();
			pan(after.x - before.x, after.y - before.y, h);
			if (pinch > 0 && d > 0) zoom(pinch / d);
			pinch = d;
			return;
		}
		let dx = e.clientX - p.x, dy = e.clientY - p.y;
		p.x = e.clientX; p.y = e.clientY;
		if (p.button === 0 && !p.shift && !e.shiftKey) turn(dx, dy, h);
		else pan(dx, dy, h);
	});
	let up = e => { pointers.delete(e.pointerId); pinch = pointers.size === 2 ? spread() : 0; };
	canvas.addEventListener('pointerup', up);
	canvas.addEventListener('pointercancel', up);
	canvas.addEventListener('wheel', e => {
		e.preventDefault();
		zoom(Math.exp(e.deltaY * 0.0015));
	}, {passive: false});
}
