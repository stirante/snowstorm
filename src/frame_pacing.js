// Firefox can pace a WebGPU canvas at about 20 frames a second for minutes after it opens.
// Extra work sent to the GPU between frames for a moment brings it back to the display's rate.

const SLOW_RATE = 40;
const WAKE_TIME = 1500;
const REST_TIME = 20000;

let frames = 0;
let second_start = 0;
let rest_until = 0;

export function watchFrameRate(now, poke) {
	frames++;
	if (now - second_start < 1000) return;
	let slow = frames < SLOW_RATE && now - second_start < 1500;
	frames = 0;
	second_start = now;
	if (!slow || now < rest_until) return;
	rest_until = now + REST_TIME;
	let timer = setInterval(poke, 4);
	setTimeout(() => clearInterval(timer), WAKE_TIME);
}
