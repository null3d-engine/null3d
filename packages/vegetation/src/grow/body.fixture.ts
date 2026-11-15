// Test helpers that read drawn geometry: the distance from a point to a mesh, and whether a mesh
// is one body. Two parts of a mesh are one body when they share a vertex or when a vertex of one
// lies within a stated distance of a triangle of the other, as a stalk that begins inside the stem
// it leaves.

/** A mesh as flat positions, three a vertex, and triangle indices. */
export interface TestMesh {
	readonly positions: ArrayLike<number>;
	readonly indices: ArrayLike<number>;
}

type Point = readonly number[];

const sub = (x: Point, y: Point) => [0, 1, 2].map((k) => (x[k] as number) - (y[k] as number));
const dot = (x: Point, y: Point) => x.reduce((sum, value, k) => sum + value * (y[k] as number), 0);

/** The distance from a point to a triangle. */
export function toTriangle(p: Point, a: Point, b: Point, c: Point): number {
	const ab = sub(b, a);
	const ac = sub(c, a);
	const ap = sub(p, a);
	const d1 = dot(ab, ap);
	const d2 = dot(ac, ap);
	let nearest: number[];
	if (d1 <= 0 && d2 <= 0) nearest = [...a];
	else {
		const bp = sub(p, b);
		const d3 = dot(ab, bp);
		const d4 = dot(ac, bp);
		const cp = sub(p, c);
		const d5 = dot(ab, cp);
		const d6 = dot(ac, cp);
		const vc = d1 * d4 - d3 * d2;
		const vb = d5 * d2 - d1 * d6;
		const va = d3 * d6 - d5 * d4;
		if (d3 >= 0 && d4 <= d3) nearest = [...b];
		else if (d6 >= 0 && d5 <= d6) nearest = [...c];
		else if (vc <= 0 && d1 >= 0 && d3 <= 0)
			nearest = a.map((x, k) => x + (ab[k] as number) * (d1 / (d1 - d3)));
		else if (vb <= 0 && d2 >= 0 && d6 <= 0)
			nearest = a.map((x, k) => x + (ac[k] as number) * (d2 / (d2 - d6)));
		else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
			const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
			nearest = b.map((x, k) => x + ((c[k] as number) - x) * w);
		} else {
			const v = vb / (va + vb + vc);
			const w = vc / (va + vb + vc);
			nearest = a.map((x, k) => x + (ab[k] as number) * v + (ac[k] as number) * w);
		}
	}
	const away = sub(p, nearest);
	return Math.sqrt(dot(away, away));
}

/** A vertex of a mesh. */
function vertexOf(mesh: TestMesh, i: number): number[] {
	return [
		mesh.positions[i * 3] as number,
		mesh.positions[i * 3 + 1] as number,
		mesh.positions[i * 3 + 2] as number,
	];
}

/**
 * The distance from a point to the nearest triangle of a mesh.
 *
 * @param mesh The mesh.
 * @param point The point.
 * @returns The distance, or infinity for a mesh with no triangle.
 */
export function toMesh(mesh: TestMesh, point: Point): number {
	let nearest = Number.POSITIVE_INFINITY;
	for (let t = 0; t < mesh.indices.length; t += 3)
		nearest = Math.min(
			nearest,
			toTriangle(
				point,
				vertexOf(mesh, mesh.indices[t] as number),
				vertexOf(mesh, mesh.indices[t + 1] as number),
				vertexOf(mesh, mesh.indices[t + 2] as number),
			),
		);
	return nearest;
}

/**
 * The bodies a mesh is made of: its triangles grouped by shared vertices, then the groups joined
 * wherever a vertex of one lies within `join` of a triangle of another.
 *
 * @param mesh The mesh.
 * @param join The distance within which two parts count as joined, in the mesh's units.
 * @returns The count of bodies.
 */
export function bodies(mesh: TestMesh, join: number): number {
	const count = mesh.positions.length / 3;
	const parent = Array.from({ length: count }, (_, i) => i);
	const find = (i: number): number => {
		let root = i;
		while (parent[root] !== root) root = parent[root] as number;
		while (parent[i] !== root) {
			const next = parent[i] as number;
			parent[i] = root;
			i = next;
		}
		return root;
	};
	const unite = (a: number, b: number) => {
		parent[find(a)] = find(b);
	};
	for (let t = 0; t < mesh.indices.length; t += 3) {
		unite(mesh.indices[t] as number, mesh.indices[t + 1] as number);
		unite(mesh.indices[t] as number, mesh.indices[t + 2] as number);
	}
	// A vertex no triangle names is no part of the drawn mesh.
	const drawn = new Uint8Array(count);
	for (let t = 0; t < mesh.indices.length; t++) drawn[mesh.indices[t] as number] = 1;
	for (let joined = true; joined; ) {
		joined = false;
		for (let i = 0; i < count; i++) {
			if (!drawn[i]) continue;
			const p = vertexOf(mesh, i);
			for (let t = 0; t < mesh.indices.length; t += 3) {
				const a = mesh.indices[t] as number;
				if (find(a) === find(i)) continue;
				const near = toTriangle(
					p,
					vertexOf(mesh, a),
					vertexOf(mesh, mesh.indices[t + 1] as number),
					vertexOf(mesh, mesh.indices[t + 2] as number),
				);
				if (near <= join) {
					unite(a, i);
					joined = true;
				}
			}
		}
	}
	const roots = new Set<number>();
	for (let i = 0; i < count; i++) if (drawn[i]) roots.add(find(i));
	return roots.size;
}
