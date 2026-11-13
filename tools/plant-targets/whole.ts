// One view of a whole plant, measured: a still, or one frame of the turning video. The outline is
// the review tool's, cleaned of the ground strip at the plant's foot as the fit tool cleans it, and
// the crown's start and its two gap figures are the review's own. The stem, the radius profile, the
// lumps and the holes are read from the same outline.
import { labImage, type Rgba, resizeToWidth } from '../lib/plant-review/image.ts';
import { type Box, measurePlant } from '../lib/plant-review/references.ts';
import { frameOutline } from '../plant-fit/silhouettes.ts';
import { endsAtHorizon, followStem, PLAIN_GROUND } from './foot.ts';
import {
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
): ViewFigures {
	const tall = box.bottom - box.top + 1;
	const stem = stemOf(mask, width, box, axis, crown.row, breastShare, trustedBottom);
	const limbs = limbsOf(mask, width, height, box, axis, stem);
	const missing: Record<string, string> = {};
	for (const [name, reason] of Object.entries(stem.missing)) missing[`trunk.${name}`] = reason;
	if ('reason' in limbs) missing.limbs = limbs.reason;
	return {
		heightToWidth: rounded(tall / (box.right - box.left + 1)),
		foot: { belowHorizon: 0, followed: 0 },
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
			for (let y = outline.box.bottom + 1; y <= stem.foot; y++)
				mask.fill(1, y * width + stem.left, y * width + stem.right + 1);
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
	);
	return {
		figures: {
			...figures,
			foot: {
				belowHorizon:
					horizonRow === null ? 0 : rounded(Math.max(0, box.bottom - horizonRow) / tall),
				followed: rounded(followed / tall),
			},
		},
		tall,
	};
}
