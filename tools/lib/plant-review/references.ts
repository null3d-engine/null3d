// A species' reference folder for the plant review: every reference file it holds, which of them
// are in use (the folder's INDEX.md marks a remade file's original as superseded), the stills
// sorted into the review's views, the texture sources, the turning videos with the arc each covers,
// the wind videos, and the plant's outline separated from a plain background with the measures a
// reviewer reads from it.
//
// The outline (the mask) works on pictures whose background is plain: an open sky, a seamless grey
// or white, and a meadow below the horizon. It fits a smooth colour surface to the frame's border,
// above and below the horizon separately, calls a pixel background when its CIELAB distance to the
// surface is small next to the border's own noise, and keeps the foreground that joins the plant.
// Its limits, which a reviewer must keep in mind:
// - A picture with no plain border (bark, the inside of a crown, a twig against foliage) has no
//   mask; `plain` is false and the measures are left out.
// - Below the horizon the meadow is textured and green, so dark foliage that touches the ground and
//   a ground shadow that joins the trunk can both be counted as plant, and pale foliage against the
//   meadow can be lost. The plant's base is reliable; its outline below the horizon is not.
// - Sky seen through the crown counts as background only where it matches the sky's colour; haze
//   or a bright leaf edge that blends with the sky can open or close a gap.
// - The horizon is found as the strongest colour step across the frame's left and right edges, so a
//   picture with no ground has none, and a plant that covers both edges hides it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { PlantReviewQuery } from '../../../tests/pages/lib/plant-review/query.ts';
import {
	type PlantBackground,
	type PlantView,
	VIEW_SPECS,
} from '../../../tests/pages/lib/plant-review/views.ts';
import { blank, deltaE76, hexOf, labImage, type Rgba, resizeToWidth, srgbOf } from './image.ts';

/** What a reference file is. */
export type ReferenceKind = 'still' | 'texture' | 'turntable' | 'wind';

/** One file of a reference folder and whether the review must compare it. */
export interface ReferenceFile {
	readonly file: string;
	readonly kind: ReferenceKind;
	/** Whether the review compares it: listed and not superseded, or not listed at all. */
	readonly inUse: boolean;
	/** The file that supersedes it, when the index says it is superseded. */
	readonly supersededBy?: string;
	/** Whether the folder's index has a row for it. */
	readonly listed: boolean;
	/** The index's words for what it shows. */
	readonly shows?: string;
}

/** One reference still or texture source, sorted into the review view that shows the same thing. */
export interface Slot {
	/** The file name. */
	readonly file: string;
	/** Its number, from the file name's prefix. */
	readonly number: number;
	/** Its name without the number and the extension, such as `bark-mid-trunk`. */
	readonly name: string;
	/** Whether it is a still of the plant or a texture source for a material. */
	readonly kind: 'still' | 'texture';
	/** The review view that shows the same thing. */
	readonly view: PlantView;
	/** The view's turn in degrees, for a slot that a side of the plant names. */
	readonly turn?: number;
	/** The view's elevation in degrees, for a slot that looks up or down more than the view does. */
	readonly elevation?: number;
	/** Query fields the slot sets beside its view, such as a limb share or a season. */
	readonly query?: Partial<PlantReviewQuery>;
	/** What the plant stands against in the still. */
	readonly background: PlantBackground;
	/** Whether the still shows the whole plant, so its framing can be measured and matched. */
	readonly framed: boolean;
	/** What the review page cannot show of this slot. */
	readonly note?: string;
}

/** A slot's view and settings, before its file's own facts. */
type SlotRule = Omit<Slot, 'file' | 'number' | 'name' | 'kind' | 'background'> & {
	readonly background?: PlantBackground;
};

/** The slot rules, first match wins: words in the still's name, and the slot they name. */
const SLOT_RULES: readonly { readonly test: (name: string) => boolean; readonly slot: SlotRule }[] =
	[
		{ test: (n) => n.includes('subbranch-studio'), slot: { view: 'subbranch', framed: false } },
		{ test: (n) => n.includes('leaf-cluster-studio'), slot: { view: 'cluster', framed: false } },
		{ test: (n) => n.includes('branch-studio'), slot: { view: 'branch', framed: false } },
		{ test: (n) => n.includes('silhouette'), slot: { view: 'silhouette', framed: true } },
		{ test: (n) => n.includes('profile'), slot: { view: 'whole', turn: 90, framed: true } },
		{
			test: (n) => /(leaf|needle|frond|blade).*(underside|lower)/.test(n),
			slot: { view: 'leaf-under', framed: false },
		},
		{
			test: (n) => /(leaf|needle|frond|blade).*upper/.test(n),
			slot: { view: 'leaf-upper', framed: false },
		},
		{
			test: (n) => n.includes('from-below'),
			slot: { view: 'below', elevation: 70, framed: false },
		},
		{
			test: (n) => /(crown|canopy).*(underside|underneath)/.test(n),
			slot: { view: 'below', elevation: 80, framed: false },
		},
		{ test: (n) => n.includes('inside'), slot: { view: 'inside', framed: false } },
		{ test: (n) => /(crown|clump)-(outside|edge)/.test(n), slot: { view: 'crown', framed: false } },
		{
			test: (n) => n.includes('limb-leaving') || n.includes('culm-base'),
			slot: { view: 'junction', framed: false },
		},
		{ test: (n) => n.includes('fork'), slot: { view: 'fork', framed: false } },
		{
			test: (n) => n.includes('secondary-branching') || n.includes('culm-branching'),
			slot: { view: 'fork', query: { distance: 2.5 }, framed: false },
		},
		{
			test: (n) => n.includes('twig') || n.includes('branchlet'),
			slot: { view: 'twigs', framed: false },
		},
		{
			test: (n) => /cluster|spray|shoot-leaves|needles/.test(n),
			slot: { view: 'cluster', background: 'white', framed: false },
		},
		{
			test: (n) => n.includes('bark-base') || n.includes('root'),
			slot: { view: 'bark-base', framed: false },
		},
		{ test: (n) => n.includes('bark-mid'), slot: { view: 'bark-mid', framed: false } },
		{
			test: (n) => /bark.*limb|limb.*bark/.test(n),
			slot: { view: 'bark-limb', framed: false },
		},
		{
			test: (n) => n.includes('winter') || n.includes('architecture') || n.includes('bare'),
			slot: { view: 'skeleton', query: { season: 'winter' }, framed: true },
		},
		{
			test: (n) => n.includes('taper') || n.includes('bole') || n.includes('lower-branches'),
			slot: { view: 'trunk', framed: false },
		},
		{ test: (n) => n.includes('skirt'), slot: { view: 'crown', elevation: -5, framed: false } },
		{
			test: (n) => n.includes('branching'),
			slot: { view: 'fork', query: { distance: 2.5 }, framed: false },
		},
		{ test: (n) => n.includes('crown'), slot: { view: 'crown', framed: false } },
		{ test: (n) => n.includes('bark'), slot: { view: 'bark-mid', framed: false } },
		{ test: (n) => /whole|distant|form|dome/.test(n), slot: { view: 'whole', framed: true } },
	];

