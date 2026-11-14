// The leaf textures (slots 24 and 25): each face cut out cleanly, framed upright on a square canvas
// with the midrib on the middle column and the stalk at the bottom, the lower face fitted to the
// upper face's outline, the shading of the picture divided out, and the blade's relief made from the
// upper face's luminance. The CPU's view of the leaf, its outline, frame, means and profiles, goes
// into the manifest.

import type { LeafConfig, LeafFrame } from './config.ts';
import { type Point, signedArea, simplifyTo, traceLoops } from './contour.ts';
import {
	bilinear,
	bleed,
	blur,
	blurWeighted,
	halve,
	halvePlane,
	luminance,
	mirror,
	normalBytes,
	type Picture,
	type Plane,
	percentile,
	picture,
	plane,
	srgbBytes,
	unit,
} from './image.ts';

/** Texels per side of the full set's leaf canvas; the half set takes half. */
export const LEAF_SIZE = 1024;

/** The coverage at which a texel counts as leaf: the alpha cutoff the materials use. */
export const CUTOFF = 0.5;

/** A 2D vector in source texels, x right and y down. */
type Vec = readonly [number, number];

/** Where a face's leaf sits in its source picture. */
export interface Frame {
	/** The stalk's bottom end and the blade's tip, in source texels. */
	readonly petiole: Vec;
	readonly tip: Vec;
}

/** The map from canvas texels to a face's source texels. */
export interface Placement {
	readonly frame: Frame;
	/** Unit vector from the petiole to the tip, and the unit vector to its right. */
	readonly up: Vec;
	readonly right: Vec;
	/** Canvas texels per source texel. */
	readonly scale: number;
	/** The along-midrib coordinate, in source texels, that sits at the canvas's middle row. */
	readonly middle: number;
}

/** A small change to a placement, which the lower face's fit searches. */
interface Nudge {
	/** Tangent of the turn, scale factor, and shift in canvas texels. */
	readonly turn: number;
	readonly scale: number;
	readonly dx: number;
	readonly dy: number;
}

const STILL: Nudge = { turn: 0, scale: 1, dx: 0, dy: 0 };

/** Clears coverage below the floor and maps the solid level to full coverage, both in bytes. */
function cleanAlpha(p: Picture, floor: number, solid: number): void {
	for (let i = 0; i < p.a.length; i++) {
		const byte = (p.a[i] as number) * 255;
		p.a[i] = byte < floor ? 0 : unit((byte - floor) / (solid - floor));
	}
}

/**
 * The texels whose colour is the leaf's own: full coverage, `erode` texels in from the edge. The
 * rest take their colour from these, so the halo that a cut-out keeps round its edge goes.
 */
function solidTexels(p: Picture, erode: number): Uint8Array {
	const { width: w, height: h } = p;
	let mask = new Uint8Array(w * h);
	for (let i = 0; i < mask.length; i++) mask[i] = (p.a[i] as number) >= 1 ? 1 : 0;
	for (let step = 0; step < erode; step++) {
		const next = new Uint8Array(w * h);
		for (let y = 1; y < h - 1; y++)
			for (let x = 1; x < w - 1; x++) {
				const i = y * w + x;
				next[i] =
					mask[i] &&
					mask[i - 1] &&
					mask[i + 1] &&
					mask[i - w] &&
					mask[i + w] &&
					mask[i - w - 1] &&
					mask[i - w + 1] &&
					mask[i + w - 1] &&
					mask[i + w + 1]
						? 1
						: 0;
			}
		mask = next;
	}
	return mask;
}

/**
 * Clears the covered texels darker than a linear luminance, fading back to their coverage over a
 * ramp above it: the gaps between a compound leaf's lobes, which its cut-out keeps.
 */
function clearGaps(p: Picture, gaps: NonNullable<LeafConfig['gaps']>): void {
	const low = gaps.luminance;
	const high = low * (1 + Math.max(1e-3, gaps.ramp));
	for (let i = 0; i < p.a.length; i++) {
		const a = p.a[i] as number;
		if (a <= 0) continue;
		const y =
			0.2126 * (p.r[i] as number) + 0.7152 * (p.g[i] as number) + 0.0722 * (p.b[i] as number);
		const t = unit((y - low) / (high - low));
		p.a[i] = a * t * t * (3 - 2 * t);
	}
}

