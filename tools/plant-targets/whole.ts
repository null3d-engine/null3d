// One view of a whole plant, measured: a still, or one frame of the turning video. The outline is
// the review tool's, cleaned of the ground strip at the plant's foot as the fit tool cleans it, and
// the crown's start and its two gap figures are the review's own. The stem, the radius profile, the
// lumps and the holes are read from the same outline.
import { deltaE76, labImage, labOf, type Rgba, resizeToWidth } from '../lib/plant-review/image.ts';
import {
	type Box,
	measurePlant,
	type PlantMask,
	surfaceAt,
} from '../lib/plant-review/references.ts';
import { frameOutline } from '../plant-fit/silhouettes.ts';
import { endsAtHorizon, followStem, PLAIN_GROUND } from './foot.ts';
import {
	axisRuns,
	envelopeOf,
	type LimbFigures,
	type LobeFigures,
	limbsOf,
	lobesOf,
	rounded,
	type SkyFigures,
	skyOf,
	stemOf,
} from './shape.ts';

/**
 * The most of a plant's height that the ground below a wide foot at the horizon may hide before
 * the outline is refused.
 */
const MASS_LOSS = 0.1;
/** The share of the frame's height, each side of the horizon, whose rows blend sky and ground. */
const HORIZON_BLEND = 0.006;

/** The figures of one view of a whole plant. */
export interface ViewFigures {
	/** The plant's height over its width. */
	readonly heightToWidth: number;
	readonly foot: {
		/**
		 * Rows of the picture at its own size, counted from its top: the picture's height, the
		 * horizon line or null without one, the last row of the review's outline, and the row where
		 * the plant meets the ground. Every share of the height is taken from the foot's row.
		 */
		readonly rows: {
			readonly frame: number;
			readonly horizon: number | null;
			readonly outline: number;
			readonly foot: number;
		};
		/** The share of the plant's height that stands below the picture's horizon line. */
		readonly belowHorizon: number;
		/**
		 * The share of the plant's height that the stem was followed through the ground, where the
		 * review's outline ended at the horizon. The outline holds only the stem's column there.
		 */
		readonly followed: number;
	};
	readonly crown: {
		/** The crown's height over its width. */
		readonly heightToWidth: number;
		/** Where the crown starts, as a share of the plant's height up from its foot. */
		readonly base: number;
		/** The crown's width over the plant's height. */
		readonly width: number;
	};
	readonly trunk: {
		/** The bare stem's share of the plant's height, from the foot to the first fork or foliage. */
		readonly bareShare: number | null;
		/** The stem's own width over the plant's height, clear of the flare. */
		readonly width: number | null;
		/**
		 * Whether the foot's run reaches the plant's top with no fork: the plant is one column. An
		 * outline cannot say whether a column is a stem, as a cactus's, or foliage, as a cypress's.
		 */
		readonly column: boolean;
		/** The stem's width at breast height over the plant's height. */
		readonly breastHeightWidth: number | null;
		/** The width at the foot over the stem's own width. */
		readonly flare: number | null;
		/** Degrees the bare stem leans from upright, positive to the picture's right. */
		readonly lean: number | null;
		/** The stems that stand apart between the foot and the crown. */
		readonly stems: number | null;
	};
	/** The limbs that show apart at the first fork, or null where they cannot be counted. */
	readonly limbs: LimbFigures | null;
	/** The outline's reach each side of the axis in height bands from the ground up. */
	readonly envelope: { readonly left: readonly number[]; readonly right: readonly number[] };
	readonly lobes: LobeFigures;
	readonly sky: SkyFigures & {
		/** The review's enclosed gap: background between each crown row's outermost plant. */
		readonly enclosedGap: number;
		/** The review's crown-box gap: background over the crown's whole box. */
		readonly boxGap: number;
	};
	/** Why each null figure is null, by the figure's name. */
	readonly missing: Readonly<Record<string, string>>;
}

/**
 * The figures of an outline whose crown start and gap figures are known.
 *
 * @param mask The plant's outline.
 * @param width The mask's width.
 * @param height The mask's height.
 * @param box The plant's box.
 * @param axis The column of the plant's foot.
 * @param crown The row where the crown starts, the crown's width in pixels, and its two gaps.
 * @param breastShare Breast height as a share of the plant's height, or null when it is not known.
 * @param trustedBottom The lowest row whose outline is trusted, the plant's foot by default.
 * @param fine The stem's width in a row read from the picture at its own size, as `stemOf` takes it.
 */