/** The slot of each standard number, for a still whose name says nothing the rules know. */
const SLOT_BY_NUMBER: Readonly<Record<number, SlotRule>> = {
	1: { view: 'whole', framed: true },
	2: { view: 'whole', turn: 90, framed: true },
	3: { view: 'below', framed: false },
	4: { view: 'crown', framed: false },
	5: { view: 'below', elevation: 80, framed: false },
	6: { view: 'inside', framed: false },
	7: { view: 'junction', framed: false },
	8: { view: 'fork', framed: false },
	9: { view: 'fork', query: { distance: 2.5 }, framed: false },
	10: { view: 'twigs', framed: false },
	11: { view: 'cluster', background: 'white', framed: false },
	12: { view: 'leaf-upper', framed: false },
	13: { view: 'leaf-under', framed: false },
	14: { view: 'bark-base', framed: false },
	15: { view: 'bark-mid', framed: false },
	16: { view: 'bark-limb', framed: false },
	17: { view: 'trunk', framed: false },
	18: { view: 'silhouette', framed: true },
	19: {
		view: 'twigs',
		framed: false,
		note: 'flowers, fruit or cones: judged on the shoot tip, in the season the name gives',
	},
	20: { view: 'skeleton', query: { season: 'winter' }, framed: true },
	21: { view: 'branch', framed: false },
	22: { view: 'subbranch', framed: false },
	23: { view: 'cluster', framed: false },
};

/** The texture sources by number: the render's own surface that each is laid beside, at scale. */
const TEXTURE_BY_NUMBER: Readonly<Record<number, SlotRule>> = {
	24: { view: 'leaf-upper', framed: false },
	25: { view: 'leaf-under', framed: false },
	26: { view: 'bark-mid', framed: false },
	27: { view: 'bark-mid', framed: false, note: "the second bark zone, at the zone's own height" },
	28: {
		view: 'bark-limb',
		query: { along: 0.85 },
		framed: false,
		note: 'young bark: thin wood far out on a limb',
	},
};

/** The season a still's name asks for, if it names one. */
function seasonOf(name: string): Partial<PlantReviewQuery> {
	if (/blossom|flower/.test(name)) return { season: 'blossom' };
	if (/autumn/.test(name)) return { season: 'autumn' };
	if (/winter|bare/.test(name)) return { season: 'winter' };
	return {};
}

/** The texture rule of a texture source that its number does not name. */
function textureRule(number: number, name: string): SlotRule {
	const known = TEXTURE_BY_NUMBER[number];
	if (known) return known;
	if (/leaf|needle|frond|blade/.test(name))
		return (name.includes('under') ? TEXTURE_BY_NUMBER[25] : TEXTURE_BY_NUMBER[24]) as SlotRule;
	return TEXTURE_BY_NUMBER[26] as SlotRule;
}

/** The slot of a numbered still or texture source, or undefined for any other file. */
export function classifySlot(file: string): Slot | undefined {
	const match = /^(\d\d)-(.+)\.(png|jpe?g|webp)$/i.exec(file);
	if (!match) return undefined;
	const number = Number(match[1]);
	const name = (match[2] as string).toLowerCase();
	const texture =
		name.includes('texture') || name.includes('young-bark') || number in TEXTURE_BY_NUMBER;
	const rule = texture
		? textureRule(number, name)
		: (SLOT_RULES.find((r) => r.test(name))?.slot ??
			SLOT_BY_NUMBER[number] ??
			// A still of another form that names no part of the plant shows the whole of it.
			(number >= 29 ? { view: 'whole', framed: true } : undefined));
	if (!rule) return undefined;
	const notes = [rule.note];
	// A young or other-habit form is a different plant from the mature one that a variant grows.
	if (/young|juvenile|sapling/.test(name) && !texture)
		notes.push('a young form: the variant grows the mature plant');
	else if (number >= 29)
		notes.push('another habit of the species: judged beside the grown variant');
	const query = { ...seasonOf(name), ...rule.query };
	const note = notes.filter(Boolean).join('; ');
	return {
		file,
		number,
		name,
		kind: texture ? 'texture' : 'still',
		...rule,
		background: rule.background ?? VIEW_SPECS[rule.view].background,
		...(Object.keys(query).length > 0 ? { query } : {}),
		...(note ? { note } : {}),
	};
}

/** The pieces a turning video turns round. */
export type TurnPiece = 'whole' | 'branch' | 'subbranch' | 'cluster';

/** One turning video: the piece it turns round and the arc it covers. */
export interface TurnVideo {
	readonly file: string;
	readonly path: string;
	readonly piece: TurnPiece;
	/** Degrees the camera turns over the video's length: 360, or 180 for a half turn. */
	readonly arc: number;
}

