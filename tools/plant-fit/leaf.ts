// The leaf contour check against a species' slot 24, the upper face of one leaf on a transparent
// ground. The picture is framed as the texture tool frames it, the midrib upright on a square
// canvas, and its coverage at the materials' cutoff is the leaf. Three things are checked: that
// the picture can be measured at all (a transparent ground, one leaf, not cut by the picture's
// edge); how well the thinned contour that the texture tool writes covers that leaf; and, where the
// species' textures exist, how well the contour their manifest ships still covers the slot's
// current picture, and whether the manifest was made from that picture.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TextureManifest } from '../../packages/vegetation/src/core/textures.ts';
import { outlineMask, textureOutline } from '../../packages/vegetation/src/leaf/outline.ts';
import { iou } from '../lib/plant-review/compare.ts';
import type { Slot } from '../lib/plant-review/references.ts';
import { TEXTURES_ROOT } from '../plant-textures/build.ts';
import { LEAF_DEFAULTS, type LeafConfig, readConfig } from '../plant-textures/config.ts';
import { signedArea, traceLoops } from '../plant-textures/contour.ts';
import { decodePicture, type Picture } from '../plant-textures/image.ts';
import { CUTOFF, framedLeaf, leafOutline } from '../plant-textures/leaf.ts';

/** Texels a side of the canvas the check frames the leaf on. */
const CHECK_SIZE = 512;
/** The least share of a picture's texels that must be transparent for it to hold a cut-out. */
const LEAST_GROUND = 0.2;
/** A loop counts as a second piece when its area passes this share of the leaf's. */
const PIECE_SHARE = 0.02;
/** The least overlap of a contour with the leaf for the contour to pass. */
export const CONTOUR_IOU = 0.95;

/** What the check found. */
export interface LeafCheck {
	/** The slot-24 file in use, or null when the folder has none. */
	readonly file: string | null;
	/** Why the picture cannot be measured, or why a contour fails. Empty when all is well. */
	readonly problems: readonly string[];
	/** The share of the picture's texels that are transparent. */
	readonly ground: number;
	/** Separate pieces of leaf on the canvas: 1 for one whole leaf. */
	readonly pieces: number;
	/** The leaf's widest extent across over its length, stalk included. */
	readonly aspect: number;
	/** The thinned contour's points and its overlap with the leaf. */
	readonly contour: { readonly points: number; readonly iou: number };
	/** The shipped manifest's contour against the leaf, and whether it was made from this file. */
	readonly manifest?: { readonly from: string; readonly current: boolean; readonly iou: number };
}

/** The species' leaf inputs: its texture folder's `source.json`, or the texture tool's defaults. */
function leafConfig(species: string): LeafConfig {
	const file = join(TEXTURES_ROOT, species, 'source.json');
	return (existsSync(file) ? readConfig(file).leaf : undefined) ?? LEAF_DEFAULTS;
}

/** A contour's mask on the canvas, its first row the canvas's top as the coverage runs. */
function contourMask(points: readonly number[], size: number): Uint8Array {
	const up = outlineMask(points, size);
	const out = new Uint8Array(size * size);
	for (let row = 0; row < size; row++)
		out.set(up.subarray(row * size, (row + 1) * size), (size - 1 - row) * size);
	return out;
}

/** Whether any texel along the picture's edge is leaf. */
function touchesEdge(p: Picture): boolean {
	const { width: w, height: h, a } = p;
	for (let x = 0; x < w; x++)
		if ((a[x] as number) >= CUTOFF || (a[(h - 1) * w + x] as number) >= CUTOFF) return true;
	for (let y = 0; y < h; y++)
		if ((a[y * w] as number) >= CUTOFF || (a[y * w + w - 1] as number) >= CUTOFF) return true;
	return false;
}

/**
 * Checks a species' leaf contour against its slot-24 picture.
 *
 * @param species The species' id, which names its texture folder.
 * @param folder Its reference folder.
 * @param stills The folder's stills and texture sources in use.
 */
export function checkLeaf(species: string, folder: string, stills: readonly Slot[]): LeafCheck {
	const slot = stills.find((s) => s.kind === 'texture' && s.number === 24);
	const empty = { ground: 0, pieces: 0, aspect: 0, contour: { points: 0, iou: 0 } };
	if (!slot)
		return { file: null, problems: ['the folder has no slot-24 picture in use'], ...empty };
	const source = decodePicture(new Uint8Array(readFileSync(join(folder, slot.file))));
	let clear = 0;
	for (const a of source.a) if (a < 16 / 255) clear++;
	const ground = Number((clear / source.a.length).toFixed(4));
	const problems: string[] = [];
	if (ground < LEAST_GROUND) {
		problems.push(`only ${(ground * 100).toFixed(0)} per cent of the picture is transparent`);
		return { file: slot.file, problems, ...empty, ground };
	}
	if (touchesEdge(source)) problems.push("the leaf runs off the picture's edge");
	const coverage = framedLeaf(source, leafConfig(species), CHECK_SIZE).face.a;
	const leaf = new Uint8Array(coverage.length);
	for (let i = 0; i < leaf.length; i++) leaf[i] = (coverage[i] as number) >= CUTOFF ? 1 : 0;
	const loops = traceLoops({ width: CHECK_SIZE, height: CHECK_SIZE, data: coverage }, CUTOFF);
	const areas = loops.map(signedArea);
	const largest = areas.reduce((best, a) => (Math.abs(a) > Math.abs(best) ? a : best), 0);
	const pieces = areas.filter(
		(a) => Math.sign(a) === Math.sign(largest) && Math.abs(a) >= PIECE_SHARE * Math.abs(largest),
	).length;
	if (pieces > 1) problems.push(`the picture holds ${pieces} separate pieces of leaf`);
	const contour = leafOutline(coverage, CHECK_SIZE);
	const flat = contour.flat();
	const contourIou = Number(iou(contourMask(flat, CHECK_SIZE), leaf).toFixed(4));
	if (contourIou < CONTOUR_IOU)
		problems.push(`the thinned contour covers the leaf with an overlap of only ${contourIou}`);
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	let left = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	for (const [u, v] of contour) {
		low = Math.min(low, v);
		high = Math.max(high, v);
		left = Math.min(left, u);
		right = Math.max(right, u);
	}
	const manifestFile = join(TEXTURES_ROOT, species, 'manifest.json');
	let manifest: LeafCheck['manifest'];
	if (existsSync(manifestFile)) {
		const shipped = JSON.parse(readFileSync(manifestFile, 'utf8')) as TextureManifest;
		if (shipped.leaf) {
			const from = shipped.source.files.find((f) => /^24-/.test(f.name))?.name ?? 'an unnamed file';
			const overlap = Number(
				iou(contourMask(textureOutline(shipped.leaf).points, CHECK_SIZE), leaf).toFixed(4),
			);
			manifest = { from, current: from === slot.file, iou: overlap };
			if (!manifest.current)
				problems.push(`the shipped textures were made from ${from}, not ${slot.file}`);
			if (overlap < CONTOUR_IOU)
				problems.push(`the shipped contour covers the leaf with an overlap of only ${overlap}`);
		}
	}
	return {
		file: slot.file,
		problems,
		ground,
		pieces,
		aspect: Number(((right - left) / Math.max(1e-6, high - low)).toFixed(3)),
		contour: { points: contour.length, iou: contourIou },
		...(manifest ? { manifest } : {}),
	};
}