export function figuresOf(
	mask: Uint8Array,
	width: number,
	height: number,
	box: Box,
	axis: number,
	crown: {
		readonly row: number;
		readonly width: number;
		readonly enclosedGap: number;
		readonly boxGap: number;
	},
	breastShare: number | null,
	trustedBottom = box.bottom,
	fine?: (row: number) => number | null,
): ViewFigures {
	const tall = box.bottom - box.top + 1;
	const stem = stemOf(mask, width, box, axis, crown.row, breastShare, trustedBottom, fine);
	const limbs = limbsOf(mask, width, height, box, axis, stem);
	const missing: Record<string, string> = {};
	for (const [name, reason] of Object.entries(stem.missing)) missing[`trunk.${name}`] = reason;
	if ('reason' in limbs) missing.limbs = limbs.reason;
	return {
		heightToWidth: rounded(tall / (box.right - box.left + 1)),
		foot: {
			rows: { frame: height, horizon: null, outline: box.bottom, foot: box.bottom },
			belowHorizon: 0,
			followed: 0,
		},
		crown: {
			heightToWidth: rounded((crown.row - box.top + 1) / Math.max(1, crown.width)),
			base: rounded((box.bottom - crown.row) / tall),
			width: rounded(crown.width / tall),
		},
		trunk: {
			bareShare: stem.bareShare,
			width: stem.width,
			column: stem.column,
			breastHeightWidth: stem.breastHeightWidth,
			flare: stem.flare,
			lean: stem.lean,
			stems: stem.stems,
		},
		limbs: 'reason' in limbs ? null : limbs,
		envelope: envelopeOf(mask, width, box, axis),
		lobes: lobesOf(mask, width, box, axis, crown.row),
		sky: {
			enclosedGap: crown.enclosedGap,
			boxGap: crown.boxGap,
			...skyOf(mask, width, box, crown.row),
		},
		missing,
	};
}

/** How far past the mask's run, in mask pixels, the picture is searched for the stem's edge. */
const EDGE_REACH = 2;
/** The least contrast of a stem against the sky, as a CIELAB distance, for its edges to be read. */
const EDGE_CONTRAST = 4;

/**
 * The width of the stem's run in a row of the mask, read from the picture at its own size. The
 * mask is made at the review's work width, where a slim stem is a few pixels wide and reads a
 * pixel wide or narrow. In each row of the picture under the mask's row, the stem's two edges are
 * where its contrast with the fitted sky falls to half the contrast at its middle, placed between
 * two pixels by their contrasts. The width is the middle value of those rows, in mask pixels.
 *
 * @returns The width for a row, or null where the row holds no run, the stem has too little
 *   contrast, or something touches the stem within the search.
 */
function fineWidths(
	image: Rgba,
	plant: PlantMask,
	box: Box,
	axis: number,
): (row: number) => number | null {
	const runs = axisRuns(plant.mask, plant.width, box, axis);
	const scale = image.width / plant.width;
	const sky = plant.background.sky;
	const known = new Map<number, number | null>();
	const contrast = (x: number, y: number): number => {
		const at = (y * image.width + x) * 4;
		return deltaE76(
			labOf(image.data[at] as number, image.data[at + 1] as number, image.data[at + 2] as number),
			surfaceAt(sky, (x + 0.5) / image.width, (y + 0.5) / image.height),
		);
	};
	const widthIn = (y: number, left: number, right: number): number | null => {
		const middle = ((left + right + 1) / 2) * scale;
		const half = ((right - left + 1) / 2) * scale;
		const inner: number[] = [];
		for (let x = Math.floor(middle - half / 2); x <= Math.ceil(middle + half / 2); x++)
			if (x >= 0 && x < image.width) inner.push(contrast(x, y));
		inner.sort((a, b) => a - b);
		const level = (inner[inner.length >> 1] ?? 0) / 2;
		if (level * 2 < EDGE_CONTRAST) return null;
		// From outside the run inward, the first pixel at the level is the stem's edge pixel.
		const edge = (step: 1 | -1): number | null => {
			const from = Math.round(middle - step * (half + EDGE_REACH * scale));
			if (from < 0 || from >= image.width) return null;
			let outer = contrast(from, y);
			if (outer >= level) return null;
			for (let x = from + step; step > 0 ? x <= middle : x >= middle; x += step) {
				const here = contrast(x, y);
				if (here >= level)
					// The edge lies between the two pixels' middles, by their contrasts.
					return x + 0.5 - (step * (here - level)) / (here - outer);
				outer = here;
			}
			return null;
		};
		const first = edge(1);
		const last = edge(-1);
		return first === null || last === null ? null : last - first;
	};
	return (row) => {
		if (known.has(row)) return known.get(row) as number | null;
		const left = runs[row * 2] as number;
		let width: number | null = null;
		if (left >= 0 && row <= box.bottom) {
			const widths: number[] = [];
			const to = Math.min(image.height, Math.ceil((row + 1) * scale));
			for (let y = Math.floor(row * scale); y < to; y++) {
				const found = widthIn(y, left, runs[row * 2 + 1] as number);
				if (found !== null) widths.push(found);
			}
			widths.sort((a, b) => a - b);
			if (widths.length > 0) width = (widths[widths.length >> 1] as number) / scale;
		}
		known.set(row, width);
		return width;
	};
}

