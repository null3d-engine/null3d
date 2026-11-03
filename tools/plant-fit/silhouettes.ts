// The outlines of a whole plant round its turning video, as the envelope reads them. Each frame's
// plant comes from the review tool's mask, which separates it from a plain sky and meadow. Its
// outline is scaled to the plant's own height with the plant's axis on the middle column, on a grid
// of a fixed number of cells over the height, rows from the ground up. In the lowest fifth of the
// plant a pixel stays only where the outline runs at least three cells' height up or down through
// it, which drops a horizon line or a strip of grass that the mask kept along the plant's foot.
//
// The camera turns round the plant's axis, so the axis stands on one column of every frame. Each
// frame gives the column of its plant's foot, the trunk's where there is one; the median over the
// views is the axis. One frame alone can mislead: low leaves or a shadow on one side pull a
// stemless plant's foot toward that side.
//
// A turning video turns at a steady rate from its first frame to its last, which stands at the end
// of its arc: over a full turn the last frame shows the first one's plant again. How far the two
// outlines overlap says how much the plant drifted over the turn. The direction of the turn cannot
// be told from outlines, since a plant and its mirror image show the same outlines from opposite
// turns.
import { anchorColumn, iou, normalise } from '../lib/plant-review/compare.ts';
import type { Rgba } from '../lib/plant-review/image.ts';
import {
	type Box,
	boxOf,
	keepPlantParts,
	measurePlant,
	type PlantMask,
	type PlantMeasures,
	plantMask,
} from '../lib/plant-review/references.ts';

/** Grid cells over the plant's height. */
export const CELLS = 96;
/** Plant heights each side of the trunk that the grid holds. */
export const SPAN = 1.3;
/** Grid cells across. */
export const COLUMNS = Math.round(2 * SPAN * CELLS);
/** The share of the plant's height, from the ground, in which thin horizontal runs are dropped. */
const LOW_SHARE = 0.2;
/** The least run up and down, in grid cells, through a pixel of the plant's lowest share. */
const LOW_RUN = 3;

/** One frame's plant: its mask, box and foot, or why the envelope may not read it. */
export interface FrameOutline {
	/** The frame's index in the video. */
	readonly frame: number;
	/** The mask without thin strips along the plant's foot, and the plant's box in it. */
	readonly mask: PlantMask;
	readonly box: Box | null;
	/** The column of the plant's foot in the mask's pixels, or null without a plant. */
	readonly foot: number | null;
	/** The review tool's measures of the frame, from its own mask. */
	readonly measures: PlantMeasures;
	/** Why the frame has no outline the envelope may read. */
	readonly problem?: string;
}

/** A cell's centre in plant heights from the trunk, positive to the right. */
export function columnX(col: number): number {
	return (col + 0.5) / CELLS - COLUMNS / 2 / CELLS;
}

/**
 * A mask without the thin horizontal runs of the plant's lowest share: a pixel there stays only
 * where the outline runs `LOW_RUN` grid cells' height up or down through it, as a trunk or a tuft
 * does and a horizon line or a ground strip does not.
 */
export function dropThinLowRuns(plant: PlantMask, box: Box): PlantMask {
	const { width, height } = plant;
	const tall = box.bottom - box.top + 1;
	const run = Math.max(2, Math.round((LOW_RUN * tall) / CELLS));
	const from = box.bottom - Math.round(LOW_SHARE * tall);
	const mask = plant.mask.slice();
	for (let y = Math.max(0, from); y <= box.bottom; y++)
		for (let x = 0; x < width; x++) {
			const at = y * width + x;
			if (!plant.mask[at]) continue;
			let length = 1;
			for (let d = 1; d < run && y + d < height && plant.mask[at + d * width]; d++) length++;
			for (let d = 1; d < run && y - d >= 0 && plant.mask[at - d * width]; d++) length++;
			if (length < run) mask[at] = 0;
		}
	keepPlantParts(mask, width, height, plant.background.horizon ?? height);
	return { ...plant, mask };
}

/**
 * A frame's outline on the grid: scaled so the plant's height fills the grid's rows, the axis on
 * the middle column, rows from the ground up. Null when the frame shows no plant to read.
 *
 * @param outline The frame's plant.
 * @param axis The column of the plant's axis in the mask's pixels.
 */
export function outlineGrid(outline: FrameOutline, axis: number): Uint8Array | null {
	const { box, mask } = outline;
	if (!box || outline.problem) return null;
	const down = normalise(mask, box, axis, box.bottom, CELLS, COLUMNS);
	const grid = new Uint8Array(CELLS * COLUMNS);
	for (let row = 0; row < CELLS; row++)
		grid.set(down.subarray((CELLS - 1 - row) * COLUMNS, (CELLS - row) * COLUMNS), row * COLUMNS);
	return grid;
}

/** The plant of one frame of a turning video of the whole plant. */
export function frameOutline(image: Rgba, frame: number): FrameOutline {
	const mask = plantMask(image);
	const measures = measurePlant(image, mask);
	const problem = !mask.background.plain
		? 'the background is not plain'
		: !measures.box
			? 'no plant is found'
			: measures.clipped.left || measures.clipped.right || measures.clipped.top
				? 'the plant runs off the frame'
				: measures.clipped.bottom
					? "the plant's foot is out of the frame"
					: undefined;
	if (problem || !measures.box)
		return {
			frame,
			mask,
			box: null,
			foot: null,
			measures,
			problem: problem ?? 'no plant is found',
		};
	const plant = dropThinLowRuns(mask, measures.box);
	const box = boxOf(plant.mask, plant.width, plant.height);
	if (!box) return { frame, mask, box: null, foot: null, measures, problem: 'no plant is found' };
	return {
		frame,
		mask: plant,
		box,
		foot: anchorColumn(plant.mask, plant.width, plant.height, box),
		measures,
	};
}

/**
 * How far the last frame of a full turn shows the first frame's plant again: the overlap of their
 * outlines, or null for a shorter arc or a frame with no outline.
 */
export function closingOverlap(
	first: Uint8Array | null,
	last: Uint8Array | null,
	arc: number,
): number | null {
	return arc >= 360 && first && last ? Number(iou(first, last).toFixed(4)) : null;
}
