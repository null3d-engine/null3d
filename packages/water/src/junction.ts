// Where the meshes of two water bodies overlap, as where a river runs into a lake, each point of the
// surface belongs to one body, and the two bodies' waves meet without a seam. The junction map
// covers each such place. Its texels hold the body that draws there, the share of the river's waves
// in the surface, and how flat the surface lies. The shader reads it in both stages, and the CPU
// reads it for the surface's height.
// - A lake draws the water inside its shore, and a river the water outside every lake. Elsewhere in
//   an overlap, the body whose mesh covers the whole texel draws. Where no mesh covers it whole,
//   each mesh draws its own part.
// - The river's waves give way to still water's over a band on both sides of the meeting. The
//   surface mixes the two sets of waves rather than slowing the current, since a current that
//   changes from place to place carries the waves' phases apart a little more every second.
// - Near the meeting, both meshes carry one current, the river's there, so their waves agree on
//   every pixel. The surface also lies flat there, so the two meshes lie in one plane and agree on
//   the texel that each pixel falls in.
import { type MeshArrays, math } from '@null3d/engine';
import type { WaterBody } from './shape';

/** The meters that one texel of the map covers, unless the map would then pass its most texels. */
const TEXEL = 0.25;
/** The most texels along each side of the map. */
const MAX_TEXELS = 512;
/** The meters over which the river's waves give way to still water's, on each side of a meeting. */
const BLEND = 3;
/** The least meters from an overlap within which the surface lies flat. */
const FLAT = 3.5;
/** The meters past the flat band over which the surface rises back to its whole waves. */
const RISE = 2;
/** How far a two-pass chamfer distance may run past the true distance, as a factor. */
const CHAMFER = 1.09;
/** The most bodies that take part in junctions: one bit each in a texel's mask. */
const MAX_BODIES = 32;

/**
 * The junction map of a water's bodies, and the values that the CPU reads from it, as the shader
 * reads them.
 */
export interface Junctions {
	/** The world point that the map's first texel covers, as [x, z] in meters. */
	readonly origin: readonly [x: number, z: number];
	/** The world size that the map covers, as [x, z] in meters. */
	readonly size: readonly [x: number, z: number];
	/** The map's texels along x. */
	readonly width: number;
	/** The map's texels along z. */
	readonly height: number;
	/**
	 * Four bytes per texel, in rows along x from the least z: the body that draws there, counted
	 * from 1, or 0 where each mesh draws its part; the share of the river's waves; how flat the
	 * surface lies; and 0, which a texture still on its way to the GPU reads as 1.
	 */
	readonly data: Uint8Array;
	/** The index of the body that draws the water at a point, or -1 where the map names none. */
	ownerAt(x: number, z: number): number;
	/**
	 * The share of the river's waves at a point, from 0 for still water's to 1, and 1 outside the
	 * map. It filters the texels as the GPU does.
	 */
	shareAt(x: number, z: number): number;
	/** How flat the surface lies at a point, from 0 to 1 where it lies flat, and 0 outside the map. */
	flatnessAt(x: number, z: number): number;
	/**
	 * The current that the meshes carry at a point near a meeting, written into `out`. False where
	 * the meshes keep their own current.
	 */
	currentAt(x: number, z: number, out: [x: number, z: number]): boolean;
}

/** A box on the water's plane, in meters. */
interface Box {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
}

/** The box of a mesh's vertices on the water's plane, and the longest edge of its triangles. */
function meshExtent(mesh: MeshArrays): { box: Box; edge: number } {
	const p = mesh.positions as ArrayLike<number>;
	const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
	for (let v = 0; v < p.length; v += 3) {
		const x = p[v] as number;
		const z = p[v + 2] as number;
		if (x < box.minX) box.minX = x;
		if (x > box.maxX) box.maxX = x;
		if (z < box.minZ) box.minZ = z;
		if (z > box.maxZ) box.maxZ = z;
	}
	const indices = mesh.indices as ArrayLike<number>;
	let edge = 0;
	for (let t = 0; t < indices.length; t += 3)
		for (let k = 0; k < 3; k++) {
			const a = (indices[t + k] as number) * 3;
			const b = (indices[t + ((k + 1) % 3)] as number) * 3;
			const length = Math.hypot(
				(p[b] as number) - (p[a] as number),
				(p[b + 2] as number) - (p[a + 2] as number),
			);
			if (length > edge) edge = length;
		}
	return { box, edge };
}

