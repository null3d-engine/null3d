// How the sky is spread through a crown's outline. The review's sky gap says what share of the
// crown's outline shows background; these figures say where that share sits, so a crown whose sky
// gathers into a few holes, or whose rim is open round a solid middle, is told from one whose sky
// stands throughout. They are read from the same outline as the gap: in each crown row, the
// background between the row's outermost plant pixels.
import {
	components,
	type PlantMask,
	type PlantMeasures,
	rowSpans,
} from '../plant-review/references.ts';

/** Zones across and down the crown's box that the spread is read over. */
export const SPREAD_COLUMNS = 4;
export const SPREAD_ROWS = 3;
/** The least share of a zone that the crown's outline fills before the zone is read. */
const ZONE_LEAST = 0.25;
/** A zone holds its share of sky when its gap is at least this share of the crown's own. */
const ZONE_SHARE = 0.33;

/** Where a crown's enclosed sky sits. */
export interface GapSpread {
	/** The crown's enclosed sky as a share of its outline, from the binary outline. */
	readonly gap: number;
	/** Each zone's enclosed sky as a share of its outline there, rows from the top, or -1 when unread. */
	readonly zones: readonly number[];
	/** The share of the read zones that hold their share of sky. */
	readonly open: number;
	/** The largest connected opening's share of all the enclosed sky. */
	readonly largest: number;
	/** The connected openings of four pixels or more. */
	readonly openings: number;
	/** The gap of the outline's inner half over the gap of its outer half, by distance from the edge. */
	readonly inner: number;
}

/**
 * Where the enclosed sky of a plant's crown sits: by zone of the crown's box, by its largest
 * opening, and between the outline's middle and its rim.
 *
 * @param plant The plant's outline.
 * @param measures Its measures, for the plant's box and the crown's start.
 * @returns The spread, or undefined for an outline with no plant.
 */
export function gapSpread(plant: PlantMask, measures: PlantMeasures): GapSpread | undefined {
	const box = measures.box;
	if (!box) return undefined;
	const { width, height, mask } = plant;
	const tall = box.bottom - box.top + 1;
	const start = box.bottom - Math.round(measures.crownStart * tall);
	const spans = rowSpans(mask, width, height);
	const crown = { top: box.top, bottom: start };
	let left = width;
	let right = -1;
	for (let y = box.top; y <= start; y++) {
		const from = spans[y * 2] as number;
		if (from < 0) continue;
		left = Math.min(left, from);
		right = Math.max(right, spans[y * 2 + 1] as number);
	}
	if (right < left) return undefined;
	const hullBy = new Float64Array(SPREAD_COLUMNS * SPREAD_ROWS);
	const gapBy = new Float64Array(SPREAD_COLUMNS * SPREAD_ROWS);
	const sky = new Uint8Array(width * height);
	// Each outline pixel's distance from the outline's own edge along its row, as a share of the row.
	let hull = 0;
	let gaps = 0;
	let innerHull = 0;
	let innerGap = 0;
	let outerHull = 0;
	let outerGap = 0;
	const across = right - left + 1;
	const down = crown.bottom - crown.top + 1;
	for (let y = crown.top; y <= crown.bottom; y++) {
		const from = spans[y * 2] as number;
		if (from < 0) continue;
		const to = spans[y * 2 + 1] as number;
		const zoneRow = Math.min(SPREAD_ROWS - 1, Math.floor(((y - crown.top) * SPREAD_ROWS) / down));
		const run = to - from + 1;
		for (let x = from; x <= to; x++) {
			const zone =
				zoneRow * SPREAD_COLUMNS +
				Math.min(SPREAD_COLUMNS - 1, Math.floor(((x - left) * SPREAD_COLUMNS) / across));
			const open = mask[y * width + x] === 0;
			hull++;
			hullBy[zone] = (hullBy[zone] as number) + 1;
			const middle = Math.min(x - from, to - x) >= run / 4;
			if (middle) innerHull++;
			else outerHull++;
			if (!open) continue;
			gaps++;
			gapBy[zone] = (gapBy[zone] as number) + 1;
			sky[y * width + x] = 1;
			if (middle) innerGap++;
			else outerGap++;
		}
	}
	const gap = hull > 0 ? gaps / hull : 0;
	const zoneArea = (across / SPREAD_COLUMNS) * (down / SPREAD_ROWS);
	const zones: number[] = [];
	let read = 0;
	let open = 0;
	for (let zone = 0; zone < hullBy.length; zone++) {
		const area = hullBy[zone] as number;
		if (area < ZONE_LEAST * zoneArea) {
			zones.push(-1);
			continue;
		}
		const share = (gapBy[zone] as number) / area;
		zones.push(Number(share.toFixed(4)));
		read++;
		if (share >= ZONE_SHARE * gap) open++;
	}
	const { sizes } = components(sky, width, height);
	let largest = 0;
	let openings = 0;
	for (let label = 1; label < sizes.length; label++) {
		const size = sizes[label] as number;
		largest = Math.max(largest, size);
		if (size >= 4) openings++;
	}
	const innerShare = innerHull > 0 ? innerGap / innerHull : 0;
	const outerShare = outerHull > 0 ? outerGap / outerHull : 0;
	return {
		gap: Number(gap.toFixed(4)),
		zones,
		open: read > 0 ? Number((open / read).toFixed(4)) : 0,
		largest: gaps > 0 ? Number((largest / gaps).toFixed(4)) : 0,
		openings,
		inner: outerShare > 0 ? Number((innerShare / outerShare).toFixed(4)) : 0,
	};
}