/** The piece and arc of a turning video's file name, or undefined for a file that is not one. */
export function classifyTurn(file: string): Omit<TurnVideo, 'path'> | undefined {
	const match = /^(.*?)-?turntable(-halfturn)?(-[a-z])*\.mp4$/i.exec(file);
	if (!match) return undefined;
	const prefix = (match[1] ?? '').toLowerCase();
	const piece: TurnPiece =
		prefix === 'subbranch'
			? 'subbranch'
			: prefix === 'branch'
				? 'branch'
				: prefix === 'leaf-cluster'
					? 'cluster'
					: 'whole';
	return { file, piece, arc: match[2] ? 180 : 360 };
}

/** The view that a turning video's piece is drawn in. */
export const TURN_VIEW: Readonly<Record<TurnPiece, PlantView>> = {
	whole: 'whole',
	branch: 'branch',
	subbranch: 'subbranch',
	cluster: 'cluster',
};

/** One row of a folder's index: the file it names and its words for what the file shows. */
export interface IndexRow {
	readonly file: string;
	readonly shows: string;
	readonly supersededBy?: string;
}

/**
 * The rows of an INDEX.md: each table row whose first cell names a file in backticks. A row whose
 * "what it shows" cell says the file is superseded marks it out of use, with the file that
 * supersedes it when the cell names one. A later cell that says "Superseded by" a file, with a
 * capital, marks it out of use too; "is superseded by" there speaks of another file.
 */