/** Marks in `cover` the lattice points that one mesh's triangles cover, with the mesh's bit. */
function rasterize(
	mesh: MeshArrays,
	bit: number,
	cover: Uint32Array,
	columns: number,
	rows: number,
	ox: number,
	oz: number,
	step: number,
): void {
	const p = mesh.positions as ArrayLike<number>;
	const indices = mesh.indices as ArrayLike<number>;
	for (let t = 0; t < indices.length; t += 3) {
		const a = (indices[t] as number) * 3;
		const b = (indices[t + 1] as number) * 3;
		const c = (indices[t + 2] as number) * 3;
		const ax = p[a] as number;
		const az = p[a + 2] as number;
		const bx = p[b] as number;
		const bz = p[b + 2] as number;
		const cx = p[c] as number;
		const cz = p[c + 2] as number;
		const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
		if (Math.abs(area) < 1e-9) continue;
		// A point on an edge counts as covered, so two triangles that share an edge leave no gap.
		const slack = -1e-6 * Math.abs(area);
		const sign = area > 0 ? 1 : -1;
		const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - ox) / step - 1e-6));
		const i1 = Math.min(columns - 1, Math.floor((Math.max(ax, bx, cx) - ox) / step + 1e-6));
		const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - oz) / step - 1e-6));
		const j1 = Math.min(rows - 1, Math.floor((Math.max(az, bz, cz) - oz) / step + 1e-6));
		for (let j = j0; j <= j1; j++) {
			const z = oz + j * step;
			for (let i = i0; i <= i1; i++) {
				const x = ox + i * step;
				const w0 = sign * ((bx - ax) * (z - az) - (bz - az) * (x - ax));
				const w1 = sign * ((cx - bx) * (z - bz) - (cz - bz) * (x - bx));
				const w2 = sign * ((ax - cx) * (z - cz) - (az - cz) * (x - cx));
				const k = j * columns + i;
				if (w0 >= slack && w1 >= slack && w2 >= slack) cover[k] = (cover[k] as number) | bit;
			}
		}
	}
}

/**
 * The distance in meters from each texel to the nearest seed texel, by a two-pass chamfer, which
 * runs at most `CHAMFER` times past the true distance. `ids`, when given, carries each seed's id to
 * the texels that it is nearest to.
 */
function chamfer(
	seed: (k: number) => boolean,
	width: number,
	height: number,
	texel: number,
	ids?: Int8Array,
): Float32Array {
	const far = Number.POSITIVE_INFINITY;
	const d = new Float32Array(width * height);
	for (let k = 0; k < d.length; k++) d[k] = seed(k) ? 0 : far;
	const diagonal = texel * Math.SQRT2;
	const relax = (k: number, from: number, cost: number) => {
		const through = (d[from] as number) + cost;
		if (through < (d[k] as number)) {
			d[k] = through;
			if (ids) ids[k] = ids[from] as number;
		}
	};
	for (let j = 0; j < height; j++)
		for (let i = 0; i < width; i++) {
			const k = j * width + i;
			if (i > 0) relax(k, k - 1, texel);
			if (j > 0) {
				relax(k, k - width, texel);
				if (i > 0) relax(k, k - width - 1, diagonal);
				if (i + 1 < width) relax(k, k - width + 1, diagonal);
			}
		}
	for (let j = height - 1; j >= 0; j--)
		for (let i = width - 1; i >= 0; i--) {
			const k = j * width + i;
			if (i + 1 < width) relax(k, k + 1, texel);
			if (j + 1 < height) {
				relax(k, k + width, texel);
				if (i + 1 < width) relax(k, k + width + 1, diagonal);
				if (i > 0) relax(k, k + width - 1, diagonal);
			}
		}
	return d;
}

