// The close views' cameras: what each finds as its subject and where it stands. Small skeletons
// built by hand hold the shapes the photographs frame: a stem that divides, a great limb that leaves
// it with another limb in the way on one side, and a limb dividing into two arms.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShootRows } from '../../../packages/vegetation/src/asset.ts';
import {
	AXIS_CULM,
	AXIS_LIMB,
	AXIS_RACHIS,
	AXIS_ROOT,
	AXIS_STEM,
	BUD_FLOWER,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../../../packages/vegetation/src/core/graph.ts';
import {
	firstForkHeight,
	flowerSites,
	sheathColumn,
	stemAt,
	stemSurfaceAt,
	type V3,
} from '../../../tests/pages/lib/plant-review/anatomy.ts';
import { departures, forks, walkedRound } from '../../../tests/pages/lib/plant-review/close.ts';
import { spanDistance } from '../../../tests/pages/lib/plant-review/framing.ts';
import {
	clutterOf,
	plantSpheres,
	type Spheres,
	sharedRecords,
} from '../../../tests/pages/lib/plant-review/sight.ts';
import { closeFraming } from './compare.ts';

/** No shoot rows, for a plant drawn as its wood alone. */
const NO_ROWS: ShootRows = {
	count: 0,
	prototype: new Uint8Array(0),
	position: new Float32Array(0),
	rotation: new Float32Array(0),
	scale: new Float32Array(0),
	record: new Uint16Array(0),
	phase: new Uint8Array(0),
	sky: new Uint8Array(0),
	bent: new Uint8Array(0),
	order: new Uint32Array(0),
};

/** A straight run of nodes on an axis from `from`, `count` steps of `step`, its radius tapering. */
function run(
	b: SkeletonBuilder,
	axis: number,
	parent: number,
	from: readonly number[],
	step: readonly number[],
	count: number,
	radius: number,
	taper: number,
): number[] {
	const nodes: number[] = [];
	let previous = parent;
	for (let k = 0; k < count; k++) {
		previous = b.addNode({
			x: (from[0] as number) + (step[0] as number) * k,
			y: (from[1] as number) + (step[1] as number) * k,
			z: (from[2] as number) + (step[2] as number) * k,
			radius: radius * (1 - taper * (k / Math.max(1, count - 1))),
			parent: previous,
			axis,
		});
		nodes.push(previous);
	}
	return nodes;
}

/**
 * A stem 5 m tall that runs on as a leader, with a huge limb leaving it nearly level toward +X at
 * its top, a thin limb toward -X, and a lesser limb that stands across the huge limb's +Z side, so
 * the huge limb is seen clear from -Z only. The huge limb divides twice further out: into two arms
 * that part in the level plane, then into two that part in an upright plane.
 */
function oakLike(): MacroSkeleton {
	const b = new SkeletonBuilder();
	const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const trunk = run(b, stem, -1, [0, 0, 0], [0, 1, 0], 6, 0.8, 0.3);
	const top = trunk[5] as number;
	const leader = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
	run(b, leader, top, [0, 6, 0], [0, 1, 0], 8, 0.5, 0.8);
	const huge = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
	const limb = run(b, huge, top, [1, 5.2, 0], [1, 0.1, 0], 9, 0.45, 0.5);
	const thin = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
	run(b, thin, top, [-1, 5.4, 0], [-1, 0.3, 0], 4, 0.1, 0.5);
	// A lesser limb that leaves the stem toward +Z and runs across the huge limb's near side.
	const blocker = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
	run(b, blocker, top, [0.3, 5.3, 1.2], [0.6, 0, 0.5], 8, 0.2, 0.5);
	// The huge limb divides into two arms of nearly its girth, parting in the level plane.
	const fork = limb[5] as number;
	const arm = b.addAxis({ parent: huge, parentNode: fork, order: 2, kind: AXIS_LIMB });
	run(b, arm, fork, [6.7, 5.7, -0.7], [0.7, 0.05, -0.7], 4, 0.2, 0.5);
	// Further out it divides again, an arm rising from it in the upright plane it runs in.
	const upper = limb[7] as number;
	const rising = b.addAxis({ parent: huge, parentNode: upper, order: 2, kind: AXIS_LIMB });
	run(b, rising, upper, [8.3, 6.5, 0], [0.4, 0.8, 0], 3, 0.17, 0.5);
	return b.finish(1);
}

describe('a part of a piece framed at its own span', () => {
	test('stands back far enough that the span fills the frame across it', () => {
		// A square frame of 40 degrees shows a span equal to twice the distance times the tangent.
		expect(spanDistance(0.5, 40, 1)).toBeCloseTo(0.25 / Math.tan((20 * Math.PI) / 180), 6);
		// A taller frame is narrower across, so the camera stands further back for the same span.
		expect(spanDistance(0.5, 40, 0.75)).toBeGreaterThan(spanDistance(0.5, 40, 1));
	});
});

describe('the flower sites', () => {
	test('finds the flowers and the ring they make, and none where the plant carries none', () => {
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const nodes = run(b, stem, -1, [0, 0, 0], [0, 0.4, 0], 6, 0.2, 0.3);
		const node = nodes[nodes.length - 1] as number;
		for (const [x, z] of [
			[0.3, 0],
			[-0.3, 0],
			[0, 0.3],
			[0, -0.3],
		])
			b.addBud({
				node,
				x: x as number,
				y: 2.4,
				z: z as number,
				frame: [0, 0, 0, 1],
				kind: BUD_FLOWER,
				vigor: 0.5,
				light: 1,
				axis: stem,
				woodRadius: 0.2,
			});
		const ring = flowerSites(b.finish(0));
		expect(ring?.sites.length).toBe(4);
		expect(ring?.radius as number).toBeCloseTo(0.3, 5);
		expect(ring?.centre[1] as number).toBeCloseTo(2.4, 5);
		// A plant with no flower site has no ring.
		const bare = new SkeletonBuilder();
		bare.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		expect(flowerSites(bare.finish(0))).toBeUndefined();
	});
});

describe('the limbs that leave the stem', () => {
	const skeleton = oakLike();

	test('leave out the limb that carries the stem on, and list the rest thickest first', () => {
		const { limbs, leader } = departures(skeleton);
		expect(leader?.axis).toBe(1);
		expect(limbs.map((d) => d.axis)).toEqual([2, 4, 3]);
		expect(limbs[0]?.angle).toBeGreaterThan(75);
	});
});

describe('a limb dividing into two', () => {
	const skeleton = oakLike();

	test('is a child of a limb with at least half its girth, not a twig leaving it', () => {
		const found = forks(skeleton);
		expect(found.map((f) => f.arm)).toEqual([5, 6]);
		for (const f of found) expect(f.armRadius).toBeGreaterThan(0.5 * f.radius);
	});
});

describe("the stem's first division", () => {
	test('stands where a limb of a share of the stem leaves, not where a thin shoot leaves low', () => {
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const trunk = run(b, stem, -1, [0, 0, 0], [0, 1, 0], 6, 0.8, 0.3);
		const shoot = b.addAxis({
			parent: stem,
			parentNode: trunk[2] as number,
			order: 1,
			kind: AXIS_LIMB,
		});
		run(b, shoot, trunk[2] as number, [0.5, 2.2, 0], [0.5, 0.3, 0], 3, 0.05, 0.5);
		const limb = b.addAxis({
			parent: stem,
			parentNode: trunk[4] as number,
			order: 1,
			kind: AXIS_LIMB,
		});
		run(b, limb, trunk[4] as number, [0.8, 4.3, 0], [0.7, 0.5, 0], 6, 0.4, 0.5);
		expect(firstForkHeight(b.finish(1))).toBe(4);
	});
});

describe("the wind records that name a shoot's axis", () => {
	test('count the records several axes share, which name no axis', () => {
		const skeleton = oakLike();
		const records = skeleton.axes.record as unknown as Uint16Array;
		records[3] = records[2] as number;
		expect(sharedRecords(skeleton)).toBe(1);
		expect(sharedRecords(oakLike())).toBe(0);
	});
});

describe('the framing a close view reports', () => {
	test('is its subject and how much of the frame the rest of the plant covers', () => {
		expect(
			closeFraming({
				subject: { kind: 'a fork', clutter: { front: 0.12345, behind: 0.2, subject: 0.5 } },
			}),
		).toEqual({ subject: 'a fork', front: 0.123, behind: 0.2, fill: 0.5 });
		expect(closeFraming({ subject: { kind: 'the stem' } })).toEqual({
			subject: 'the stem',
			front: null,
			behind: null,
			fill: null,
		});
		expect(closeFraming({ notes: [] })).toBeUndefined();
	});

	test('carries the warning of a view that drew a plain camera in place of its subject', () => {
		const warning = 'the plant has no part for the fork view';
		expect(closeFraming({ subject: { kind: 'the whole plant', warning } })).toEqual({
			subject: 'the whole plant',
			front: null,
			behind: null,
			fill: null,
			warning,
		});
	});
});

describe("the plant's types the cameras read", () => {
	test('come from the plant core as types alone, so no engine code loads with the cameras', () => {
		const file = join(import.meta.dir, '../../../tests/pages/lib/plant-review/plant-types.ts');
		const lines = readFileSync(file, 'utf8')
			.split('\n')
			.filter((line) => line.trim() !== '' && !line.startsWith('//'));
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) expect(line).toMatch(/^export type \{[^}]+\} from '[^']+';$/);
	});
});

