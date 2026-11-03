// Peeling strips, after design §7.5: the bark of a birch, a plane or a eucalyptus lifts in strips
// wider than tall that curl away from the stem. Each strip is a small band held to the bark along its
// upper edge, curling out and down below it, with two faces. The outer face shows the bark under it,
// at the same `u` and `v`. The inner face carries a pipe radius of zero, so the plant shader draws it
// with the young bark, the pale inner layer. Strips stand only in the record's peel zone, as many per
// square metre as it asks, and only at the nearest level.
import { unitAt } from '../core/hash';
import { cos, sin } from '../core/math';
import type { BarkSpec } from '../core/record';
import { spreadAt } from '../core/types';
import type { AxisRings } from './tube';

/** Hash purpose of the strips, apart from every other stage's. */
const PEEL = 0x61;

/** Vertices across a strip and down it. */
const ACROSS = 5;
const DOWN = 3;

/** A strip stands this far off the bark, so the two never fight for depth. */
const LIFT = 0.0015;

/** A strip's thickness: its inner face stands this far behind its outer face. */
const THICKNESS = 0.0006;

/** The strips of one axis, in floats, with indices from 0. */
export interface FinMesh {
	readonly positions: number[];
	readonly normals: number[];
	/** Per vertex: `u`, `v` in metres of bark, and the pipe radius (0 on inner faces). */
	readonly u: number[];
	readonly v: number[];
	readonly pipe: number[];
	/** Per vertex: the arc length along the axis, for the bend weight. */
	readonly along: number[];
	readonly indices: number[];
}

/** What the strips read of an axis's bark: per ring, the top line's `u` and the span once round. */
export interface FinBark {
	readonly top: ArrayLike<number>;
	readonly span: ArrayLike<number>;
}

/**
 * The peeling strips of one axis, or none when the record peels no bark.
 *
 * @param rings The axis's rings.
 * @param plain How many of the rings are the axis's own, before its rounded end.
 * @param bark Each ring's bark.
 * @param spec The record's bark.
 * @param keys The seed, the species' salt, the variant and the axis, for the hash.
 * @returns The strips.
 */
export function peelFins(
	rings: AxisRings,
	plain: number,
	bark: FinBark,
	spec: BarkSpec | undefined,
	keys: readonly [seed: number, salt: number, variant: number, axis: number],
): FinMesh {
	const out: FinMesh = {
		positions: [],
		normals: [],
		u: [],
		v: [],
		pipe: [],
		along: [],
		indices: [],
	};
	const peel = spec?.peel;
	const zone = peel ? spec?.zones[peel.zone] : undefined;
	if (!peel || !zone || peel.perSquareMetre <= 0) return out;
	const [seed, salt, variant, axis] = keys;
	let strip = 0;
	for (let r = rings.welded; r + 1 < plain; r++) {
		const first = rings.first[r] as number;
		const pipe = rings.pipe[first] as number;
		const at = zone.by === 'height' ? (rings.centre[r * 3 + 1] as number) : pipe;
		if (at < zone.from || at >= zone.to) continue;
		const length = (rings.arc[r + 1] as number) - (rings.arc[r] as number);
		const mean = rings.rho[first] as number;
		const area = 2 * Math.PI * mean * length;
		const expected = area * peel.perSquareMetre;
		const count =
			Math.floor(expected) +
			(unitAt(seed, salt, variant, PEEL, axis * 4096 + r) < expected % 1 ? 1 : 0);
		for (let k = 0; k < count; k++, strip++) {
			const key = axis * 65536 + strip;
			const along = unitAt(seed, salt, variant, PEEL + 1, key);
			const theta = unitAt(seed, salt, variant, PEEL + 2, key) * 2 * Math.PI;
			const width = Math.max(
				0.005,
				spreadAt(peel.width, unitAt(seed, salt, variant, PEEL + 3, key)),
			);
			const height = width * (0.25 + 0.2 * unitAt(seed, salt, variant, PEEL + 4, key));
			addStrip(out, rings, r, along, theta, width, height, peel.curl, bark, mean);
		}
	}
	return out;
}

