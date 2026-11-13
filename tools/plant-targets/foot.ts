// A plant whose outline ends at the horizon on a lost foot. The review's outline follows a stem
// below the horizon to its foot, and it cannot follow a tuft, a colony or thin stalks there: a part
// that stands against ground of nearly its own colour is lost below the horizon line. These helpers
// tell such an outline, so its figures are refused and not read from part of a plant.
import { deltaE76, labImage, type Rgba, resizeToWidth } from '../lib/plant-review/image.ts';
import { axisRuns, type Box, type PlantMask } from '../lib/plant-review/references.ts';

/** The rows above the outline's end whose run is the foot's. */
const FOOT_ROWS = 6;
/** The spread of a ground that is drawn plain, as a CIELAB distance: a silhouette's ground band. */
export const PLAIN_GROUND = 3;
/**
 * The least CIELAB distance between a foot's colour and the ground's under it for the foot to stand
 * in view: about half the least that a reference's foot standing in view was measured apart, and
 * five times what a reference's tuft that runs on below the horizon was.
 */
const FOOT_IN_VIEW = 15;
/** Rows either side of the horizon within which an outline's last row ends at it. */
const AT_HORIZON = 0.015;
/** The most of a plant's height that the ground below a wide foot at the horizon may hide before the outline is refused. */
const MASS_LOSS = 0.1;

/** Whether an outline's last row lies at the horizon rather than in the ground below it. */
export function endsAtHorizon(box: Box, horizonRow: number, height: number): boolean {
	return box.bottom <= horizonRow + Math.max(2, Math.round(height * AT_HORIZON));
}

/** The run nearest the axis in each of the outline's last rows that holds one, lowest first. */
function footRuns(mask: Uint8Array, width: number, box: Box, axis: number): [number, number][] {
	const runs = axisRuns(mask, width, box, axis);
	const found: [number, number][] = [];
	for (let y = box.bottom; y > Math.max(box.top, box.bottom - FOOT_ROWS); y--)
		if ((runs[y * 2] as number) >= 0)
			found.push([runs[y * 2] as number, runs[y * 2 + 1] as number]);
	return found;
}

/** The middle value of a list of numbers, or 0 for an empty list. */
function middle(values: number[]): number {
	values.sort((a, b) => a - b);
	return values[values.length >> 1] ?? 0;
}

/**
 * Whether a foot that ends at the horizon stands in view on the ground: the rows under its run are
 * of another colour than the foot. A tuft or a colony that runs on below the horizon keeps its own
 * colour there, where the ground's fitted colour lost it.
 *
 * @param lab The picture's CIELAB colours at the mask's size.
 */
export function footInView(
	lab: Float32Array,
	width: number,
	height: number,
	mask: Uint8Array,
	box: Box,
	axis: number,
): boolean {
	const found = footRuns(mask, width, box, axis);
	const from = middle(found.map(([left]) => left));
	const to = middle(found.map(([, right]) => right));
	const mean = (rows: readonly number[]): number[] | null => {
		const sum = [0, 0, 0];
		let pixels = 0;
		for (const y of rows)
			for (let x = from; x <= to; x++) {
				for (let c = 0; c < 3; c++)
					sum[c] = (sum[c] as number) + (lab[(y * width + x) * 3 + c] as number);
				pixels++;
			}
		return pixels === 0 ? null : sum.map((v) => v / pixels);
	};
	const rows = (start: number, end: number): number[] =>
		Array.from({ length: Math.max(0, end - start + 1) }, (_, k) => start + k);
	const foot = mean(rows(box.bottom - FOOT_ROWS + 1, box.bottom));
	const under = mean(rows(box.bottom + 1, Math.min(height - 1, box.bottom + FOOT_ROWS)));
	return foot !== null && under !== null && deltaE76(foot, under) >= FOOT_IN_VIEW;
}

/**
 * Whether a whole plant's outline has lost its foot: it ends at the horizon where the review's stem
 * follower followed no stem below it, over a photographed ground and not a plain band, a real share
 * of its height above the frame's foot, and the rows under it keep its own colour. A mass too wide
 * to be a stem, a tuft or a colony, is lost so, and so are thin stalks standing in grass of their
 * own colour, which the follower does not take for a stem. A trunk that meets the ground at the
 * horizon stands in view on it, of another colour.
 *
 * @param image The picture.
 * @param plant Its plant mask, at the work size.
 * @param box The outline's box in the mask.
 * @param horizon The horizon as a share of the picture's height, or null where none is in view.
 * @param axis The column of the plant's axis in the mask.
 */
export function footLost(
	image: Rgba,
	plant: PlantMask,
	box: Box,
	horizon: number | null,
	axis: number,
): boolean {
	const { width, height, background } = plant;
	if (horizon === null || plant.footFollowedFrom !== undefined) return false;
	if ((background.ground?.noise ?? 0) < PLAIN_GROUND) return false;
	if (!endsAtHorizon(box, Math.floor(horizon * height), height)) return false;
	if ((height - 1 - box.bottom) / (box.bottom - box.top + 1) < MASS_LOSS) return false;
	const lab = labImage(image.width > width ? resizeToWidth(image, width) : image);
	return !footInView(lab, width, height, plant.mask, box, axis);
}
