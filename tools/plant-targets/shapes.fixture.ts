// Drawn shapes with known answers for the plant targets' tests: masks of one byte per pixel on a
// square frame, built from discs, boxes and lines.
import type { Box } from '../lib/plant-review/references.ts';

/** The test frame's width and height in pixels. */
export const WIDTH = 400;
export const HEIGHT = 400;

/** An empty mask of the test size. */
export function empty(): Uint8Array {
	return new Uint8Array(WIDTH * HEIGHT);
}

/** Draws a disc into a mask. */
export function disc(mask: Uint8Array, cx: number, cy: number, radius: number, value = 1): void {
	for (let y = 0; y < HEIGHT; y++)
		for (let x = 0; x < WIDTH; x++)
			if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) mask[y * WIDTH + x] = value;
}

/** Draws a box into a mask, edges included. */
export function fill(
	mask: Uint8Array,
	left: number,
	top: number,
	right: number,
	bottom: number,
	value = 1,
): void {
	for (let y = top; y <= bottom; y++)
		for (let x = left; x <= right; x++) mask[y * WIDTH + x] = value;
}

/** Draws a line of a thickness into a mask. */
export function line(
	mask: Uint8Array,
	ax: number,
	ay: number,
	bx: number,
	by: number,
	thick: number,
): void {
	const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
	for (let k = 0; k <= steps; k++)
		disc(mask, ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, thick / 2);
}

/** The box round a mask's pixels. */
export function boxOf(mask: Uint8Array): Box {
	let left = WIDTH;
	let top = HEIGHT;
	let right = -1;
	let bottom = -1;
	for (let y = 0; y < HEIGHT; y++)
		for (let x = 0; x < WIDTH; x++)
			if (mask[y * WIDTH + x]) {
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
	return { left, top, right, bottom };
}

/** A round crown of a radius on a stem that leans by a set angle, standing on the frame's foot row. */
export function lollipop(lean: number, stemWidth = 10): { mask: Uint8Array; crownRow: number } {
	const mask = empty();
	const foot = 380;
	const top = 200;
	const slope = Math.tan((lean * Math.PI) / 180);
	for (let y = top; y <= foot; y++) {
		const centre = 200 + slope * (foot - y);
		fill(mask, Math.round(centre - stemWidth / 2), y, Math.round(centre + stemWidth / 2) - 1, y);
	}
	disc(mask, 200 + slope * (foot - top), 120, 90);
	return { mask, crownRow: 209 };
}
