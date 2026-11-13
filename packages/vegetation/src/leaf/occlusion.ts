// Self-occlusion inside a shoot: for each vertex, the share of sixteen rays that leave the shoot
// without striking its own triangles, written into the vertex's fourth colour byte. A leaf takes
// light on both faces, so its rays go all round; a stem or a bud takes it on its outside only, so
// its rays stay on the side its normal faces. The triangles sit in a grid of cells that each ray
// walks, so a shoot of a few thousand triangles takes a few milliseconds.
import { cos, sin } from '../core/math';
import { leafSurface, type MeshWriter } from './writer';

/** Rays per vertex. */
const RAYS = 16;
/** How far a ray starts off its surface, in metres. */
const LIFT = 2e-4;

/** Sixteen directions spread evenly over the sphere, on a Fibonacci spiral. */
const DIRECTIONS: readonly (readonly [number, number, number])[] = (() => {
	const out: [number, number, number][] = [];
	const golden = Math.PI * (3 - Math.sqrt(5));
	for (let i = 0; i < RAYS; i++) {
		const y = 1 - (2 * (i + 0.5)) / RAYS;
		const r = Math.sqrt(1 - y * y);
		out.push([cos(golden * i) * r, y, sin(golden * i) * r]);
	}
	return out;
})();

/**
 * The occluder's triangles in a grid of cells, each cell's triangle list packed into one array.
 * A ray marks each triangle it tests, so a triangle that spans many cells is tested once a ray.
 */
class TriangleGrid {
	private readonly min = new Float64Array(3);
	private readonly cells = new Int32Array(3);
	private readonly cell: number;
	private readonly positions: Float64Array;
	private readonly indices: Int32Array;
	/** Where each cell's list starts in `items`, and its end at the next cell's start. */
	private readonly starts: Int32Array;
	private readonly items: Int32Array;
	/** The last ray that tested each triangle. */
	private readonly tested: Int32Array;
	private ray = 0;

	constructor(positions: readonly number[], indices: readonly number[]) {
		this.positions = Float64Array.from(positions);
		this.indices = Int32Array.from(indices);
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		for (let i = 0; i < positions.length; i += 3)
			for (let c = 0; c < 3; c++) {
				lo[c] = Math.min(lo[c] as number, positions[i + c] as number);
				hi[c] = Math.max(hi[c] as number, positions[i + c] as number);
			}
		const size = Math.max(
			(hi[0] as number) - (lo[0] as number),
			(hi[1] as number) - (lo[1] as number),
			(hi[2] as number) - (lo[2] as number),
			1e-4,
		);
		const triangles = indices.length / 3;
		// Cells across the box: three per cube root of the triangle count, rounded, from 4 to 48. Whole
		// cubes of half steps find it exactly, so the count is the same on every engine.
		const target = 27 * triangles;
		let across = 4;
		while (across < 48 && (across + 0.5) * (across + 0.5) * (across + 0.5) <= target) across++;
		this.cell = (size / across) * 1.0001;
		for (let c = 0; c < 3; c++) {
			this.min[c] = (lo[c] as number) - 1e-6;
			this.cells[c] = Math.max(
				1,
				Math.ceil(((hi[c] as number) - (lo[c] as number)) / this.cell) + 1,
			);
		}
		const total = (this.cells[0] as number) * (this.cells[1] as number) * (this.cells[2] as number);
		// Two passes over the triangles' boxes: count each cell's list, then fill it.
		const counts = new Int32Array(total + 1);
		const box = new Int32Array(6);
		const visit = (t: number, write: (cell: number) => void) => {
			for (let c = 0; c < 3; c++) {
				let a = Infinity;
				let b = -Infinity;
				for (let k = 0; k < 3; k++) {
					const value = this.positions[(this.indices[t + k] as number) * 3 + c] as number;
					a = Math.min(a, value);
					b = Math.max(b, value);
				}
				box[c] = this.index(a, c);
				box[c + 3] = this.index(b, c);
			}
			for (let z = box[2] as number; z <= (box[5] as number); z++)
				for (let y = box[1] as number; y <= (box[4] as number); y++)
					for (let x = box[0] as number; x <= (box[3] as number); x++)
						write((z * (this.cells[1] as number) + y) * (this.cells[0] as number) + x);
		};
		for (let t = 0; t < indices.length; t += 3)
			visit(t, (cell) => {
				counts[cell + 1] = (counts[cell + 1] as number) + 1;
			});
		for (let i = 1; i <= total; i++) counts[i] = (counts[i] as number) + (counts[i - 1] as number);
		this.starts = counts;
		this.items = new Int32Array(counts[total] as number);
		const fill = counts.slice(0, total);
		for (let t = 0; t < indices.length; t += 3)
			visit(t, (cell) => {
				this.items[fill[cell] as number] = t;
				fill[cell] = (fill[cell] as number) + 1;
			});
		this.tested = new Int32Array(triangles).fill(-1);
	}

