// A branch piece, measured from one picture of it: a cut branch, sub-branch or leaf cluster on a
// plain ground, or a branch in place on the plant. The outline is the review tool's. Pixels of the
// review's leaf green are the foliage and the rest of the piece is its wood, which gives the four
// cut-branch figures where the wood shows and stays in one part.
import { LEAF_GREEN } from '../lib/plant-review/compare.ts';
import { labImage, type Rgba, resizeToWidth } from '../lib/plant-review/image.ts';
import { type Box, boxOf, components, plantMask } from '../lib/plant-review/references.ts';
import { rounded } from './shape.ts';
import { type BranchFigures, branchFigures } from './skeleton.ts';

/** The least share of the piece that must be wood for its wood to be read. */
const WOOD_FLOOR = 0.03;
/** The least share of the wood that its largest part must hold, or the leaves part it too much. */
const WOOD_WHOLE = 0.5;

/**
 * The most of the piece that may read as wood. Above it the leaves are not leaf-green (grey, blue
 * or yellow foliage) and colour has not parted them from the wood.
 */
const WOOD_CEILING = 0.3;
/** The share of leaf green under which a piece is bare wood. */
const BARE_FLOOR = 0.02;

/** The edges of a frame that a subject's box runs off. */
export function edgesMet(box: Box, width: number, height: number): string[] {
	return [
		box.left <= 0 ? 'left' : '',
		box.top <= 0 ? 'top' : '',
		box.right >= width - 1 ? 'right' : '',
		box.bottom >= height - 1 ? 'bottom' : '',
	].filter((edge) => edge !== '');
}

/** The figures of one picture of a branch piece. */
export interface PieceFigures {
	/** The piece's height over its width in the picture. */
	readonly heightToWidth: number;
	/** The share of the piece's box that the piece covers. */
	readonly boxShare: number;
	/** The share of the piece's box that leaf-green covers, or null where colour does not part it. */
	readonly foliageShare: number | null;
	/** The share of the piece that is not leaf-green: its wood, with buds and fruit. Null likewise. */
	readonly woodShare: number | null;
	/** The four cut-branch figures, or null where too little wood shows. */
	readonly branch: BranchFigures | null;
	/** Degrees the piece's long axis points below level, away from where it joins the plant. */
	readonly droop: number | null;
	/** The frame edges the piece runs off. */
	readonly clipped: readonly string[];
	/** Why each null figure is null. */
	readonly missing: Readonly<Record<string, string>>;
}

/**
 * Measures one picture of a branch piece.
 *
 * @param image The picture.
 * @param inPlace Whether the picture shows the piece on the plant, so its angle is the plant's own.
 * @param green Whether the picture's leaves are green, so colour parts them from the wood.
 * @param branched Whether the piece is a branch with twigs, so the cut-branch figures apply to it.
 * @returns The figures, or the reason the picture gives no outline.
 */