/** The index of the lowest set bit of a mask, or -1 for none. */
function lowestBit(mask: number): number {
	return mask === 0 ? -1 : 31 - Math.clz32(mask & -mask);
}

/**
 * The junction map of a water's bodies and their meshes, or undefined where no two meshes overlap.
 * It also gives the vertices of each mesh near a meeting the river's current there, so that both
 * meshes carry the same current.
 */
export function junctions(
	bodies: readonly WaterBody[],
	meshes: readonly MeshArrays[],
): Junctions | undefined {
	const count = Math.min(bodies.length, meshes.length, MAX_BODIES);
	if (count < 2) return undefined;
	const extents = meshes.slice(0, count).map(meshExtent);
	const edge = Math.max(...extents.map((e) => e.edge));
	// A vertex near a meeting takes the river's current when it lies within this reach of the other
	// kind of body, which holds every vertex of a triangle whose pixels mix the two sets of waves.
	const reach = BLEND + edge;
	const flat = Math.max(FLAT, edge + 2 * TEXEL);
	const margin = Math.max(reach + edge, flat + RISE + edge) + 2 * TEXEL;
	// The map covers the points within the margin of both meshes of each pair that overlaps.
	let grid: Box | undefined;
	for (let a = 0; a < count; a++)
		for (let b = a + 1; b < count; b++) {
			const A = (extents[a] as { box: Box }).box;
			const B = (extents[b] as { box: Box }).box;
			if (A.minX >= B.maxX || B.minX >= A.maxX || A.minZ >= B.maxZ || B.minZ >= A.maxZ) continue;
			const minX = Math.max(A.minX, B.minX) - margin;
			const maxX = Math.min(A.maxX, B.maxX) + margin;
			const minZ = Math.max(A.minZ, B.minZ) - margin;
			const maxZ = Math.min(A.maxZ, B.maxZ) + margin;
			grid = grid
				? {
						minX: Math.min(grid.minX, minX),
						maxX: Math.max(grid.maxX, maxX),
						minZ: Math.min(grid.minZ, minZ),
						maxZ: Math.max(grid.maxZ, maxZ),
					}
				: { minX, maxX, minZ, maxZ };
		}
	if (!grid) return undefined;
	const texel = Math.max(
		TEXEL,
		(grid.maxX - grid.minX) / MAX_TEXELS,
		(grid.maxZ - grid.minZ) / MAX_TEXELS,
	);
	const width = Math.ceil((grid.maxX - grid.minX) / texel);
	const height = Math.ceil((grid.maxZ - grid.minZ) / texel);
	const ox = grid.minX;
	const oz = grid.minZ;
	const texels = width * height;

	// The lattice holds each texel's corners, the middles of its sides and its center, so a texel is
	// covered whole when all nine of its points are.
	const columns = 2 * width + 1;
	const rows = 2 * height + 1;
	const cover = new Uint32Array(columns * rows);
	for (let m = 0; m < count; m++)
		rasterize(meshes[m] as MeshArrays, (1 << m) >>> 0, cover, columns, rows, ox, oz, texel / 2);
	let rivers = 0;
	for (let m = 0; m < count; m++) if ((bodies[m] as WaterBody).kind === 'river') rivers |= 1 << m;
	const every = count === MAX_BODIES ? 0xffffffff : (1 << count) - 1;
	const lakes = (every & ~rivers) >>> 0;

	const touched = new Uint32Array(texels);
	const owner = new Uint8Array(texels);
	const raw = new Float32Array(texels);
	const weight = new Float32Array(texels);
	const overlap = new Uint8Array(texels);
	for (let j = 0; j < height; j++)
		for (let i = 0; i < width; i++) {
			let any = 0;
			let all = 0xffffffff;
			for (let dj = 0; dj < 3; dj++)
				for (let di = 0; di < 3; di++) {
					const point = cover[(2 * j + dj) * columns + 2 * i + di] as number;
					any |= point;
					all &= point;
				}
			const k = j * width + i;
			touched[k] = any >>> 0;
			all >>>= 0;
			if (any === 0) continue;
			weight[k] = 1;
			const x = ox + (i + 0.5) * texel;
			const z = oz + (j + 0.5) * texel;
			if ((any & (any - 1)) === 0) {
				raw[k] = any & rivers ? 1 : 0;
				continue;
			}
			overlap[k] = 1;
			let drawer = -1;
			for (let bits = all & lakes; bits !== 0 && drawer < 0; bits &= bits - 1) {
				const m = lowestBit(bits);
				if ((bodies[m] as WaterBody).contains(x, z)) drawer = m;
			}
			if (drawer < 0) drawer = lowestBit(all & rivers);
			if (drawer < 0) drawer = lowestBit(all);
			if (drawer >= 0) {
				owner[k] = drawer + 1;
				raw[k] = (bodies[drawer] as WaterBody).kind === 'river' ? 1 : 0;
			} else raw[k] = any & lakes ? 0 : 1;
		}
	if (!overlap.includes(1)) return undefined;

	// The share of the river's waves: the drawer's kind, blurred over the texels that some mesh
	// covers. Where every texel in reach agrees, the share is exactly 0 or 1.
	const sigma = BLEND / 3 / texel;
	const radius = Math.ceil(BLEND / texel);
	const kernel = new Float32Array(2 * radius + 1);
	for (let t = -radius; t <= radius; t++)
		kernel[t + radius] = Math.exp((-t * t) / (2 * sigma * sigma));
	const rowSum = new Float32Array(texels);
	const rowWeight = new Float32Array(texels);
	for (let j = 0; j < height; j++)
		for (let i = 0; i < width; i++) {
			let sum = 0;
			let total = 0;
			for (let t = Math.max(-radius, -i); t <= Math.min(radius, width - 1 - i); t++) {
				const k = j * width + i + t;
				const g = kernel[t + radius] as number;
				sum += g * (raw[k] as number) * (weight[k] as number);
				total += g * (weight[k] as number);
			}
			rowSum[j * width + i] = sum;
			rowWeight[j * width + i] = total;
		}
	const share = new Float32Array(texels);
	for (let j = 0; j < height; j++)
		for (let i = 0; i < width; i++) {
			let sum = 0;
			let total = 0;
			for (let t = Math.max(-radius, -j); t <= Math.min(radius, height - 1 - j); t++) {
				const k = (j + t) * width + i;
				const g = kernel[t + radius] as number;
				sum += g * (rowSum[k] as number);
				total += g * (rowWeight[k] as number);
			}
			share[j * width + i] = total > 0 ? sum / total : 1;
		}

	// The river's current at each meeting: its current at the middle of its overlaps with lakes.
	const carried: ([number, number] | undefined)[] = [];
	for (let m = 0; m < count; m++) {
		const body = bodies[m] as WaterBody;
		if (body.kind !== 'river') continue;
		let sx = 0;
		let sz = 0;
		let n = 0;
		for (let k = 0; k < texels; k++)
			if (overlap[k] && (touched[k] as number) & (1 << m) && (touched[k] as number) & lakes) {
				sx += ox + ((k % width) + 0.5) * texel;
				sz += oz + (Math.floor(k / width) + 0.5) * texel;
				n++;
			}
		if (n === 0) continue;
		const out: [number, number] = [0, 0];
		body.currentAt(sx / n, sz / n, out);
		carried[m] = out;
	}
	const nearestRiver = new Int8Array(texels).fill(-1);
	for (let k = 0; k < texels; k++) {
		const r = (touched[k] as number) & rivers;
		if (r) nearestRiver[k] = lowestBit(r);
	}
	const toRiver = chamfer(
		(k) => ((touched[k] as number) & rivers) !== 0,
		width,
		height,
		texel,
		nearestRiver,
	);
	const toLake = chamfer((k) => ((touched[k] as number) & lakes) !== 0, width, height, texel);
	const toOverlap = chamfer((k) => overlap[k] === 1, width, height, texel);
	// A vertex is checked at its texel's center, up to half a diagonal away.
	const near = (reach + texel) * CHAMFER;
	const texelAt = (x: number, z: number) => {
		const i = Math.floor((x - ox) / texel);
		const j = Math.floor((z - oz) / texel);
		return i < 0 || j < 0 || i >= width || j >= height ? -1 : j * width + i;
	};
	/** The river whose current the meshes carry at a texel, or -1 where they keep their own. */
	const carrier = (k: number, kind: WaterBody['kind'], self: number): number => {
		if (kind === 'river') return (toLake[k] as number) <= near && carried[self] ? self : -1;
		const river = nearestRiver[k] as number;
		return (toRiver[k] as number) <= near && river >= 0 && carried[river] ? river : -1;
	};
	const data = new Uint8Array(texels * 4);
	for (let k = 0; k < texels; k++) {
		data[k * 4] = owner[k] as number;
		data[k * 4 + 1] = Math.round((share[k] as number) * 255);
		const distance = (toOverlap[k] as number) / CHAMFER;
		data[k * 4 + 2] = Math.round((1 - math.smoothstep(distance, flat, flat + RISE)) * 255);
		data[k * 4 + 3] = 0;
	}
	/** A channel of the map at a point, filtered between the four nearest texel centers. */
	const filtered = (x: number, z: number, channel: number, outside: number) => {
		const u = (x - ox) / texel - 0.5;
		const w = (z - oz) / texel - 0.5;
		if (u < -0.5 || w < -0.5 || u > width - 0.5 || w > height - 0.5) return outside;
		const i = Math.floor(u);
		const j = Math.floor(w);
		const fu = u - i;
		const fw = w - j;
		const at = (a: number, b: number) => {
			const ci = Math.min(Math.max(a, 0), width - 1);
			const cj = Math.min(Math.max(b, 0), height - 1);
			return (data[(cj * width + ci) * 4 + channel] as number) / 255;
		};
		const low = at(i, j) + (at(i + 1, j) - at(i, j)) * fu;
		const high = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fu;
		return low + (high - low) * fw;
	};
	for (let m = 0; m < count; m++) {
		const mesh = meshes[m] as MeshArrays;
		const kind = (bodies[m] as WaterBody).kind;
		const p = mesh.positions as ArrayLike<number>;
		const uvs = mesh.uvs as Float32Array;
		const uvs1 = mesh.uvs1 as Float32Array;
		for (let v = 0; v < p.length / 3; v++) {
			const k = texelAt(p[v * 3] as number, p[v * 3 + 2] as number);
			if (k < 0) continue;
			// The fraction of the body's number holds how flat the surface lies, at half scale.
			uvs[v * 2 + 1] = m + 1 + 0.5 * filtered(p[v * 3] as number, p[v * 3 + 2] as number, 2, 0);
			const river = carrier(k, kind, m);
			if (river < 0) continue;
			const [cx, cz] = carried[river] as [number, number];
			const speed = Math.hypot(cx, cz);
			uvs[v * 2] = speed;
			uvs1[v * 2] = speed > 0 ? (cx / speed) * 0.5 + 0.5 : 1;
			uvs1[v * 2 + 1] = speed > 0 ? (cz / speed) * 0.5 + 0.5 : 0.5;
		}
	}
	return {
		origin: [ox, oz],
		size: [width * texel, height * texel],
		width,
		height,
		data,
		ownerAt(x, z) {
			const k = texelAt(x, z);
			return k < 0 ? -1 : (owner[k] as number) - 1;
		},
		shareAt: (x, z) => filtered(x, z, 1, 1),
		flatnessAt: (x, z) => filtered(x, z, 2, 0),
		currentAt(x, z, out) {
			const k = texelAt(x, z);
			if (k < 0) return false;
			const river = carrier(k, 'lake', -1);
			if (river < 0) return false;
			const [cx, cz] = carried[river] as [number, number];
			out[0] = cx;
			out[1] = cz;
			return true;
		},
	};
}