describe('the clutter of a frame', () => {
	const spheres = (
		list: readonly (readonly [number, number, number, number, number])[],
	): Spheres => ({
		data: new Float32Array(list.flatMap((s) => s.slice(0, 4))),
		axis: new Int32Array(list.map((s) => s[4])),
		row: new Int32Array(list.map(() => -1)),
		count: list.length,
	});
	const shot = {
		position: [0, 1, 10] as [number, number, number],
		target: [0, 1, 0] as [number, number, number],
	};
	const subject = new Uint8Array([1, 0]);

	test('counts the subject, what stands in front of it and what stands behind it apart', () => {
		const frame = spheres([
			[0, 1, 0, 1, 0],
			[1, 1, 5, 0.5, 1],
			[-3, 1, -10, 2, 1],
		]);
		const clutter = clutterOf(frame, shot, 40, 1, { axes: subject, band: 2 });
		expect(clutter.subject).toBeGreaterThan(0.05);
		expect(clutter.front).toBeGreaterThan(0.01);
		expect(clutter.behind).toBeGreaterThan(0.01);
		expect(clutter.inside).toBe(false);
	});

	test('counts a part of the subject that comes near the lens as standing in front', () => {
		const clutter = clutterOf(spheres([[0, 1, 6, 0.5, 0]]), shot, 40, 1, {
			axes: subject,
			band: 2,
		});
		expect(clutter.subject).toBe(0);
		expect(clutter.front).toBeGreaterThan(0);
	});

	test('reads the same when it passes over runs of spheres wholly outside the frame', () => {
		const skeleton = oakLike();
		const { bounds, ...plain } = plantSpheres(skeleton, NO_ROWS, [], [0, 5, 0], 2);
		expect(bounds).toBeDefined();
		const laid = { ...plain, ...(bounds && { bounds }) };
		const mark = { axes: new Uint8Array(skeleton.axes.count).fill(0), band: 3 };
		mark.axes[2] = 1;
		// Cameras on a lattice through and round the plant, each looking at points across it.
		let seed = 7;
		const next = () => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		for (let x = -9; x <= 9; x += 3)
			for (let y = 0.5; y <= 9; y += 2.5)
				for (let z = -9; z <= 9; z += 3) {
					const shot = {
						position: [x, y, z] as V3,
						target: [next() * 12 - 4, next() * 9, next() * 8 - 4] as V3,
					};
					expect(clutterOf(laid, shot, 45, 1.3, mark)).toEqual(
						clutterOf(plain, shot, 45, 1.3, mark),
					);
				}
		// A camera inside the stem still knows it stands inside the plant.
		const within = { position: [0, 2, 0.1] as V3, target: [3, 2, 3] as V3 };
		expect(clutterOf(laid, within, 45, 1.3, mark).inside).toBe(true);
	});

	test('knows a camera that stands inside the plant', () => {
		const clutter = clutterOf(spheres([[0, 1, 10, 0.5, 1]]), shot, 40, 1, {
			axes: subject,
			band: 2,
		});
		expect(clutter.inside).toBe(true);
	});
});

