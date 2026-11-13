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
/** The most of that distance that a pixel of the stem may stand from the stem's own colour. */
const STEM_NEAR = 0.6;
/** How far a row's run may reach past the run above it, each side, in stem widths: a root flare. */
const GROW = 0.25;
/** The least and the most of the stem's width that a row's run may be. */
const RUN_LEAST = 0.5;
const RUN_MOST = 3;
/** How much of a row's colour the stem's colour takes on, so a foot that darkens is still stem. */
const COLOUR_FOLLOWS = 0.3;
/** The rows on end that may fail before the stem has ended. */
const MISSES = 3;
/** The spread of a ground that is drawn plain, as a CIELAB distance: a silhouette's ground band. */
export const PLAIN_GROUND = 3;
/** Rows either side of the horizon within which an outline's last row ends at it. */
const AT_HORIZON = 0.015;

/** What following a stem below the horizon gives. */
export type Followed =
	| {
			readonly kind: 'stem';
			/** The row where the stem ends. */
			readonly foot: number;
			/** Each followed row's first and last column, from the row below the outline's last. */
			readonly runs: readonly (readonly [number, number])[];
	  }
	| { readonly kind: 'mass' }
	| { readonly kind: 'none' };

/** Whether an outline's last row lies at the horizon rather than in the ground below it. */
export function endsAtHorizon(box: Box, horizonRow: number, height: number): boolean {
	return box.bottom <= horizonRow + Math.max(2, Math.round(height * AT_HORIZON));
}

/** The mean colour of a run of pixels in a row, or null for a run off the frame. */
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
 * @returns The row where the stem ends with each followed row's run; `mass` where the outline's
 *   last rows are too wide to be a stem; `none` where no stem runs on below the outline.
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
	let stem = colour.map((v) => v / pixels);
	const beside = Math.max(3, across);
	const gap = Math.max(1, Math.round(across / 4));
	const grow = Math.max(1, Math.round(across * GROW));
	const blur = Math.max(1, Math.round(across / 4));
	const followed: [number, number][] = [];
	let foot = box.bottom;
	let misses = 0;
	for (let y = box.bottom + 1; y < height && misses < MISSES; y++) {
		const from = Math.max(0, left - grow);
		const to = Math.min(width - 1, right + grow);
		// The ground on each side of the row's reach; a side off the frame is left out.
		const grounds = [
			meanLab(lab, width, y, from - gap - beside, from - gap - 1),
			meanLab(lab, width, y, to + gap + 1, to + gap + beside),
		].filter((ground): ground is number[] => ground !== null);
		const ground =
			grounds.length === 0 ? 0 : Math.min(...grounds.map((side) => deltaE76(stem, side)));
		// The run of stem-coloured pixels that lies most under the run above; one pixel bridges.
		let best: [number, number] | null = null;
		let bestOver = 0;
		let start = -1;
		let last = -1;
		const close = (): void => {
			if (start < 0) return;
			const over = Math.min(last, right) - Math.max(start, left) + 1;
			if (over > bestOver) {
				bestOver = over;
				best = [start, last];
			}
			start = -1;
		};
		if (ground >= CONTRAST)
			for (let x = from; x <= to; x++) {
				// Bark is mottled, so a pixel is read with its neighbours across half a stem's width.
				const here = meanLab(lab, width, y, x - blur, x + blur) as number[];
				if (deltaE76(stem, here) >= ground * STEM_NEAR) continue;
				if (start >= 0 && x - last > 2) close();
				if (start < 0) start = x;
				last = x;
			}
		close();
		let run = best as [number, number] | null;
		const length = run ? run[1] - run[0] + 1 : 0;
		if (!run || length < Math.max(2, across * RUN_LEAST) || length > across * RUN_MOST) {
			// A foot whose bark is too mottled to hold pixel by pixel can still hold as a whole: the
			// column under the run above, taken together, against the ground beside it.
			run = null;
			let least = Number.POSITIVE_INFINITY;
			for (const shift of [0, -1, 1]) {
				const inside = meanLab(lab, width, y, left + shift, right + shift);
				const sides = [
					meanLab(lab, width, y, left + shift - gap - beside, left + shift - gap - 1),
					meanLab(lab, width, y, right + shift + gap + 1, right + shift + gap + beside),
				].filter((side): side is number[] => side !== null);
				if (!inside || sides.length === 0) continue;
				const apart = Math.min(...sides.map((side) => deltaE76(stem, side)));
				const off = deltaE76(stem, inside);
				if (apart >= CONTRAST && off < apart * STEM_NEAR && off < least) {
					least = off;
					run = [Math.max(0, left + shift), Math.min(width - 1, right + shift)];
				}
			}
		}
		if (!run) {
			misses++;
			continue;
		}
		// Rows that failed between two that hold are the stem too: they take the run below them.
		for (let k = 0; k <= misses; k++) followed.push(run);
		misses = 0;
		left = run[0];
		right = run[1];
		foot = y;
		const here = meanLab(lab, width, y, left, right) as number[];
		stem = stem.map((v, c) => v + ((here[c] as number) - v) * COLOUR_FOLLOWS);
	}
	return foot > box.bottom ? { kind: 'stem', foot, runs: followed } : { kind: 'none' };
}
