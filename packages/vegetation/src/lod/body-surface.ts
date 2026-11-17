// The body surface: one closed surface round a body axis, drawn once by the shared bake for every
// family whose model states a body. The axis gives the course and the girth, the model gives the
// rings it draws, and the level and its coarsening give the sides. The surface is closed at both
// ends, so a body under any cap never shows the sky through it.
import { cos, sin } from '../core/math';
import type { Detail, Vec3 } from '../core/types';
import type { MeshLevel } from '../stages';
import { sidesFor, tubeDetail } from '../wood/tube';

/** One node of a body axis: its place and its radius there, in metres. */
export interface BodyNode {
	readonly at: Vec3;
	readonly radius: number;
}

/** A body surface's rings, sides and geometry. */
export interface BodySurface {
	/** The rings the surface draws, one for each step the model states. */
	readonly rings: number;
	/** The sides of each ring, all the same. */
	readonly sides: number;
	/** Three numbers a vertex. */
	readonly positions: Float32Array;
	/** Three numbers a vertex, the outward normal. */
	readonly normals: Float32Array;
	/** Three numbers a ring, its centre on the axis. */
	readonly centres: Float32Array;
	/** Three indices a triangle, the bands first and the two caps last. */
	readonly indices: Uint32Array;
	/** The triangles drawn. */
	readonly triangles: number;
}

/**
 * The closed surface of a body axis, at one level and one step of its coarsening.
 *
 * The rings stand at even steps along the axis's course, one for each step the model states, so
 * the drawn count is the model's figure and not a constant in the draw. The sides follow the
 * coarsening's edge and the body's mean girth, held between three and the level's ceiling. Each
 * band between two rings draws two triangles a side, and each end closes with a fan, so every
 * edge of the surface is shared by exactly two triangles.
 *
 * @param nodes The body axis's nodes, from its foot to its top.
 * @param segments The rings the model states for the axis.
 * @param level The level the surface is drawn at.
 * @param detail The mesh tier.
 * @param coarseness The level's coarsening, from 0 to 1.
 * @param sections The section sparsity, from 0 to 1.
 * @returns The surface.
 * @category api/vegetation
 */
