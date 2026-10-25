// The parts of the CSS3D ports that both the page and the sketch use, which touch no browser API:
// the stage's size, a frame wait, and the integer hash that keeps a scattered scene repeatable. The
// page's stages, which use the DOM and three.js, live in css3d-example.ts.

/** The size of every port's stage, in CSS pixels. The examples draw to the window, so a held picture
 * fixes the size and the camera's aspect. */
export const STAGE = { width: 960, height: 540 };

/** Resolves after `count` animation frames. */
export const frames = (count: number): Promise<void> =>
	new Promise((resolve) => {
		const step = () => (--count <= 0 ? resolve() : requestAnimationFrame(step));
		requestAnimationFrame(step);
	});

/**
 * A number from 0 up to 1, from an integer hash of `index` and `salt`. The examples that scatter
 * their elements use `Math.random()`, which a held picture cannot repeat, so both engines here take
 * the same scatter from this function.
 */
export function unit(index: number, salt = 0): number {
	let h = (Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
	h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
	return ((h ^ (h >>> 15)) >>> 0) / 4_294_967_296;
}
