// A grown plant set against a reference picture without a browser: the plant is drawn on the CPU
// from a camera that stands where the picture's own framing puts it, its matte is read by the
// review tool's own outline and measures, and the two outlines are laid over one another. The
// figures are the review's: the enclosed sky gap, the outline overlap and the crown's box. The
// drawing is the preview's, so a figure here says where a plant stands before a review draws it,
// and the review's own run stays the judge.
import type { PlantAsset, SpeciesKitData } from '../../../packages/vegetation/src/asset.ts';
import type { ScreenFraming } from '../../../tests/pages/lib/plant-review/framing.ts';
import { anchorColumn, frameIou, iou, normalise, profileError } from '../plant-review/compare.ts';
import {
	blank,
	drawText,
	onColour,
	paste,
	type Rgba,
	resizeToWidth,
} from '../plant-review/image.ts';
import {
	type Box,
	boxOf,
	matteMask,
	measurePlant,
	type PlantMask,
	type PlantMeasures,
	plantMask,
	WORK_WIDTH,
} from '../plant-review/references.ts';
import { enlarged, type PreviewCamera, restood, standingCamera } from './camera.ts';
import {
	canvas,
	drawCards,
	drawLevelWood,
	drawShoots,
	drawWood,
	matte,
	NATURAL,
	painted,
} from './draw.ts';
import { type GapSpread, gapSpread } from './spread.ts';

/** The whole views' field of view in degrees, as the review's slots set it. */
export const WHOLE_FOV = 30;
/** The camera's height in metres where a picture's plant stands on its horizon. */
const LOW_EYE = 0.3;
/** Canvas pixels drawn for each pixel of the matte, a side. */
export const SUPERSAMPLE = 3;
/** How far the render's sky gap may stand above and below its reference's, by the review's row 6. */
export const GAP_ABOVE = 0.05;
export const GAP_BELOW = 0.02;
/** How near the drawn width's share of the frame comes to its reference's before the stand holds. */
const WIDTH_BAND = 0.01;
/** The most times a stand is corrected from the width its own picture measures. */
const WIDTH_PASSES = 3;

/** One picture's outline with what the review tool measures from it. */
export interface Outline {
	readonly plant: PlantMask;
	readonly measures: PlantMeasures;
	readonly spread: GapSpread | undefined;
}

/** A reference picture as the preview compares with it. */
export interface ReferenceView extends Outline {
	/** The picture at the work width. */
	readonly image: Rgba;
	/** Where its plant stands in its frame. */
	readonly framing: ScreenFraming;
	/** The share of the frame's width its plant takes. */
	readonly widthShare: number;
}

/**
 * Where a measured plant stands in its frame: its top and base rows, its trunk's column and the
 * horizon, which is the plant's base where the picture shows none.
 *
 * @param outline The plant's outline and measures.
 * @returns The framing, or undefined when the outline holds no plant.
 */
export function framingOf(outline: Outline): ScreenFraming | undefined {
	const { plant, measures } = outline;
	const box = measures.box;
	if (!box) return undefined;
	const base = (box.bottom + 1) / measures.height;
	return {
		fov: WHOLE_FOV,
		aspect: measures.width / measures.height,
		horizon: measures.horizon ?? base,
		top: box.top / measures.height,
		base,
		eye: LOW_EYE,
		targetX: anchorColumn(plant.mask, plant.width, plant.height, box) / measures.width,
	};
}

/**
 * Reads a reference picture as the review does: flattened onto white, outlined from its plain
 * background and measured.
 *
 * @param image The picture as read from its file.
 * @returns Its outline, its measures and its framing, or undefined when no plant separates.
 */
export function referenceView(image: Rgba): ReferenceView | undefined {
	const flat = onColour(image, [255, 255, 255]);
	const plant = plantMask(flat);
	const measures = measurePlant(flat, plant);
	const outline = { plant, measures, spread: gapSpread(plant, measures) };
	const framing = framingOf(outline);
	const box = measures.box;
	if (!framing || !box) return undefined;
	return {
		...outline,
		framing,
		widthShare: (box.right - box.left + 1) / measures.width,
		image: resizeToWidth(flat, plant.width),
	};
}

/** A plant drawn at a reference's framing. */
export interface RenderView extends Outline {
	/** The plant in its own colours. */
	readonly colour: Rgba;
	/** The plant's matte, dark on white. */
	readonly matte: Rgba;
}