export function bodySurface(
	nodes: readonly BodyNode[],
	segments: number,
	level: MeshLevel,
	detail: Detail,
	coarseness = 0,
	sections = 0,
): BodySurface {
	if (nodes.length < 2) throw new Error('@null3d/vegetation: a body axis has at least two nodes');
	const rings = Math.max(1, Math.floor(segments));
	const tube = tubeDetail(level, detail, coarseness, sections);
	// The arc length along the axis's course.
	const step: number[] = [0];
	for (let k = 1; k < nodes.length; k++) {
		const a = nodes[k - 1] as BodyNode;
		const b = nodes[k] as BodyNode;
		const dx = (b.at[0] as number) - (a.at[0] as number);
		const dy = (b.at[1] as number) - (a.at[1] as number);
		const dz = (b.at[2] as number) - (a.at[2] as number);
		step.push((step[k - 1] as number) + Math.sqrt(dx * dx + dy * dy + dz * dz));
	}
	const length = step[step.length - 1] as number;
	/** The axis's point and radius at an arc length. */
	const at = (s: number): { readonly point: Vec3; readonly radius: number } => {
		let k = 0;
		while (k < nodes.length - 2 && (step[k + 1] as number) < s) k++;
		const a = nodes[k] as BodyNode;
		const b = nodes[k + 1] as BodyNode;
		const span = (step[k + 1] as number) - (step[k] as number);
		const t = span > 1e-9 ? Math.min(1, Math.max(0, (s - (step[k] as number)) / span)) : 0;
		return {
			point: [
				(a.at[0] as number) + ((b.at[0] as number) - (a.at[0] as number)) * t,
				(a.at[1] as number) + ((b.at[1] as number) - (a.at[1] as number)) * t,
				(a.at[2] as number) + ((b.at[2] as number) - (a.at[2] as number)) * t,
			],
			radius: a.radius + (b.radius - a.radius) * t,
		};
	};
	// The rings stand at the middles of the steps, so each cap reaches the axis's own end.
	let mean = 0;
	for (const node of nodes) mean += node.radius;
	mean /= nodes.length;
	const sides = sidesFor(2 * Math.PI * mean, mean, tube);
	const count = rings * sides + 2;
	const positions = new Float32Array(count * 3);
	const normals = new Float32Array(count * 3);
	const centres = new Float32Array(rings * 3);
	const cosines = new Float32Array(sides);
	const sines = new Float32Array(sides);
	for (let j = 0; j < sides; j++) {
		const angle = (2 * Math.PI * j) / sides;
		cosines[j] = cos(angle);
		sines[j] = sin(angle);
	}
	/** The frame round the axis at an arc length: its tangent and two sides. */
	const frame = (s: number): { tangent: Vec3; side: Vec3; up: Vec3 } => {
		const before = at(Math.max(0, s - 1e-3)).point;
		const after = at(Math.min(length, s + 1e-3)).point;
		let tx = (after[0] as number) - (before[0] as number);
		let ty = (after[1] as number) - (before[1] as number);
		let tz = (after[2] as number) - (before[2] as number);
		const turn = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
		tx /= turn;
		ty /= turn;
		tz /= turn;
		// The reference side is a level one across the axis, so a plumb body keeps a steady frame.
		let sx = -tz;
		let sy = 0;
		let sz = tx;
		const across = Math.sqrt(sx * sx + sy * sy + sz * sz);
		if (across < 1e-6) {
			sx = 1;
			sy = 0;
			sz = 0;
		} else {
			sx /= across;
			sy /= across;
			sz /= across;
		}
		// The other side is the axis turned onto it, so the frame is right-handed.
		const ux = ty * sz - tz * sy;
		const uy = tz * sx - tx * sz;
		const uz = tx * sy - ty * sx;
		return { tangent: [tx, ty, tz], side: [sx, sy, sz], up: [ux, uy, uz] };
	};
	for (let ring = 0; ring < rings; ring++) {
		const s = (length * (ring + 0.5)) / rings;
		const place = at(s);
		centres[ring * 3] = place.point[0] as number;
		centres[ring * 3 + 1] = place.point[1] as number;
		centres[ring * 3 + 2] = place.point[2] as number;
		const { side, up } = frame(s);
		for (let j = 0; j < sides; j++) {
			const c = cosines[j] as number;
			const n = sines[j] as number;
			const nx = (side[0] as number) * c + (up[0] as number) * n;
			const ny = (side[1] as number) * c + (up[1] as number) * n;
			const nz = (side[2] as number) * c + (up[2] as number) * n;
			const vertex = ring * sides + j;
			positions[vertex * 3] = (place.point[0] as number) + nx * place.radius;
			positions[vertex * 3 + 1] = (place.point[1] as number) + ny * place.radius;
			positions[vertex * 3 + 2] = (place.point[2] as number) + nz * place.radius;
			normals[vertex * 3] = nx;
			normals[vertex * 3 + 1] = ny;
			normals[vertex * 3 + 2] = nz;
		}
	}
	// The foot and the top, each the axis's own end node.
	const foot = nodes[0] as BodyNode;
	const top = nodes[nodes.length - 1] as BodyNode;
	const footVertex = rings * sides;
	const topVertex = footVertex + 1;
	positions[footVertex * 3] = foot.at[0] as number;
	positions[footVertex * 3 + 1] = foot.at[1] as number;
	positions[footVertex * 3 + 2] = foot.at[2] as number;
	const footFrame = frame(0);
	normals[footVertex * 3] = -(footFrame.tangent[0] as number);
	normals[footVertex * 3 + 1] = -(footFrame.tangent[1] as number);
	normals[footVertex * 3 + 2] = -(footFrame.tangent[2] as number);
	positions[topVertex * 3] = top.at[0] as number;
	positions[topVertex * 3 + 1] = top.at[1] as number;
	positions[topVertex * 3 + 2] = top.at[2] as number;
	const topFrame = frame(length);
	normals[topVertex * 3] = topFrame.tangent[0] as number;
	normals[topVertex * 3 + 1] = topFrame.tangent[1] as number;
	normals[topVertex * 3 + 2] = topFrame.tangent[2] as number;
	// Two triangles a side between each pair of rings, then a fan at each end.
	const triangles = 2 * sides * rings;
	const indices = new Uint32Array(triangles * 3);
	let t = 0;
	const write = (a: number, b: number, c: number): void => {
		indices[t++] = a;
		indices[t++] = b;
		indices[t++] = c;
	};
	for (let ring = 0; ring < rings - 1; ring++) {
		for (let j = 0; j < sides; j++) {
			const next = (j + 1) % sides;
			const a = ring * sides + j;
			const b = ring * sides + next;
			const c = (ring + 1) * sides + next;
			const d = (ring + 1) * sides + j;
			write(a, b, c);
			write(a, c, d);
		}
	}
	for (let j = 0; j < sides; j++) {
		const next = (j + 1) % sides;
		write(footVertex, next, j);
		write(topVertex, (rings - 1) * sides + j, (rings - 1) * sides + next);
	}
	return { rings, sides, positions, normals, centres, indices, triangles };
}