/** A face cleaned: coverage floored and stretched, dark gaps cleared, colour bled out from the solid texels. */
export function cleanFace(p: Picture, config: LeafConfig): Picture {
	cleanAlpha(p, config.alpha.floor, config.alpha.solid);
	if (config.gaps) clearGaps(p, config.gaps);
	bleed(p, solidTexels(p, config.erode));
	return p;
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];

/** A unit vector. */
function normalise(v: Vec): Vec {
	const length = Math.sqrt(dot(v, v));
	return [v[0] / length, v[1] / length];
}

/**
 * Finds the leaf in a face: its principal axis by the moments of its coverage, the stalk at the
 * narrower end, the stalk's bottom end and the blade's tip as the means of the texels at each end.
 */
export function findFrame(p: Picture): Frame {
	const { width: w, height: h } = p;
	let n = 0;
	let mx = 0;
	let my = 0;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			if ((p.a[y * w + x] as number) >= CUTOFF) {
				n++;
				mx += x + 0.5;
				my += y + 0.5;
			}
	if (n === 0) throw new Error('the leaf picture holds no leaf: every texel is transparent');
	mx /= n;
	my /= n;
	let sxx = 0;
	let sxy = 0;
	let syy = 0;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			if ((p.a[y * w + x] as number) >= CUTOFF) {
				const dx = x + 0.5 - mx;
				const dy = y + 0.5 - my;
				sxx += dx * dx;
				sxy += dx * dy;
				syy += dy * dy;
			}
	const half = (sxx - syy) / 2;
	const major = (sxx + syy) / 2 + Math.sqrt(half * half + sxy * sxy);
	let axis: Vec =
		Math.abs(sxy) > 1e-9 ? normalise([sxy, major - sxx]) : sxx >= syy ? [1, 0] : [0, 1];
	if (axis[1] > 0) axis = [-axis[0], -axis[1]];
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			if ((p.a[y * w + x] as number) >= CUTOFF) {
				const t = dot([x + 0.5 - mx, y + 0.5 - my], axis);
				low = Math.min(low, t);
				high = Math.max(high, t);
			}
	const length = high - low;
	// The stalk's end holds fewer texels near it than the blade's end.
	const band = length * 0.04;
	let lowCount = 0;
	let highCount = 0;
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++)
			if ((p.a[y * w + x] as number) >= CUTOFF) {
				const t = dot([x + 0.5 - mx, y + 0.5 - my], axis);
				if (t <= low + band) lowCount++;
				if (t >= high - band) highCount++;
			}
	const stalkLow = lowCount <= highCount;
	const mean = (from: number, to: number): Vec => {
		let count = 0;
		let sx = 0;
		let sy = 0;
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++)
				if ((p.a[y * w + x] as number) >= CUTOFF) {
					const t = dot([x + 0.5 - mx, y + 0.5 - my], axis);
					if (t >= from && t <= to) {
						count++;
						sx += x + 0.5;
						sy += y + 0.5;
					}
				}
		return [sx / count, sy / count];
	};
	const stalkEnd = stalkLow ? mean(low, low + length * 0.004) : mean(high - length * 0.004, high);
	const tipEnd = stalkLow ? mean(high - length * 0.01, high) : mean(low, low + length * 0.01);
	return { petiole: stalkEnd, tip: tipEnd };
}

/** Places a face's leaf on the canvas: midrib on the middle column, the leaf's extent centred. */
function place(p: Picture, frame: Frame, size: number, margin: number): Placement {
	const up = normalise([frame.tip[0] - frame.petiole[0], frame.tip[1] - frame.petiole[1]]);
	const right: Vec = [-up[1], up[0]];
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	let across = 0;
	for (let y = 0; y < p.height; y++)
		for (let x = 0; x < p.width; x++)
			if ((p.a[y * p.width + x] as number) > 0) {
				const d: Vec = [x + 0.5 - frame.petiole[0], y + 0.5 - frame.petiole[1]];
				const along = dot(d, up);
				low = Math.min(low, along);
				high = Math.max(high, along);
				across = Math.max(across, Math.abs(dot(d, right)));
			}
	const scale = (size * (1 - 2 * margin)) / Math.max(high - low, 2 * across);
	return { frame, up, right, scale, middle: (low + high) / 2 };
}

