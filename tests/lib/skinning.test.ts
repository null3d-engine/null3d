import { describe, expect, it } from 'bun:test';
import {
	type CharacterMesh,
	cameraView,
	characterMesh,
	compareImages,
	cullCharacters,
	fitCascades,
	frameSaving,
	indexRanges,
	JOINT_FLOATS,
	type PathTiming,
	placeOf,
	poseCharacters,
	SKINNING,
	type SkinningResult,
	skinningProblems,
	sliceCorners,
	sphereInside,
	splitDistances,
} from '../pages/lib/skinning.ts';
import { judge, NONE_MISSING, PLANS, skinningPlan, skinningSummary } from './plans.ts';
import type { ItemResult } from './runs.ts';

const ASPECT = SKINNING.size[0] / SKINNING.size[1];

/** Skins vertex `v` of `mesh` with character `c`'s joint matrices, as the shaders do. */
function skin(mesh: CharacterMesh, joints: Float32Array, c: number, v: number): number[] {
	const out = [0, 0, 0];
	const p = [...mesh.positions.subarray(v * 3, v * 3 + 3), 1];
	for (let k = 0; k < 4; k++) {
		const base = (c * SKINNING.joints + mesh.joints[v * 4 + k]!) * JOINT_FLOATS;
		const w = mesh.weights[v * 4 + k]!;
		for (let row = 0; row < 3; row++)
			for (let col = 0; col < 4; col++) out[row]! += w * joints[base + row * 4 + col]! * p[col]!;
	}
	return out;
}

describe('the skinning scene', () => {
	const mesh = characterMesh();

	it('gives every vertex four joint weights that add up to 1', () => {
		expect(mesh.vertexCount).toBe(SKINNING.rings * SKINNING.segments);
		for (let v = 0; v < mesh.vertexCount; v++) {
			const weights = mesh.weights.subarray(v * 4, v * 4 + 4);
			expect(weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1, 6);
			for (const joint of mesh.joints.subarray(v * 4, v * 4 + 4))
				expect(joint).toBeLessThan(SKINNING.joints);
		}
		expect(Math.max(...mesh.indices)).toBe(mesh.vertexCount - 1);
	});

	it('poses each joint as a rigid turn, one segment up the chain from its parent', () => {
		const count = 4;
		const joints = new Float32Array(count * SKINNING.joints * JOINT_FLOATS);
		poseCharacters(joints, count, 0.8);
		const segment = SKINNING.height / (SKINNING.joints - 1);
		for (let c = 0; c < count; c++) {
			let parent: number[] | null = null;
			for (let j = 0; j < SKINNING.joints; j++) {
				const base = (c * SKINNING.joints + j) * JOINT_FLOATS;
				const row = (r: number) => [...joints.subarray(base + r * 4, base + r * 4 + 3)];
				for (let a = 0; a < 3; a++)
					for (let b = 0; b < 3; b++) {
						const dot = row(a).reduce((sum, x, i) => sum + x * row(b)[i]!, 0);
						expect(dot).toBeCloseTo(a === b ? 1 : 0, 5);
					}
				// The joint sits where its matrix takes its rest position.
				const rest = j * segment;
				const at = [0, 1, 2].map(
					(r) => joints[base + r * 4 + 1]! * rest + joints[base + r * 4 + 3]!,
				);
				if (j === 0) expect([at[0], at[2]]).toEqual([placeOf(c, count)[0]!, placeOf(c, count)[1]!]);
				if (parent)
					expect(Math.hypot(...at.map((x, i) => x - parent![i]!))).toBeCloseTo(segment, 5);
				parent = at;
			}
		}
	});

	it('keeps a bent character inside its bounding sphere', () => {
		const joints = new Float32Array(SKINNING.joints * JOINT_FLOATS);
		for (const time of [0, 0.4, 1.3, 2.9]) {
			poseCharacters(joints, 1, time);
			for (let v = 0; v < mesh.vertexCount; v += 7) {
				const [x = 0, y = 0, z = 0] = skin(mesh, joints, 0, v);
				expect(Math.hypot(x, y - SKINNING.height / 2, z)).toBeLessThan(SKINNING.boundRadius);
			}
		}
	});

	it('splits the shadow distance into cascades that each hold their slice of the view', () => {
		for (const count of [1, 2, 3, 4]) {
			const ends = splitDistances(count);
			expect(ends.at(-1)).toBeCloseTo(SKINNING.shadowDistance, 6);
			expect([...ends].sort((a, b) => a - b)).toEqual(ends);
			const cascades = fitCascades(count, ASPECT);
			let start: number = SKINNING.near;
			for (const cascade of cascades) {
				for (const p of [...sliceCorners(start, ASPECT), ...sliceCorners(cascade.end, ASPECT)]) {
					// Inside the box, less a sliver for rounding: no plane has the corner past it.
					const past = cascade.planes.filter(
						(plane) => plane[0] * p[0] + plane[1] * p[1] + plane[2] * p[2] + plane[3] < -1e-6,
					);
					expect(past).toEqual([]);
					// The box's matrix takes the corner into clip space, within -1 to 1 on each axis.
					const m = cascade.viewProj;
					for (let row = 0; row < 3; row++) {
						const clip = m[row]! * p[0] + m[4 + row]! * p[1] + m[8 + row]! * p[2] + m[12 + row]!;
						expect(Math.abs(clip)).toBeLessThanOrEqual(1 + 1e-5);
					}
				}
				start = cascade.end;
			}
		}
	});

	it("culls the crowd to each view's planes", () => {
		const view = cameraView(ASPECT);
		expect(sphereInside(view.planes, 0, 1, 0)).toBe(true);
		const behind = view.eye.map((v, i) => v - 10 * view.forward[i]!);
		expect(sphereInside(view.planes, behind[0]!, behind[1]!, behind[2]!)).toBe(false);
		const list = new Uint32Array(600);
		const drawn = cullCharacters(view, 500, list, 100);
		expect(drawn).toBeGreaterThan(100);
		expect(drawn).toBeLessThanOrEqual(500);
		const ids = [...list.subarray(100, 100 + drawn)];
		expect([...ids].sort((a, b) => a - b)).toEqual(ids);
		// The farthest cascade holds some of the crowd, and the nearest one fewer.
		const cascades = fitCascades(4, ASPECT);
		const counts = cascades.map((cascade) => cullCharacters(cascade, 500, list, 0));
		expect(counts.at(-1)).toBeGreaterThan(0);
		expect(counts[0]).toBeLessThan(counts.at(-1)!);
	});

	it('draws consecutive slots of skinned characters in one range of indices', () => {
		const ids = new Uint32Array([9, 9, 1, 2, 3, 7, 8, 0]);
		const slotOf = new Int32Array(10).fill(-1);
		for (const [slot, c] of [1, 2, 3, 5, 7, 8].entries()) slotOf[c] = slot;
		const counts = new Int32Array(8);
		const offsets = new Int32Array(8);
		// From the third id on: characters 1, 2, 3 take slots 0 to 2, and 7, 8 slots 4 and 5.
		const ranges = indexRanges(ids, 2, 5, slotOf, 10, counts, offsets);
		expect(ranges).toBe(2);
		expect([...counts.subarray(0, 2)]).toEqual([30, 20]);
		expect([...offsets.subarray(0, 2)]).toEqual([0, 4 * 10 * 4]);
	});

	it('counts the pixels where two images differ by more than the threshold', () => {
		const a = new Uint8Array([10, 10, 10, 255, 10, 10, 10, 255, 0, 0, 0, 255]);
		const b = new Uint8Array([12, 10, 10, 255, 20, 10, 10, 255, 0, 0, 0, 255]);
		expect(compareImages(a, b)).toEqual({ differing: 1, pixels: 3, largest: 10 });
	});
});

