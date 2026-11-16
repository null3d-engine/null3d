// A leaf's outline in texture coordinates, and the polygon work the leaf mesh needs: the texture's
// measured contour or a parametric outline, smoothed through its points, pushed out by a few
// texels, simplified without cutting into the blade, and triangulated.
//
// Texture coordinates stand the leaf upright: u runs right and v runs up, v = 0 at the stalk end,
// and the midrib lies on u = 0.5. Outlines run counter-clockwise, as flat [u, v, u, v, ...] lists.
// Every figure uses the four operations and the core's own trigonometry, so a leaf's bytes are the
// same on every script engine.

import { PI, sin } from '../core/math';
import type { ParametricOutline } from '../core/record';
import type { TextureManifestLeaf } from '../core/textures';
import type { Vec2 } from '../core/types';
import { curveAt } from '../core/types';

/**
 * A leaf's outline and its frame, in texture coordinates.
 *
 * @category api/vegetation
 */
export interface LeafOutline {
	/** The blade's contour, counter-clockwise, u then v. */
	readonly points: readonly number[];
	/** The stalk's end where it joins the shoot. */
	readonly petiole: Vec2;
	/** Where the blade starts on the midrib. */
	readonly base: Vec2;
	/** The blade's tip on the midrib. */
	readonly tip: Vec2;
	/** Texels a side of the texture the outline was measured on. */
	readonly texels: number;
}

/** Texels a side that a parametric outline stands for, so its margin matches a texture's. */
const PARAMETRIC_TEXELS = 1024;
/** Where a parametric leaf's blade starts and ends in v. */
const PARAMETRIC_BASE = 0.04;
const PARAMETRIC_TIP = 0.96;
/** Points per side of a parametric outline. */
const PARAMETRIC_STEPS = 32;

/**
 * The outline of the leaf that a texture's manifest measured.
 *
 * @param leaf The manifest's leaf figures.
 * @returns The outline.
 * @category api/vegetation
 */
export function textureOutline(leaf: TextureManifestLeaf): LeafOutline {
	const points = [...leaf.outline];
	if (signedArea(points) < 0) reverse(points);
	return {
		points,
		petiole: leaf.frame.petiole,
		base: leaf.frame.base,
		tip: leaf.frame.tip,
		texels: leaf.size,
	};
}

/** How a parametric tip narrows the blade at a share t of its length. */
function tipFactor(tip: ParametricOutline['tip'], t: number): number {
	const left = 1 - t;
	switch (tip) {
		case 'acute':
			return Math.min(1, left / 0.22);
		case 'acuminate': {
			const r = Math.min(1, left / 0.35);
			return r * r * Math.sqrt(r);
		}
		case 'rounded':
		case 'notched': {
			if (t < 0.75) return 1;
			const d = (t - 0.75) / 0.25;
			return Math.sqrt(Math.max(0, 1 - d * d));
		}
	}
}

/** How a parametric base narrows the blade at a share t of its length. */
function baseFactor(base: ParametricOutline['base'], t: number): number {
	switch (base) {
		case 'cuneate':
			return Math.min(1, 0.04 + t / 0.3);
		case 'rounded':
		case 'oblique':
		case 'cordate': {
			if (t > 0.22) return 1;
			const d = (0.22 - t) / 0.22;
			return Math.sqrt(Math.max(0, 1 - d * d));
		}
	}
}

/**
 * A leaf outline drawn from a record's half-width curve, tip and base, in a frame like a texture's:
 * the blade from near the bottom to near the top, the midrib on u = 0.5, no drawn stalk.
 *
 * @param shape The record's outline.
 * @returns The outline.
 * @category api/vegetation
 */
