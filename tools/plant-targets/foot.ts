// A plant whose outline ends at the horizon on a wide foot. The review's outline follows a stem
// below the horizon to its foot, and it cannot follow a tuft or a colony there: a mass that stands
// against ground of nearly its own colour is lost below the horizon line. These helpers tell such
// an outline, so its figures are refused and not read from half a plant.
import { axisRuns, type Box, FOOT_STEM_SHARE } from '../lib/plant-review/references.ts';

/** The rows above the outline's end whose run is the foot's. */
const FOOT_ROWS = 6;
/** The spread of a ground that is drawn plain, as a CIELAB distance: a silhouette's ground band. */
export const PLAIN_GROUND = 3;
/** Rows either side of the horizon within which an outline's last row ends at it. */
const AT_HORIZON = 0.015;

/** Whether an outline's last row lies at the horizon rather than in the ground below it. */
export function endsAtHorizon(box: Box, horizonRow: number, height: number): boolean {
	return box.bottom <= horizonRow + Math.max(2, Math.round(height * AT_HORIZON));
}

/**
 * Whether the outline's last rows are too wide to be a stem: the middle width of the run nearest
 * the axis, against the share of the plant's width that the review's stem follower takes as a stem.
 */
export function wideFoot(mask: Uint8Array, width: number, box: Box, axis: number): boolean {
	const runs = axisRuns(mask, width, box, axis);
	const widths: number[] = [];
	for (let y = box.bottom; y > Math.max(box.top, box.bottom - FOOT_ROWS); y--)
		if ((runs[y * 2] as number) >= 0)
			widths.push((runs[y * 2 + 1] as number) - (runs[y * 2] as number) + 1);
	widths.sort((a, b) => a - b);
	return (widths[widths.length >> 1] ?? 0) > (box.right - box.left + 1) * FOOT_STEM_SHARE;
}