const timing = (frameMs: number): PathTiming => ({
	frameMs,
	frameMsQuartiles: [frameMs * 0.9, frameMs * 1.1],
	cpuMs: 1.25,
	gpuMs: null,
	batchFrames: 4,
	batches: 12,
	skinnedVertices: 1000,
});

const result = (overrides: Partial<SkinningResult> = {}): ItemResult & SkinningResult => ({
	ok: true,
	characters: 100,
	cascades: 3,
	size: SKINNING.size,
	vertices: 2560,
	joints: SKINNING.joints,
	multiDraw: true,
	gpuTimer: false,
	drawn: [90, 10, 30, 60],
	skinned: 95,
	image: { differing: 3, pixels: 921_600, largest: 4 },
	paths: { 'vertex-shader': timing(20), 'transform-feedback': timing(16) },
	...overrides,
});

describe('the skinning plan', () => {
	const items = skinningPlan();

	it('runs the skinning page at each crowd size and cascade count, on WebGL2', () => {
		expect(PLANS.skinning).toBe(skinningPlan);
		expect(items).toHaveLength(16);
		expect(items[0]).toMatchObject({
			id: 'skinning-50-1',
			path: '/tests/pages/skinning.html?characters=50&cascades=1',
			check: { kind: 'skinning', tier: 'webgl2', characters: 50, cascades: 1 },
		});
		expect(items.at(-1)?.id).toBe('skinning-500-4');
	});

	it('fails a page whose two paths drew different images, or that timed nothing', () => {
		const check = items[0]!.check;
		expect(frameSaving(result())).toBeCloseTo(0.2, 6);
		expect(judge(check, result(), NONE_MISSING)).toEqual([]);
		const different = result({ image: { differing: 5000, pixels: 921_600, largest: 80 } });
		expect(judge(check, different, NONE_MISSING)).toEqual([
			'the two paths drew different images: 5000 of 921600 pixels differ, by up to 80 levels',
		]);
		const untimed = result({
			paths: { 'vertex-shader': timing(0), 'transform-feedback': timing(16) },
		});
		expect(skinningProblems(untimed)).toEqual(['the vertex-shader path measured no frame time']);
		// A browser without WebGL2 skips the page where the run allows it.
		const missing = { ok: false, error: 'no WebGL2 context' };
		expect(judge(check, missing, { webgpu: false, webgl2: true })).toBe('skip');
	});

	it("tables each page's frame times and the share that transform feedback saves", () => {
		const table = skinningSummary(items.slice(0, 2), (id) =>
			id === 'skinning-50-1' ? result() : undefined,
		);
		expect(table?.split('\n').slice(2)).toEqual([
			'| Characters | Cascades | Drawn | Vertex shader | Transform feedback | Saved | Pixels that differ | Multi-draw |',
			'| --- | --- | --- | --- | --- | --- | --- | --- |',
			'| 50 | 1 | 90 / 10 / 30 / 60 (95) | 20.00 / 1.25 / - | 16.00 / 1.25 / - | 20.0% | 3 of 921600 | yes |',
			'| 50 | 2 | no result; the runner stopped before this page | | | | | |',
		]);
		expect(skinningSummary(PLANS.checks!(), () => undefined)).toBeUndefined();
	});
});
