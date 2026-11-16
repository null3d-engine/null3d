// The crown's light after the shoots attach (methods §6.2): the leaf area density grid from the
// shoot rows, then at each cell the share of the sky it sees through the leaves, exp(−κ∫LAD ds)
// over sixteen directions of the upper hemisphere weighted by their cosine, and the bent normal,
// the mean of those directions weighted by what each lets through. Each shoot row takes both at its
// leaves' centre; the wood's vertices read the grid. It is sky light only: the sun's light comes
// from the shadow maps.
import type { ShootRows } from '../asset';
import { cos, exp, PI, sin, type Vector3 } from '../core/math';
import type { CrownLight, DressInput } from '../stages';
import { leafDensity, rowCentre } from './density';

/**
 * The extinction per unit of leaf area along a ray. Three tenths, measured against two species: a
 * crown's own sky share sets each far card's shade, and at this figure a passing crown's colours
 * move toward its photographs while its sky gaps and outlines improve with them. At the half used
 * before, every crown drew darker than its photograph could explain — the English elm read eleven to
 * thirteen colour steps at the far views against a band of three, and even with no crown shade at
 * all it stayed five to six steps off, so the term explains most but not all of that darkness.
 *
 * A species that names `skyToLeaf` takes its own value here instead, so one value is the crown's
 * extinction and the share of the sky added to its leaf and card faces in the shader; absent, this
 * default stands and the faces draw as before.
 */
const EXTINCTION = 0.3;
/** Directions over the upper hemisphere. */
const DIRECTIONS = 16;

/**
 * The sky directions and their weights: four rings of four, each ring turned half a step from the
 * one below, even in solid angle and weighted by their height above the horizon, so an open sky's
 * mean direction is straight up.
 */
const SKY: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }[] =
	(() => {
		const rings = 4;
		const around = DIRECTIONS / rings;
		const out: { x: number; y: number; z: number; w: number }[] = [];
		for (let ring = 0; ring < rings; ring++) {
			const y = 1 - (ring + 0.5) / rings;
			const r = Math.sqrt(1 - y * y);
			for (let k = 0; k < around; k++) {
				const a = ((k + (ring % 2) * 0.5) * 2 * PI) / around;
				out.push({ x: r * cos(a), y, z: r * sin(a), w: y });
			}
		}
		const total = out.reduce((sum, d) => sum + d.w, 0);
		for (const d of out) d.w /= total;
		return out;
	})();

/**
 * Packs a unit vector as an octahedral byte with Y up: the high four bits hold x, the low four z,
 * each from -1 to 1 rounded over 0 to 15 (so a nibble n reads back as n / 7.5 - 1), and the lower
 * half folds over the upper.
 *
 * @param x The vector's x.
 * @param y The vector's y.
 * @param z The vector's z.
 * @returns The byte.
 */
export function packBent(x: number, y: number, z: number): number {
	const sum = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
	// A rounding's worth off the axis stays on it, so straight up is always the middle byte.
	let u = Math.abs(x / sum) < 1e-6 ? 0 : x / sum;
	let v = Math.abs(z / sum) < 1e-6 ? 0 : z / sum;
	if (y < 0) {
		const fu = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1);
		const fv = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1);
		u = fu;
		v = fv;
	}
	const hi = Math.min(15, Math.max(0, Math.round((u * 0.5 + 0.5) * 15)));
	const lo = Math.min(15, Math.max(0, Math.round((v * 0.5 + 0.5) * 15)));
	return (hi << 4) | lo;
}

/**
 * A grid value at a point, trilinear between cell centres and held at the edges.
 *
 * @param crown The crown's grid.
 * @param values Values per cell, x fastest, then y, then z, `stride` numbers a cell.
 * @param stride Numbers per cell.
 * @param channel Which of them.
 * @param x The point.
 * @param y The point.
 * @param z The point.
 * @returns The value.
 */