/**
 * Draws a grown plant from the camera a framing asks for and reads its matte as the review reads a
 * render's. A whole view of a tree stands where the first card level draws, so that level is the
 * one drawn unless another is asked for: its cards, and the wood orders it keeps.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @param framing Where the plant lands in the frame.
 * @param turn Degrees about the plant; 0 looks from +Z.
 * @param level The detail level drawn: 0 for the shoots' own leaves, 1 or 2 for a card level.
 * @param widthShare The share of the frame's width the plant takes, which the camera stands for.
 * @param width The matte's width in pixels.
 * @returns The picture, the matte and the measures.
 */
export function renderView(
	kit: SpeciesKitData,
	asset: PlantAsset,
	framing: ScreenFraming,
	turn: number,
	level: 0 | 1 | 2 = 1,
	widthShare?: number,
	width = WORK_WIDTH,
): RenderView {
	// The camera frames the drawn top, which the shoots carry above the skeleton's.
	const top = Math.max(
		asset.skeleton.height,
		drawShoots(canvas(1, 1), undefined, kit, asset.shoots),
	);
	const draw = (camera: PreviewCamera) => {
		const drawing = canvas(camera.width, camera.height);
		// The level's own wood mesh where the asset holds it; else the skeleton's strokes.
		if (!drawLevelWood(drawing, camera, kit, asset, level))
			drawWood(drawing, camera, asset.skeleton, {
				...(level > 0 ? { orders: kit.record.lod.woodOrders[level - 1] } : {}),
			});
		if (level === 0) drawShoots(drawing, camera, kit, asset.shoots);
		else drawCards(drawing, camera, kit, asset, level);
		return drawing;
	};
	// The review stands its camera so the drawn plant takes the reference's share of the frame's
	// width, from the width a first picture measures; a small picture measures it here.
	let camera = standingCamera(framing, top, turn, width);
	if (widthShare !== undefined && widthShare < 1)
		for (let pass = 0; pass < WIDTH_PASSES; pass++) {
			const rough = matteMask(matte(draw(camera), 1));
			const box = boxOf(rough.mask, rough.width, rough.height);
			if (!box) break;
			const share = (box.right - box.left + 1) / rough.width;
			if (Math.abs(share - widthShare) <= WIDTH_BAND) break;
			camera = restood(camera, share / widthShare);
		}
	const drawing = draw(enlarged(camera, SUPERSAMPLE));
	const picture = matte(drawing, SUPERSAMPLE);
	const plant = matteMask(picture);
	const measures = measurePlant(picture, plant);
	return {
		colour: painted(drawing, SUPERSAMPLE, NATURAL),
		matte: picture,
		plant,
		measures,
		spread: gapSpread(plant, measures),
	};
}

/** The review's figures for one render beside its reference. */
export interface MatchFigures {
	/** The enclosed sky gap of each, and whether the render's stands inside row 6's band. */
	readonly gap: { readonly reference: number; readonly render: number; readonly inBand: boolean };
	/** The overlap of the two outlines at one height and trunk column, from 0 to 1. */
	readonly shapeIou: number;
	/** The overlap of the two outlines as framed. */
	readonly frameIou: number;
	/** The mean difference of the width profiles, in plant heights. */
	readonly profileError: number;
	/** Each crown's width over its height. */
	readonly crownAspect: { readonly reference: number; readonly render: number };
	/** Each plant's width over its height. */
	readonly plantAspect: { readonly reference: number; readonly render: number };
	/** Where each crown starts, as a share of the plant's height. */
	readonly crownStart: { readonly reference: number; readonly render: number };
	/** Where the sky sits in each crown. */
	readonly spread: { readonly reference?: GapSpread; readonly render?: GapSpread };
}

/** A box's width over its height. */
function aspectOf(box: Box): number {
	return (box.right - box.left + 1) / (box.bottom - box.top + 1);
}

/** An outline on the comparison canvas: its plant's height on the canvas's, its trunk on the middle. */
function normal(outline: Outline): Uint8Array | undefined {
	const box = outline.measures.box;
	if (!box) return undefined;
	const { plant } = outline;
	return normalise(
		plant,
		box,
		anchorColumn(plant.mask, plant.width, plant.height, box),
		box.bottom,
	);
}

/**
 * The figures of a render against its reference.
 *
 * @param reference The reference's outline.
 * @param render The render's outline.
 * @returns The figures, or undefined when either holds no plant.
 */
