import { beforeAll, describe, expect, it } from 'bun:test';
import { Document, NodeIO } from '@gltf-transform/core';
import {
	coneShare,
	FACING_DRAWN_MIN_TRIANGLES,
	FACING_LIST_MIN_TRIANGLES,
	FACING_MIN_SHARE,
	facingPieces,
	facingPiecesPay,
	GROUP_LIST_MIN_TRIANGLES,
	GROUP_TRIANGLES,
	type GroupPlan,
	listPieces,
	PIECE_BOUNDS,
	PIECE_LIST_MIN_TRIANGLES,
	type PiecePlan,
	pieceCount,
	piecesInOrder,
	planGroups,
	planPieces,
} from '@null3d/engine/pieces-planner';
import { MeshoptClusterizer, MeshoptEncoder } from 'meshoptimizer';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { cacheOrder, clusterOrder } from './geometry.js';
import { planLevels, storeLevels } from './levels.js';
import { lodOf, MSFTLod } from './lod-extension.js';
import { NULL3D_PIECES, Null3dPieces, piecesOf, storePieces } from './pieces-extension.js';

/** A rough sphere of `around` by `rings` cells, as positions and indices. */
function roughSphere(around: number, rings: number) {
	const positions: number[] = [];
	const indices: number[] = [];
	for (let r = 0; r <= rings; r++)
		for (let a = 0; a <= around; a++) {
			const polar = (r / rings) * Math.PI;
			const turn = (a / around) * Math.PI * 2;
			const radius = 1 + 0.1 * Math.sin(7 * turn) * Math.sin(5 * polar);
			positions.push(
				radius * Math.sin(polar) * Math.cos(turn),
				radius * Math.cos(polar),
				radius * Math.sin(polar) * Math.sin(turn),
			);
		}
	for (let r = 0; r < rings; r++)
		for (let a = 0; a < around; a++) {
			const p = r * (around + 1) + a;
			const q = p + around + 1;
			indices.push(p, p + 1, q, p + 1, q + 1, q);
		}
	return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * A house of separate quads, as a building kit makes one: four walls and a flat roof and floor,
 * each a grid of `cells` by `cells` quads with corners of their own, and a round pot of `around`
 * sides by four rings, whose triangles face between the walls' ways.
 */
function house(cells: number, around: number) {
	const positions: number[] = [];
	const indices: number[] = [];
	const quad = (corners: number[][]) => {
		const first = positions.length / 3;
		for (const c of corners) positions.push(...(c as [number, number, number]));
		indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
	};
	// Each side: its middle, then the two steps across it, which turn counter-clockwise from outside.
	const sides: [number[], number[], number[]][] = [
		[
			[0, 0, 4],
			[8, 0, 0],
			[0, 6, 0],
		],
		[
			[0, 0, -4],
			[-8, 0, 0],
			[0, 6, 0],
		],
		[
			[4, 0, 0],
			[0, 0, -8],
			[0, 6, 0],
		],
		[
			[-4, 0, 0],
			[0, 0, 8],
			[0, 6, 0],
		],
		[
			[0, 3, 0],
			[8, 0, 0],
			[0, 0, -8],
		],
		[
			[0, -3, 0],
			[8, 0, 0],
			[0, 0, 8],
		],
	];
	for (const [middle, u, v] of sides)
		for (let i = 0; i < cells; i++)
			for (let j = 0; j < cells; j++) {
				const at = (a: number, b: number) =>
					[0, 1, 2].map(
						(k) =>
							(middle[k] as number) +
							(a / cells - 0.5) * (u[k] as number) +
							(b / cells - 0.5) * (v[k] as number),
					);
				quad([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
			}
	const ring = (k: number, t: number) => {
		const radius = 0.3 + 0.1 * Math.sin((k / 4) * Math.PI);
		const turn = (t / around) * Math.PI * 2;
		return [5 + radius * Math.cos(turn), -3 + k * 0.2, 5 - radius * Math.sin(turn)];
	};
	for (let r = 0; r < 4; r++)
		for (let a = 0; a < around; a++)
			quad([ring(r, a), ring(r, a + 1), ring(r + 1, a + 1), ring(r + 1, a)]);
	return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** A corner of a triangle as three numbers. */
const corner = (positions: Float32Array, indices: ArrayLike<number>, t: number, c: number) => {
	const v = (indices[t * 3 + c] as number) * 3;
	return [positions[v] as number, positions[v + 1] as number, positions[v + 2] as number];
};

/** The triangle's facing, not of unit length. */
function facing(positions: Float32Array, indices: ArrayLike<number>, t: number) {
	const [a, b, c] = [0, 1, 2].map((k) => corner(positions, indices, t, k)) as number[][];
	const e1 = [0, 1, 2].map((k) => (b?.[k] as number) - (a?.[k] as number));
	const e2 = [0, 1, 2].map((k) => (c?.[k] as number) - (a?.[k] as number));
	return [
		(e1[1] as number) * (e2[2] as number) - (e1[2] as number) * (e2[1] as number),
		(e1[2] as number) * (e2[0] as number) - (e1[0] as number) * (e2[2] as number),
		(e1[0] as number) * (e2[1] as number) - (e1[1] as number) * (e2[0] as number),
	];
}

/** Checks that each piece's sphere holds its corners and its cone holds its facings. */
function expectBounds(plan: PiecePlan, positions: Float32Array, indices: Uint32Array): number {
	let first = 0;
	let cones = 0;
	plan.counts.forEach((count, k) => {
		const b = plan.bounds.subarray(k * PIECE_BOUNDS, (k + 1) * PIECE_BOUNDS);
		const [x, y, z, r, ax, ay, az, cutoff] = Array.from(b) as number[];
		const axisLength = Math.hypot(ax as number, ay as number, az as number);
		const widest = Math.sqrt(Math.max(0, 1 - (cutoff as number) ** 2));
		if ((cutoff as number) < 1) cones += 1;
		for (let t = first; t < first + count; t++) {
			const triangle = plan.order[t] as number;
			for (let c = 0; c < 3; c++) {
				const [px, py, pz] = corner(positions, indices, triangle, c) as number[];
				const d = Math.hypot(
					(px as number) - (x as number),
					(py as number) - (y as number),
					(pz as number) - (z as number),
				);
				expect(d).toBeLessThanOrEqual(r as number);
			}
			if ((cutoff as number) >= 1) continue;
			const n = facing(positions, indices, triangle);
			const length = Math.hypot(n[0] as number, n[1] as number, n[2] as number);
			if (length === 0) continue;
			const dot =
				((n[0] as number) * (ax as number) +
					(n[1] as number) * (ay as number) +
					(n[2] as number) * (az as number)) /
				(length * axisLength);
			expect(dot).toBeGreaterThanOrEqual(widest - 1e-6);
		}
		first += count;
	});
	return cones;
}

/**
 * Counts the pieces that the cone test culls from eyes all around the list, and checks that every
 * triangle of each such piece faces away from the eye.
 */
function expectConeCulls(plan: PiecePlan, positions: Float32Array, indices: Uint32Array): number {
	let culled = 0;
	for (let e = 0; e < 200; e++) {
		const turn = e * 2.39996;
		const up = 1 - (2 * (e + 0.5)) / 200;
		const ring = Math.sqrt(1 - up * up);
		const distance = 1.5 + (e % 7) * 4;
		const eye = [ring * Math.cos(turn) * distance, up * distance, ring * Math.sin(turn) * distance];
		let first = 0;
		plan.counts.forEach((count, k) => {
			const [x, y, z, r, ax, ay, az, cutoff] = Array.from(
				plan.bounds.subarray(k * PIECE_BOUNDS, (k + 1) * PIECE_BOUNDS),
			) as number[];
			const c = [
				(x as number) - (eye[0] as number),
				(y as number) - (eye[1] as number),
				(z as number) - (eye[2] as number),
			];
			const away =
				(c[0] as number) * (ax as number) +
					(c[1] as number) * (ay as number) +
					(c[2] as number) * (az as number) >=
				((cutoff as number) + 1e-3) * Math.hypot(c[0] as number, c[1] as number, c[2] as number) +
					(r as number);
			if (away) {
				culled += 1;
				for (let t = first; t < first + count; t++) {
					const triangle = plan.order[t] as number;
					const n = facing(positions, indices, triangle);
					const p = corner(positions, indices, triangle, 0);
					const toward =
						((p[0] as number) - (eye[0] as number)) * (n[0] as number) +
						((p[1] as number) - (eye[1] as number)) * (n[1] as number) +
						((p[2] as number) - (eye[2] as number)) * (n[2] as number);
					expect(toward).toBeGreaterThanOrEqual(0);
				}
			}
			first += count;
		});
	}
	return culled;
}

/** A group plan as a plan of pieces over its own list, whose triangles it takes in order. */
const asPlan = (groups: GroupPlan): PiecePlan => ({
	order: Uint32Array.from({ length: groups.indices.length / 3 }, (_, t) => t),
	counts: Uint32Array.from(groups.counts),
	bounds: groups.bounds,
});

/**
 * True when `groups` split each of the pieces of `counts` in turn, with no group that crosses from
 * one piece into the next.
 */
function groupsSplit(groups: ArrayLike<number>, counts: ArrayLike<number>): boolean {
	let g = 0;
	for (let k = 0; k < counts.length; k++) {
		let left = counts[k] as number;
		while (left > 0 && g < groups.length) {
			const size = groups[g++] as number;
			if (size === 0 || size > left) return false;
			left -= size;
		}
		if (left > 0) return false;
	}
	return g === groups.length;
}

/** Each triangle of a list as text, starting at its least corner, which keeps its turn. */
function turnedTriangles(list: ArrayLike<number>): string[] {
	const out: string[] = [];
	for (let t = 0; t < list.length; t += 3) {
		const corners = [list[t], list[t + 1], list[t + 2]] as number[];
		const least = corners.indexOf(Math.min(...corners));
		out.push([0, 1, 2].map((k) => corners[(least + k) % 3]).join(','));
	}
	return out.sort();
}

/** Checks that a plan takes every triangle of a list of `triangles` once. */
function expectEveryTriangle(plan: PiecePlan, triangles: number): void {
	expect(plan.counts.reduce((sum, n) => sum + n, 0)).toBe(triangles);
	expect([...plan.order].sort((a, b) => a - b)).toEqual(
		Array.from({ length: triangles }, (_, t) => t),
	);
}

describe('pieces of a triangle list', () => {
	const { positions, indices } = roughSphere(96, 48);
	const triangles = indices.length / 3;
	const plan = planPieces(positions, indices, 8);

	it('take every triangle once, in runs that add up to the list', () => {
		expect(plan).toBeDefined();
		if (!plan) return;
		expect(plan.counts.length).toBeGreaterThanOrEqual(2);
		expectEveryTriangle(plan, triangles);
	});

	it('give each piece a sphere that holds its corners and a cone that holds its facings', () => {
		if (!plan) throw new Error('no plan');
		expect(expectBounds(plan, positions, indices)).toBeGreaterThan(0);
	});

	it('cull a piece by its cone only where every triangle faces away from the eye', () => {
		// Narrow facing groups, whose cones cull from eyes near the mesh.
		const plan = planPieces(positions, indices, 16);
		if (!plan) throw new Error('no plan');
		expect(expectConeCulls(plan, positions, indices)).toBeGreaterThan(0);
	});

	it('come out the same on every run', () => {
		const again = planPieces(positions, indices, 8);
		expect(again?.order).toEqual(plan?.order);
		expect(again?.bounds).toEqual(plan?.bounds);
	});

	it('leave a small list whole', () => {
		expect(pieceCount(1000)).toBe(0);
	});

	it('follow the large rule for a large list, whatever its copies', () => {
		const listed = listPieces(positions, indices);
		const planned = planPieces(positions, indices, pieceCount(triangles));
		expect(listed?.order).toEqual(planned?.order);
		expect(listed?.bounds).toEqual(planned?.bounds);
		expect(facingPieces(positions, indices)).toBeUndefined();
	});
});

describe('groups of the pieces of a list', () => {
	const { positions, indices } = roughSphere(96, 48);
	const triangles = indices.length / 3;
	const plan = planPieces(positions, indices, 8) as PiecePlan;
	let inPieces = new Uint32Array(0);
	let groups: GroupPlan | undefined;
	beforeAll(async () => {
		await Promise.all([MeshoptEncoder.ready, MeshoptClusterizer.ready]);
		inPieces = piecesInOrder(indices, plan, cacheOrder);
		groups = planGroups(positions, inPieces, plan.counts, clusterOrder);
	});

	it('split each piece into groups of up to the most triangles, and keep each turn', () => {
		expect(triangles).toBeGreaterThanOrEqual(GROUP_LIST_MIN_TRIANGLES);
		const plan2 = groups as GroupPlan;
		expect(plan2).toBeDefined();
		expect(plan2.counts.length).toBeGreaterThanOrEqual(Math.ceil(triangles / GROUP_TRIANGLES));
		expect(Math.max(...plan2.counts)).toBeLessThanOrEqual(GROUP_TRIANGLES);
		expect(groupsSplit(plan2.counts, plan.counts)).toBe(true);
		// Each piece keeps its own triangles, each with the same turn of its corners.
		let first = 0;
		for (const count of plan.counts) {
			const range = [first * 3, (first + count) * 3] as const;
			expect(turnedTriangles(plan2.indices.subarray(...range))).toEqual(
				turnedTriangles(inPieces.subarray(...range)),
			);
			first += count;
		}
	});

	it('give each group a sphere that holds its corners and a cone that holds its facings', () => {
		const plan2 = asPlan(groups as GroupPlan);
		expect(expectBounds(plan2, positions, (groups as GroupPlan).indices)).toBeGreaterThan(0);
		expect(expectConeCulls(plan2, positions, (groups as GroupPlan).indices)).toBeGreaterThan(0);
	});

	it('come out the same on every run', () => {
		const again = planGroups(positions, inPieces, plan.counts, clusterOrder);
		expect(again?.indices).toEqual((groups as GroupPlan).indices);
		expect(again?.counts).toEqual((groups as GroupPlan).counts);
		expect(again?.bounds).toEqual((groups as GroupPlan).bounds);
	});

	it('leave the pieces of a small list without groups', () => {
		const small = roughSphere(32, 16);
		expect(small.indices.length / 3).toBeLessThan(GROUP_LIST_MIN_TRIANGLES);
		const counts = Uint32Array.of(small.indices.length / 3);
		expect(planGroups(small.positions, small.indices, counts, clusterOrder)).toBeUndefined();
	});
});

describe('facing pieces of a smaller list', () => {
	const { positions, indices } = house(9, 24);
	const triangles = indices.length / 3;
	const many = Math.ceil(FACING_DRAWN_MIN_TRIANGLES / triangles);
	const plan = facingPieces(positions, indices);

	it('come to a list under the large floor whose triangles face a few ways', () => {
		expect(triangles).toBeGreaterThanOrEqual(FACING_LIST_MIN_TRIANGLES);
		expect(triangles).toBeLessThan(PIECE_LIST_MIN_TRIANGLES);
		if (!plan) throw new Error('no plan');
		expectEveryTriangle(plan, triangles);
		expect(listPieces(positions, indices)?.order).toEqual(plan.order);
	});

	it("give each of the house's six sides a flat piece, and its pot one more", () => {
		if (!plan) throw new Error('no plan');
		expect(plan.counts.length).toBe(7);
		for (let k = 0; k < 6; k++) {
			expect(plan.counts[k]).toBe(9 * 9 * 2);
			expect(plan.bounds[k * PIECE_BOUNDS + 7]).toBeLessThan(1e-3);
		}
		expect(plan.counts[6]).toBe(4 * 24 * 2);
		expect(coneShare(plan)).toBeGreaterThanOrEqual(FACING_MIN_SHARE);
	});

	it('bound each piece, and cull one by its cone only where its triangles face away', () => {
		if (!plan) throw new Error('no plan');
		expect(expectBounds(plan, positions, indices)).toBeGreaterThanOrEqual(6);
		expect(expectConeCulls(plan, positions, indices)).toBeGreaterThan(0);
	});

	it('come out the same on every run', () => {
		const again = facingPieces(positions, indices);
		expect(again?.order).toEqual(plan?.order);
		expect(again?.bounds).toEqual(plan?.bounds);
	});

	it('pay only where the copies hold enough triangles together', () => {
		expect(facingPiecesPay(triangles, many)).toBe(true);
		expect(facingPiecesPay(triangles, many - 1)).toBe(false);
		expect(facingPiecesPay(FACING_LIST_MIN_TRIANGLES - 1, 1_000_000)).toBe(false);
		expect(facingPiecesPay(PIECE_LIST_MIN_TRIANGLES, 1_000_000)).toBe(false);
	});

	it('leave a list whole that holds too few triangles', () => {
		const small = house(4, 8);
		expect(small.indices.length / 3).toBeLessThan(FACING_LIST_MIN_TRIANGLES);
		expect(facingPieces(small.positions, small.indices)).toBeUndefined();
	});

	it('leave a rough list whole, whose facings fall into no tight groups', () => {
		const rock = roughSphere(48, 24);
		expect(rock.indices.length / 3).toBeGreaterThanOrEqual(FACING_LIST_MIN_TRIANGLES);
		expect(facingPieces(rock.positions, rock.indices)).toBeUndefined();
	});

	it('leave a list whole that faces one way, as a ground does', () => {
		// A bumpy heightfield of 40 by 40 cells: its sides face a few ways, but a view sees its top.
		const positions: number[] = [];
		const ground: number[] = [];
		for (let z = 0; z <= 40; z++)
			for (let x = 0; x <= 40; x++)
				positions.push(x, 0.4 * Math.sin(x * 1.3) * Math.cos(z * 0.9), z);
		for (let z = 0; z < 40; z++)
			for (let x = 0; x < 40; x++) {
				const a = z * 41 + x;
				ground.push(a, a + 41, a + 1, a + 1, a + 41, a + 42);
			}
		expect(ground.length / 3).toBeGreaterThanOrEqual(FACING_LIST_MIN_TRIANGLES);
		expect(facingPieces(new Float32Array(positions), new Uint32Array(ground))).toBeUndefined();
	});

	it('leave a list whole whose material does not let its pieces drop by facing', () => {
		expect(listPieces(positions, indices, false)).toBeUndefined();
	});
});

/** A document of one mesh with a coarser level of its own, which `copies` nodes draw. */
function placedDocument(
	shape: { positions: Float32Array<ArrayBuffer>; indices: Uint32Array<ArrayBuffer> },
	copies: number,
	doubleSided = false,
) {
	const doc = new Document();
	const buffer = doc.createBuffer();
	const material = doc.createMaterial('plaster').setDoubleSided(doubleSided);
	const primitive = (indices: Uint32Array<ArrayBuffer>) =>
		doc
			.createPrimitive()
			.setMaterial(material)
			.setAttribute(
				'POSITION',
				doc.createAccessor().setType('VEC3').setArray(shape.positions).setBuffer(buffer),
			)
			.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
	const prim = primitive(shape.indices);
	const mesh = doc.createMesh('house').addPrimitive(prim);
	const far = doc.createMesh('house-far').addPrimitive(primitive(shape.indices.slice(0, 6 * 128)));
	const lods = doc.createExtension(MSFTLod);
	const scene = doc.createScene();
	for (let k = 0; k < copies; k++) {
		const node = doc
			.createNode(`house-${k}`)
			.setMesh(mesh)
			.setTranslation([k * 20, 0, 0]);
		node.setExtension(
			'MSFT_lod',
			lods.createLod().addLevel(doc.createNode(`house-far-${k}`).setMesh(far)),
		);
		scene.addChild(node);
	}
	return { doc, prim };
}

describe('the pieces step', () => {
	it('gives a smaller mesh facing pieces whatever copies of it the file places', async () => {
		await MeshoptEncoder.ready;
		// A page may place many copies of a mesh that the file holds once, and the engine draws
		// the pieces only once the scene's copies pay for them.
		const once = placedDocument(house(9, 24), 1);
		expect(storePieces(once.doc).lists).toBe(1);
		expect(piecesOf(once.prim)?.getTriangles().length).toBe(7);
		const both = placedDocument(house(9, 24), 1, true);
		expect(storePieces(both.doc).lists).toBe(0);
		expect(piecesOf(both.prim)).toBeNull();
	});

	it(
		'sorts a large mesh and its levels into pieces and groups, and keeps every triangle',
		async () => {
			await Promise.all([MeshoptEncoder.ready, MeshoptClusterizer.ready]);
			// The first level halves the list and still holds enough triangles for pieces.
			const { positions, indices } = roughSphere(256, 160);
			expect(indices.length / 3).toBeGreaterThanOrEqual(2 * PIECE_LIST_MIN_TRIANGLES);
			const doc = new Document();
			const buffer = doc.createBuffer();
			const prim = doc
				.createPrimitive()
				.setAttribute(
					'POSITION',
					doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer),
				)
				.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
			const mesh = doc.createMesh('rock').addPrimitive(prim);
			const node = doc.createNode('rock').setMesh(mesh);
			doc.createScene().addChild(node);
			storeLevels(doc, await planLevels(doc));
			const summary = storePieces(doc);
			expect(summary.lists).toBeGreaterThanOrEqual(2);
			const pieces = piecesOf(prim);
			expect(pieces).not.toBeNull();
			const sorted = Array.from(prim.getIndices()?.getArray() ?? []);
			const key = (list: ArrayLike<number>) => {
				const out: string[] = [];
				for (let t = 0; t < list.length; t += 3)
					out.push(`${list[t]},${list[t + 1]},${list[t + 2]}`);
				return out.sort();
			};
			// Each piece's triangles are ordered for the vertex cache, which may start a triangle at
			// another corner, so the test compares each triangle's turn of corners.
			const turned = (list: ArrayLike<number>) =>
				key(
					Array.from({ length: list.length }, (_, i) => {
						const t = i - (i % 3);
						const corners = [list[t], list[t + 1], list[t + 2]] as number[];
						const least = corners.indexOf(Math.min(...corners));
						return corners[(least + (i % 3)) % 3] as number;
					}),
				);
			expect(turned(sorted)).toEqual(turned(indices));
			expect(pieces?.getTriangles().reduce((sum, n) => sum + n, 0)).toBe(indices.length / 3);
			// The pieces split into groups, which keep within them.
			const groups = pieces?.getGroups()?.getArray() as Uint8Array<ArrayBuffer>;
			expect(summary.groups).toBeGreaterThan(0);
			expect(groups).toBeInstanceOf(Uint8Array);
			expect(groupsSplit(groups, pieces?.getTriangles() ?? [])).toBe(true);
			expect(pieces?.getGroupBounds()?.getCount()).toBe(groups.length * 2);
			const level = lodOf(node)?.listLevels()[0]?.getMesh()?.listPrimitives()[0];
			expect(level && piecesOf(level)).not.toBeNull();
			// The extension survives a write and a read.
			const io = new NodeIO().registerExtensions([MSFTLod, Null3dPieces]);
			const json = await io.writeJSON(doc);
			const written = json.json.meshes?.[0]?.primitives[0]?.extensions?.[NULL3D_PIECES] as
				| {
						triangles: number[];
						bounds: number[];
						groups: number;
						groupBounds: number;
						version: number;
				  }
				| undefined;
			expect(written?.version).toBe(2);
			expect(written?.bounds.length).toBe((written?.triangles.length ?? 0) * PIECE_BOUNDS);
			expect(typeof written?.groups).toBe('number');
			expect(typeof written?.groupBounds).toBe('number');
			const read = await io.readJSON(json);
			const readPrim = read.getRoot().listMeshes()[0]?.listPrimitives()[0];
			const readPieces = readPrim && piecesOf(readPrim);
			expect(readPieces?.getTriangles()).toEqual(pieces?.getTriangles());
			expect(readPieces?.getGroups()?.getArray()).toEqual(groups);
		},
		scaledBudget(60_000),
	);
});