export function readIndex(text: string): IndexRow[] {
	const rows: IndexRow[] = [];
	for (const line of text.split('\n')) {
		const cells = line.split('|').map((cell) => cell.trim());
		// A table row starts and ends with a bar, so its first and last cells are empty.
		const file = /^`([^`]+)`$/.exec(cells[1] ?? '')?.[1];
		if (!file) continue;
		const shows = cells[2] ?? '';
		const later = cells.slice(3).join(' ');
		const laterBy = /\bSuperseded by `([^`]+)`/.exec(later)?.[1];
		const superseded = /\bsuperseded\b/i.test(shows) || laterBy !== undefined;
		const by = /superseded by `([^`]+)`/i.exec(shows)?.[1] ?? laterBy;
		rows.push({ file, shows, ...(superseded ? { supersededBy: by ?? 'a later file' } : {}) });
	}
	return rows;
}

/** A species' reference folder: every reference file, and those in use by kind. */
export interface ReferenceSet {
	readonly folder: string;
	/** The folder's own name, the species' slug. */
	readonly slug: string;
	/** Every reference file, in name order, in use or not. */
	readonly files: readonly ReferenceFile[];
	/** The stills and texture sources in use, in number order, each with its slot. */
	readonly stills: readonly Slot[];
	/** The turning videos in use. */
	readonly turns: readonly TurnVideo[];
	/** The wind videos in use. */
	readonly winds: readonly string[];
	/** Files in use that no slot, turn or wind rule knows, which the review cannot draw a view for. */
	readonly unknown: readonly string[];
}

/** Whether a file is a reference: a picture or a video, but not a video's contact sheet. */
function isReference(file: string): boolean {
	return /\.(png|jpe?g|webp|mp4)$/i.test(file) && !/-sheet\.png$/i.test(file);
}

/** Reads a reference folder: its index's rows, and every reference file sorted by kind. */
export function readReferenceSet(folder: string): ReferenceSet {
	const indexPath = join(folder, 'INDEX.md');
	const rows = existsSync(indexPath) ? readIndex(readFileSync(indexPath, 'utf8')) : [];
	const byFile = new Map(rows.map((row) => [row.file, row]));
	const files: ReferenceFile[] = [];
	const stills: Slot[] = [];
	const turns: TurnVideo[] = [];
	const winds: string[] = [];
	const unknown: string[] = [];
	for (const file of readdirSync(folder).sort()) {
		if (!isReference(file)) continue;
		const row = byFile.get(file);
		const inUse = row?.supersededBy === undefined;
		const slot = classifySlot(file);
		const turn = classifyTurn(file);
		const wind = /wind/i.test(file) && file.toLowerCase().endsWith('.mp4');
		const kind: ReferenceKind = slot ? slot.kind : turn ? 'turntable' : wind ? 'wind' : 'still';
		files.push({
			file,
			kind,
			inUse,
			listed: row !== undefined,
			...(row?.supersededBy ? { supersededBy: row.supersededBy } : {}),
			...(row ? { shows: row.shows } : {}),
		});
		if (!inUse) continue;
		if (slot) stills.push(slot);
		else if (turn) turns.push({ ...turn, path: join(folder, file) });
		else if (wind) winds.push(join(folder, file));
		else unknown.push(file);
	}
	stills.sort((a, b) => a.number - b.number || a.file.localeCompare(b.file));
	return { folder, slug: basename(folder), files, stills, turns, winds, unknown };
}

/** The widest picture the masks and the measures work on, in pixels. */
export const WORK_WIDTH = 640;

/** A smooth colour surface over the frame: a quadratic in x and y for each CIELAB channel. */
export interface ColourSurface {
	/** Six coefficients for each channel, for 1, x, y, x², y² and xy over shares of the frame. */
	readonly coefficients: readonly (readonly number[])[];
	/** The spread of the border's own colours about the surface, as a CIELAB distance. */
	readonly noise: number;
	/** The share of the border's samples that the surface fits, from 0 to 1. */
	readonly fit: number;
}

/** The surface's colour at a point given as shares of the frame. */
export function surfaceAt(surface: ColourSurface, x: number, y: number): [number, number, number] {
	const terms = [1, x, y, x * x, y * y, x * y];
	const out: [number, number, number] = [0, 0, 0];
	for (let c = 0; c < 3; c++) {
		const k = surface.coefficients[c] as readonly number[];
		let sum = 0;
		for (let t = 0; t < 6; t++) sum += (k[t] as number) * (terms[t] as number);
		out[c] = sum;
	}
	return out;
}

/** Solves a small linear system by Gaussian elimination with partial pivoting. */
export function solve(matrix: number[][], vector: number[]): number[] {
	const n = vector.length;
	const a = matrix.map((row, i) => [...row, vector[i] as number]);
	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let row = col + 1; row < n; row++)
			if (
				Math.abs((a[row] as number[])[col] as number) >
				Math.abs((a[pivot] as number[])[col] as number)
			)
				pivot = row;
		[a[col], a[pivot]] = [a[pivot] as number[], a[col] as number[]];
		const p = (a[col] as number[])[col] as number;
		if (Math.abs(p) < 1e-12) continue;
		for (let row = 0; row < n; row++) {
			if (row === col) continue;
			const f = ((a[row] as number[])[col] as number) / p;
			for (let k = col; k <= n; k++)
				(a[row] as number[])[k] =
					((a[row] as number[])[k] as number) - f * ((a[col] as number[])[k] as number);
		}
	}
	return a.map((row, i) => {
		const p = row[i] as number;
		return Math.abs(p) < 1e-12 ? 0 : (row[n] as number) / p;
	});
}

/**
 * Fits a colour surface to samples by least squares, dropping the samples that sit far from it
 * and fitting again, so a plant that covers part of the border does not pull the surface.
 * `samples` holds x, y (shares) and L, a, b for each sample.
 */
export function fitSurface(samples: Float32Array, flat = false): ColourSurface {
	const count = samples.length / 5;
	let inliers = new Uint8Array(count).fill(1);
	let coefficients: number[][] = [
		[0, 0, 0, 0, 0, 0],
		[0, 0, 0, 0, 0, 0],
		[0, 0, 0, 0, 0, 0],
	];
	let noise = 0;
	const terms = flat ? 1 : 6;
	for (let pass = 0; pass < 5; pass++) {
		const matrix = Array.from({ length: terms }, () => new Array<number>(terms).fill(0));
		const vectors = [0, 1, 2].map(() => new Array<number>(terms).fill(0));
		let used = 0;
		for (let i = 0; i < count; i++) {
			if (!inliers[i]) continue;
			used++;
			const x = samples[i * 5] as number;
			const y = samples[i * 5 + 1] as number;
			const t = [1, x, y, x * x, y * y, x * y].slice(0, terms);
			for (let r = 0; r < terms; r++) {
				for (let c = 0; c < terms; c++)
					(matrix[r] as number[])[c] =
						((matrix[r] as number[])[c] as number) + (t[r] as number) * (t[c] as number);
				for (let ch = 0; ch < 3; ch++)
					(vectors[ch] as number[])[r] =
						((vectors[ch] as number[])[r] as number) +
						(t[r] as number) * (samples[i * 5 + 2 + ch] as number);
			}
		}
		if (used < terms * 4) break;
		// A light ridge keeps the fit steady when the samples cover the frame unevenly.
		for (let r = 1; r < terms; r++)
			(matrix[r] as number[])[r] = ((matrix[r] as number[])[r] as number) + used * 1e-4;
		coefficients = vectors.map((v) => {
			const k = solve(
				matrix.map((row) => [...row]),
				v,
			);
			return [...k, 0, 0, 0, 0, 0, 0].slice(0, 6);
		});
		const surface = { coefficients, noise: 0, fit: 1 };
		const residuals = new Float32Array(count);
		for (let i = 0; i < count; i++)
			residuals[i] = deltaE76(
				surfaceAt(surface, samples[i * 5] as number, samples[i * 5 + 1] as number),
				[samples[i * 5 + 2] as number, samples[i * 5 + 3] as number, samples[i * 5 + 4] as number],
			);
		const kept = Array.from(residuals.filter((_, i) => inliers[i] === 1)).sort((a, b) => a - b);
		const median = kept[kept.length >> 1] ?? 0;
		noise = Math.max(0.5, median * 1.4826);
		const limit = Math.max(6, noise * 3);
		const next = new Uint8Array(count);
		for (let i = 0; i < count; i++) next[i] = (residuals[i] as number) < limit ? 1 : 0;
		inliers = next;
	}
	let fitted = 0;
	for (let i = 0; i < count; i++) fitted += inliers[i] as number;
	return { coefficients, noise, fit: count > 0 ? fitted / count : 0 };
}

/** The background of a picture: the horizon, the sky's surface and the ground's below it. */
export interface Background {
	/** The horizon's row in the work picture, or null when the picture has no ground. */
	readonly horizon: number | null;
	readonly sky: ColourSurface;
	readonly ground?: ColourSurface;
	/** Whether the border is plain enough for a mask: most of it fits a smooth surface. */
	readonly plain: boolean;
}

/** The median of the CIELAB colours of a strip of columns in one row. */
function stripMedian(
	lab: Float32Array,
	width: number,
	y: number,
	from: number,
	to: number,
): number[] {
	const channels: number[][] = [[], [], []];
	for (let x = from; x < to; x++)
		for (let c = 0; c < 3; c++)
			(channels[c] as number[]).push(lab[(y * width + x) * 3 + c] as number);
	return channels.map((values) => {
		values.sort((a, b) => a - b);
		return values[values.length >> 1] ?? 0;
	});
}

/**
 * The horizon's row: the strongest colour step down the frame's left and right edges, where the
 * sky above differs from the ground below. Null when no step is strong enough, as in a studio.
 */
export function findHorizon(lab: Float32Array, width: number, height: number): number | null {
	const strip = Math.max(2, Math.round(width * 0.06));
	const rows = Array.from({ length: height }, (_, y) => [
		stripMedian(lab, width, y, 0, strip),
		stripMedian(lab, width, y, width - strip, width),
	]);
	const k = Math.max(2, Math.round(height * 0.015));
	let best = -1;
	let bestScore = 0;
	// A horizon can sit a few rows above the frame's foot, so the window below it narrows there.
	for (let y = k; y <= height - 2; y++) {
		const under = Math.min(k, height - y);
		let score = 0;
		for (let side = 0; side < 2; side++) {
			const above = [0, 0, 0];
			const below = [0, 0, 0];
			for (let i = 1; i <= k; i++)
				for (let c = 0; c < 3; c++)
					above[c] =
						(above[c] as number) +
						(((rows[y - i] as number[][])[side] as number[])[c] as number) / k;
			for (let i = 1; i <= under; i++)
				for (let c = 0; c < 3; c++)
					below[c] =
						(below[c] as number) +
						(((rows[y + i - 1] as number[][])[side] as number[])[c] as number) / under;
			score += deltaE76(above, below);
		}
		if (score > bestScore) {
			bestScore = score;
			best = y;
		}
	}
	// Both edges together must step by a clear colour difference.
	return bestScore / 2 >= 12 ? best : null;
}

/** The border samples of a region of rows, as x, y, L, a, b for each sample. */
function borderSamples(
	lab: Float32Array,
	width: number,
	height: number,
	from: number,
	to: number,
	top: boolean,
	bottom: boolean,
): Float32Array {
	const strip = Math.max(2, Math.round(width * 0.06));
	const band = Math.max(2, Math.round(height * 0.05));
	const out: number[] = [];
	const step = Math.max(1, Math.round(width / 320));
	for (let y = from; y < to; y += step)
		for (let x = 0; x < width; x += step) {
			const edge =
				x < strip || x >= width - strip || (top && y < from + band) || (bottom && y >= to - band);
			if (!edge) continue;
			const at = (y * width + x) * 3;
			out.push(
				x / width,
				y / height,
				lab[at] as number,
				lab[at + 1] as number,
				lab[at + 2] as number,
			);
		}
	return Float32Array.from(out);
}

/** The background of a picture in CIELAB, from its border. */
export function backgroundOf(lab: Float32Array, width: number, height: number): Background {
	const horizon = findHorizon(lab, width, height);
	const gap = Math.max(1, Math.round(height * 0.01));
	const skyTo = horizon === null ? height : Math.max(1, horizon - gap);
	const sky = fitSurface(borderSamples(lab, width, height, 0, skyTo, true, horizon === null));
	const ground =
		horizon !== null && horizon + gap < height - 2
			? fitSurface(borderSamples(lab, width, height, horizon + gap, height, false, true))
			: undefined;
	return {
		horizon,
		sky,
		...(ground ? { ground } : {}),
		plain: sky.fit >= 0.55 && sky.noise < 12,
	};
}

/** A plant's outline in a picture, and the background it was taken from. */
export interface PlantMask {
	readonly width: number;
	readonly height: number;
	/** One byte per pixel: 1 where the plant is. */
	readonly mask: Uint8Array;
	readonly background: Background;
}

/** The pixels of the foreground's connected parts, 8-connected, labelled from 1; 0 is background. */
export function components(
	mask: Uint8Array,
	width: number,
	height: number,
): { labels: Int32Array; sizes: number[] } {
	const labels = new Int32Array(width * height);
	const sizes: number[] = [0];
	const stack: number[] = [];
	for (let start = 0; start < mask.length; start++) {
		if (!mask[start] || labels[start]) continue;
		const label = sizes.length;
		let size = 0;
		labels[start] = label;
		stack.push(start);
		while (stack.length > 0) {
			const at = stack.pop() as number;
			size++;
			const x = at % width;
			const y = (at - x) / width;
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
					const next = ny * width + nx;
					if (mask[next] && !labels[next]) {
						labels[next] = label;
						stack.push(next);
					}
				}
		}
		sizes.push(size);
	}
	return { labels, sizes };
}

/** The CIELAB distance from a colour to the nearest blend of two others. */
export function distanceToSegment(
	point: readonly number[],
	from: readonly number[],
	to: readonly number[],
): number {
	const d = [0, 1, 2].map((c) => (to[c] as number) - (from[c] as number));
	const p = [0, 1, 2].map((c) => (point[c] as number) - (from[c] as number));
	const length = d.reduce((sum, v) => sum + v * v, 0);
	const t =
		length > 0
			? Math.max(0, Math.min(1, d.reduce((sum, v, c) => sum + v * (p[c] as number), 0) / length))
			: 0;
	return deltaE76(
		point,
		[0, 1, 2].map((c) => (from[c] as number) + t * (d[c] as number)),
	);
}

/** The pixel distance below which a colour counts as the background, from the surface's noise. */
function threshold(surface: ColourSurface, floor: number, spread: number): number {
	return Math.max(floor, surface.noise * spread);
}

/**
 * Whether a colour below the horizon reads as the meadow in shade: darker than the meadow, with
 * about its hue and a good share of its colourfulness. A trunk is browner or greyer than that.
 */
export function shadowLike(pixel: readonly number[], meadow: readonly number[]): boolean {
	const chroma = Math.hypot(pixel[1] ?? 0, pixel[2] ?? 0);
	const meadowChroma = Math.hypot(meadow[1] ?? 0, meadow[2] ?? 0);
	if ((pixel[0] ?? 0) >= (meadow[0] ?? 0) || meadowChroma < 6) return false;
	const hue = Math.atan2(pixel[2] ?? 0, pixel[1] ?? 0);
	const meadowHue = Math.atan2(meadow[2] ?? 0, meadow[1] ?? 0);
	let turn = Math.abs(hue - meadowHue);
	if (turn > Math.PI) turn = 2 * Math.PI - turn;
	return turn < (25 * Math.PI) / 180 && chroma > meadowChroma * 0.35;
}

/**
 * From a row down, keeps only the plant that hangs down from the plant above it, row by row. Below
 * the horizon it also stops where the colour turns to the meadow in shade: a ground shadow is a
 * darker meadow that spreads sideways from the trunk's foot, and the meadow's texture never joins
 * the plant from above. In a frame with no horizon, the same rule over the lowest rows drops a sliver
 * of ground that shows along the frame's foot.
 */
export function keepHangingParts(
	mask: Uint8Array,
	lab: Float32Array,
	width: number,
	height: number,
	from: number,
	ground?: ColourSurface,
): void {
	for (let y = Math.max(1, from); y < height; y++)
		for (let x = 0; x < width; x++) {
			const at = y * width + x;
			if (!mask[at]) continue;
			const above = at - width;
			const hangs =
				mask[above] === 1 ||
				(x > 0 && mask[above - 1] === 1) ||
				(x < width - 1 && mask[above + 1] === 1);
			const pixel = [lab[at * 3] as number, lab[at * 3 + 1] as number, lab[at * 3 + 2] as number];
			const shade = ground ? shadowLike(pixel, surfaceAt(ground, x / width, y / height)) : false;
			mask[at] = hangs && !shade ? 1 : 0;
		}
}

/** The share of a frame's height, at its foot, that the hanging rule covers when no horizon shows. */
const FOOT_SHARE = 0.03;

/**
 * The plant's outline in a picture with a plain background, in the work picture's pixels. The
 * picture is first shrunk to the work width. Returns a mask with no plant when the border is not
 * plain.
 */
export function plantMask(image: Rgba): PlantMask {
	const work = image.width > WORK_WIDTH ? resizeToWidth(image, WORK_WIDTH) : image;
	const { width, height } = work;
	const lab = labImage(work);
	const background = backgroundOf(lab, width, height);
	const mask = new Uint8Array(width * height);
	if (!background.plain) return { width, height, mask, background };
	const horizon = background.horizon ?? height;
	const skyLimit = threshold(background.sky, 8, 3.5);
	const groundLimit = background.ground ? threshold(background.ground, 10, 3) : skyLimit;
	// The rows at the horizon blend the sky with the meadow, so there a pixel is background when it
	// lies near any blend of the two.
	const band = Math.max(1, Math.round(height * 0.006));
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const at = y * width + x;
			const pixel = [lab[at * 3] as number, lab[at * 3 + 1] as number, lab[at * 3 + 2] as number];
			const below = y >= horizon && background.ground;
			const surface = below ? (background.ground as ColourSurface) : background.sky;
			const own = surfaceAt(surface, x / width, y / height);
			let d = deltaE76(own, pixel);
			if (background.ground && Math.abs(y - horizon) <= band) {
				const sky = surfaceAt(background.sky, x / width, y / height);
				const ground = surfaceAt(background.ground, x / width, y / height);
				d = Math.min(d, distanceToSegment(pixel, sky, ground));
			}
			mask[at] = d > (below ? groundLimit : skyLimit) ? 1 : 0;
		}
	clearSideBands(mask, lab, width, height, horizon);
	if (background.ground) keepHangingParts(mask, lab, width, height, horizon, background.ground);
	else
		keepHangingParts(
			mask,
			lab,
			width,
			height,
			height - Math.max(2, Math.round(height * FOOT_SHARE)),
		);
	keepPlantParts(mask, width, height, horizon);
	return { width, height, mask, background };
}

/** How far above the horizon, as a share of the frame's height, a background band may lie. */
const SIDE_BAND_REACH = 0.25;
/** The CIELAB distance from the colour at the frame's side within which a band runs on. */
const SIDE_BAND_COLOUR = 18;

/** The most rows, as a share of the frame's height, of a strip that reaches only one side. */
const SIDE_STRIP_ROWS = 0.04;

/**
 * Clears the background bands that the sky's and the meadow's surfaces miss, such as a river or a
 * far bank along the horizon. Near or below the horizon, a row whose outline reaches both sides of
 * the frame holds such a band, since a plant in frame reaches at most one; so does a thin run of
 * rows that reaches one side once those are cleared, where a plant running off the frame reaches
 * it over many rows. In each such row, the run in from each side it reaches is cleared while its
 * colour stays near the colour at that side.
 */
export function clearSideBands(
	mask: Uint8Array,
	lab: Float32Array,
	width: number,
	height: number,
	horizon: number,
): void {
	const sample = Math.max(2, Math.round(width * 0.01));
	const from = Math.max(0, horizon - Math.round(height * SIDE_BAND_REACH));
	const thin = Math.max(2, Math.round(height * SIDE_STRIP_ROWS));
	const left = (y: number) => mask[y * width] === 1;
	const right = (y: number) => mask[y * width + width - 1] === 1;
	for (let y = from; y < height; y++)
		if (left(y) && right(y)) clearSideRuns(mask, lab, width, y, sample);
	for (let y = from; y < height; ) {
		if (!left(y) && !right(y)) {
			y++;
			continue;
		}
		let end = y;
		while (end < height && (left(end) || right(end))) end++;
		if (end - y <= thin) for (let r = y; r < end; r++) clearSideRuns(mask, lab, width, r, sample);
		y = end;
	}
}

/**
 * Clears a band's pixels along a row, in from each side of the frame it reaches: those whose colour
 * stays near the colour at that side, up to the first stretch of other colours as wide as a
 * hundredth of the frame, which is the plant. Shorter stretches between band pixels are the band's
 * own texture and go with it.
 */
function clearSideRuns(
	mask: Uint8Array,
	lab: Float32Array,
	width: number,
	y: number,
	sample: number,
): void {
	const row = y * width;
	for (const [start, step] of [
		[0, 1],
		[width - 1, -1],
	] as const) {
		if (!mask[row + start]) continue;
		const seed = [0, 0, 0];
		let n = 0;
		for (let k = 0, x = start; k < sample && mask[row + x]; k++, x += step) {
			for (let c = 0; c < 3; c++)
				seed[c] = (seed[c] as number) + (lab[(row + x) * 3 + c] as number);
			n++;
		}
		for (let c = 0; c < 3; c++) seed[c] = (seed[c] as number) / n;
		const pending: number[] = [];
		for (let x = start; x >= 0 && x < width && pending.length < sample; x += step) {
			if (!mask[row + x]) continue;
			const at = (row + x) * 3;
			const pixel = [lab[at] as number, lab[at + 1] as number, lab[at + 2] as number];
			if (deltaE76(pixel, seed) > SIDE_BAND_COLOUR) {
				pending.push(row + x);
				continue;
			}
			for (const p of pending) mask[p] = 0;
			pending.length = 0;
			mask[row + x] = 0;
		}
	}
}

/**
 * Keeps the plant in a mask: its largest part, and the small parts near it above the horizon,
 * which are leaf clumps that the sky cut off. Parts wholly below the horizon that do not join it
 * are the meadow's own texture.
 */
export function keepPlantParts(
	mask: Uint8Array,
	width: number,
	height: number,
	horizon: number,
): void {
	const { labels, sizes } = components(mask, width, height);
	let main = 0;
	for (let label = 1; label < sizes.length; label++)
		if ((sizes[label] as number) > (sizes[main] as number)) main = label;
	if (main === 0) return;
	const boxes = sizes.map(() => [width, height, -1, -1]);
	for (let at = 0; at < labels.length; at++) {
		const label = labels[at] as number;
		if (!label) continue;
		const x = at % width;
		const y = (at - x) / width;
		const box = boxes[label] as number[];
		box[0] = Math.min(box[0] as number, x);
		box[1] = Math.min(box[1] as number, y);
		box[2] = Math.max(box[2] as number, x);
		box[3] = Math.max(box[3] as number, y);
	}
	const mainBox = boxes[main] as number[];
	const margin = Math.round(width * 0.05);
	const keep = sizes.map((size, label) => {
		if (label === main) return true;
		const box = boxes[label] as number[];
		const minimum = Math.max(4, (sizes[main] as number) * 0.0005);
		const near =
			(box[2] as number) >= (mainBox[0] as number) - margin &&
			(box[0] as number) <= (mainBox[2] as number) + margin &&
			(box[3] as number) >= (mainBox[1] as number) - margin &&
			(box[1] as number) <= (mainBox[3] as number) + margin;
		return size >= minimum && near && (box[1] as number) < horizon;
	});
	for (let at = 0; at < labels.length; at++)
		mask[at] = keep[labels[at] as number] && labels[at] ? 1 : 0;
}

/** The plant's outline from a matte: the plant drawn dark on white, as the silhouette view draws it. */
export function matteMask(image: Rgba): PlantMask {
	const work = image.width > WORK_WIDTH ? resizeToWidth(image, WORK_WIDTH) : image;
	const { width, height } = work;
	const mask = new Uint8Array(width * height);
	for (let at = 0; at < mask.length; at++) {
		const luma =
			0.2126 * (work.data[at * 4] as number) +
			0.7152 * (work.data[at * 4 + 1] as number) +
			0.0722 * (work.data[at * 4 + 2] as number);
		mask[at] = luma < 128 ? 1 : 0;
	}
	const flat: ColourSurface = {
		coefficients: [
			[100, 0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0, 0],
		],
		noise: 0.5,
		fit: 1,
	};
	return { width, height, mask, background: { horizon: null, sky: flat, plain: true } };
}

/** A box of pixels, edges included. */
export interface Box {
	readonly left: number;
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
}

/** The measures a reviewer reads from a plant's outline. Rows count down, shares run 0 to 1. */
export interface PlantMeasures {
	/** The work picture's size. */
	readonly width: number;
	readonly height: number;
	/** The horizon's row share, or null. */
	readonly horizon: number | null;
	/** The plant's box in the work picture, or null when the mask holds no plant. */
	readonly box: Box | null;
	/** Which edges of the frame the plant touches, so its box is cut there. */
	readonly clipped: {
		readonly left: boolean;
		readonly top: boolean;
		readonly right: boolean;
		readonly bottom: boolean;
	};
	/** The plant's width in each of the profile's height bands, top band first, over its height. */
	readonly widthProfile: readonly number[];
	/** Where the crown starts, as a share of the plant's height up from its base. */
	readonly crownStart: number;
	/** The crown's box: its widest run and its height to the crown's start, in work pixels. */
	readonly crownBox: { readonly width: number; readonly height: number };
	/** The share of the crown's outline that shows background: the sky or ground through it. */
	readonly gapFraction: number;
	/** The share of the plant's box that the plant covers. */
	readonly solidity: number;
	/** The mean CIELAB colour of the crown's foliage, and its sRGB hex. */
	readonly foliage: { readonly lab: readonly number[]; readonly hex: string } | null;
	/** The mean CIELAB colour of the trunk below the crown, and its sRGB hex. */
	readonly bark: { readonly lab: readonly number[]; readonly hex: string } | null;
	/** The colours of the background, as sRGB hex: the sky at mid-height and the ground. */
	readonly sky: string;
	readonly ground: string | null;
}

/** The number of height bands of a width profile. */
export const PROFILE_BANDS = 24;

/** Each row's leftmost and rightmost plant pixel, or -1 for a row with none. */
export function rowSpans(mask: Uint8Array, width: number, height: number): Int32Array {
	const spans = new Int32Array(height * 2).fill(-1);
	for (let y = 0; y < height; y++) {
		let left = -1;
		let right = -1;
		for (let x = 0; x < width; x++)
			if (mask[y * width + x]) {
				if (left < 0) left = x;
				right = x;
			}
		spans[y * 2] = left;
		spans[y * 2 + 1] = right;
	}
	return spans;
}

/** The box round a mask's plant pixels, or null for an empty mask. */
export function boxOf(mask: Uint8Array, width: number, height: number): Box | null {
	let left = width;
	let top = height;
	let right = -1;
	let bottom = -1;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			if (mask[y * width + x]) {
				if (x < left) left = x;
				if (x > right) right = x;
				if (y < top) top = y;
				bottom = y;
			}
	return right < 0 ? null : { left, top, right, bottom };
}

/** The plant's width in each height band over its height, from the rows' spans. */
export function widthProfile(spans: Int32Array, box: Box, bands = PROFILE_BANDS): number[] {
	const tall = box.bottom - box.top + 1;
	return Array.from({ length: bands }, (_, band) => {
		const from = box.top + Math.floor((band * tall) / bands);
		const to =
			box.top +
			Math.max(Math.floor(((band + 1) * tall) / bands), Math.floor((band * tall) / bands) + 1);
		let widest = 0;
		for (let y = from; y < Math.min(to, box.bottom + 1); y++) {
			const left = spans[y * 2] as number;
			if (left >= 0) widest = Math.max(widest, (spans[y * 2 + 1] as number) - left + 1);
		}
		return widest / tall;
	});
}

/**
 * The row where the crown starts: going up from the plant's base, the first row from which the
 * plant stays wider than its trunk by a clear margin. The trunk's width is the median width of the
 * lowest rows.
 */
export function crownStartRow(spans: Int32Array, box: Box): number {
	const tall = box.bottom - box.top + 1;
	const width = (y: number) => {
		const left = spans[y * 2] as number;
		return left < 0 ? 0 : (spans[y * 2 + 1] as number) - left + 1;
	};
	const low: number[] = [];
	for (let y = box.bottom; y > box.bottom - Math.max(2, Math.round(tall * 0.06)); y--)
		low.push(width(y));
	low.sort((a, b) => a - b);
	const trunk = low[low.length >> 1] ?? 0;
	let widest = 0;
	for (let y = box.top; y <= box.bottom; y++) widest = Math.max(widest, width(y));
	const limit = Math.max(trunk * 2.5, widest * 0.12);
	const run = Math.max(2, Math.round(tall * 0.03));
	for (let y = box.bottom; y >= box.top; y--) {
		let wide = true;
		for (let k = 0; k < run && y - k >= box.top; k++) if (width(y - k) <= limit) wide = false;
		if (wide) return y;
	}
	return box.bottom;
}

/** The mean CIELAB colour of the pixels that a test picks, or null when it picks none. */
function meanColour(
	lab: Float32Array,
	count: number,
	pick: (at: number) => boolean,
): { lab: number[]; hex: string } | null {
	const sum = [0, 0, 0];
	let n = 0;
	for (let at = 0; at < count; at++) {
		if (!pick(at)) continue;
		for (let c = 0; c < 3; c++) sum[c] = (sum[c] as number) + (lab[at * 3 + c] as number);
		n++;
	}
	if (n === 0) return null;
	const mean = sum.map((v) => v / n);
	return { lab: mean.map((v) => Number(v.toFixed(2))), hex: hexOf(srgbOf(mean)) };
}

/** Measures a plant from its outline in a picture. */
export function measurePlant(image: Rgba, plant: PlantMask): PlantMeasures {
	const { width, height, mask, background } = plant;
	const work = image.width === width ? image : resizeToWidth(image, width);
	const lab = labImage(work);
	const horizon = background.horizon;
	const skyAt = surfaceAt(background.sky, 0.5, horizon === null ? 0.5 : horizon / height / 2);
	const groundAt =
		background.ground && horizon !== null
			? surfaceAt(background.ground, 0.5, (horizon / height + 1) / 2)
			: null;
	const base = {
		width,
		height,
		horizon: horizon === null ? null : horizon / height,
		sky: hexOf(srgbOf(skyAt)),
		ground: groundAt ? hexOf(srgbOf(groundAt)) : null,
	};
	const box = background.plain ? boxOf(mask, width, height) : null;
	if (!box)
		return {
			...base,
			box: null,
			clipped: { left: false, top: false, right: false, bottom: false },
			widthProfile: [],
			crownStart: 0,
			crownBox: { width: 0, height: 0 },
			gapFraction: 0,
			solidity: 0,
			foliage: null,
			bark: null,
		};
	const spans = rowSpans(mask, width, height);
	const start = crownStartRow(spans, box);
	const tall = box.bottom - box.top + 1;
	// The crown's outline: in each crown row, everything between the row's outermost plant pixels.
	let hull = 0;
	let gaps = 0;
	let crownWidth = 0;
	const inCrown = new Uint8Array(width * height);
	for (let y = box.top; y <= start; y++) {
		const left = spans[y * 2] as number;
		if (left < 0) continue;
		const right = spans[y * 2 + 1] as number;
		crownWidth = Math.max(crownWidth, right - left + 1);
		for (let x = left; x <= right; x++) {
			hull++;
			if (!mask[y * width + x]) gaps++;
			else inCrown[y * width + x] = 1;
		}
	}
	let covered = 0;
	for (let y = box.top; y <= box.bottom; y++)
		for (let x = box.left; x <= box.right; x++) covered += mask[y * width + x] as number;
	return {
		...base,
		box,
		clipped: {
			left: box.left <= 0,
			top: box.top <= 0,
			right: box.right >= width - 1,
			bottom: box.bottom >= height - 1,
		},
		widthProfile: widthProfile(spans, box).map((v) => Number(v.toFixed(4))),
		crownStart: Number(((box.bottom - start) / tall).toFixed(4)),
		crownBox: { width: crownWidth, height: start - box.top + 1 },
		gapFraction: hull > 0 ? Number((gaps / hull).toFixed(4)) : 0,
		solidity: Number((covered / ((box.right - box.left + 1) * tall)).toFixed(4)),
		foliage: meanColour(lab, width * height, (at) => inCrown[at] === 1),
		bark:
			start < box.bottom
				? meanColour(lab, width * height, (at) => {
						const y = Math.floor(at / width);
						return y > start && mask[at] === 1;
					})
				: null,
	};
}

/** A picture of a mask beside its picture: the picture with the background dimmed to grey. */
export function maskPreview(image: Rgba, plant: PlantMask): Rgba {
	const work = image.width === plant.width ? image : resizeToWidth(image, plant.width);
	const out = blank(work.width, work.height, [0, 0, 0]);
	for (let at = 0; at < plant.mask.length; at++) {
		const keep = plant.mask[at] === 1;
		for (let c = 0; c < 3; c++) {
			const v = work.data[at * 4 + c] as number;
			out.data[at * 4 + c] = keep ? v : Math.round(160 + (v - 160) * 0.15);
		}
	}
	if (plant.background.horizon !== null)
		for (let x = 0; x < out.width; x++) {
			const at = (plant.background.horizon * out.width + x) * 4;
			out.data[at] = 255;
			out.data[at + 1] = 0;
			out.data[at + 2] = 0;
		}
	return out;
}