/** The ring frame's point at a share between two rings, an angle and a lift off the bark. */
function surfacePoint(
	rings: AxisRings,
	r: number,
	t: number,
	theta: number,
	radius: number,
	out: number[],
): void {
	const a = r * 3;
	const b = (r + 1) * 3;
	const c = cos(theta);
	const s = sin(theta);
	for (let k = 0; k < 3; k++) {
		const centre = (rings.centre[a + k] as number) * (1 - t) + (rings.centre[b + k] as number) * t;
		const n = (rings.normal[a + k] as number) * (1 - t) + (rings.normal[b + k] as number) * t;
		const bn = (rings.binormal[a + k] as number) * (1 - t) + (rings.binormal[b + k] as number) * t;
		out[k] = centre + radius * (c * n + s * bn);
	}
}

/** Adds one strip: a band held along its upper edge, curling out below it, with two faces. */
function addStrip(
	out: FinMesh,
	rings: AxisRings,
	r: number,
	along: number,
	theta: number,
	width: number,
	height: number,
	curl: number,
	bark: FinBark,
	radius: number,
): void {
	const span = (rings.arc[r + 1] as number) - (rings.arc[r] as number);
	if (span <= 0 || radius <= 0) return;
	// The strip hangs from its upper edge, so it stands below `along` in the ring step.
	const topT = Math.min(1, along + height / (2 * span));
	const arcWidth = width / radius;
	const ringSpan = bark.span[r] as number;
	const ringTop = bark.top[r] as number;
	const v0 = (rings.v[r] as number) * (1 - topT) + (rings.v[r + 1] as number) * topT;
	const pipe = rings.pipe[rings.first[r] as number] as number;
	const point = [0, 0, 0];
	// The strip's own share of the way round, unwrapped, so its u never jumps at the ring's seam.
	const share = (((theta / (2 * Math.PI)) % 1) + 1) % 1;
	const surface = [0, 0, 0];
	for (const inner of [false, true]) {
		const faceBase = out.positions.length / 3;
		for (let row = 0; row < DOWN; row++) {
			const down = row / (DOWN - 1);
			const t = Math.max(0, topT - (down * height) / span);
			// The strip lifts off the bark as it hangs, more with the record's curl.
			const lift = LIFT + curl * height * down * down;
			for (let col = 0; col < ACROSS; col++) {
				const across = col / (ACROSS - 1) - 0.5;
				const angle = theta + across * arcWidth;
				surfacePoint(rings, r, t, angle, radius, surface);
				surfacePoint(rings, r, t, angle, radius + lift - (inner ? THICKNESS : 0), point);
				// Outward from the stem, turning down as the strip curls.
				let nx =
					(surface[0] as number) -
					((rings.centre[r * 3] as number) * (1 - t) + (rings.centre[(r + 1) * 3] as number) * t);
				let ny =
					(surface[1] as number) -
					((rings.centre[r * 3 + 1] as number) * (1 - t) +
						(rings.centre[(r + 1) * 3 + 1] as number) * t);
				let nz =
					(surface[2] as number) -
					((rings.centre[r * 3 + 2] as number) * (1 - t) +
						(rings.centre[(r + 1) * 3 + 2] as number) * t);
				const bend = curl * down;
				nx -= bend * radius * (rings.tangent[r * 3] as number);
				ny -= bend * radius * (rings.tangent[r * 3 + 1] as number);
				nz -= bend * radius * (rings.tangent[r * 3 + 2] as number);
				const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
				const sign = inner ? -1 : 1;
				out.positions.push(point[0] as number, point[1] as number, point[2] as number);
				out.normals.push((sign * nx) / l, (sign * ny) / l, (sign * nz) / l);
				out.u.push(ringTop + (share + (across * arcWidth) / (2 * Math.PI) - 0.5) * ringSpan);
				out.v.push(v0 - down * height);
				out.pipe.push(inner ? 0 : pipe);
				out.along.push((rings.arc[r] as number) + t * span);
			}
		}
		for (let row = 0; row + 1 < DOWN; row++)
			for (let col = 0; col + 1 < ACROSS; col++) {
				const a = faceBase + row * ACROSS + col;
				const b = a + 1;
				const c = a + ACROSS;
				const d = c + 1;
				// The outer face winds counter-clockwise seen from outside; the inner face the other way.
				if (inner) out.indices.push(a, b, c, b, d, c);
				else out.indices.push(a, c, b, b, c, d);
			}
	}
}