export function parametricOutline(shape: ParametricOutline): LeafOutline {
	const span = PARAMETRIC_TIP - PARAMETRIC_BASE;
	const side = (sign: 1 | -1): number[] => {
		const out: number[] = [];
		for (let k = 0; k <= PARAMETRIC_STEPS; k++) {
			const t = k / PARAMETRIC_STEPS;
			// Oblique bases start one side higher than the other.
			const shifted = shape.base === 'oblique' && sign < 0 ? Math.max(0, (t - 0.08) / 0.92) : t;
			let half =
				curveAt(shape.width, t) * tipFactor(shape.tip, t) * baseFactor(shape.base, shifted);
			if (shape.base === 'oblique' && sign < 0 && t < 0.08) half = 0;
			let v = PARAMETRIC_BASE + t * span;
			// A cordate base hangs two rounded lobes below the blade's base beside the stalk.
			if (shape.base === 'cordate' && t < 0.22) v -= 0.06 * span * sin((t / 0.22) * PI);
			out.push(0.5 + sign * Math.min(0.48, half * span), v);
		}
		return out;
	};
	const right = side(1);
	const left = side(-1);
	const points: number[] = [];
	// The right side runs from base to tip, the left side from tip back to base: counter-clockwise.
	for (let i = 0; i < right.length; i += 2) {
		const u = right[i] as number;
		const v = right[i + 1] as number;
		if (i === 0 || i === right.length - 2) {
			// The midrib's ends: the base, then the tip (dipped for a notched tip).
			const end =
				i === 0 ? PARAMETRIC_BASE : PARAMETRIC_TIP - (shape.tip === 'notched' ? 0.03 * span : 0);
			if (i === 0) points.push(0.5, end);
			else {
				points.push(u, v);
				points.push(0.5, end);
			}
			if (i === 0 && u > 0.5) points.push(u, v);
			continue;
		}
		points.push(u, v);
	}
	for (let i = left.length - 4; i >= 2; i -= 2)
		points.push(left[i] as number, left[i + 1] as number);
	if ((left[0] as number) < 0.5) points.push(left[0] as number, left[1] as number);
	const cleaned = dedupe(points);
	if (signedArea(cleaned) < 0) reverse(cleaned);
	const base: Vec2 = [0.5, PARAMETRIC_BASE];
	return {
		points: cleaned,
		petiole: base,
		base,
		tip: [0.5, PARAMETRIC_TIP],
		texels: PARAMETRIC_TEXELS,
	};
}

/** Drops points that repeat their neighbour. */
function dedupe(points: number[]): number[] {
	const out: number[] = [];
	const n = points.length / 2;
	for (let i = 0; i < n; i++) {
		const u = points[i * 2] as number;
		const v = points[i * 2 + 1] as number;
		const pu = out[out.length - 2];
		const pv = out[out.length - 1];
		if (pu !== undefined && Math.abs(pu - u) < 1e-9 && Math.abs((pv as number) - v) < 1e-9)
			continue;
		out.push(u, v);
	}
	if (out.length >= 4 && Math.abs((out[0] as number) - (out[out.length - 2] as number)) < 1e-9)
		if (Math.abs((out[1] as number) - (out[out.length - 1] as number)) < 1e-9) out.length -= 2;
	return out;
}

/** Turns a flat point list around in place. */
function reverse(points: number[]): void {
	const n = points.length / 2;
	for (let i = 0; i < n / 2; i++) {
		const j = n - 1 - i;
		const u = points[i * 2] as number;
		const v = points[i * 2 + 1] as number;
		points[i * 2] = points[j * 2] as number;
		points[i * 2 + 1] = points[j * 2 + 1] as number;
		points[j * 2] = u;
		points[j * 2 + 1] = v;
	}
}

/**
 * Twice the signed area of a polygon: positive when it runs counter-clockwise.
 *
 * @param points The polygon, u then v.
 * @returns Twice its signed area.
 * @category api/vegetation
 */
export function signedArea(points: readonly number[]): number {
	const n = points.length / 2;
	let sum = 0;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		sum +=
			(points[i * 2] as number) * (points[j * 2 + 1] as number) -
			(points[j * 2] as number) * (points[i * 2 + 1] as number);
	}
	return sum;
}

/**
 * Whether a point lies inside a polygon, by the even-odd rule.
 *
 * @param points The polygon, u then v.
 * @param u The point's u.
 * @param v The point's v.
 * @returns True inside.
 * @category api/vegetation
 */
export function insidePolygon(points: readonly number[], u: number, v: number): boolean {
	const n = points.length / 2;
	let inside = false;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const ui = points[i * 2] as number;
		const vi = points[i * 2 + 1] as number;
		const uj = points[j * 2] as number;
		const vj = points[j * 2 + 1] as number;
		if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
	}
	return inside;
}

/**
 * The polygon's coverage on a square grid of texture coordinates, one byte per texel, 1 inside and
 * 0 outside by the even-odd rule at each texel's centre. Row 0 lies at v = 0.
 *
 * @param points The polygon, u then v.
 * @param size Texels a side.
 * @returns The mask.
 * @category api/vegetation
 */
