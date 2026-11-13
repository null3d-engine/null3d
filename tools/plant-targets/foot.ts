// The foot of a plant whose outline ends at the horizon. The review's outline is reliable above the
// horizon and not below it: a stem that stands against ground of nearly its own colour is lost
// there, and the plant then reads shorter than it is. Where the outline ends at the horizon on a
// stem, this follows the stem down through the ground by its colour against the ground beside it,
// to the row where it ends.
import { deltaE76 } from '../lib/plant-review/image.ts';
import type { Box } from '../lib/plant-review/references.ts';
import { axisRuns } from './shape.ts';

/** The rows above the outline's end that give the stem's place, width and colour. */
const STEM_ROWS = 6;
/** The most of the plant's width that the outline's last rows may span and still be a stem. */
const STEM_MOST = 0.25;
/** The least CIELAB distance between the stem's colour and the ground beside it. */
const CONTRAST = 6;
/** The most of that distance that a row of the stem may stand from the stem's own colour. */
const STEM_NEAR = 0.6;
/** The rows on end that may fail before the stem has ended. */
const MISSES = 3;
/** The spread of a ground that is drawn plain, as a CIELAB distance: a silhouette's ground band. */
export const PLAIN_GROUND = 3;
/** Rows either side of the horizon within which an outline's last row ends at it. */
const AT_HORIZON = 0.015;

/** What following a stem below the horizon gives. */
export type Followed =
	| { readonly kind: 'stem'; readonly foot: number; readonly left: number; readonly right: number }
	| { readonly kind: 'mass' }
	| { readonly kind: 'none' };

/** Whether an outline's last row lies at the horizon rather than in the ground below it. */
export function endsAtHorizon(box: Box, horizonRow: number, height: number): boolean {
	return box.bottom <= horizonRow + Math.max(2, Math.round(height * AT_HORIZON));
}

/** The mean colour of a run of pixels in a row, or null for an empty run. */
function meanLab(
	lab: Float32Array,
	width: number,
	y: number,
	from: number,
	to: number,
): number[] | null {
	const left = Math.max(0, from);
	const right = Math.min(width - 1, to);
	if (right < left) return null;
	const sum = [0, 0, 0];
	for (let x = left; x <= right; x++)
		for (let c = 0; c < 3; c++)
			sum[c] = (sum[c] as number) + (lab[(y * width + x) * 3 + c] as number);
	return sum.map((v) => v / (right - left + 1));
}

/**
 * Follows a stem down from the last row of an outline.
 *
 * @param lab The picture's CIELAB colours at the mask's size.
 * @param width The mask's width.
 * @param height The mask's height.
 * @param mask The plant's outline.
 * @param box The plant's box.
 * @param axis The column of the plant's foot.
 * @returns The row where the stem ends and its columns there; `mass` where the outline's last rows
 *   are too wide to be a stem; `none` where no stem runs on below the outline.
 */
export function followStem(
	lab: Float32Array,
	width: number,
	height: number,
	mask: Uint8Array,
	box: Box,
	axis: number,
): Followed {
	const runs = axisRuns(mask, width, box, axis);
	const lefts: number[] = [];
	const rights: number[] = [];
	const colour = [0, 0, 0];
	let pixels = 0;
	for (let y = box.bottom; y > Math.max(box.top, box.bottom - STEM_ROWS); y--) {
		const from = runs[y * 2] as number;
		if (from < 0) continue;
		const to = runs[y * 2 + 1] as number;
		lefts.push(from);
		rights.push(to);
		for (let x = from; x <= to; x++) {
			for (let c = 0; c < 3; c++)
				colour[c] = (colour[c] as number) + (lab[(y * width + x) * 3 + c] as number);
			pixels++;
		}
	}
	if (pixels === 0) return { kind: 'none' };
	lefts.sort((a, b) => a - b);
	rights.sort((a, b) => a - b);
	let left = lefts[lefts.length >> 1] as number;
	let right = rights[rights.length >> 1] as number;
	const across = right - left + 1;
	if (across > (box.right - box.left + 1) * STEM_MOST) return { kind: 'mass' };
	const stem = colour.map((v) => v / pixels);
	const beside = Math.max(3, across);
	const gap = Math.max(1, Math.round(across / 4));
	let foot = box.bottom;
	let misses = 0;
	for (let y = box.bottom + 1; y < height && misses < MISSES; y++) {
		let best: { shift: number; off: number } | null = null;
		for (const shift of [0, -1, 1]) {
			const inside = meanLab(lab, width, y, left + shift, right + shift);
			if (!inside) continue;
			// The ground on each side of the stem in this row; a side off the frame is left out.
			const grounds = [
				meanLab(lab, width, y, left + shift - gap - beside, left + shift - gap - 1),
				meanLab(lab, width, y, right + shift + gap + 1, right + shift + gap + beside),
			].filter((ground): ground is number[] => ground !== null);
			if (grounds.length === 0) continue;
			const ground = Math.min(...grounds.map((g) => deltaE76(stem, g)));
			const off = deltaE76(stem, inside);
			if (ground >= CONTRAST && off < ground * STEM_NEAR && (!best || off < best.off))
				best = { shift, off };
		}
		if (!best) {
			misses++;
			continue;
		}
		misses = 0;
		left += best.shift;
		right += best.shift;
		foot = y;
	}
	return foot > box.bottom ? { kind: 'stem', foot, left, right } : { kind: 'none' };
}
