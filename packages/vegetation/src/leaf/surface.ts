// A leaf's shape in space: the map from a point of the flat leaf, in metres across the midrib and
// along it from the stalk's end, to leaf space. The midline droops along the stalk, then curls
// along the blade; across it, each half folds at the midrib and rolls toward its margin; the blade
// twists about the midrib and its margin waves. Normals come from the bent surface's slopes.
//
// Leaf space: the stalk's end at the origin, the midrib up +Y, the upper face toward +Z.
import { cos, radians, sin } from '../core/math';
import type { LeafShape } from '../core/record';
import type { LeafOutline } from './outline';

/**
 * The bent surface of one leaf, for its outline and its blade's length.
 *
 * @category api/vegetation
 */
export class LeafSurface {
	/** Metres per unit of texture coordinate. */
	readonly scale: number;
	/** Metres of stalk before the texture's drawn stalk starts. */
	readonly extra: number;
	/** Metres from the attach point to the blade's base along the midrib. */
	readonly stalk: number;
	/** Metres of blade from its base to its tip. */
	readonly blade: number;
	/** The blade's widest half, in metres. */
	readonly halfWidth: number;
	private readonly droop: number;
	private readonly curl: number;
	private readonly fold: number;
	private readonly roll: number;
	private readonly twist: number;
	private readonly wave: number;
	private readonly waves: number;
	/** The midline's point where the blade starts. */
	private readonly bladeStart: readonly [y: number, z: number];

	/**
	 * @param shape The record's leaf.
	 * @param outline The leaf's outline in texture coordinates.
	 * @param length The blade's length in metres, base to tip.
	 */
	constructor(shape: LeafShape, outline: LeafOutline, length: number) {
		this.scale = length / (outline.tip[1] - outline.base[1]);
		const drawn = (outline.base[1] - outline.petiole[1]) * this.scale;
		this.extra = Math.max(0, shape.petiole.length - drawn);
		this.stalk = this.extra + drawn;
		this.blade = length;
		let widest = 0;
		for (let i = 0; i < outline.points.length; i += 2)
			widest = Math.max(widest, Math.abs((outline.points[i] as number) - 0.5));
		this.halfWidth = Math.max(widest * this.scale, 1e-6);
		this.droop = radians(shape.petiole.droop);
		this.curl = radians(shape.curl);
		this.fold = radians(shape.fold);
		this.roll = radians(shape.crossCurl);
		this.twist = radians(shape.twist);
		this.wave = shape.wave[0];
		this.waves = shape.wave[1];
		this.bladeStart = arc(0, this.droop, this.stalk, this.stalk);
	}

	/** The midline's point and angle at a distance t from the attach point. */
	private midline(t: number): [y: number, z: number, angle: number] {
		// Below the attach point, where the outline's margin reaches, the midline runs straight on.
		if (t <= 0) return [t, 0, 0];
		if (t <= this.stalk) {
			const [y, z] = arc(0, this.droop, t, this.stalk);
			return [y, z, (this.droop * t) / this.stalk];
		}
		const s = t - this.stalk;
		const [y, z] = arc(this.droop, this.curl, s, this.blade);
		return [
			this.bladeStart[0] + y,
			this.bladeStart[1] + z,
			this.droop + (this.curl * s) / this.blade,
		];
	}

	/**
	 * A flat point's place in leaf space.
	 *
	 * @param x Metres across the midrib, positive to the right.
	 * @param t Metres along the midrib from the attach point.
	 * @param out The point to write.
	 */
	place(x: number, t: number, out: number[]): void {
		const [my, mz, angle] = this.midline(t);
		const along = Math.min(1, Math.max(0, (t - this.stalk) / this.blade));
		const s = Math.abs(x);
		const sign = x < 0 ? -1 : 1;
		// The half section: a fold at the midrib, then a roll that grows toward the margin.
		const k = this.roll / this.halfWidth;
		let cx: number;
		let cz: number;
		if (Math.abs(k * s) < 1e-7) {
			cx = s * cos(this.fold);
			cz = s * sin(this.fold);
		} else {
			cx = (sin(this.fold + k * s) - sin(this.fold)) / k;
			cz = (cos(this.fold) - cos(this.fold + k * s)) / k;
		}
		cx *= sign;
		if (this.wave !== 0 && this.waves > 0) {
			const reach = s / this.halfWidth;
			cz +=
				this.wave *
				reach *
				reach *
				sin(2 * Math.PI * this.waves * along + (sign < 0 ? Math.PI / 2 : 0));
		}
		const turn = this.twist * along;
		const rx = cx * cos(turn) - cz * sin(turn);
		const rz = cx * sin(turn) + cz * cos(turn);
		// The section's normal axis turns with the midline: (0, sin a, cos a).
		out[0] = rx;
		out[1] = my + rz * sin(angle);
		out[2] = mz + rz * cos(angle);
	}

	/**
	 * The surface's unit normal at a flat point, from its slopes. A side other than 0 takes the slope
	 * across the midrib from that side only, so a folded leaf keeps its crease.
	 *
	 * @param x Metres across the midrib.
	 * @param t Metres along the midrib.
	 * @param side -1 or 1 for one side's slope, 0 for both.
	 * @param out The normal to write.
	 */
	normal(x: number, t: number, side: number, out: number[]): void {
		const h = this.blade * 1e-4;
		const a = [0, 0, 0];
		const b = [0, 0, 0];
		const x0 = side < 0 ? x - h : side > 0 ? x : x - h / 2;
		this.place(x0 + h, t, a);
		this.place(x0, t, b);
		const ax = (a[0] as number) - (b[0] as number);
		const ay = (a[1] as number) - (b[1] as number);
		const az = (a[2] as number) - (b[2] as number);
		this.place(x, t + h / 2, a);
		this.place(x, t - h / 2, b);
		const tx = (a[0] as number) - (b[0] as number);
		const ty = (a[1] as number) - (b[1] as number);
		const tz = (a[2] as number) - (b[2] as number);
		const nx = ay * tz - az * ty;
		const ny = az * tx - ax * tz;
		const nz = ax * ty - ay * tx;
		const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
		out[0] = nx / length;
		out[1] = ny / length;
		out[2] = nz / length;
	}

	/**
	 * The midline's unit tangent at a distance t.
	 *
	 * @param t Metres along the midrib.
	 * @param out The tangent to write.
	 */
	tangent(t: number, out: number[]): void {
		const angle = this.midline(t)[2];
		out[0] = 0;
		out[1] = cos(angle);
		out[2] = -sin(angle);
	}
}

/**
 * The end of a midline arc of length `s` that starts at angle `a0` and turns by `turn` over `total`,
 * from +Y toward -Z: y is the integral of the cosine, z of minus the sine.
 */
function arc(a0: number, turn: number, s: number, total: number): [number, number] {
	const k = total > 0 ? turn / total : 0;
	if (Math.abs(k * s) < 1e-7) return [s * cos(a0), -s * sin(a0)];
	return [(sin(a0 + k * s) - sin(a0)) / k, -(cos(a0) - cos(a0 + k * s)) / k];
}