export function outlineMask(points: readonly number[], size: number): Uint8Array {
	const mask = new Uint8Array(size * size);
	const n = points.length / 2;
	const crossings: number[] = [];
	for (let row = 0; row < size; row++) {
		const v = (row + 0.5) / size;
		crossings.length = 0;
		for (let i = 0, j = n - 1; i < n; j = i++) {
			const vi = points[i * 2 + 1] as number;
			const vj = points[j * 2 + 1] as number;
			if (vi > v === vj > v) continue;
			const ui = points[i * 2] as number;
			const uj = points[j * 2] as number;
			crossings.push(ui + ((v - vi) / (vj - vi)) * (uj - ui));
		}
		crossings.sort((a, b) => a - b);
		for (let k = 0; k + 1 < crossings.length; k += 2) {
			const from = Math.max(0, Math.ceil((crossings[k] as number) * size - 0.5));
			const to = Math.min(size - 1, Math.floor((crossings[k + 1] as number) * size - 0.5));
			if (to >= from) mask.fill(1, row * size + from, row * size + to + 1);
		}
	}
	return mask;
}

/**
 * A closed curve through a polygon's points, sampled `steps` times per edge: a centripetal
 * Catmull-Rom spline, which follows a rounded lobe between the contour's points and never loops at a
 * sharp sinus.
 *
 * @param points The polygon, u then v.
 * @param steps Samples per edge, 1 to keep the polygon.
 * @returns The smoothed polygon.
 * @category api/vegetation
 */
export function smoothPolygon(points: readonly number[], steps: number): number[] {
	const n = points.length / 2;
	if (steps <= 1 || n < 4) return [...points];
	const at = (i: number): [number, number] => {
		const k = ((i % n) + n) % n;
		return [points[k * 2] as number, points[k * 2 + 1] as number];
	};
	const knot = (a: readonly number[], b: readonly number[]) =>
		Math.sqrt(
			Math.sqrt(
				((b[0] as number) - (a[0] as number)) ** 2 + ((b[1] as number) - (a[1] as number)) ** 2,
			),
		) || 1e-9;
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const p0 = at(i - 1);
		const p1 = at(i);
		const p2 = at(i + 1);
		const p3 = at(i + 2);
		const t1 = knot(p0, p1);
		const t2 = t1 + knot(p1, p2);
		const t3 = t2 + knot(p2, p3);
		for (let s = 0; s < steps; s++) {
			const t = t1 + ((t2 - t1) * s) / steps;
			const point: number[] = [0, 0];
			for (let c = 0; c < 2; c++) {
				const a1 = ((t1 - t) * (p0[c] as number) + t * (p1[c] as number)) / t1;
				const a2 = ((t2 - t) * (p1[c] as number) + (t - t1) * (p2[c] as number)) / (t2 - t1);
				const a3 = ((t3 - t) * (p2[c] as number) + (t - t2) * (p3[c] as number)) / (t3 - t2);
				const b1 = ((t2 - t) * a1 + t * a2) / t2;
				const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
				point[c] = ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
			}
			out.push(point[0] as number, point[1] as number);
		}
	}
	return out;
}

/**
 * A counter-clockwise polygon pushed outward by a distance: each point moves along the mean of its
 * two edges' outward normals, by the distance over the cosine of half the turn, with the move held to
 * three times the distance at sharp points.
 *
 * @param points The polygon, counter-clockwise, u then v.
 * @param distance How far to push, in the polygon's units.
 * @returns The pushed polygon.
 * @category api/vegetation
 */
export function offsetPolygon(points: readonly number[], distance: number): number[] {
	const n = points.length / 2;
	const out: number[] = [];
	for (let i = 0; i < n; i++) {
		const a = (i + n - 1) % n;
		const c = (i + 1) % n;
		const pu = points[i * 2] as number;
		const pv = points[i * 2 + 1] as number;
		const e0 = normal(points[a * 2] as number, points[a * 2 + 1] as number, pu, pv);
		const e1 = normal(pu, pv, points[c * 2] as number, points[c * 2 + 1] as number);
		let mu = e0[0] + e1[0];
		let mv = e0[1] + e1[1];
		const m = Math.sqrt(mu * mu + mv * mv);
		if (m < 1e-9) {
			mu = e0[0];
			mv = e0[1];
		} else {
			mu /= m;
			mv /= m;
		}
		const cosHalf = mu * e0[0] + mv * e0[1];
		const reach = Math.min(3 * distance, distance / Math.max(cosHalf, 1e-6));
		out.push(pu + mu * reach, pv + mv * reach);
	}
	return out;
}