/** The source texel under a canvas point, through a placement and a nudge about the canvas's centre. */
function toSource(at: Placement, nudge: Nudge, size: number, x: number, y: number): Vec {
	const c = 1 / Math.sqrt(1 + nudge.turn * nudge.turn);
	const s = nudge.turn * c;
	const px = x - size / 2 - nudge.dx;
	const py = y - size / 2 - nudge.dy;
	const qx = (c * px + s * py) / nudge.scale;
	const qy = (-s * px + c * py) / nudge.scale;
	const across = qx / at.scale;
	const along = -qy / at.scale + at.middle;
	return [
		at.frame.petiole[0] + along * at.up[0] + across * at.right[0],
		at.frame.petiole[1] + along * at.up[1] + across * at.right[1],
	];
}

/** The canvas point of a source texel through a placement with no nudge. */
function toCanvas(at: Placement, size: number, v: Vec): Vec {
	const d: Vec = [v[0] - at.frame.petiole[0], v[1] - at.frame.petiole[1]];
	return [
		size / 2 + dot(d, at.right) * at.scale,
		size / 2 - (dot(d, at.up) - at.middle) * at.scale,
	];
}

/** Draws a face onto a canvas of `size` texels, four samples a texel; past the source, nothing. */
function render(
	p: Picture,
	at: Placement,
	nudge: Nudge,
	size: number,
	samples = 2,
	alphaOnly = false,
): Picture {
	const out = picture(size, size);
	const scale = size / LEAF_SIZE;
	const from = alphaOnly ? [p.a] : [p.r, p.g, p.b, p.a];
	const to = alphaOnly ? [out.a] : [out.r, out.g, out.b, out.a];
	const last = from.length - 1;
	const step = 1 / samples;
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const sum = from.map(() => 0);
			for (let sy = 0; sy < samples; sy++)
				for (let sx = 0; sx < samples; sx++) {
					const [u, v] = toSource(
						at,
						nudge,
						LEAF_SIZE,
						(x + (sx + 0.5) * step) / scale,
						(y + (sy + 0.5) * step) / scale,
					);
					const inside = u >= 0 && v >= 0 && u <= p.width && v <= p.height;
					for (let c = 0; c <= last; c++)
						sum[c] =
							(sum[c] as number) +
							(c === last && !inside
								? 0
								: bilinear(from[c] as Float32Array, p.width, p.height, u, v));
				}
			const i = y * size + x;
			for (let c = 0; c <= last; c++)
				(to[c] as Float32Array)[i] = (sum[c] as number) / (samples * samples);
		}
	return out;
}

/** Overlap of two coverages: the sum of the smaller over the sum of the larger. */
function overlap(a: Float32Array, b: Float32Array): number {
	let low = 0;
	let high = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i] as number;
		const y = b[i] as number;
		low += x < y ? x : y;
		high += x > y ? x : y;
	}
	return high > 0 ? low / high : 0;
}

/** The size at which the lower face's fit compares coverage. */
const FIT_SIZE = 256;

/**
 * Fits the lower face to the upper face's coverage: small turns, scales and shifts, searched one at
 * a time with halving steps, keeping each that raises the overlap.
 */
function fitLower(
	lower: Picture,
	at: Placement,
	target: Float32Array,
): { nudge: Nudge; overlap: number } {
	const score = (nudge: Nudge) => overlap(render(lower, at, nudge, FIT_SIZE, 1, true).a, target);
	let best = STILL;
	let bestScore = score(best);
	const steps = { turn: 0.02, scale: 0.02, dx: 8, dy: 8 };
	for (let round = 0; round < 400; round++) {
		let improved = false;
		for (const key of ['turn', 'scale', 'dx', 'dy'] as const)
			for (const sign of [1, -1]) {
				const trial = { ...best, [key]: best[key] + sign * steps[key] };
				const value = score(trial);
				if (value > bestScore) {
					best = trial;
					bestScore = value;
					improved = true;
				}
			}
		if (!improved) {
			steps.turn /= 2;
			steps.scale /= 2;
			steps.dx /= 2;
			steps.dy /= 2;
			if (steps.dx < 0.25) break;
		}
	}
	return { nudge: best, overlap: bestScore };
}

