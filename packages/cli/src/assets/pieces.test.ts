import { describe, expect, it } from 'bun:test';
import { Document, NodeIO } from '@gltf-transform/core';
import { MeshoptEncoder } from 'meshoptimizer';
import { planLevels, storeLevels } from './levels.js';
import { lodOf, MSFTLod } from './lod-extension.js';
import {
	cacheMisses,
	PIECE_BOUNDS,
	PIECE_LIST_MIN_TRIANGLES,
	pieceCount,
	planPieces,
} from './pieces.js';
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

describe('pieces of a triangle list', () => {
	const { positions, indices } = roughSphere(96, 48);
	const triangles = indices.length / 3;
	const plan = planPieces(positions, indices, 8);

	it('take every triangle once, in runs that add up to the list', () => {
		expect(plan).toBeDefined();
		if (!plan) return;
		expect(plan.counts.length).toBeGreaterThanOrEqual(2);
		expect(plan.counts.reduce((sum, n) => sum + n, 0)).toBe(triangles);
		expect([...plan.order].sort((a, b) => a - b)).toEqual(
			Array.from({ length: triangles }, (_, t) => t),
		);
	});

	it('give each piece a sphere that holds its corners and a cone that holds its facings', () => {
		if (!plan) throw new Error('no plan');
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
		expect(cones).toBeGreaterThan(0);
	});

	it('cull a piece by its cone only where every triangle faces away from the eye', () => {
		// Narrow facing groups, whose cones cull from eyes near the mesh.
		const plan = planPieces(positions, indices, 16);
		if (!plan) throw new Error('no plan');
		let culled = 0;
		for (let e = 0; e < 200; e++) {
			const turn = e * 2.39996;
			const up = 1 - (2 * (e + 0.5)) / 200;
			const ring = Math.sqrt(1 - up * up);
			const distance = 1.5 + (e % 7) * 4;
			const eye = [
				ring * Math.cos(turn) * distance,
				up * distance,
				ring * Math.sin(turn) * distance,
			];
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
		expect(culled).toBeGreaterThan(0);
	});

	it('come out the same on every run', () => {
		const again = planPieces(positions, indices, 8);
		expect(again?.order).toEqual(plan?.order);
		expect(again?.bounds).toEqual(plan?.bounds);
	});

	it('cost more vertex work where they part neighbouring triangles', () => {
		const space = planPieces(positions, indices, 16, 1);
		if (!space) throw new Error('no plan');
		const order = (plan: NonNullable<typeof space>) =>
			Array.from(plan.order).flatMap((t) => [
				indices[t * 3] as number,
				indices[t * 3 + 1] as number,
				indices[t * 3 + 2] as number,
			]);
		// Pieces by space keep neighbouring triangles together, so they repeat little more vertex
		// work than the list in its own order, row by row.
		expect(cacheMisses(order(space))).toBeLessThan(1.2 * cacheMisses(indices));
		expect(cacheMisses([0, 1, 2, 0, 2, 3])).toBe(2);
	});

	it('leave a small list whole', () => {
		expect(pieceCount(1000)).toBe(0);
	});
});

describe('the pieces step', () => {
	it('sorts a large mesh and its levels into pieces, and keeps every triangle', async () => {
		await MeshoptEncoder.ready;
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
			for (let t = 0; t < list.length; t += 3) out.push(`${list[t]},${list[t + 1]},${list[t + 2]}`);
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
		const level = lodOf(node)?.listLevels()[0]?.getMesh()?.listPrimitives()[0];
		expect(level && piecesOf(level)).not.toBeNull();
		// The extension survives a write and a read.
		const io = new NodeIO().registerExtensions([MSFTLod, Null3dPieces]);
		const json = await io.writeJSON(doc);
		const written = json.json.meshes?.[0]?.primitives[0]?.extensions?.[NULL3D_PIECES] as
			| { triangles: number[]; bounds: number[]; version: number }
			| undefined;
		expect(written?.version).toBe(1);
		expect(written?.bounds.length).toBe((written?.triangles.length ?? 0) * PIECE_BOUNDS);
		const read = await io.readJSON(json);
		const readPrim = read.getRoot().listMeshes()[0]?.listPrimitives()[0];
		expect(readPrim && piecesOf(readPrim)?.getTriangles()).toEqual(pieces?.getTriangles());
	}, 60_000);
});