export function measurePiece(
	image: Rgba,
	inPlace: boolean,
	green = true,
	branched = true,
): { readonly figures: PieceFigures } | { readonly problem: string } {
	const plant = plantMask(image);
	const { width, height, mask } = plant;
	const box = boxOf(mask, width, height);
	if (!box)
		return {
			problem: plant.background.plain
				? 'no piece is found against the background'
				: 'the background is not plain, so the piece has no outline',
		};
	// A close picture has no horizon. Where the outline finds one, a limb or a band of the backdrop
	// crosses the frame, and the outline splits the piece along it.
	if (plant.background.horizon !== null)
		return {
			problem:
				'a limb or a band of the backdrop crosses the frame and reads as a horizon, so the outline is not trusted',
		};
	const lab = labImage(image.width === width ? image : resizeToWidth(image, width));
	const wood = new Uint8Array(mask.length);
	let covered = 0;
	let leafy = 0;
	let woody = 0;
	let sumX = 0;
	let sumY = 0;
	for (let at = 0; at < mask.length; at++) {
		if (!mask[at]) continue;
		covered++;
		sumX += at % width;
		sumY += Math.floor(at / width);
		if ((lab[at * 3 + 1] as number) < LEAF_GREEN) leafy++;
		else {
			wood[at] = 1;
			woody++;
		}
	}
	const across = box.right - box.left + 1;
	const tall = box.bottom - box.top + 1;
	const area = across * tall;
	const missing: Record<string, string> = {};
	// A piece with no leaf green at all is bare wood; one with some is parted only while its wood
	// is the lesser part.
	const bare = leafy / covered < BARE_FLOOR;
	const parted = green && (bare || woody / covered <= WOOD_CEILING);
	const unparted = green
		? 'too much of the piece is not leaf-green (grey, blue or yellow foliage), so colour cannot part its leaves from its wood'
		: 'the leaves or flowers in the picture are not green, so colour cannot part them from the wood';
	if (!parted) {
		missing.foliageShare = unparted;
		missing.woodShare = unparted;
	}
	const clipped = edgesMet(box, width, height);
	let branch: BranchFigures | null = null;
	if (!parted) missing.branch = unparted;
	else if (!branched)
		missing.branch = 'a leaf cluster shows one shoot, so the cut-branch figures do not apply to it';
	else if (woody / covered < WOOD_FLOOR) missing.branch = 'the leaves hide the wood';
	else {
		// The wood that can be followed is its largest part: the stem from the cut with the twigs that
		// stay joined to it. Wood that shows again beyond a leaf is a part of its own, and is left out.
		const { labels, sizes } = components(wood, width, height);
		let largest = 0;
		for (let label = 1; label < sizes.length; label++)
			if ((sizes[label] as number) > (sizes[largest] as number) || largest === 0) largest = label;
		if ((sizes[largest] as number) / woody < WOOD_WHOLE)
			missing.branch = 'the wood shows in separate parts, none large enough to follow';
		else {
			for (let at = 0; at < wood.length; at++) if (labels[at] !== largest) wood[at] = 0;
			branch = branchFigures(wood, width, height, Math.max(across, tall), area);
			if (!branch) missing.branch = 'the wood leaves no line with a free end';
		}
	}
	let droop: number | null = null;
	if (!inPlace)
		missing.droop =
			"the picture stands the cut piece on its cut, so its angle is the photographer's, not the plant's";
	else if (clipped.length !== 1)
		missing.droop =
			clipped.length === 0
				? 'the piece touches no edge of the frame, so the end that joins the plant is not known'
				: `the piece runs off ${clipped.length} edges of the frame, so the end that joins the plant is not known`;
	else if (clipped[0] === 'bottom')
		missing.droop =
			"the subject rises from the frame's lower edge, as a standing plant or a stood cutting does, so its angle is not a branch's droop";
	else {
		// The long axis of the piece's pixels, pointed away from the edge it enters by.
		const meanX = sumX / covered;
		const meanY = sumY / covered;
		let xx = 0;
		let xy = 0;
		let yy = 0;
		for (let at = 0; at < mask.length; at++) {
			if (!mask[at]) continue;
			const dx = (at % width) - meanX;
			const dy = Math.floor(at / width) - meanY;
			xx += dx * dx;
			xy += dx * dy;
			yy += dy * dy;
		}
		const turn = 0.5 * Math.atan2(2 * xy, xx - yy);
		let ax = Math.cos(turn);
		let ay = Math.sin(turn);
		const edge = clipped[0];
		const away = edge === 'left' ? ax : edge === 'right' ? -ax : ay;
		if (away < 0) {
			ax = -ax;
			ay = -ay;
		}
		droop = rounded((Math.atan2(ay, Math.abs(ax)) * 180) / Math.PI, 1);
	}
	return {
		figures: {
			heightToWidth: rounded(tall / across),
			boxShare: rounded(covered / area),
			foliageShare: parted ? rounded(leafy / area) : null,
			woodShare: parted ? rounded(woody / covered) : null,
			branch,
			droop,
			clipped,
			missing,
		},
	};
}