/** Divides out the picture's low-frequency shading inside the leaf, then restores its mean. */
function delight(p: Picture, radius: number, strength: number): void {
	const y = luminance(p);
	const weight: Plane = { width: p.width, height: p.height, data: Float32Array.from(p.a) };
	const low = blurWeighted(y, weight, radius, false);
	const before = coveredMean(y, p.a);
	for (let i = 0; i < y.data.length; i++) {
		const l = low.data[i] as number;
		let gain = l > 1e-6 ? before / l : 1;
		gain = gain < 0.5 ? 0.5 : gain > 2 ? 2 : gain;
		gain = 1 + strength * (gain - 1);
		p.r[i] = (p.r[i] as number) * gain;
		p.g[i] = (p.g[i] as number) * gain;
		p.b[i] = (p.b[i] as number) * gain;
	}
	const after = coveredMean(luminance(p), p.a);
	const restore = after > 0 ? before / after : 1;
	for (let i = 0; i < p.r.length; i++) {
		p.r[i] = unit((p.r[i] as number) * restore);
		p.g[i] = unit((p.g[i] as number) * restore);
		p.b[i] = unit((p.b[i] as number) * restore);
	}
}

/** The mean of values over the texels at or above the cutoff. */
function coveredMean(values: Plane, coverage: Float32Array): number {
	let sum = 0;
	let n = 0;
	for (let i = 0; i < values.data.length; i++)
		if ((coverage[i] as number) >= CUTOFF) {
			sum += values.data[i] as number;
			n++;
		}
	return n > 0 ? sum / n : 0;
}

/** The linear mean colour of the covered texels. */
function meanColour(p: Picture): [number, number, number] {
	let r = 0;
	let g = 0;
	let b = 0;
	let n = 0;
	for (let i = 0; i < p.a.length; i++)
		if ((p.a[i] as number) >= CUTOFF) {
			r += p.r[i] as number;
			g += p.g[i] as number;
			b += p.b[i] as number;
			n++;
		}
	return [r / n, g / n, b / n];
}

/** Mean luminance of covered texels in eight bands between two canvas rows, the first row first. */
function profile(p: Picture, from: number, to: number): number[] {
	const y = luminance(p);
	return Array.from({ length: 8 }, (_, band) => {
		const a = from + ((to - from) * band) / 8;
		const b = from + ((to - from) * (band + 1)) / 8;
		const top = Math.max(0, Math.floor(Math.min(a, b)));
		const bottom = Math.min(p.height, Math.ceil(Math.max(a, b)));
		let sum = 0;
		let n = 0;
		for (let row = top; row < bottom; row++)
			for (let x = 0; x < p.width; x++) {
				const i = row * p.width + x;
				if ((p.a[i] as number) >= CUTOFF) {
					sum += y.data[i] as number;
					n++;
				}
			}
		return n > 0 ? sum / n : 0;
	});
}

/**
 * The canvas row where the blade starts: the first row up from the stalk's end whose covered width
 * passes three times the stalk's and a twelfth of the canvas.
 */
function bladeBase(p: Picture, petioleRow: number, tipRow: number): number {
	const width = (row: number) => {
		let n = 0;
		for (let x = 0; x < p.width; x++) if ((p.a[row * p.width + x] as number) >= CUTOFF) n++;
		return n;
	};
	const start = Math.min(p.height - 1, Math.floor(petioleRow));
	const stalkRows = Math.max(2, Math.round(p.height * 0.01));
	const stalk: number[] = [];
	for (let row = start; row > start - stalkRows && row >= 0; row--) stalk.push(width(row));
	stalk.sort((a, b) => a - b);
	const stalkWidth = Math.max(1, stalk[stalk.length >> 1] as number);
	const threshold = Math.max(3 * stalkWidth, p.width / 12);
	for (let row = start; row > tipRow; row--) if (width(row) > threshold) return row + 1;
	return start;
}

/** The leaf textures of both sets, and what the manifest records of them. */
export interface LeafTextures {
	/** RGBA8 layers, upper then lower, and the relief map, per set. */
	readonly full: {
		readonly colour: readonly Uint8Array[];
		readonly normal: Uint8Array;
		readonly size: number;
	};
	readonly half: {
		readonly colour: readonly Uint8Array[];
		readonly normal: Uint8Array;
		readonly size: number;
	};
	readonly manifest: {
		readonly size: number;
		readonly layers: readonly ('upper' | 'lower')[];
		readonly length: number;
		readonly frame: { readonly petiole: Vec; readonly base: Vec; readonly tip: Vec };
		readonly outline: readonly number[];
		readonly mean: {
			readonly upper: readonly [number, number, number];
			readonly lower: readonly [number, number, number];
		};
		readonly veins: { readonly luminance: number; readonly contrast: number };
		readonly profile: { readonly upper: readonly number[]; readonly lower: readonly number[] };
		readonly coverage: number;
	};
	/** Figures for the tool's report. */
	readonly report: {
		readonly lowerOverlap: number;
		/** True when the lower face's picture was turned left for right to fit. */
		readonly lowerMirrored: boolean;
		readonly lowerNudge: Nudge;
		/** Share of texels at or above the cutoff, at each mip level of a box filter down to 16². */
		readonly coverageByLevel: readonly number[];
	};
}

