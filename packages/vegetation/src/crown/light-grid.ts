// The shadow grid that self-organizing growth reads (Palubicki et al. 2009, shadow propagation).
// Each live bud casts a pyramid of shadow into the cells below it: a share a·b^−q of light in the
// cells q layers down and up to q cells aside. A bud's light is what its cell keeps after the
// shadows of the others, and a shoot leans toward the brightest cells around it. Cells outside the
// envelope hold no light at all, so the envelope is the silhouette the crown fills. The grid is
// updated as buds come and go, never rebuilt.
import { pow } from '../core/math';

/** One offset of the perception neighbourhood, with its unit direction and its weight. */
interface Probe {
	readonly dx: number;
	readonly dy: number;
	readonly dz: number;
	readonly ux: number;
	readonly uy: number;
	readonly uz: number;
	readonly weight: number;
}

/** How strongly a difference of light around a bud turns it: a contrast of a third pulls fully. */
const CONTRAST = 3;

/** Cells a bud looks across for light, along each axis. */
const PERCEPTION = 3;

/** Every offset within the perception radius, weighted by the inverse of its distance. */
const PROBES: readonly Probe[] = (() => {
	const probes: Probe[] = [];
	for (let dy = -PERCEPTION; dy <= PERCEPTION; dy++)
		for (let dz = -PERCEPTION; dz <= PERCEPTION; dz++)
			for (let dx = -PERCEPTION; dx <= PERCEPTION; dx++) {
				const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
				if (d === 0 || d > PERCEPTION + 0.01) continue;
				probes.push({ dx, dy, dz, ux: dx / d, uy: dy / d, uz: dz / d, weight: 1 / d });
			}
	return probes;
})();

/**
 * A grid of shadow over a plant's space, in metres, x fastest.
 */
export class ShadowGrid {
	/** Cells along x, y and z. */
	readonly nx: number;
	readonly ny: number;
	readonly nz: number;
	/** The grid's lowest corner in plant space. */
	readonly min: readonly [number, number, number];
	/** A cell's edge in metres. */
	readonly cell: number;
	/** Shadow per cell. */
	readonly shadow: Float32Array;
	/** 1 where a cell lies inside the envelope and can hold light. */
	readonly open: Uint8Array;
	/** The shadow a bud casts q layers down, by q. */
	private readonly falloff: Float64Array;
	/** The shadow a bud casts in its own cell, which its own light does not count. */
	private readonly own: number;
	/** Each probe's light during one `toward`, -1 where it is not read. */
	private readonly probeLight = new Float64Array(PROBES.length);

	/**
	 * A grid with no shadow, every cell closed until `openWhere` opens it.
	 *
	 * @param min The lowest corner in plant space.
	 * @param cells Cells along x, y and z.
	 * @param cell A cell's edge in metres.
	 * @param shadow The pyramid: depth in cells, and a and b in a·b^−q.
	 */
	constructor(
		min: readonly [number, number, number],
		cells: readonly [number, number, number],
		cell: number,
		shadow: readonly [depth: number, a: number, b: number],
	) {
		this.min = min;
		[this.nx, this.ny, this.nz] = cells;
		this.cell = cell;
		const count = this.nx * this.ny * this.nz;
		this.shadow = new Float32Array(count);
		this.open = new Uint8Array(count);
		const [depth, a, b] = shadow;
		const layers = Math.max(0, Math.round(depth));
		this.falloff = new Float64Array(layers + 1);
		for (let q = 0; q <= layers; q++) this.falloff[q] = a * pow(b, -q);
		this.own = a;
	}

	/**
	 * Opens every cell whose centre a test passes, such as the cells inside the envelope.
	 *
	 * @param inside The test, given a cell centre in plant space.
	 */
	openWhere(inside: (x: number, y: number, z: number) => boolean): void {
		const [x0, y0, z0] = this.min;
		const c = this.cell;
		let k = 0;
		for (let j = 0; j < this.ny; j++)
			for (let l = 0; l < this.nz; l++)
				for (let i = 0; i < this.nx; i++, k++)
					this.open[k] = inside(x0 + (i + 0.5) * c, y0 + (j + 0.5) * c, z0 + (l + 0.5) * c) ? 1 : 0;
	}

	/** The cell coordinate along one axis of a position, which may fall outside the grid. */
	private coord(value: number, min: number): number {
		return Math.floor((value - min) / this.cell);
	}