function sample(
	crown: CrownLight,
	values: Float32Array,
	stride: number,
	channel: number,
	x: number,
	y: number,
	z: number,
): number {
	const [nx, ny, nz] = crown.cells;
	const clamp = (f: number, n: number) => Math.min(Math.max(f, 0), n - 1);
	const fx = clamp((x - crown.min[0]) / crown.cell - 0.5, nx);
	const fy = clamp((y - crown.min[1]) / crown.cell - 0.5, ny);
	const fz = clamp((z - crown.min[2]) / crown.cell - 0.5, nz);
	const i0 = Math.floor(fx);
	const j0 = Math.floor(fy);
	const l0 = Math.floor(fz);
	const i1 = Math.min(i0 + 1, nx - 1);
	const j1 = Math.min(j0 + 1, ny - 1);
	const l1 = Math.min(l0 + 1, nz - 1);
	const wx = fx - i0;
	const wy = fy - j0;
	const wz = fz - l0;
	const at = (i: number, j: number, l: number) =>
		values[((l * ny + j) * nx + i) * stride + channel] as number;
	const a = at(i0, j0, l0) * (1 - wx) + at(i1, j0, l0) * wx;
	const b = at(i0, j1, l0) * (1 - wx) + at(i1, j1, l0) * wx;
	const c = at(i0, j0, l1) * (1 - wx) + at(i1, j0, l1) * wx;
	const d = at(i0, j1, l1) * (1 - wx) + at(i1, j1, l1) * wx;
	return (a * (1 - wy) + b * wy) * (1 - wz) + (c * (1 - wy) + d * wy) * wz;
}

/**
 * The sky a point of the plant sees through its crown, 0 to 1: what the wood's vertices read.
 *
 * @param crown The crown's light.
 * @param x The point in plant space.
 * @param y The point's height.
 * @param z The point in plant space.
 * @returns The share of the sky.
 */
export function crownSkyAt(crown: CrownLight, x: number, y: number, z: number): number {
	return sample(crown, crown.sky, 1, 0, x, y, z);
}

/**
 * Lights a variant's crown: writes each shoot row's sky visibility and bent normal in place, and
 * returns the grid that the wood's vertices read.
 *
 * @param input The grown skeleton, the kit, the record, the seed and the variant.
 * @param rows The shoot rows, whose `sky` and `bent` it writes.
 * @returns The crown's light.
 */
export function lightCrown(input: DressInput, rows: ShootRows): CrownLight {
	const lad = leafDensity(input, rows);
	const extinction = input.record.skyToLeaf ?? EXTINCTION;
	const [nx, ny, nz] = lad.cells;
	const { cell, density } = lad;
	const count = nx * ny * nz;
	const sky = new Float32Array(count);
	const bent = new Float32Array(count * 3);
	// Each direction's march, one cell a step; every direction rises, so a ray ends above the
	// highest layer that holds leaves.
	const steps = Math.ceil(Math.sqrt(nx * nx + ny * ny + nz * nz));
	let highest = -1;
	for (let k = 0; k < count; k++)
		if ((density[k] as number) > 0) highest = Math.max(highest, Math.floor(k / nx) % ny);
	for (let l = 0; l < nz; l++)
		for (let j = 0; j < ny; j++)
			for (let i = 0; i < nx; i++) {
				let seen = 0;
				let bx = 0;
				let by = 0;
				let bz = 0;
				for (const d of SKY) {
					let depth = 0;
					// Start a cell out: a shoot shades itself inside its prototype, not here.
					let x = i + 0.5 + d.x;
					let y = j + 0.5 + d.y;
					let z = l + 0.5 + d.z;
					for (let s = 0; s < steps; s++) {
						const ci = Math.floor(x);
						const cj = Math.floor(y);
						const cl = Math.floor(z);
						if (ci < 0 || cj > highest || cl < 0 || ci >= nx || cl >= nz) break;
						depth += density[(cl * ny + cj) * nx + ci] as number;
						x += d.x;
						y += d.y;
						z += d.z;
					}
					const through = exp(-extinction * depth * cell) * d.w;
					seen += through;
					bx += d.x * through;
					by += d.y * through;
					bz += d.z * through;
				}
				const k = (l * ny + j) * nx + i;
				sky[k] = seen;
				const length = Math.sqrt(bx * bx + by * by + bz * bz);
				bent[k * 3] = length > 1e-9 ? bx / length : 0;
				bent[k * 3 + 1] = length > 1e-9 ? by / length : 1;
				bent[k * 3 + 2] = length > 1e-9 ? bz / length : 0;
			}
	const crown: CrownLight = { cells: [nx, ny, nz], min: lad.min, cell, sky };
	const centre: Vector3 = [0, 0, 0];
	const prototypes = input.kit.prototypes;
	for (let r = 0; r < rows.count; r++) {
		const prototype = prototypes[rows.prototype[r] as number];
		rowCentre(rows, r, prototype?.length ?? 0, centre);
		const [x, y, z] = centre;
		rows.sky[r] = Math.round(250 * Math.min(1, Math.max(0, crownSkyAt(crown, x, y, z))));
		rows.bent[r] = packBent(
			sample(crown, bent, 3, 0, x, y, z),
			sample(crown, bent, 3, 1, x, y, z),
			sample(crown, bent, 3, 2, x, y, z),
		);
	}
	return crown;
}