/** The relief height of the blade, without units: sunken veins and the puckering between them. */
function reliefHeight(p: Picture, veins: number, pucker: number): Plane {
	const y = luminance(p);
	const mean = coveredMean(y, p.a);
	for (let i = 0; i < y.data.length; i++) y.data[i] = (y.data[i] as number) / mean;
	// Each scale averages only the leaf's own texels, so the colour bled past the edge adds no relief,
	// and the relief fades to flat over the edge's last texels.
	const coverage: Plane = { width: p.width, height: p.height, data: p.a };
	const scale = p.width / LEAF_SIZE;
	const fine = blurWeighted(y, coverage, 1 * scale, false);
	const vein = blurWeighted(y, coverage, 4 * scale, false);
	const small = blurWeighted(y, coverage, 8 * scale, false);
	const broad = blurWeighted(y, coverage, 32 * scale, false);
	const fade = blur(coverage, 2 * scale, false);
	const out = plane(p.width, p.height);
	for (let i = 0; i < out.data.length; i++)
		out.data[i] =
			unit(fade.data[i] as number) *
			(-veins * ((fine.data[i] as number) - (vein.data[i] as number)) +
				pucker * ((small.data[i] as number) - (broad.data[i] as number)));
	return out;
}

/** Share of texels at or above the cutoff. */
function coverageShare(a: Float32Array): number {
	let n = 0;
	for (const v of a) if (v >= CUTOFF) n++;
	return n / a.length;
}

/** Rounds a figure for the manifest. */
export function round(value: number, places = 5): number {
	let f = 1;
	for (let i = 0; i < places; i++) f *= 10;
	return Math.round(value * f) / f;
}

/** A face's leaf as the texture holds it, and where it came from. */
export interface FramedLeaf {
	/** The face cleaned: coverage floored and stretched, colour bled out from the solid texels. */
	readonly clean: Picture;
	/** The stalk's end and the tip in the source's texels. */
	readonly frame: Frame;
	readonly at: Placement;
	/** The cleaned face drawn on the square canvas, the midrib upright, the stalk at the bottom. */
	readonly face: Picture;
}

/**
 * The frame a face is drawn by: the one its config names, turned left for right with a mirrored
 * face, or the one found by the moments of its coverage.
 */
export function leafFrame(p: Picture, configured?: LeafFrame, mirrored = false): Frame {
	if (!configured) return findFrame(p);
	const across = (point: Vec): Vec =>
		mirrored ? [p.width - 1 - point[0], point[1]] : [point[0], point[1]];
	return { petiole: across(configured.petiole), tip: across(configured.tip) };
}

/**
 * Cleans a face's picture and draws its leaf on a square canvas of `size` texels, placed as on the
 * full canvas, so a smaller canvas holds the same leaf at a lower resolution.
 */
export function framedLeaf(source: Picture, config: LeafConfig, size: number): FramedLeaf {
	const clean = cleanFace(source, config);
	const frame = leafFrame(clean, config.frame);
	const at = place(clean, frame, LEAF_SIZE, config.margin);
	return { clean, frame, at, face: render(clean, at, STILL, size) };
}

/**
 * The outline of the leaf on a square canvas of coverage: its largest loop at the cutoff, thinned to
 * 24 to 64 points, in texture coordinates with v up, counter-clockwise.
 */
export function leafOutline(coverage: Float32Array, size: number): Point[] {
	const loops = traceLoops({ width: size, height: size, data: coverage }, CUTOFF);
	const largest = loops.reduce<Point[]>(
		(best, loop) => (Math.abs(signedArea(loop)) > Math.abs(signedArea(best)) ? loop : best),
		[],
	);
	const outline = simplifyTo(largest, 24, 64).map(([x, y]) => [x / size, 1 - y / size] as Point);
	if (signedArea(outline) < 0) outline.reverse();
	return outline;
}

