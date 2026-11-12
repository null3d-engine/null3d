// The close views' cameras: what each finds as its subject and where it stands. Small skeletons
// built by hand hold the shapes the photographs frame: a stem that divides, a great limb that leaves
// it with another limb in the way on one side, and a limb dividing into two arms.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShootRows } from '../../../packages/vegetation/src/asset.ts';
import {
	AXIS_LIMB,
	AXIS_ROOT,
	AXIS_STEM,
	BUD_FLOWER,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../../../packages/vegetation/src/core/graph.ts';
import {
	dot,
	firstForkHeight,
	flowerSites,
	normalize,
	stemAt,
	stemSurfaceAt,
	turnedAbout,
	type V3,
} from '../../../tests/pages/lib/plant-review/anatomy.ts';
import {
	barkLimbView,
	belowView,
	departures,
	forks,
	forkView,
	insideView,
	junctionCandidates,
	junctionFrameHeight,
	junctionView,
	surfaceView,
	trunkView,
	walkedRound,
} from '../../../tests/pages/lib/plant-review/close.ts';
import { rowAngle, spanDistance } from '../../../tests/pages/lib/plant-review/framing.ts';
import {
	clutterOf,
	lensAxes,
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

describe('the view up the stem', () => {
	const skeleton = oakLike();
	const plant = { skeleton, shoots: NO_ROWS, prototypes: [] };
	const lens = { fov: 70, aspect: 1.5 };

	test('stands at eye height a step back from the bark, on the side the turn faces', () => {
		const view = belowView(plant, 0, lens, { elevation: 70 });
		expect(view.position[1]).toBeCloseTo(1.6, 6);
		const reach = Math.hypot(view.position[0], view.position[2]);
		// Outside the bark at eye height, by the step back.
		expect(reach).toBeGreaterThan(0.6);
		expect(reach).toBeLessThan(0.8 + 1.01);
		expect(view.position[2]).toBeGreaterThan(0);
		expect(view.subject.pitch).toBe(70);
	});

	test('drops its lens into a plant shorter than a person, so the crown stands above it', () => {
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		run(b, stem, -1, [0, 0, 0], [0, 0.1, 0], 11, 0.02, 0.3);
		const short = { skeleton: b.finish(1), shoots: NO_ROWS, prototypes: [] };
		expect(short.skeleton.height).toBeCloseTo(1, 6);
		const view = belowView(short, 0, lens, { elevation: 70 });
		// A third of the way up the plant, and still above the ground.
		expect(view.position[1]).toBeCloseTo(0.35, 6);
		expect(view.subject.pitch).toBe(70);
	});

	test('pitches up until the bark where the stem divides lands on the asked row', () => {
		const forkRow = 0.4;
		const view = belowView(plant, 0, lens, { elevation: 85, forkRow });
		const pitch = view.subject.pitch as number;
		expect(pitch).toBeLessThan(85);
		// The near bark at the fork's height, seen from the camera, lands on the asked row.
		const fork = view.subject.fork as number;
		const near = Math.hypot(view.position[0], view.position[2]) - 0.56;
		const angle = Math.atan2(fork - 1.6, near) - (pitch * Math.PI) / 180;
		expect(angle).toBeCloseTo(rowAngle(forkRow, lens.fov), 1);
	});

	test("stands back until the ground at the bark and the crown's base land on the asked rows", () => {
		const wide = { fov: 75, aspect: 1 };
		// A crown whose foliage starts at 4.5 m, where the limbs leave the bole.
		const crowned = { skeleton: { ...skeleton, crownBase: 4.5 }, shoots: NO_ROWS, prototypes: [] };
		const view = belowView(crowned, 0, wide, { elevation: 70, crownRow: 0.09, footRow: 0.96 });
		expect(view.position[1]).toBeCloseTo(1.6, 6);
		const base = view.subject.crownBase as number;
		expect(base).toBe(4.5);
		const bark =
			Math.hypot(view.position[0], view.position[2]) - (view.subject.stemRadius as number);
		const pitch = ((view.subject.pitch as number) * Math.PI) / 180;
		const row = (height: number) =>
			0.5 -
			Math.tan(Math.atan2(height - 1.6, bark) - pitch) / (2 * Math.tan((37.5 * Math.PI) / 180));
		expect(row(0)).toBeCloseTo(0.96, 6);
		expect(row(base)).toBeCloseTo(0.09, 6);
	});

	test("takes the plain view up the stem, and says so, where the crown's base stands low", () => {
		const low = { skeleton: { ...skeleton, crownBase: 0.4 }, shoots: NO_ROWS, prototypes: [] };
		const view = belowView(
			low,
			0,
			{ fov: 75, aspect: 1 },
			{ elevation: 70, crownRow: 0.09, footRow: 0.96 },
		);
		expect(view.subject.warning).toContain("crown's base");
		expect(view.subject.crownBase).toBeUndefined();
		expect(view.position[1]).toBeCloseTo(1.6, 6);
		expect(view.subject.pitch).toBe(70);
		const swapped = belowView(
			{ skeleton: { ...skeleton, crownBase: 4.5 }, shoots: NO_ROWS, prototypes: [] },
			0,
			{ fov: 75, aspect: 1 },
			{ elevation: 70, crownRow: 0.96, footRow: 0.09 },
		);
		expect(swapped.subject.warning).toContain("crown's row");
		expect(Math.hypot(swapped.position[0], swapped.position[2])).toBeLessThan(5);
		const near = belowView(
			{ skeleton: { ...skeleton, crownBase: 4.5 }, shoots: NO_ROWS, prototypes: [] },
			0,
			{ fov: 75, aspect: 1 },
			{ elevation: 70, crownRow: 0.49, footRow: 0.5 },
		);
		expect(near.subject.warning).toContain("crown's row");
		expect(Math.hypot(near.position[0], near.position[2])).toBeLessThan(5);
	});

	test("stands low at a stemless plant's rim and looks up through its leaves", () => {
		const b = new SkeletonBuilder();
		const crown = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_ROOT });
		const foot = b.addNode({ x: 0, y: 0, z: 0, radius: 0.11, parent: -1, axis: crown });
		const top = b.addNode({ x: 0, y: 0.03, z: 0, radius: 0.11, parent: foot, axis: crown });
		const shoot = b.addAxis({ parent: crown, parentNode: top, order: 1, kind: AXIS_LIMB });
		run(b, shoot, top, [0.2, 0, 0], [0.2, 0.28, 0], 6, 0.02, 0.5);
		const skeleton = b.finish(1);
		const view = belowView({ skeleton, shoots: NO_ROWS, prototypes: [] }, 0, lens, {
			elevation: 70,
		});
		expect(view.position[1]).toBeLessThan(0.6);
		expect(Math.hypot(view.position[0], view.position[2])).toBeGreaterThan(0.5);
		expect(view.subject.kind).toBe('the plant from its foot');
		expect(view.subject.pitch).toBe(70);
	});

	test("stands as far from the stem's axis as the photograph, in stem radii", () => {
		const view = belowView(plant, 0, lens, { elevation: 70, stand: 3.3 });
		const radius = view.subject.stemRadius as number;
		expect(Math.hypot(view.position[0], view.position[2])).toBeCloseTo(3.3 * radius, 6);
	});

	test('walks round the stem to a stand clear of a low branch', () => {
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const trunk = run(b, stem, -1, [0, 0, 0], [0, 1, 0], 6, 0.8, 0.3);
		// A low branch at eye height, running out across the stand on the +Z side.
		const low = b.addAxis({
			parent: stem,
			parentNode: trunk[1] as number,
			order: 1,
			kind: AXIS_LIMB,
		});
		run(b, low, trunk[1] as number, [-1, 1.6, 1.7], [0.5, 0, 0], 5, 0.15, 0.2);
		const view = belowView({ skeleton: b.finish(1), shoots: NO_ROWS, prototypes: [] }, 0, lens, {
			elevation: 70,
		});
		expect(view.subject.walked).not.toBe(0);
		expect(view.subject.warning).toBeUndefined();
		expect(Math.abs(view.position[2] - 1.7) + Math.abs(view.position[0])).toBeGreaterThan(0.5);
	});

	test('says so when no stand round the stem is clear, and keeps the one its turn asks', () => {
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const trunk = run(b, stem, -1, [0, 0, 0], [0, 1, 0], 6, 0.8, 0.3);
		// A branch that rings the stem at eye height, through every stand a step back from the bark.
		const ring = b.addAxis({
			parent: stem,
			parentNode: trunk[1] as number,
			order: 1,
			kind: AXIS_LIMB,
		});
		const reach = 0.8 * (1 - (0.3 * 1.6) / 5) + 1;
		let previous = trunk[1] as number;
		for (let k = 0; k <= 48; k++) {
			const angle = (k / 48) * 2 * Math.PI;
			previous = b.addNode({
				x: reach * Math.sin(angle),
				y: 1.6,
				z: reach * Math.cos(angle),
				radius: 0.3,
				parent: previous,
				axis: ring,
			});
		}
		const view = belowView({ skeleton: b.finish(1), shoots: NO_ROWS, prototypes: [] }, 0, lens, {
			elevation: 70,
		});
		expect(view.subject.walked).toBe(0);
		expect(view.subject.warning).toContain('no stand');
		expect(view.position[2]).toBeCloseTo(reach, 6);
	});

	test('turns its look to the right of the stem by the aside', () => {
		const straight = belowView(plant, 0, lens, { elevation: 80 });
		const turned = belowView(plant, 0, lens, { elevation: 80, aside: 40 });
		const heading = (v: typeof straight) =>
			Math.atan2(v.target[0] - v.position[0], v.target[2] - v.position[2]);
		const turn = ((heading(straight) - heading(turned) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
		expect((turn * 180) / Math.PI).toBeCloseTo(40, 3);
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

	test('frame the huge limb side on from the side where no other limb stands in front', () => {
		const view = junctionView(
			{ skeleton, shoots: NO_ROWS, prototypes: [] },
			{ fov: 50, aspect: 1 },
		);
		if (!view) throw new Error('the junction view found no limb');
		expect(view.subject.axis).toBe(2);
		// The camera stands on the clear side, square to the plane of the stem and the limb.
		expect(view.position[2]).toBeLessThan(view.target[2]);
		const back = [0, 1, 2].map((k) => (view.position[k] as number) - (view.target[k] as number));
		expect(Math.abs((back[2] as number) / Math.hypot(...back))).toBeGreaterThan(0.6);
		expect(view.clutter?.front).toBeLessThan(0.05);
	});
});

describe('the limb a junction view takes', () => {
	test('is the most level of the thick limbs, though a steeper one is thicker', () => {
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const top = run(b, stem, -1, [0, 0, 0], [0, 1, 0], 6, 0.8, 0.3)[5] as number;
		const steep = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
		run(b, steep, top, [0.8, 5.8, 0], [0.7, 0.7, 0], 8, 0.5, 0.5);
		const level = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
		run(b, level, top, [-1, 5.1, 0], [-1, 0.05, 0], 8, 0.4, 0.5);
		const view = junctionView(
			{ skeleton: b.finish(1), shoots: NO_ROWS, prototypes: [] },
			{ fov: 50, aspect: 1 },
		);
		expect(view?.subject.axis).toBe(level);
	});
});

describe('the junction candidates', () => {
	test('admit a thin stipe beside a thick limb, and a limb that ends inside the frame is left out', () => {
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const top = run(b, stem, -1, [0, 0, 0], [0, 1, 0], 6, 0.8, 0.3)[5] as number;
		const thick = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
		run(b, thick, top, [0.8, 5.8, 0], [0.7, 0.7, 0], 8, 0.5, 0.5);
		// A stipe at three tenths of the thick limb's radius, running on past the frame.
		const stipe = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
		run(b, stipe, top, [-1, 5.1, 0], [-1, 0.02, 0], 8, 0.15, 0.2);
		// A short twig that ends inside the frame is not a junction candidate.
		const short = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
		run(b, short, top, [0, 5, 0.5], [0, 0, 0.02], 4, 0.4, 0.2);
		// The crown's base stands above the stipe, so the stipe is the dead skirt.
		const skeleton = b.finish(6);
		const limbs = departures(skeleton).limbs;
		const kept = junctionCandidates(limbs, limbs[0]?.radius ?? 0, { fov: 50, aspect: 1 }, 6);
		const axes = kept.map((d) => d.axis);
		expect(axes).toContain(stipe);
		expect(axes).not.toContain(short);
		// A thin limb above the crown's base is not a skirt stipe.
		const above = junctionCandidates(limbs, limbs[0]?.radius ?? 0, { fov: 50, aspect: 1 }, 1);
		expect(above.map((d) => d.axis)).not.toContain(stipe);
	});
});

describe("the junction frame from a picture's subject box", () => {
	test('takes the larger of the height share and the width share, and the limb share without one', () => {
		// The saguaro's box: the limb's thick diameter at the height share, the stem's width at the
		// width share, and the stem's width needs the further camera.
		expect(junctionFrameHeight(0.286, 1.014, { width: 0.441, height: 0.383 }, 1)).toBeCloseTo(
			1.014 / 0.441,
			6,
		);
		// The tree fern's box: the wide, shallow subject puts the limb's thickness first.
		expect(junctionFrameHeight(0.3, 0.44, { width: 0.546, height: 0.167 }, 1)).toBeCloseTo(
			0.3 / 0.167,
			6,
		);
		// Without a measured box the view keeps the limb's own share of the frame.
		expect(junctionFrameHeight(0.286, 1.014, undefined, 1)).toBeCloseTo(0.286 / 0.55, 6);
	});
});

describe('how level a limb leaves', () => {
	test('counts a limb drooping past square as level as one rising as far', () => {
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const top = run(b, stem, -1, [0, 0, 0], [0, 1, 0], 6, 0.8, 0.3)[5] as number;
		// One limb rises at about 15 degrees, the other droops at about 6 degrees.
		const rising = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
		run(b, rising, top, [1, 5.3, 0], [1, 0.27, 0], 8, 0.4, 0.5);
		const drooping = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
		run(b, drooping, top, [-1, 4.9, 0], [-1, -0.1, 0], 8, 0.4, 0.5);
		const view = junctionView(
			{ skeleton: b.finish(1), shoots: NO_ROWS, prototypes: [] },
			{ fov: 50, aspect: 1 },
		);
		expect(view?.subject.axis).toBe(drooping);
	});
});

describe('a limb dividing into two', () => {
	const skeleton = oakLike();

	test('is a child of a limb with at least half its girth, not a twig leaving it', () => {
		const found = forks(skeleton);
		expect(found.map((f) => f.arm)).toEqual([5, 6]);
		for (const f of found) expect(f.armRadius).toBeGreaterThan(0.5 * f.radius);
	});

	test('is the fork whose arms part upright, seen square to them, its joint under the middle', () => {
		const view = forkView({ skeleton, shoots: NO_ROWS, prototypes: [] }, { fov: 50, aspect: 1 });
		if (!view) throw new Error('the fork view found no fork');
		const upright = forks(skeleton).find((f) => f.arm === 6);
		expect(view.subject.node).toBe(upright?.node ?? -1);
		// The arms part in the plane facing +Z, so the camera looks along Z, nearly level.
		const back = [0, 1, 2].map((k) => (view.position[k] as number) - (view.target[k] as number));
		expect(Math.abs((back[2] as number) / Math.hypot(...back))).toBeGreaterThan(0.8);
		expect(view.target[1]).toBeGreaterThan(upright?.at[1] ?? 0);
	});

	/** The height in metres that a view's frame covers at its target. */
	const frameHeight = (view: { position: number[]; target: number[] }): number =>
		2 *
		Math.hypot(...[0, 1, 2].map((k) => (view.position[k] as number) - (view.target[k] as number))) *
		Math.tan((50 * Math.PI) / 360);

	test("frames the arms' run, and takes the span a picture asks for", () => {
		const plant = { skeleton, shoots: NO_ROWS, prototypes: [] };
		const plain = forkView(plant, { fov: 50, aspect: 1 });
		if (!plain) throw new Error('the fork view found no fork');
		const fork = forks(skeleton).find((f) => f.node === plain.subject.node);
		if (!fork) throw new Error('the framed fork is not a fork');
		// The photograph frames both arms and their twigs, so the frame runs well past the limb's own
		// thickness.
		expect(frameHeight(plain)).toBeGreaterThan(4 * 2 * fork.radius);
		// A picture that asks for a span gets it, as the limb view does.
		const asked = forkView(plant, { fov: 50, aspect: 1 }, undefined, 3);
		if (!asked) throw new Error('the fork view found no fork');
		expect(frameHeight(asked)).toBeCloseTo(3, 5);
	});

	test("takes a great limb's fork over a branch's fork nearer the sought size", () => {
		const b = new SkeletonBuilder();
		const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const top = run(b, stem, -1, [0, 0, 0], [0, 1, 0], 6, 0.8, 0.3)[5] as number;
		// A great limb leaving the stem, rising, that divides into an even arm far out.
		const great = b.addAxis({ parent: stem, parentNode: top, order: 1, kind: AXIS_LIMB });
		const limb = run(b, great, top, [0.8, 5.6, 0], [0.8, 0.6, 0], 8, 0.45, 0.5);
		const fork = limb[6] as number;
		const arm = b.addAxis({ parent: great, parentNode: fork, order: 2, kind: AXIS_LIMB });
		run(b, arm, fork, [5.6, 9.4, -0.6], [0.3, 0.8, -0.4], 4, 0.2, 0.4);
		// A branch of the great limb that divides as well, its girth nearer the sought radius.
		const branch = b.addAxis({
			parent: great,
			parentNode: limb[3] as number,
			order: 2,
			kind: AXIS_LIMB,
		});
		const twig = run(b, branch, limb[3] as number, [3.2, 7.8, 0.6], [0.2, 0.8, 0.5], 6, 0.2, 0.3);
		const split = b.addAxis({
			parent: branch,
			parentNode: twig[3] as number,
			order: 3,
			kind: AXIS_LIMB,
		});
		run(b, split, twig[3] as number, [3.4, 10.4, 2.4], [0.6, 0.6, 0.1], 3, 0.15, 0.3);
		const view = forkView(
			{ skeleton: b.finish(1), shoots: NO_ROWS, prototypes: [] },
			{ fov: 50, aspect: 1 },
		);
		expect(view?.subject.node).toBe(fork);
		expect(view?.subject.wishes).toMatchObject({ great: true });
	});

	test("says which of the photograph's wishes the plant has forks to meet", () => {
		const view = forkView({ skeleton, shoots: NO_ROWS, prototypes: [] }, { fov: 50, aspect: 1 });
		expect(view?.subject.wishes).toEqual({ great: true, size: true, even: true, wide: true });
	});

	test('turns its picture until the limb comes up to the fork from the lower edge', () => {
		const view = forkView({ skeleton, shoots: NO_ROWS, prototypes: [] }, { fov: 50, aspect: 1 });
		if (!view) throw new Error('the fork view found no fork');
		const fork = forks(skeleton).find((f) => f.node === view.subject.node);
		if (!fork) throw new Error('the fork view framed no fork of the plant');
		const { forward, up } = lensAxes(view);
		const rolledUp = turnedAbout(up, forward, view.roll ?? 0);
		const along = fork.into.map((v, k) => v - (forward[k] as number) * dot(fork.into, forward));
		expect(dot(normalize(along), rolledUp)).toBeGreaterThan(0.99);
	});
});

describe("the crown's outer rim", () => {
	test('is seen from under it, on the stem side, looking up past its edge', () => {
		const skeleton = oakLike();
		const view = surfaceView(
			{ skeleton, shoots: NO_ROWS, prototypes: [] },
			{ fov: 45, aspect: 1 },
			{ share: 0.6, thin: 0.15, span: 2 },
		);
		if (!view) throw new Error('the rim view found no limb');
		const back = [0, 1, 2].map((k) => (view.position[k] as number) - (view.target[k] as number));
		const rise = (Math.asin((back[1] as number) / Math.hypot(...back)) * 180) / Math.PI;
		expect(rise).toBeGreaterThan(-32);
		expect(rise).toBeLessThan(-18);
		expect(Math.hypot(view.position[0], view.position[2])).toBeLessThan(
			Math.hypot(view.target[0], view.target[2]),
		);
	});
});

describe('the views of a great limb and of the bole', () => {
	const skeleton = oakLike();
	const plant = { skeleton, shoots: NO_ROWS, prototypes: [] };

	test('stand under the limb from inside the crown, looking up across it', () => {
		const view = insideView(plant, { fov: 75, aspect: 1 });
		if (!view) throw new Error('the inside view found no limb');
		expect(view.subject.axis).toBe(2);
		const back = [0, 1, 2].map((k) => (view.position[k] as number) - (view.target[k] as number));
		const rise = (Math.asin((back[1] as number) / Math.hypot(...back)) * 180) / Math.PI;
		expect(rise).toBeLessThan(-30);
		// The huge limb runs along X, so the camera stands off it along Z.
		expect(Math.abs(back[2] as number)).toBeGreaterThan(Math.abs(back[0] as number));
	});

	test("frame a limb's bark with the limb's thickness filling its share of the frame", () => {
		const girth = 0.38;
		const view = barkLimbView(plant, { fov: 40, aspect: 1 }, girth, 0.3);
		if (!view) throw new Error('the bark view found no limb');
		const radius = view.subject.radius as number;
		const distance = Math.hypot(...view.position.map((p, k) => p - (view.target[k] as number)));
		expect(distance).toBeCloseTo(radius / girth / Math.tan((20 * Math.PI) / 180), 6);
	});

	test('frame the bole from the side where the fewest limbs cross in front of it', () => {
		const lens = { fov: 40, aspect: 0.75 };
		const view = trunkView(plant, lens, 0);
		if (!view) throw new Error('the bole view found no stem');
		const spheres = plantSpheres(skeleton, NO_ROWS, [], view.target, 20);
		const mark = { axes: new Uint8Array(skeleton.axes.count).fill(0), band: 20 };
		mark.axes[0] = 1;
		mark.axes[1] = 1;
		const stand = view.subject.stand as number;
		const asked = { position: [0, view.position[1], stand] as V3, target: view.target };
		const chosen = clutterOf(spheres, view, lens.fov, lens.aspect, mark).front;
		expect(chosen).toBeLessThanOrEqual(
			clutterOf(spheres, asked, lens.fov, lens.aspect, mark).front,
		);
	});
});

describe('the view of the bole', () => {
	const skeleton = oakLike();
	const lens = { fov: 40, aspect: 1 };

	test("stands at eye height, the foot on the frame's lower margin and the fork a fifth under its top", () => {
		const view = trunkView({ skeleton, shoots: NO_ROWS, prototypes: [] }, lens, 0);
		if (!view) throw new Error('the bole view found no stem');
		expect(view.position[1]).toBeCloseTo(1.6, 6);
		expect(view.subject.fork).toBe(5);
		const look = normalize(view.target.map((t, k) => t - (view.position[k] as number)) as V3);
		const pitch = Math.asin(look[1]);
		const bark =
			Math.hypot(view.position[0], view.position[2]) - (stemAt(skeleton, 1.6)?.radius ?? 0);
		const row = (height: number) =>
			0.5 - Math.tan(Math.atan2(height - 1.6, bark) - pitch) / (2 * Math.tan((20 * Math.PI) / 180));
		expect(row(0)).toBeCloseTo(0.92, 6);
		expect(row(5)).toBeCloseTo(0.2, 6);
	});

	test('divides where a limb of a share of the stem leaves, not where a thin shoot leaves low', () => {
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