describe('the stem surface of a plant with no single trunk', () => {
	const b = new SkeletonBuilder();
	// A crown a few centimetres across, with two culms rising from it past the sampled height.
	const crown = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const crownBase = b.addNode({ x: 0, y: -0.03, z: 0, radius: 0.045, parent: -1, axis: crown });
	const crownTop = b.addNode({ x: 0, y: 0, z: 0, radius: 0.045, parent: crownBase, axis: crown });
	for (const [x, z, radius] of [
		[0.02, 0, 0.0018],
		[-0.02, 0.01, 0.0014],
	] as const) {
		const culm = b.addAxis({ parent: crown, parentNode: crownTop, order: 1, kind: AXIS_LIMB });
		run(b, culm, crownTop, [x, 0, z], [0, 0.05, 0], 10, radius, 0.3);
	}
	const skeleton = b.finish(0);

	test('the main stem does not reach the height the picture samples', () => {
		expect(stemAt(skeleton, 0.16)).toBeUndefined();
	});

	test('the thickest culm crossing that height is the surface', () => {
		const found = stemSurfaceAt(skeleton, 0.16);
		expect(found?.at.at[1]).toBeCloseTo(0.16, 6);
		expect(found?.at.radius).toBeCloseTo(0.001608, 6);
	});

	test('no axis reaches a height above the plant', () => {
		expect(stemSurfaceAt(skeleton, 2)).toBeUndefined();
	});
});