/** Makes the leaf textures from the upper and lower faces' source pictures. */
export function leafTextures(
	upperSource: Picture,
	lowerSource: Picture,
	config: LeafConfig,
): LeafTextures {
	const size = LEAF_SIZE;
	const {
		clean: upperClean,
		frame: upperFrame,
		at: upperAt,
		face: upper,
	} = framedLeaf(upperSource, config, size);
	const target = render(upperClean, upperAt, STILL, FIT_SIZE, 1, true).a;
	// A picture of the leaf turned over shows its outline mirrored; a generated underside may keep
	// the upper face's outline as drawn. The lower face takes whichever fits the upper's outline.
	const lowerClean = cleanFace(lowerSource, config);
	const fits = [false, true]
		.filter((mirrored) => config.mirrorLower === undefined || config.mirrorLower === mirrored)
		.map((mirrored) => {
			const face = mirrored ? mirror(lowerClean) : lowerClean;
			const at = place(face, leafFrame(face, config.lowerFrame, mirrored), size, config.margin);
			return { face, at, mirrored, ...fitLower(face, at, target) };
		});
	const fit = fits.reduce((best, next) => (next.overlap > best.overlap ? next : best));
	const lower = render(fit.face, fit.at, fit.nudge, size);

	const radius = config.delight.radius * size;
	delight(upper, radius, config.delight.strength);
	delight(lower, radius, config.delight.strength);

	// The frame in canvas texels: the petiole and the tip of the upper face sit on the middle column.
	const petiole = toCanvas(upperAt, size, upperFrame.petiole);
	const tip = toCanvas(upperAt, size, upperFrame.tip);
	const baseRow = bladeBase(upper, petiole[1], tip[1]);
	const uv = (x: number, y: number): Vec => [round(x / size), round(1 - y / size)];

	// The mesh's outline holds both faces: a generated underside's lobes may reach a little past the
	// upper face's, and a back face cut by the upper outline alone shows straight edges there.
	const both = new Float32Array(upper.a.length);
	for (let i = 0; i < both.length; i++)
		both[i] = Math.max(upper.a[i] as number, lower.a[i] as number);
	const outline = leafOutline(both, size);

	const lum = luminance(upper);
	const blade: number[] = [];
	for (let i = 0; i < lum.data.length; i++)
		if ((upper.a[i] as number) >= CUTOFF) blade.push(lum.data[i] as number);
	const median = percentile(blade, 0.5);
	const light = percentile(blade, 0.98);

	const height = reliefHeight(upper, config.relief.veins, config.relief.pucker);
	const upperHalf = halve(upper);
	const lowerHalf = halve(lower);
	const heightHalf = halvePlane(height);

	const coverageByLevel: number[] = [];
	let level: Plane = { width: size, height: size, data: upper.a };
	while (level.width >= 16) {
		coverageByLevel.push(round(coverageShare(level.data), 4));
		level = halvePlane(level);
	}

	const mean = (c: readonly number[]) =>
		c.map((v) => round(v)) as unknown as readonly [number, number, number];
	return {
		full: {
			colour: [srgbBytes(upper, true), srgbBytes(lower, true)],
			normal: normalBytes(height, size * config.relief.depth, size * config.relief.depth, false),
			size,
		},
		half: {
			colour: [srgbBytes(upperHalf, true), srgbBytes(lowerHalf, true)],
			normal: normalBytes(
				heightHalf,
				(size / 2) * config.relief.depth,
				(size / 2) * config.relief.depth,
				false,
			),
			size: size / 2,
		},
		manifest: {
			size,
			layers: ['upper', 'lower'],
			length: round((tip[1] > baseRow ? 0 : baseRow - tip[1]) / size),
			frame: {
				petiole: uv(petiole[0], petiole[1]),
				base: uv(size / 2, baseRow),
				tip: uv(tip[0], tip[1]),
			},
			outline: outline.flatMap(([x, y]) => [round(x, 4), round(y, 4)]),
			mean: { upper: mean(meanColour(upper)), lower: mean(meanColour(lower)) },
			veins: { luminance: round(median), contrast: round(1 / Math.max(1e-4, light - median), 3) },
			profile: {
				upper: profile(upper, baseRow, tip[1]).map((v) => round(v)),
				lower: profile(lower, baseRow, tip[1]).map((v) => round(v)),
			},
			coverage: round(coverageShare(upper.a), 4),
		},
		report: {
			lowerOverlap: round(fit.overlap, 4),
			lowerMirrored: fit.mirrored,
			lowerNudge: fit.nudge,
			coverageByLevel,
		},
	};
}