	/**
	 * Adds a bud's pyramid of shadow, or takes it away.
	 *
	 * @param x The bud's position.
	 * @param y The bud's height.
	 * @param z The bud's position.
	 * @param sign 1 to cast the shadow, -1 to lift it.
	 */
	cast(x: number, y: number, z: number, sign: 1 | -1): void {
		const i = this.coord(x, this.min[0]);
		const j = this.coord(y, this.min[1]);
		const l = this.coord(z, this.min[2]);
		const { nx, ny, nz, shadow, falloff } = this;
		for (let q = 0; q < falloff.length; q++) {
			const jj = j - q;
			if (jj < 0) break;
			if (jj >= ny) continue;
			const amount = sign * (falloff[q] as number);
			const i0 = Math.max(0, i - q);
			const i1 = Math.min(nx - 1, i + q);
			const l0 = Math.max(0, l - q);
			const l1 = Math.min(nz - 1, l + q);
			for (let ll = l0; ll <= l1; ll++) {
				const row = (jj * nz + ll) * nx;
				for (let ii = i0; ii <= i1; ii++) shadow[row + ii] = (shadow[row + ii] as number) + amount;
			}
		}
	}

	/** The light a cell holds, ignoring any bud's own shadow, or -1 outside the grid or the envelope. */
	private cellLight(i: number, j: number, l: number): number {
		if (i < 0 || j < 0 || l < 0 || i >= this.nx || j >= this.ny || l >= this.nz) return -1;
		const k = (j * this.nz + l) * this.nx + i;
		if (!this.open[k]) return -1;
		return Math.max(0, 1 - (this.shadow[k] as number));
	}

	/**
	 * Whether a point's cell lies inside the envelope, where the grid holds light.
	 *
	 * @param x The point's position.
	 * @param y The point's height.
	 * @param z The point's position.
	 * @returns True inside the envelope.
	 */
	inside(x: number, y: number, z: number): boolean {
		const i = this.coord(x, this.min[0]);
		const j = this.coord(y, this.min[1]);
		const l = this.coord(z, this.min[2]);
		if (i < 0 || j < 0 || l < 0 || i >= this.nx || j >= this.ny || l >= this.nz) return false;
		return this.open[(j * this.nz + l) * this.nx + i] === 1;
	}

	/**
	 * The light at a bud, 0 to 1: full light less the shadow of the other buds in its cell.
	 *
	 * @param x The bud's position.
	 * @param y The bud's height.
	 * @param z The bud's position.
	 * @returns The light.
	 */
	light(x: number, y: number, z: number): number {
		const i = this.coord(x, this.min[0]);
		const j = this.coord(y, this.min[1]);
		const l = this.coord(z, this.min[2]);
		if (i < 0 || j < 0 || l < 0 || i >= this.nx || j >= this.ny || l >= this.nz) return 0;
		const k = (j * this.nz + l) * this.nx + i;
		if (!this.open[k]) return 0;
		return Math.min(1, Math.max(0, 1 - (this.shadow[k] as number) + this.own));
	}

	/**
	 * The pull toward the light around a bud: the mean of the directions to the open cells within
	 * the perception radius over the half space ahead of the shoot, each weighted by its nearness
	 * and by how much brighter or darker it is than their mean. It leads toward the room inside the
	 * envelope that no crown fills yet, and its length grows with the contrast, up to 1.
	 *
	 * @param x The bud's position.
	 * @param y The bud's height.
	 * @param z The bud's position.
	 * @param ahead The shoot's direction, a unit vector.
	 * @param out The vector to write: the pull, of length 0 to 1.
	 */
	toward(
		x: number,
		y: number,
		z: number,
		ahead: readonly [number, number, number],
		out: [number, number, number],
	): void {
		const i = this.coord(x, this.min[0]);
		const j = this.coord(y, this.min[1]);
		const l = this.coord(z, this.min[2]);
		// Light against the mean of the open cells around, so a bud near the outline is not pushed
		// back from it: only brighter and darker room inside the envelope steers.
		const lights = this.probeLight;
		let total = 0;
		let weights = 0;
		for (let k = 0; k < PROBES.length; k++) {
			const p = PROBES[k] as Probe;
			lights[k] = -1;
			if (p.ux * ahead[0] + p.uy * ahead[1] + p.uz * ahead[2] < 0) continue;
			const light = this.cellLight(i + p.dx, j + p.dy, l + p.dz);
			if (light < 0) continue;
			lights[k] = light;
			total += light * p.weight;
			weights += p.weight;
		}
		const mean = weights > 0 ? total / weights : 0;
		let sx = 0;
		let sy = 0;
		let sz = 0;
		for (let k = 0; k < PROBES.length; k++) {
			const light = lights[k] as number;
			if (light < 0) continue;
			const p = PROBES[k] as Probe;
			const w = (light - mean) * p.weight;
			sx += p.ux * w;
			sy += p.uy * w;
			sz += p.uz * w;
		}
		// The pull grows with the contrast of light around the bud, up to a unit vector.
		const scale = weights > 0 ? CONTRAST / weights : 0;
		sx *= scale;
		sy *= scale;
		sz *= scale;
		const length = Math.sqrt(sx * sx + sy * sy + sz * sz);
		const over = length > 1 ? 1 / length : 1;
		out[0] = sx * over;
		out[1] = sy * over;
		out[2] = sz * over;
	}
}
