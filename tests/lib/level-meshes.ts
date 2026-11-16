// Meshes that the run-time level planner's tests plan: a bumpy grid with normals and texture
// coordinates, and the words that the engine core hands the planner for it. The unit tests, the
// browser test page and its spec build the same arrays from here, so the levels that Node's
// planner gives and the ones a job worker gives describe the same mesh.
import { VERTEX_ATTRIBUTES } from '../../packages/engine/src/generated/gpu';

/** A mesh as arrays of floats, as the core gives them to the planner. */
export interface LevelArrays {
	positions: Float32Array;
	normals: Float32Array;
	uvs?: Float32Array;
	colors?: Float32Array;
	indices: Uint32Array;
}

/**
 * A grid of `n` x `n` cells over a bumpy surface, one meter across, with normals and texture
 * coordinates that repeat the texture twice.
 */
export function bumpyGrid(n: number): LevelArrays & { uvs: Float32Array } {
	const row = n + 1;
	const positions = new Float32Array(row * row * 3);
	const normals = new Float32Array(row * row * 3);
	const uvs = new Float32Array(row * row * 2);
	for (let y = 0; y <= n; y++)
		for (let x = 0; x <= n; x++) {
			const v = y * row + x;
			const [u, w] = [x / n, y / n];
			const h = 0.08 * Math.sin(u * 9) * Math.cos(w * 7) + 0.03 * Math.sin(u * 31 + w * 23);
			positions.set([u, h, w], v * 3);
			const dx =
				0.08 * 9 * Math.cos(u * 9) * Math.cos(w * 7) + 0.03 * 31 * Math.cos(u * 31 + w * 23);
			const dz =
				-0.08 * 7 * Math.sin(u * 9) * Math.sin(w * 7) + 0.03 * 23 * Math.cos(u * 31 + w * 23);
			const length = Math.hypot(dx, 1, dz);
			normals.set([-dx / length, 1 / length, -dz / length], v * 3);
			uvs.set([u * 2, w * 2], v * 2);
		}
	const indices = new Uint32Array(n * n * 6);
	for (let y = 0; y < n; y++)
		for (let x = 0; x < n; x++) {
			const [a, b] = [y * row + x, (y + 1) * row + x];
			indices.set([a, b, a + 1, a + 1, b, b + 1], (y * n + x) * 6);
		}
	return { positions, normals, uvs, indices };
}

/**
 * A closed box of separate quads, as a building kit makes its walls: each of its six sides a grid
 * of `cells` by `cells` quads with corners of their own, `width` by `height` by `depth` meters
 * around the origin, with each side's normals. Every triangle faces one of the six ways.
 */
export function quadBox(cells: number, width = 8, height = 6, depth = 8): LevelArrays {
	const [hx, hy, hz] = [width / 2, height / 2, depth / 2];
	// Each side: its middle, then the two steps across it, which turn counter-clockwise from outside.
	const sides: [number[], number[], number[]][] = [
		[
			[0, 0, hz],
			[width, 0, 0],
			[0, height, 0],
		],
		[
			[0, 0, -hz],
			[-width, 0, 0],
			[0, height, 0],
		],
		[
			[hx, 0, 0],
			[0, 0, -depth],
			[0, height, 0],
		],
		[
			[-hx, 0, 0],
			[0, 0, depth],
			[0, height, 0],
		],
		[
			[0, hy, 0],
			[width, 0, 0],
			[0, 0, -depth],
		],
		[
			[0, -hy, 0],
			[width, 0, 0],
			[0, 0, depth],
		],
	];
	const quads = sides.length * cells * cells;
	const positions = new Float32Array(quads * 12);
	const normals = new Float32Array(quads * 12);
	const indices = new Uint32Array(quads * 6);
	let q = 0;
	for (const [middle, u, v] of sides) {
		const n = [
			(u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
			(u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
			(u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
		];
		const length = Math.hypot(n[0] as number, n[1] as number, n[2] as number);
		for (let i = 0; i < cells; i++)
			for (let j = 0; j < cells; j++) {
				const corners = [
					[i, j],
					[i + 1, j],
					[i + 1, j + 1],
					[i, j + 1],
				];
				corners.forEach(([a, b], c) => {
					for (let k = 0; k < 3; k++) {
						positions[(q * 4 + c) * 3 + k] =
							(middle[k] as number) +
							((a as number) / cells - 0.5) * (u[k] as number) +
							((b as number) / cells - 0.5) * (v[k] as number);
						normals[(q * 4 + c) * 3 + k] = (n[k] as number) / length;
					}
				});
				const first = q * 4;
				indices.set([first, first + 1, first + 2, first, first + 2, first + 3], q * 6);
				q++;
			}
	}
	return { positions, normals, indices };
}

/** The format bit of the attribute at a vertex shader location. */
const bit = (location: number) => VERTEX_ATTRIBUTES[location]?.[0] ?? 0;

/** The words that the engine reads from the core for `arrays`, before they go to the planner. */
export function planningWords({
	positions,
	normals,
	uvs,
	colors,
	indices,
}: LevelArrays): ArrayBuffer {
	const vertices = positions.length / 3;
	const format = (uvs ? bit(2) : 0) | (colors ? bit(5) : 0);
	const floats = [positions, normals, ...(uvs ? [uvs] : []), ...(colors ? [colors] : [])];
	const out = new Uint32Array(3 + floats.reduce((sum, f) => sum + f.length, 0) + indices.length);
	out.set([vertices, indices.length, format]);
	let at = 3;
	for (const values of floats) {
		out.set(new Uint32Array(values.buffer, values.byteOffset, values.length), at);
		at += values.length;
	}
	out.set(indices, at);
	return out.buffer;
}

/** A hash of a level's indices, FNV-1a over their words, so a page reports a level in one number. */
export function indicesHash(indices: Uint32Array): number {
	let hash = 0x811c9dc5;
	for (const index of indices) {
		hash = Math.imul(hash ^ index, 0x01000193) >>> 0;
	}
	return hash;
}