	/** The cell index along one axis of a coordinate, held inside the grid. */
	private index(value: number, axis: number): number {
		const count = this.cells[axis] as number;
		return Math.min(
			count - 1,
			Math.max(0, Math.floor((value - (this.min[axis] as number)) / this.cell)),
		);
	}

	/** Whether a triangle blocks the ray from o along d beyond a small start distance. */
	private hits(
		t: number,
		ox: number,
		oy: number,
		oz: number,
		dx: number,
		dy: number,
		dz: number,
	): boolean {
		const p = this.positions;
		const a = (this.indices[t] as number) * 3;
		const b = (this.indices[t + 1] as number) * 3;
		const c = (this.indices[t + 2] as number) * 3;
		const ax = p[a] as number;
		const ay = p[a + 1] as number;
		const az = p[a + 2] as number;
		const e1x = (p[b] as number) - ax;
		const e1y = (p[b + 1] as number) - ay;
		const e1z = (p[b + 2] as number) - az;
		const e2x = (p[c] as number) - ax;
		const e2y = (p[c + 1] as number) - ay;
		const e2z = (p[c + 2] as number) - az;
		const px = dy * e2z - dz * e2y;
		const py = dz * e2x - dx * e2z;
		const pz = dx * e2y - dy * e2x;
		const det = e1x * px + e1y * py + e1z * pz;
		if (det > -1e-14 && det < 1e-14) return false;
		const inv = 1 / det;
		const sx = ox - ax;
		const sy = oy - ay;
		const sz = oz - az;
		const u = (sx * px + sy * py + sz * pz) * inv;
		if (u < 0 || u > 1) return false;
		const qx = sy * e1z - sz * e1y;
		const qy = sz * e1x - sx * e1z;
		const qz = sx * e1y - sy * e1x;
		const v = (dx * qx + dy * qy + dz * qz) * inv;
		if (v < 0 || u + v > 1) return false;
		return (e2x * qx + e2y * qy + e2z * qz) * inv > LIFT;
	}

	/** One axis of a ray's walk: its first cell, step, distance to the next cell wall and per cell. */
	private axis(origin: number, direction: number, c: number): [number, number, number, number] {
		// A ray that starts just outside the grid, as a low tier's vertex may, starts at its edge.
		const count = this.cells[c] as number;
		const local = Math.min(
			count - 1e-9,
			Math.max(0, (origin - (this.min[c] as number)) / this.cell),
		);
		const cell = Math.floor(local);
		if (direction > 0) return [cell, 1, (cell + 1 - local) / direction, 1 / direction];
		if (direction < 0) return [cell, -1, (local - cell) / -direction, -1 / direction];
		return [cell, 0, Infinity, Infinity];
	}