export function matchFigures(reference: Outline, render: Outline): MatchFigures | undefined {
	const a = reference.measures;
	const b = render.measures;
	const na = normal(reference);
	const nb = normal(render);
	if (!a.box || !b.box || !na || !nb) return undefined;
	const crown = (m: PlantMeasures) =>
		m.crownBox.height > 0 ? Number((m.crownBox.width / m.crownBox.height).toFixed(4)) : 0;
	return {
		gap: {
			reference: a.gapFraction,
			render: b.gapFraction,
			inBand:
				b.gapFraction <= a.gapFraction + GAP_ABOVE && b.gapFraction >= a.gapFraction - GAP_BELOW,
		},
		shapeIou: Number(iou(na, nb).toFixed(4)),
		frameIou: Number(frameIou(reference.plant, render.plant).toFixed(4)),
		profileError: Number(profileError(a.widthProfile, b.widthProfile).toFixed(4)),
		crownAspect: { reference: crown(a), render: crown(b) },
		plantAspect: {
			reference: Number(aspectOf(a.box).toFixed(4)),
			render: Number(aspectOf(b.box).toFixed(4)),
		},
		crownStart: { reference: a.crownStart, render: b.crownStart },
		spread: {
			...(reference.spread ? { reference: reference.spread } : {}),
			...(render.spread ? { render: render.spread } : {}),
		},
	};
}

const BOTH = [70, 70, 70] as const;
const REFERENCE_ONLY = [214, 76, 170] as const;
const RENDER_ONLY = [70, 170, 84] as const;

/** The two outlines laid over one another: where both stand, where only one does. */
function overlay(reference: PlantMask, render: PlantMask): Rgba {
	const out = blank(reference.width, reference.height, [255, 255, 255]);
	for (let y = 0; y < reference.height; y++)
		for (let x = 0; x < reference.width; x++) {
			const a = reference.mask[y * reference.width + x] === 1;
			const rx = Math.min(render.width - 1, x);
			const ry = Math.min(render.height - 1, y);
			const b = render.mask[ry * render.width + rx] === 1;
			if (!a && !b) continue;
			const colour = a && b ? BOTH : a ? REFERENCE_ONLY : RENDER_ONLY;
			out.data.set(colour, (y * reference.width + x) * 4);
		}
	return out;
}

/** Text rows under a match strip. */
const LABEL_ROWS = 4;
const LABEL_SCALE = 2;
const LINE = 9 * LABEL_SCALE;

/**
 * One strip of a match sheet: the reference picture, the two outlines overlaid and the render, with
 * the figures in words below.
 *
 * @param title The strip's name, such as the reference file and its turn.
 * @param reference The reference.
 * @param render The render.
 * @param figures Their figures.
 * @returns The strip.
 */
export function matchStrip(
	title: string,
	reference: ReferenceView,
	render: RenderView,
	figures: MatchFigures | undefined,
): Rgba {
	const { width, height } = reference.plant;
	const strip = blank(width * 3 + 8, height + LABEL_ROWS * LINE + 8, [255, 255, 255]);
	paste(strip, reference.image, 0, 0);
	paste(strip, overlay(reference.plant, render.plant), width + 4, 0);
	paste(strip, render.colour, width * 2 + 8, 0);
	const lines = [title];
	if (figures) {
		const { gap, spread } = figures;
		lines.push(
			`sky gap ref ${gap.reference.toFixed(4)} render ${gap.render.toFixed(4)} band ${(gap.reference - GAP_BELOW).toFixed(4)} to ${(gap.reference + GAP_ABOVE).toFixed(4)} ${gap.inBand ? 'inside' : 'OUTSIDE'}   outline overlap ${figures.shapeIou.toFixed(3)} as framed ${figures.frameIou.toFixed(3)}`,
			`plant w/h ref ${figures.plantAspect.reference.toFixed(3)} render ${figures.plantAspect.render.toFixed(3)}   crown w/h ref ${figures.crownAspect.reference.toFixed(3)} render ${figures.crownAspect.render.toFixed(3)}   crown start ref ${figures.crownStart.reference.toFixed(3)} render ${figures.crownStart.render.toFixed(3)}`,
		);
		const words = (s: GapSpread | undefined) =>
			s
				? `zones open ${s.open.toFixed(2)} largest opening ${s.largest.toFixed(2)} of ${s.openings} middle/rim ${s.inner.toFixed(2)}`
				: 'none';
		lines.push(`sky spread ref: ${words(spread.reference)}   render: ${words(spread.render)}`);
	} else lines.push('no plant outline to compare');
	lines.forEach((line, k) => {
		drawText(strip, line, 6, height + 6 + k * LINE, LABEL_SCALE, [20, 20, 20]);
	});
	return strip;
}

/** Strips stacked into one sheet. */
export function stacked(strips: readonly Rgba[]): Rgba {
	const width = Math.max(1, ...strips.map((s) => s.width));
	const height = strips.reduce((sum, s) => sum + s.height, 0);
	const out = blank(width, Math.max(1, height), [255, 255, 255]);
	let y = 0;
	for (const strip of strips) {
		paste(out, strip, 0, y);
		y += strip.height;
	}
	return out;
}