describe('the sheath column of a ground plant', () => {
	test('takes the thickest short limb, not a blade or a flowering stem', () => {
		const b = new SkeletonBuilder();
		const crown = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_ROOT });
		const crownBase = b.addNode({ x: 0, y: -0.03, z: 0, radius: 0.05, parent: -1, axis: crown });
		const crownTop = b.addNode({ x: 0, y: 0, z: 0, radius: 0.05, parent: crownBase, axis: crown });
		const thick = b.addAxis({ parent: crown, parentNode: crownTop, order: 1, kind: AXIS_LIMB });
		const thickNodes = run(b, thick, crownTop, [0.01, 0, 0], [0, 0.02, 0], 3, 0.0018, 0.2);
		const thin = b.addAxis({ parent: crown, parentNode: crownTop, order: 1, kind: AXIS_LIMB });
		run(b, thin, crownTop, [-0.01, 0, 0], [0, 0.02, 0], 3, 0.0009, 0.2);
		// A flowering stem and a blade both rise past the sheaths; neither is the sheath column.
		const culm = b.addAxis({
			parent: thick,
			parentNode: thickNodes[thickNodes.length - 1] as number,
			order: 2,
			kind: AXIS_CULM,
		});
		run(
			b,
			culm,
			thickNodes[thickNodes.length - 1] as number,
			[0.01, 0.06, 0],
			[0, 0.1, 0],
			5,
			0.0008,
			0.3,
		);
		const blade = b.addAxis({
			parent: thick,
			parentNode: thickNodes[0] as number,
			order: 2,
			kind: AXIS_RACHIS,
		});
		run(b, blade, thickNodes[0] as number, [0.01, 0.02, 0], [0.02, 0.1, 0], 4, 0.003, 0.5);
		expect(sheathColumn(b.finish(0))).toBe(thick);
	});

	test('finds none on a plant with a trunk', () => {
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		run(b, stem, -1, [0, 0, 0], [0, 1, 0], 6, 0.2, 0.3);
		expect(sheathColumn(b.finish(0))).toBe(-1);
	});
});

describe('a sheet of turns of a close view', () => {
	test('walks round the subject at the same distance and height', () => {
		const view = {
			position: [3, 2, 4] as [number, number, number],
			target: [0, 1, 0] as [number, number, number],
			subject: {},
		};
		const walked = walkedRound(view, Math.PI / 2);
		expect(walked.target).toEqual(view.target);
		expect(walked.position[1]).toBeCloseTo(2, 6);
		expect(Math.hypot(walked.position[0], walked.position[2])).toBeCloseTo(5, 6);
	});
});