/** The outward unit normal of a counter-clockwise edge from (au, av) to (bu, bv). */
function normal(au: number, av: number, bu: number, bv: number): [number, number] {
	const du = bu - au;
	const dv = bv - av;
	const length = Math.sqrt(du * du + dv * dv) || 1;
	return [dv / length, -du / length];
}

/** Whether segments ab and cd cross, not counting shared ends. */
function segmentsCross(
	au: number,
	av: number,
	bu: number,
	bv: number,
	cu: number,
	cv: number,
	du: number,
	dv: number,
): boolean {
	const d1 = (du - cu) * (av - cv) - (dv - cv) * (au - cu);
	const d2 = (du - cu) * (bv - cv) - (dv - cv) * (bu - cu);
	const d3 = (bu - au) * (cv - av) - (bv - av) * (cu - au);
	const d4 = (bu - au) * (dv - av) - (bv - av) * (du - au);
	return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * A counter-clockwise polygon simplified to at most `limit` points, dropping one point at a time
 * where it changes the area least. Dropping a reflex point only adds area, so it keeps the blade
 * covered; dropping a convex point cuts into it and costs four times as much. A drop that would make
 * the polygon cross itself is never made.
 *
 * @param points The polygon, counter-clockwise, u then v.
 * @param limit Points to keep, at least 3.
 * @returns The simplified polygon.
 * @category api/vegetation
 */
export function simplifyCovering(points: readonly number[], limit: number): number[] {
	const u: number[] = [];
	const v: number[] = [];
	for (let i = 0; i < points.length; i += 2) {
		u.push(points[i] as number);
		v.push(points[i + 1] as number);
	}
	const keep = Math.max(3, limit);
	while (u.length > keep) {
		const n = u.length;
		let best = -1;
		let bestCost = Number.POSITIVE_INFINITY;
		for (let i = 0; i < n; i++) {
			const a = (i + n - 1) % n;
			const c = (i + 1) % n;
			const cross =
				((u[i] as number) - (u[a] as number)) * ((v[c] as number) - (v[i] as number)) -
				((v[i] as number) - (v[a] as number)) * ((u[c] as number) - (u[i] as number));
			const cost = cross > 0 ? 4 * cross : -cross;
			if (cost >= bestCost) continue;
			let crosses = false;
			for (let j = 0; j < n && !crosses; j++) {
				const k = (j + 1) % n;
				if (j === a || j === i || k === a || k === i || j === c || k === c) continue;
				crosses = segmentsCross(
					u[a] as number,
					v[a] as number,
					u[c] as number,
					v[c] as number,
					u[j] as number,
					v[j] as number,
					u[k] as number,
					v[k] as number,
				);
			}
			if (crosses) continue;
			best = i;
			bestCost = cost;
		}
		if (best < 0) break;
		u.splice(best, 1);
		v.splice(best, 1);
	}
	const out: number[] = [];
	for (let i = 0; i < u.length; i++) out.push(u[i] as number, v[i] as number);
	return out;
}

/**
 * A simple counter-clockwise polygon split by the vertical line u = `at` into simple pieces, each
 * counter-clockwise. Where a piece's border runs along the line, it gains a point at each of the
 * `stops` (v values) that lies on that stretch, so pieces that share the stretch share its points.
 *
 * @param points The polygon, u then v.
 * @param at The line's u.
 * @param stops The v values to add along the line.
 * @returns The pieces, each u then v.
 * @category api/vegetation
 */
export function splitPolygon(
	points: readonly number[],
	at: number,
	stops: readonly number[],
): number[][] {
	const n = points.length / 2;
	const u: number[] = [];
	const v: number[] = [];
	for (let i = 0; i < n; i++) {
		let pu = points[i * 2] as number;
		// A point on the line moves off it a little, so every crossing is a clean one.
		if (Math.abs(pu - at) < 1e-9) pu = at + (pu <= at ? -2e-9 : 2e-9);
		u.push(pu);
		v.push(points[i * 2 + 1] as number);
	}
	// The polygon with a point at each crossing, and the crossings in order along the line.
	const ru: number[] = [];
	const rv: number[] = [];
	const crossings: number[] = [];
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		ru.push(u[i] as number);
		rv.push(v[i] as number);
		const a = (u[i] as number) - at;
		const b = (u[j] as number) - at;
		if (a < 0 !== b < 0) {
			const f = a / (a - b);
			crossings.push(ru.length);
			ru.push(at);
			rv.push((v[i] as number) + f * ((v[j] as number) - (v[i] as number)));
		}
	}
	if (crossings.length < 2) return [[...points]];
	const order = [...crossings].sort((a, b) => (rv[a] as number) - (rv[b] as number));
	const partner = new Map<number, number>();
	for (let k = 0; k + 1 < order.length; k += 2) {
		partner.set(order[k] as number, order[k + 1] as number);
		partner.set(order[k + 1] as number, order[k] as number);
	}
	const m = ru.length;
	const visited = new Uint8Array(m);
	const pieces: number[][] = [];
	for (let start = 0; start < m; start++) {
		if (visited[start] || partner.has(start)) continue;
		const piece: number[] = [];
		let i = start;
		let guard = 0;
		do {
			visited[i] = 1;
			piece.push(ru[i] as number, rv[i] as number);
			const across = partner.get(i);
			if (across !== undefined) {
				// Run along the line to the partner crossing, through the stops between them.
				const from = rv[i] as number;
				const to = rv[across] as number;
				const rising = to > from;
				const between = stops.filter((s) => (rising ? s > from && s < to : s < from && s > to));
				between.sort((a, b) => (rising ? a - b : b - a));
				for (const s of between) piece.push(at, s);
				visited[across] = 1;
				piece.push(ru[across] as number, rv[across] as number);
				i = (across + 1) % m;
			} else i = (i + 1) % m;
			guard++;
		} while (i !== start && guard < m * 4);
		if (piece.length >= 6) pieces.push(piece);
	}
	return pieces;
}