	/** Whether the ray from o along the unit d strikes any triangle: a walk of the grid's cells. */
	blocked(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean {
		const ray = ++this.ray;
		let [x, sx, nx, ex] = this.axis(ox, dx, 0);
		let [y, sy, ny, ey] = this.axis(oy, dy, 1);
		let [z, sz, nz, ez] = this.axis(oz, dz, 2);
		const cx = this.cells[0] as number;
		const cy = this.cells[1] as number;
		const cz = this.cells[2] as number;
		for (;;) {
			const cell = (z * cy + y) * cx + x;
			const end = this.starts[cell + 1] as number;
			for (let i = this.starts[cell] as number; i < end; i++) {
				const t = this.items[i] as number;
				const triangle = t / 3;
				if (this.tested[triangle] === ray) continue;
				this.tested[triangle] = ray;
				if (this.hits(t, ox, oy, oz, dx, dy, dz)) return true;
			}
			if (nx < ny && nx < nz) {
				x += sx;
				if (x < 0 || x >= cx) return false;
				nx += ex;
			} else if (ny < nz) {
				y += sy;
				if (y < 0 || y >= cy) return false;
				ny += ey;
			} else {
				z += sz;
				if (z < 0 || z >= cz) return false;
				nz += ez;
			}
		}
	}
}

/**
 * Writes each vertex's self-occlusion into its fourth colour byte: 255 where every ray leaves the
 * shoot, 0 where none does.
 *
 * @param mesh The mesh whose vertices to shade.
 * @param occluder The triangles that cast the shade: the same shoot, usually at the high tier.
 */
export function selfOcclusion(mesh: MeshWriter, occluder: MeshWriter): void {
	const grid = new TriangleGrid(occluder.positions, occluder.indices);
	const count = mesh.vertices;
	for (let i = 0; i < count; i++) {
		const px = mesh.positions[i * 3] as number;
		const py = mesh.positions[i * 3 + 1] as number;
		const pz = mesh.positions[i * 3 + 2] as number;
		const nx = mesh.normals[i * 3] as number;
		const ny = mesh.normals[i * 3 + 1] as number;
		const nz = mesh.normals[i * 3 + 2] as number;
		const leaf = leafSurface(mesh.colors[i * 4 + 2] as number);
		let open = 0;
		for (const [rx, ry, rz] of DIRECTIONS) {
			let dx = rx;
			let dy = ry;
			let dz = rz;
			let facing = dx * nx + dy * ny + dz * nz;
			if (!leaf && facing < 0) {
				// A stem's ray mirrors into the side its normal faces.
				dx -= 2 * facing * nx;
				dy -= 2 * facing * ny;
				dz -= 2 * facing * nz;
				facing = -facing;
			}
			const side = facing < 0 ? -1 : 1;
			const ox = px + (nx * side + dx) * LIFT;
			const oy = py + (ny * side + dy) * LIFT;
			const oz = pz + (nz * side + dz) * LIFT;
			if (!grid.blocked(ox, oy, oz, dx, dy, dz)) open++;
		}
		mesh.colors[i * 4 + 3] = Math.round((open / RAYS) * 255);
	}
}

/**
 * Shades every tier of one shoot: rays from the vertices of the source tier against its own
 * triangles, then each vertex of another tier takes the shade of the nearest vertex of the same part
 * (one stem, one bud, one leaf) in the source tier. The tiers mesh one plan in one order of parts,
 * so their shade agrees, at the cost of one tier's rays.
 *
 * @param tiers The shoot's meshes, one per tier, each with its parts marked.
 * @param source The tier whose vertices cast the rays.
 */
export function shootOcclusion(tiers: readonly MeshWriter[], source: number): void {
	const shaded = tiers[source];
	if (!shaded) return;
	selfOcclusion(shaded, shaded);
	const from = shaded.positions;
	tiers.forEach((mesh, tier) => {
		if (tier === source) return;
		if (mesh.parts.length !== shaded.parts.length)
			throw new Error('@null3d/vegetation: the tiers of a shoot have different parts');
		for (let part = 0; part < mesh.parts.length; part++) {
			const start = mesh.parts[part] as number;
			const end = mesh.parts[part + 1] ?? mesh.vertices;
			// A part the source tier leaves out, such as a bud that its cluster's one cone stands for,
			// takes the shade of the nearest vertex anywhere in the source tier.
			const own = shaded.parts[part] as number;
			const ownEnd = shaded.parts[part + 1] ?? shaded.vertices;
			const first = ownEnd > own ? own : 0;
			const last = ownEnd > own ? ownEnd : shaded.vertices;
			for (let i = start; i < end; i++) {
				const x = mesh.positions[i * 3] as number;
				const y = mesh.positions[i * 3 + 1] as number;
				const z = mesh.positions[i * 3 + 2] as number;
				let best = -1;
				let bestDistance = Infinity;
				for (let j = first; j < last; j++) {
					const d =
						((from[j * 3] as number) - x) ** 2 +
						((from[j * 3 + 1] as number) - y) ** 2 +
						((from[j * 3 + 2] as number) - z) ** 2;
					if (d < bestDistance) {
						bestDistance = d;
						best = j;
					}
				}
				mesh.colors[i * 4 + 3] = best >= 0 ? (shaded.colors[best * 4 + 3] as number) : 255;
			}
		}
	});
}