/**
 * Measures one picture of a whole plant.
 *
 * @param image The picture.
 * @param breastShare Breast height as a share of the plant's height, or null when it is not known.
 * @returns The figures with the plant's height in the picture's work pixels, or the reason the
 *   picture gives no outline to read them from.
 */
export function measureView(
	image: Rgba,
	breastShare: number | null,
): { readonly figures: ViewFigures; readonly tall: number } | { readonly problem: string } {
	const outline = frameOutline(image, 0);
	if (outline.problem || !outline.box || outline.foot === null)
		return { problem: outline.problem ?? 'no plant is found' };
	let plant = outline.mask;
	const { width, height, background } = plant;
	const horizon = outline.measures.horizon;
	const horizonRow = horizon === null ? null : Math.floor(horizon * height);
	let followed = 0;
	const outlineEnd = outline.box.bottom;
	// Below a horizon the outline is not reliable. On a ground that is drawn plain, as under a
	// silhouette, the plant stands on the ground's edge. On a photographed ground an outline that
	// ends at the horizon may have lost its foot there, so the stem is followed down to its end.
	if (
		horizonRow !== null &&
		(background.ground?.noise ?? 0) >= PLAIN_GROUND &&
		endsAtHorizon(outline.box, horizonRow, height)
	) {
		const work = image.width === width ? image : resizeToWidth(image, width);
		const stem = followStem(labImage(work), width, height, plant.mask, outline.box, outline.foot);
		// A mass that ends at the horizon has lost at most the ground below it. Where that ground
		// is a thin band the loss is small and the outline stands; otherwise it is refused.
		const most = (height - 1 - outline.box.bottom) / (outline.box.bottom - outline.box.top + 1);
		if (stem.kind === 'mass' && most >= MASS_LOSS)
			return {
				problem:
					'the outline ends at the horizon on a mass too wide to be a stem, so the part of the plant that stands against the ground below is lost',
			};
		if (stem.kind === 'stem') {
			const mask = plant.mask.slice();
			stem.runs.forEach(([from, to], k) => {
				const y = (outline.box as Box).bottom + 1 + k;
				mask.fill(1, y * width + from, y * width + to + 1);
			});
			followed = stem.foot - outline.box.bottom;
			plant = { ...plant, mask };
		}
	}
	// The crown's start and its gaps come from the review's own measure, on the cleaned outline.
	const measures = measurePlant(image, plant);
	const box = measures.box;
	if (!box) return { problem: 'no plant is found' };
	const tall = box.bottom - box.top + 1;
	// The rows at the horizon blend the sky with the ground, so the trusted rows end above them.
	const trusted =
		horizonRow === null
			? box.bottom
			: Math.min(box.bottom, horizonRow - Math.max(1, Math.round(height * HORIZON_BLEND)) - 1);
	const figures = figuresOf(
		plant.mask,
		width,
		height,
		box,
		outline.foot,
		{
			row: box.top + measures.crownBox.height - 1,
			width: measures.crownBox.width,
			enclosedGap: measures.gapFraction,
			boxGap: measures.crownBoxGap,
		},
		breastShare,
		trusted,
		fineWidths(image, plant, box, outline.foot),
	);
	// A row of the mask as a row of the picture at its own size.
	const own = (row: number): number => Math.round(((row + 0.5) * image.height) / height - 0.5);
	return {
		figures: {
			...figures,
			foot: {
				rows: {
					frame: image.height,
					horizon: horizonRow === null ? null : own(horizonRow),
					outline: own(outlineEnd),
					foot: own(box.bottom),
				},
				belowHorizon:
					horizonRow === null ? 0 : rounded(Math.max(0, box.bottom - horizonRow) / tall),
				followed: rounded(followed / tall),
			},
		},
		tall,
	};
}