/**
 * The triangles of a simple counter-clockwise polygon, by ear clipping: each triangle is three
 * indices into the polygon's points, counter-clockwise.
 *
 * @param points The polygon, u then v.
 * @returns The triangles' indices, three per triangle.
 * @category api/vegetation
 */
export function triangulate(points: readonly number[]): number[] {
	const n = points.length / 2;
	const left: number[] = [];
	for (let i = 0; i < n; i++) left.push(i);
	const out: number[] = [];
	const pu = (i: number) => points[i * 2] as number;
	const pv = (i: number) => points[i * 2 + 1] as number;
	const area = (a: number, b: number, c: number) =>
		(pu(b) - pu(a)) * (pv(c) - pv(a)) - (pv(b) - pv(a)) * (pu(c) - pu(a));
	const inside = (p: number, a: number, b: number, c: number) =>
		area(a, b, p) >= 0 && area(b, c, p) >= 0 && area(c, a, p) >= 0;
	let guard = 0;
	while (left.length > 3 && guard < n * n) {
		guard++;
		const m = left.length;
		// The ear whose triangle is fattest, so the clipped strips stay well shaped.
		let best = -1;
		let bestScore = -1;
		for (let k = 0; k < m; k++) {
			const a = left[(k + m - 1) % m] as number;
			const b = left[k] as number;
			const c = left[(k + 1) % m] as number;
			const twice = area(a, b, c);
			if (twice <= 1e-14) continue;
			let blocked = false;
			for (const p of left) {
				if (p === a || p === b || p === c) continue;
				if (inside(p, a, b, c)) {
					blocked = true;
					break;
				}
			}
			if (blocked) continue;
			const ab = (pu(b) - pu(a)) ** 2 + (pv(b) - pv(a)) ** 2;
			const bc = (pu(c) - pu(b)) ** 2 + (pv(c) - pv(b)) ** 2;
			const ca = (pu(a) - pu(c)) ** 2 + (pv(a) - pv(c)) ** 2;
			const score = twice / (ab + bc + ca);
			if (score > bestScore) {
				bestScore = score;
				best = k;
			}
		}
		if (best < 0) {
			// Only flat or folded ears remain: drop the flattest point.
			left.splice(0, 1);
			continue;
		}
		out.push(
			left[(best + m - 1) % m] as number,
			left[best] as number,
			left[(best + 1) % m] as number,
		);
		left.splice(best, 1);
	}
	if (left.length === 3 && area(left[0] as number, left[1] as number, left[2] as number) > 0)
		out.push(left[0] as number, left[1] as number, left[2] as number);
	return out;
}
