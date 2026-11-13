// The face a section view lays over a stem cut across, built from the wood's triangles where they
// cross the cut's plane. Each test cuts an eight-sided stem of known size and reads the face back.
import { describe, expect, test } from 'bun:test';
import { cross, type V3 } from '../../../tests/pages/lib/plant-review/anatomy.ts';
import { cutFace } from '../../../tests/pages/lib/plant-review/cut-face.ts';
import { partPositions } from '../../../tests/pages/lib/plant-review/measure.ts';
import type { PlantPart, SpeciesBox } from '../../../tests/pages/lib/plant-review/plant-types.ts';

const BOX: SpeciesBox = { min: [-1, 0, -1], max: [1, 2, 1] } as SpeciesBox;
const SIDES = 8;
const RADIUS = 0.5;
const LENGTH = 2;
/** The bark coordinate a stem's top carries, a metre of bark being 1024 steps along it. */
const TOP_V = 1024 * LENGTH;
/** One step of the box's 16-bit positions, in metres. */
const STEP = 2 / 65535;

/** An upright eight-sided stem as a wood part: its foot ring and its top ring, two triangles a side. */
function stem(): PlantPart {
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const uvs1: number[] = [];
	const colors: number[] = [];
	const quantise = (x: number, k: number) => Math.round(((x - (BOX.min[k] as number)) / 2) * 65535);
	for (const [y, v, bytes] of [
		[0, 0, [1, 2, 3, 4]],
		[LENGTH, TOP_V, [5, 6, 7, 8]],
	] as const)
		for (let i = 0; i < SIDES; i++) {
			const a = (i / SIDES) * 2 * Math.PI;
			const at = [RADIUS * Math.cos(a), y, RADIUS * Math.sin(a)];
			positions.push(...at.map(quantise));
			normals.push(Math.round(Math.cos(a) * 127), 0, Math.round(Math.sin(a) * 127));
			uvs.push(i * 100, v);
			uvs1.push(1000, 0);
			colors.push(...bytes);
		}
	const indices: number[] = [];
	for (let i = 0; i < SIDES; i++) {
		const j = (i + 1) % SIDES;
		indices.push(i, SIDES + i, j, j, SIDES + i, SIDES + j);
	}
	return {
		name: 'wood',
		arrays: {
			positions: new Uint16Array(positions),
			normals: new Int8Array(normals),
			uvs: new Uint16Array(uvs),
			uvs1: new Uint16Array(uvs1),
			colors: new Uint8Array(colors),
			indices: new Uint16Array(indices),
		},
	};
}

/** The face's vertices in metres. */
function points(face: PlantPart): V3[] {
	const metres = partPositions(face, BOX);
	const out: V3[] = [];
	for (let i = 0; i < metres.length; i += 3)
		out.push([metres[i] as number, metres[i + 1] as number, metres[i + 2] as number]);
	return out;
}

describe("a section's cut face", () => {
	const plane = { at: [0, 0.5, 0] as V3, normal: [0, 1, 0] as V3, reach: 0.75 };

	test('fans from the line to every crossing of the skin, flat at the cut', () => {
		const face = cutFace(stem(), BOX, plane) as PlantPart;
		// Each of the eight sides' two triangles crosses the plane once.
		expect(face.arrays.indices.length).toBe(2 * SIDES * 3);
		const at = points(face);
		for (const p of at) expect(Math.abs(p[1] - 0.5)).toBeLessThanOrEqual(STEP);
		for (let t = 0; t < at.length; t += 3) {
			const [middle, first, second] = [at[t], at[t + 1], at[t + 2]] as [V3, V3, V3];
			expect(Math.hypot(middle[0], middle[2])).toBeLessThanOrEqual(STEP);
			// A rim point lies on the skin: at a corner, or across a side's flat between corners.
			for (const rim of [first, second]) {
				const out = Math.hypot(rim[0], rim[2]);
				expect(out).toBeGreaterThan(RADIUS * Math.cos(Math.PI / SIDES) - STEP);
				expect(out).toBeLessThan(RADIUS + STEP);
			}
		}
	});

	test('winds every triangle to face along the cut normal, as the camera above it sees it', () => {
		const face = cutFace(stem(), BOX, plane) as PlantPart;
		const at = points(face);
		for (let t = 0; t < at.length; t += 3) {
			const [a, b, c] = [at[t], at[t + 1], at[t + 2]] as [V3, V3, V3];
			const n = cross(
				[b[0] - a[0], b[1] - a[1], b[2] - a[2]],
				[c[0] - a[0], c[1] - a[1], c[2] - a[2]],
			);
			expect(n[1]).toBeGreaterThan(0);
		}
		for (let v = 0; v < face.arrays.normals.length; v += 3)
			expect([...face.arrays.normals.subarray(v, v + 3)]).toEqual([0, 127, 0]);
	});

	test("carries the skin's bark coordinates and radius where it crosses, and the nearer end's bytes", () => {
		const face = cutFace(stem(), BOX, plane) as PlantPart;
		const { uvs, uvs1, colors } = face.arrays;
		for (let v = 0; v < uvs.length / 2; v++) {
			// A quarter of the way up the stem.
			expect(uvs[v * 2 + 1]).toBe(TOP_V / 4);
			expect(uvs1[v * 2]).toBe(1000);
			expect([...colors.subarray(v * 4, v * 4 + 4)]).toEqual([1, 2, 3, 4]);
		}
	});

	test("leaves out a crossing past the reach of the cut stem's own skin", () => {
		expect(cutFace(stem(), BOX, { ...plane, reach: 0.3 })).toBeUndefined();
	});

	test('gives no face where the plane misses the stem', () => {
		expect(cutFace(stem(), BOX, { ...plane, at: [0, 3, 0] })).toBeUndefined();
	});
});
