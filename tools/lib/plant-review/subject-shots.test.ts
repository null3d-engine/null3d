// The close cameras solved from a plant's subjects. Each test builds the subjects by hand, solves a
// shot, and projects the subject's points through the solved camera: they must land where the
// photograph of that view has them, at the size it has them.
import { describe, expect, test } from 'bun:test';
import { dot, normalize, type V3 } from '../../../tests/pages/lib/plant-review/anatomy.ts';
import {
	barkBaseShot,
	barkLimbShot,
	barkMidShot,
	belowShot,
	blockedBy,
	boleShot,
	branchPieceShot,
	type Camera,
	cameraAxes,
	checkShot,
	crownOutsideShot,
	crownUndersideShot,
	forkShot,
	insideShot,
	junctionShot,
	lowShot,
	project,
	type Solved,
	type SubjectShot,
} from '../../../tests/pages/lib/plant-review/subject-shots.ts';
import {
	type AxisSample,
	absent,
	type ForkSubject,
	type GreatLimb,
	isAbsent,
	type Lobe,
	type PlantSubjects,
	type TrunkSubject,
} from '../../../tests/pages/lib/plant-review/subjects.ts';

const DEG = Math.PI / 180;
/** A landscape still's lens and a portrait still's. */
const WIDE = { fov: 50, aspect: 4 / 3 };
const TALL = { fov: 50, aspect: 3 / 4 };

/** A straight axis from `from` along `direction`, `length` metres, its radius tapering to `end`. */
function axis(
	from: V3,
	direction: V3,
	length: number,
	radius: number,
	end = radius,
	samples = 9,
): AxisSample[] {
	const d = normalize(direction);
	return Array.from({ length: samples }, (_, k) => {
		const t = k / (samples - 1);
		return {
			at: [
				from[0] + d[0] * length * t,
				from[1] + d[1] * length * t,
				from[2] + d[2] * length * t,
			] as V3,
			radius: radius + (end - radius) * t,
		};
	});
}

/** An upright trunk of a height and radius that first divides at `fork` metres. */
function trunkOf(height: number, radius: number, fork?: number): TrunkSubject {
	const line = axis([0, 0, 0], [0, 1, 0], height, radius, radius * 0.5, 17);
	const at = (y: number): AxisSample => ({
		at: [0, y, 0],
		radius: radius + (radius * 0.5 - radius) * (y / height),
	});
	return {
		base: [0, 0, 0],
		axis: line,
		breast: at(Math.min(1.3, height * 0.3)),
		firstFork: fork === undefined ? absent('the trunk does not divide') : at(fork),
	};
}

/** A great limb that leaves an upright trunk at a height, toward a direction. */
function limbOf(
	id: number,
	height: number,
	direction: V3,
	radius: number,
	length: number,
	trunkRadius: number,
): GreatLimb {
	const d = normalize(direction);
	return {
		id,
		joint: [0, height, 0],
		trunkRadius,
		trunkDirection: [0, 1, 0],
		direction: d,
		radius,
		length,
		axis: axis([0, height, 0], d, length, radius, radius * 0.4),
	};
}

/** A tree: an upright trunk, a great limb toward +X at its fork, and what a test adds to it. */
function tree(over: Partial<PlantSubjects> = {}): PlantSubjects {
	const trunk = trunkOf(14, 0.5, 5);
	return {
		source: 'test',
		foot: [0, 0, 0],
		height: 16,
		reach: 8,
		crownBase: 5,
		trunk,
		limbs: [limbOf(1, 5, [1, 0.25, 0], 0.3, 8, 0.4), limbOf(2, 7, [-1, 0.5, 0.2], 0.2, 6, 0.35)],
		forks: [],
		lobes: [],
		twigTips: absent('none in this test'),
		pieces: absent('none in this test'),
		leaf: { length: 0.1 },
		...over,
	};
}

/** A solved shot, which the test expects the plant to give. */
function shotOf(solved: Solved): SubjectShot {
	if (isAbsent(solved)) throw new Error(`no shot: ${solved.absent}`);
	return solved;
}

/** Where a named point of a shot lands. */
function landing(shot: SubjectShot, lens: typeof WIDE, name: string) {
	const point = shot.points.find((p) => p.name === name);
	if (!point) throw new Error(`the shot has no point named ${name}`);
	return project(shot.camera, lens, point.at);
}

/** The camera's pitch above level, in degrees. */
function pitchOf(camera: Camera): number {
	return Math.asin(cameraAxes(camera).forward[1]) / DEG;
}

describe('a point through a camera', () => {
	const camera: Camera = { position: [0, 1, 10], target: [0, 1, 0] };

	test('lands on the frame middle at the target, and to the right and up as it moves', () => {
		expect(project(camera, WIDE, [0, 1, 0])).toMatchObject({ x: 0.5, y: 0.5, depth: 10 });
		expect(project(camera, WIDE, [1, 1, 0]).x).toBeGreaterThan(0.5);
		expect(project(camera, WIDE, [0, 2, 0]).y).toBeLessThan(0.5);
		// The frame's upper edge is half a frame's height above the target.
		const half = 10 * Math.tan(25 * DEG);
		expect(project(camera, WIDE, [0, 1 + half, 0]).y).toBeCloseTo(0, 9);
		expect(project(camera, WIDE, [half * WIDE.aspect, 1, 0]).x).toBeCloseTo(1, 9);
	});

	test('has no place in the frame when it stands behind the lens', () => {
		const behind = project(camera, WIDE, [0, 1, 20]);
		expect(behind.depth).toBeLessThan(0);
		expect(Number.isNaN(behind.x)).toBe(true);
	});

	test('turns with the roll about the line of sight', () => {
		// A quarter turn of the picture counterclockwise brings what was to the right to the top.
		const rolled = project({ ...camera, roll: Math.PI / 2 }, WIDE, [1, 1, 0]);
		expect(rolled.x).toBeCloseTo(0.5, 9);
		expect(rolled.y).toBeLessThan(0.5);
	});
});

describe('the view up the trunk', () => {
	test("puts the bole's top on its row and the trunk on the lower edge, from under the limbs", () => {
		const subjects = tree();
		const shot = shotOf(belowShot(subjects, { fov: 70, aspect: 4 / 3 }, { turn: 0 }));
		const lens = { fov: 70, aspect: 4 / 3 };
		const fork = landing(shot, lens, 'the top of the bole');
		expect(fork.x).toBeCloseTo(0.5, 6);
		expect(fork.y).toBeCloseTo(0.42, 6);
		// The eye stands at a person's height, below the fork, on the side the turn faces.
		expect(shot.camera.position[1]).toBeCloseTo(1.6, 9);
		expect(shot.camera.position[2]).toBeGreaterThan(0);
		expect(pitchOf(shot.camera)).toBeGreaterThanOrEqual(25 - 1e-6);
		// The trunk stands on the lower edge at the share its photograph gives it.
		const edge = landing(shot, lens, 'the trunk at the lower edge');
		expect(edge.y).toBeGreaterThan(0.9);
		expect(edge.y).toBeLessThanOrEqual(1);
		expect(shot.facts.trunkShare as number).toBeCloseTo(0.42, 2);
		expect(checkShot(shot, lens).present).toBe(true);
	});

	test('drops the eye under a low fork, so the lens never stands among the limbs', () => {
		const subjects = tree({
			trunk: trunkOf(5, 0.4, 1.2),
			crownBase: 1.2,
			limbs: [limbOf(1, 1.2, [1, 0.5, 0], 0.2, 4, 0.38)],
		});
		const lens = { fov: 70, aspect: 3 / 4 };
		const shot = shotOf(belowShot(subjects, lens, { turn: 0 }));
		expect(shot.camera.position[1]).toBeCloseTo(0.45 * 1.2, 9);
		expect(shot.camera.position[1]).toBeLessThan(1.2);
		expect(landing(shot, lens, 'the top of the bole').y).toBeCloseTo(0.42, 6);
		// The camera keeps clear of the bark.
		expect(Math.hypot(shot.camera.position[0], shot.camera.position[2])).toBeGreaterThanOrEqual(
			0.4 * 0.9 + 0.25 - 1e-6,
		);
		expect(checkShot(shot, lens).present).toBe(true);
	});

	test('never looks up less than its least pitch, however thick the bole', () => {
		const subjects = tree({
			trunk: trunkOf(8, 1.2, 4),
			crownBase: 4,
			limbs: [limbOf(1, 4, [1, 0.25, 0], 0.5, 8, 0.9)],
		});
		const lens = { fov: 70, aspect: 4 / 3 };
		const shot = shotOf(belowShot(subjects, lens, { turn: 0 }));
		expect(pitchOf(shot.camera)).toBeCloseTo(25, 4);
		expect(shot.facts.trunkShare as number).toBeGreaterThan(0.42);
		expect(landing(shot, lens, 'the top of the bole').y).toBeCloseTo(0.42, 6);
	});

	test('keeps the fork on the middle column of a trunk that leans', () => {
		// A stool's stem: its fork stands 1.2 m to the side of its foot.
		const lens = { fov: 70, aspect: 3 / 4 };
		const leaning: TrunkSubject = {
			...trunkOf(6, 0.15, 3),
			axis: axis([0, 0, 0], [0.4, 1, 0], Math.hypot(1.2, 3) * 2, 0.15, 0.08, 17),
			firstFork: { at: [1.2, 3, 0], radius: 0.11 },
		};
		const subjects = tree({
			trunk: leaning,
			crownBase: 3,
			limbs: [{ ...limbOf(1, 3, [1, 0.5, 0], 0.08, 4, 0.11), joint: [1.2, 3, 0] }],
		});
		const below = shotOf(belowShot(subjects, lens, { turn: 0 }));
		expect(landing(below, lens, 'the top of the bole').x).toBeCloseTo(0.5, 6);
		expect(landing(below, lens, 'the top of the bole').y).toBeCloseTo(0.42, 6);
		// The camera stands in the plane of the lean, so the trunk's foot end stays on the column too.
		expect(Math.abs(below.camera.position[2])).toBeLessThan(1e-6);
		expect(landing(below, lens, 'the trunk at the lower edge').x).toBeCloseTo(0.5, 6);
		expect(checkShot(below, lens).present).toBe(true);
		// The bole's foot and its top stand either side of the middle column, as far from it as each other.
		const bole = shotOf(boleShot(subjects, TALL, { turn: 0 }));
		const foot = landing(bole, TALL, "the trunk's foot");
		const top = landing(bole, TALL, 'the top of the bole');
		expect(foot.x + top.x).toBeCloseTo(1, 1);
		expect(checkShot(bole, TALL).present).toBe(true);
	});

	test("asks a stem too thin for its share only for what a hand's width away gives it", () => {
		// A shrub's stem 9 cm through: the camera cannot stand nearer than its clearance.
		const lens = { fov: 70, aspect: 4 / 3 };
		const thin = tree({
			trunk: trunkOf(3, 0.045, 1.8),
			crownBase: 1.8,
			limbs: [limbOf(1, 1.8, [1, 0.5, 0], 0.025, 2, 0.04)],
		});
		const shot = shotOf(belowShot(thin, lens, { turn: 0 }));
		expect(shot.facts.standoff as number).toBeCloseTo(0.25, 6);
		expect(shot.facts.trunkShare as number).toBeLessThan(0.42);
		expect(checkShot(shot, lens).present).toBe(true);
	});

	test('walks round the trunk off a limb that stands where the camera would', () => {
		const lens = { fov: 70, aspect: 4 / 3 };
		const open = shotOf(belowShot(tree(), lens, { turn: 0 }));
		const stand = open.camera.position;
		// A low limb runs straight through the stand the turn asks for.
		const inTheWay: GreatLimb = {
			...limbOf(3, 5, [0, 0, 1], 0.2, 6, 0.45),
			axis: axis([0, stand[1], 0], [0, 0, 1], 6, 0.2),
		};
		const subjects = tree({ limbs: [limbOf(1, 5, [1, 0.25, 0], 0.3, 8, 0.4), inTheWay] });
		const walked = shotOf(belowShot(subjects, lens, { turn: 0 }));
		expect(walked.facts.walked).toBe(15);
		expect(blockedBy(subjects, walked.camera.position, walked.camera.position, {}, 0.25)).toBe(
			undefined,
		);
		expect(landing(walked, lens, 'the top of the bole').y).toBeCloseTo(0.42, 6);
	});

	test('ends the bole at the lowest great limb, though the leader divides far above it', () => {
		// A conifer: the leader runs to the top, where the first limb of a real share of it leaves,
		// and the great limbs start at 9 m.
		const lens = { fov: 70, aspect: 4 / 3 };
		const conifer = tree({
			trunk: trunkOf(18, 0.4, 16),
			crownBase: 8.5,
			limbs: [limbOf(1, 11, [1, 0, 0], 0.13, 5, 0.3), limbOf(2, 9, [0, 0, 1], 0.12, 5, 0.33)],
		});
		const shot = shotOf(belowShot(conifer, lens, { turn: 0 }));
		expect(shot.facts.fork).toBeCloseTo(9, 9);
		expect(shot.points[0]?.at[1]).toBeCloseTo(9, 9);
	});

	test('takes the first fork, then the crown base, where no great limb leaves the trunk', () => {
		const lens = { fov: 70, aspect: 4 / 3 };
		const forked = tree({ trunk: trunkOf(14, 0.5, 7), crownBase: 6, limbs: [] });
		expect(shotOf(belowShot(forked, lens, { turn: 0 })).facts.fork).toBeCloseTo(7, 9);
		const unforked = tree({ trunk: trunkOf(14, 0.5), crownBase: 6, limbs: [] });
		expect(shotOf(belowShot(unforked, lens, { turn: 0 })).facts.fork).toBeCloseTo(6, 9);
		const neither = belowShot(
			tree({ trunk: trunkOf(14, 0.5), crownBase: absent('unknown'), limbs: [] }),
			lens,
			{ turn: 0 },
		);
		expect(isAbsent(neither)).toBe(true);
	});

	test('sees a plant with no trunk from a low eye, its foot and its top on their rows', () => {
		const tuft: PlantSubjects = {
			...tree(),
			height: 0.9,
			reach: 0.6,
			crownBase: 0,
			trunk: absent('a tuft'),
			limbs: absent('a tuft'),
		};
		const lens = { fov: 70, aspect: 3 / 4 };
		const shot = shotOf(belowShot(tuft, lens, { turn: 0 }));
		expect(shot.kind).toBe('the plant from a low eye beside it');
		expect(shot.camera.position[1]).toBeCloseTo(0.15 * 0.9, 9);
		expect(landing(shot, lens, "the plant's foot").y).toBeCloseTo(0.95, 4);
		expect(landing(shot, lens, "the plant's top").y).toBeCloseTo(0.08, 4);
		expect(checkShot(shot, lens).present).toBe(true);
		expect(isAbsent(lowShot({ ...tuft, height: 0 }, lens, 0))).toBe(true);
	});
});

describe('the view of the bole', () => {
	test("puts the foot and the bole's top on their rows from eye height", () => {
		const subjects = tree();
		const shot = shotOf(boleShot(subjects, TALL, { turn: 0 }));
		expect(shot.camera.position[1]).toBeCloseTo(1.6, 9);
		expect(landing(shot, TALL, "the trunk's foot").y).toBeCloseTo(0.92, 4);
		expect(landing(shot, TALL, 'the top of the bole').y).toBeCloseTo(0.2, 4);
		expect(landing(shot, TALL, "the trunk's foot").x).toBeCloseTo(0.5, 6);
		expect(checkShot(shot, TALL).present).toBe(true);
	});

	test('takes the rows a slot names, and the crown base in place of the fork', () => {
		const subjects = tree({ crownBase: 9 });
		const lens = { fov: 75, aspect: 3 / 4 };
		const shot = shotOf(
			boleShot(subjects, lens, { turn: 0, footRow: 0.96, topRow: 0.09, toCrown: true }),
		);
		expect(shot.facts.top).toBeCloseTo(9, 9);
		expect(landing(shot, lens, "the trunk's foot").y).toBeCloseTo(0.96, 4);
		expect(landing(shot, lens, 'the top of the bole').y).toBeCloseTo(0.09, 4);
	});

	test('walks to a side from which no great limb crosses the bole', () => {
		const clear = shotOf(boleShot(tree(), TALL, { turn: 0 }));
		const stand = clear.camera.position;
		// A drooping limb hangs between the stand and the bole.
		const across: GreatLimb = {
			...limbOf(3, 5, [0, 0, 1], 0.2, 6, 0.45),
			axis: axis([-3, (stand[1] + 2.5) / 2, stand[2] / 2], [1, 0, 0], 6, 0.25),
		};
		const subjects = tree({ limbs: [limbOf(1, 5, [1, 0.25, 0], 0.3, 8, 0.4), across] });
		const walked = shotOf(boleShot(subjects, TALL, { turn: 0 }));
		expect(walked.facts.walked).not.toBe(0);
		expect(blockedBy(subjects, walked.camera.position, [0, 2.5, 0], { trunk: true })).toBe(
			undefined,
		);
	});

	test('gives no shot for a plant with no trunk, with the reason', () => {
		const solved = boleShot(tree({ trunk: absent('a tuft has no stem') }), TALL, { turn: 0 });
		expect(solved).toEqual({ absent: 'a tuft has no stem' });
	});
});

describe('the view of a limb leaving the trunk', () => {
	test('stands square to the join, the collar left of the middle and the limb leaving right', () => {
		const subjects = tree();
		const shot = shotOf(junctionShot(subjects, TALL));
		const limb = (subjects.limbs as readonly GreatLimb[])[0] as GreatLimb;
		const collar = landing(shot, TALL, 'the collar, where the limb meets the trunk');
		expect(collar.x).toBeCloseTo(0.47, 6);
		expect(collar.y).toBeCloseTo(0.5, 6);
		// The limb leaves to the right of the collar, and the trunk stands to its left.
		expect(landing(shot, TALL, "the limb's base").x).toBeGreaterThan(collar.x);
		expect(landing(shot, TALL, 'the trunk below the joint').x).toBeLessThan(collar.x);
		// The camera looks square to the plane of the trunk and the limb, a little upward.
		const { forward } = cameraAxes(shot.camera);
		const normal = normalize([
			limb.trunkDirection[1] * limb.direction[2] - limb.trunkDirection[2] * limb.direction[1],
			limb.trunkDirection[2] * limb.direction[0] - limb.trunkDirection[0] * limb.direction[2],
			limb.trunkDirection[0] * limb.direction[1] - limb.trunkDirection[1] * limb.direction[0],
		]);
		expect(Math.abs(dot(forward, normal))).toBeCloseTo(Math.cos(10 * DEG), 6);
		expect(forward[1]).toBeGreaterThan(0);
		expect(checkShot(shot, TALL).present).toBe(true);
	});

	test("gives the limb's base a third of the frame's height", () => {
		const shot = shotOf(junctionShot(tree(), TALL));
		const check = checkShot(shot, TALL);
		const base = check.points.find((p) => p.name === "the limb's base");
		// The frame is the limb's diameter over its share: the trunk here is not thick enough to widen it.
		expect(shot.facts.frame as number).toBeCloseTo(0.6 / 0.35, 9);
		expect(base?.size as number).toBeGreaterThan(0.3);
		expect(base?.size as number).toBeLessThan(0.4);
	});

	test('frames no wider than the trunk needs, so a thick bole does not set a frame of metres', () => {
		// A bole 1.8 m through with a limb 0.9 m through: the frame follows the limb.
		const trunk = trunkOf(14, 0.9, 5);
		const subjects = tree({ trunk, limbs: [limbOf(1, 5, [1, 0.3, 0], 0.45, 9, 0.9)] });
		const shot = shotOf(junctionShot(subjects, TALL));
		expect(shot.facts.frame as number).toBeCloseTo(0.9 / 0.35, 9);
		expect(shot.facts.frame as number).toBeLessThan(3);
		expect(checkShot(shot, TALL).present).toBe(true);
		// A thin limb on the same bole still shows the trunk's round: the frame is 0.9 of its diameter.
		const thin = tree({ trunk, limbs: [limbOf(1, 5, [1, 0.3, 0], 0.05, 3, 0.9)] });
		expect(shotOf(junctionShot(thin, TALL)).facts.frame as number).toBeCloseTo(0.9 * 1.8, 9);
	});

	test("takes the photograph's own subject box shares where the tool measured them", () => {
		const shot = shotOf(junctionShot(tree(), WIDE, { shares: { width: 0.2, height: 0.5 } }));
		// The limb's 0.6 m takes half the height, unless the trunk's 0.8 m at a fifth of the width needs more.
		expect(shot.facts.frame as number).toBeCloseTo(
			Math.max(0.6 / 0.5, 0.8 / (0.2 * WIDE.aspect)),
			9,
		);
	});

	test('takes the thickest wide limb that no other limb hides, or the limb a slot names', () => {
		const first = shotOf(junctionShot(tree(), TALL));
		expect(first.facts.limb).toBe(1);
		// A limb crosses halfway between the camera and the thickest limb's collar.
		const collar = first.points[0]?.at as V3;
		const hiding: GreatLimb = {
			...limbOf(3, 4, [0, 0, 1], 0.1, 4, 0.4),
			axis: axis(
				[
					(first.camera.position[0] + collar[0]) / 2 - 2,
					(first.camera.position[1] + collar[1]) / 2,
					(first.camera.position[2] + collar[2]) / 2,
				],
				[1, 0, 0],
				4,
				0.15,
			),
		};
		const subjects = tree({
			limbs: [
				limbOf(1, 5, [1, 0.25, 0], 0.3, 8, 0.4),
				limbOf(2, 7, [-1, 0.5, 0.2], 0.2, 6, 0.35),
				hiding,
			],
		});
		expect(shotOf(junctionShot(subjects, TALL)).facts.limb).toBe(2);
		expect(shotOf(junctionShot(subjects, TALL, { limb: 1 })).facts.limb).toBe(1);
		expect(isAbsent(junctionShot(subjects, TALL, { limb: 9 }))).toBe(true);
	});

	test('gives no shot where no limb leaves at a wide angle', () => {
		const steep = tree({ limbs: [limbOf(1, 5, [0.2, 1, 0], 0.3, 8, 0.4)] });
		expect(junctionShot(steep, TALL)).toEqual({
			absent: 'no great limb leaves the trunk at a wide angle',
		});
	});
});

/** A fork of a limb that runs up and out toward +X, its arms parting in an upright plane. */
function forkOf(over: Partial<ForkSubject> = {}): ForkSubject {
	return {
		at: [3, 7, 0],
		order: 1,
		into: normalize([1, 1, 0]),
		arms: [normalize([1, 0.2, 0]), normalize([0.2, 1, 0])],
		radius: 0.12,
		armRadii: [0.1, 0.09],
		...over,
	};
}

describe('the view of a fork', () => {
	test('stands square to the arms, the limb coming up to the joint from the lower edge', () => {
		const subjects = tree({ forks: [forkOf()] });
		const shot = shotOf(forkShot(subjects, TALL));
		const joint = landing(shot, TALL, 'the joint');
		expect(joint.x).toBeCloseTo(0.5, 6);
		expect(joint.y).toBeCloseTo(0.58, 6);
		// The limb enters from below the joint, on the frame's middle column.
		const limb = landing(shot, TALL, 'the limb below the joint');
		expect(limb.x).toBeCloseTo(0.5, 6);
		expect(limb.y).toBeGreaterThan(joint.y);
		// Both arms leave upward, one to each side.
		const one = landing(shot, TALL, 'one arm');
		const other = landing(shot, TALL, 'the other arm');
		expect(one.y).toBeLessThan(joint.y);
		expect(other.y).toBeLessThan(joint.y);
		expect((one.x - 0.5) * (other.x - 0.5)).toBeLessThan(0);
		// The line of sight is square to both arms.
		const { forward } = cameraAxes(shot.camera);
		const fork = forkOf();
		expect(dot(forward, fork.arms[0])).toBeCloseTo(0, 9);
		expect(dot(forward, fork.arms[1])).toBeCloseTo(0, 9);
		expect(checkShot(shot, TALL).present).toBe(true);
	});

	test("gives the limb a fifth of the frame's width, and draws only the wood near the joint", () => {
		const shot = shotOf(forkShot(tree({ forks: [forkOf()] }), TALL));
		const limb = checkShot(shot, TALL).points.find((p) => p.name === 'the limb below the joint');
		expect(limb?.size as number).toBeCloseTo(0.22, 2);
		const depth = landing(shot, TALL, 'the joint').depth;
		expect(shot.near as number).toBeLessThan(depth);
		expect(shot.far as number).toBeGreaterThan(depth);
		// The slab is a few limb radii either side of the joint, not the crown's depth.
		expect((shot.far as number) - (shot.near as number)).toBeLessThan(2);
	});

	test('takes the thickest even, open fork of a great limb before a thinner order', () => {
		const forks = [
			forkOf({ order: 2, radius: 0.3 }),
			forkOf({ radius: 0.2, armRadii: [0.2, 0.05] }),
			forkOf({ radius: 0.08, armRadii: [0.08, 0.07] }),
			forkOf({ radius: 0.15, armRadii: [0.15, 0.12], at: [4, 8, 1] }),
		];
		const shot = shotOf(forkShot(tree({ forks }), TALL));
		// The second is uneven and the first is of a higher order: the thickest even order-one fork wins.
		expect(shot.facts.fork).toBe(3);
		expect(shotOf(forkShot(tree({ forks }), TALL, { fork: 0 })).facts.fork).toBe(0);
	});

	test('gives no shot, with the count, where no limb divides evenly', () => {
		const uneven = [forkOf({ armRadii: [0.12, 0.02] })];
		expect(forkShot(tree({ forks: uneven }), TALL)).toEqual({
			absent: 'no limb divides into two arms of like size: 1 divisions, none even and open',
		});
		expect(forkShot(tree({ forks: absent('a cut piece carries no skeleton') }), TALL)).toEqual({
			absent: 'a cut piece carries no skeleton',
		});
	});
});

describe("the view of the crown's outside", () => {
	const lobes: Lobe[] = [
		{ centre: [5, 8, 0], radius: 2, limb: 1 },
		{ centre: [-4, 9, 1], radius: 2.2, limb: 2 },
		{ centre: [0, 13, 0], radius: 2.5 },
		{ centre: [1, 6, 1], radius: 0.2 },
	];

	test('frames one lobe at the rim from outside the crown and below it', () => {
		const subjects = tree({ lobes });
		const shot = shotOf(crownOutsideShot(subjects, TALL, { turn: 90 * DEG }));
		const lobe = landing(shot, TALL, 'the lobe');
		expect(lobe.x).toBeCloseTo(0.5, 6);
		expect(lobe.y).toBeCloseTo(0.5, 6);
		// The turn faces +X, so the lobe on that side is the subject.
		expect(shot.facts.limb).toBe(1);
		// The camera stands farther out than the lobe, lower than it, and looks up.
		expect(shot.facts.outside as number).toBeGreaterThan(2);
		expect(shot.camera.position[1]).toBeLessThan(8);
		expect(pitchOf(shot.camera)).toBeCloseTo(20, 4);
		// The lobe's width takes its share of the frame's shorter side.
		const size = checkShot(shot, TALL).points[0]?.size as number;
		expect(size).toBeCloseTo(0.7, 1);
		expect(checkShot(shot, TALL).present).toBe(true);
	});

	test('takes the lobe on the side the turn asks, and passes over a speck of foliage', () => {
		const subjects = tree({ lobes });
		expect(shotOf(crownOutsideShot(subjects, WIDE, { turn: -90 * DEG })).facts.limb).toBe(2);
		expect(shotOf(crownOutsideShot(subjects, WIDE, { turn: 90 * DEG })).facts.radius).toBe(2);
	});

	test('looks level where the ground leaves no room below the lobe', () => {
		const low = tree({ lobes: [{ centre: [1, 0.6, 0], radius: 0.6 }], crownBase: 0, height: 1.2 });
		const shot = shotOf(crownOutsideShot(low, WIDE, { turn: 90 * DEG }));
		expect(shot.camera.position[1]).toBeGreaterThanOrEqual(0.05 - 1e-9);
		expect(pitchOf(shot.camera)).toBeLessThan(20);
		expect(checkShot(shot, WIDE).present).toBe(true);
	});

	test('gives no shot where the generator names no lobes', () => {
		const solved = crownOutsideShot(tree({ lobes: absent('no bud sites') }), WIDE, { turn: 0 });
		expect(solved).toEqual({ absent: 'no bud sites' });
		expect(isAbsent(crownOutsideShot(tree({ lobes: [] }), WIDE, { turn: 0 }))).toBe(true);
	});
});

describe("the view of the crown's underside", () => {
	const lens = { fov: 70, aspect: 3 / 4 };

	test('stands under a great limb, out from the trunk, and looks back up along it', () => {
		const subjects = tree({
			lobes: [
				{ centre: [5, 8, 0], radius: 2, limb: 1 },
				{ centre: [1, 11, 0], radius: 2.5 },
			],
		});
		const shot = shotOf(crownUndersideShot(subjects, lens, { turn: 90 * DEG }));
		expect(shot.facts.limb).toBe(1);
		// The eye is a person's, under the crown's base, out under the limb on its own side.
		expect(shot.camera.position[1]).toBeCloseTo(1.6, 9);
		expect(shot.camera.position[0]).toBeGreaterThan(1);
		// The step to one side of the limb's line costs the pitch a degree or so.
		expect(pitchOf(shot.camera)).toBeGreaterThan(57);
		expect(pitchOf(shot.camera)).toBeLessThanOrEqual(60);
		// The camera looks back toward the trunk.
		expect(cameraAxes(shot.camera).forward[0]).toBeLessThan(0);
		// The limb stands on the middle, and its joint low in the frame, left of the middle.
		const joint = landing(shot, lens, "the limb's joint");
		expect(joint.depth).toBeGreaterThan(0);
		expect(joint.x).toBeLessThan(0.5);
		expect(joint.y).toBeGreaterThan(0.6);
		expect(joint.y).toBeLessThan(1);
		// The foliage mass nearest the frame's middle is the one over the limb, not the limb's own.
		expect(shot.points[2]?.at).toEqual([1, 11, 0]);
		expect(checkShot(shot, lens).present).toBe(true);
	});

	test('stays under a limb that rises steeply, and looks up more steeply at it', () => {
		// A birch's limb: 8 m long, rising at 20 degrees from the trunk's line, so it runs 2.7 m out.
		const steep = tree({
			limbs: [limbOf(1, 5, [Math.sin(20 * DEG), Math.cos(20 * DEG), 0], 0.1, 8, 0.2)],
		});
		const shot = shotOf(crownUndersideShot(steep, lens, { turn: 90 * DEG }));
		const run = 8 * Math.sin(20 * DEG);
		expect(shot.facts.stand as number).toBeLessThanOrEqual(0.8 * run + 1e-9);
		expect(pitchOf(shot.camera)).toBeGreaterThan(60);
		expect(checkShot(shot, lens).present).toBe(true);
	});

	test('drops the eye under a low crown, and gives no shot under a crown at the ground', () => {
		const low = tree({
			trunk: trunkOf(4, 0.2, 1),
			crownBase: 1,
			limbs: [limbOf(1, 1, [1, 0.8, 0], 0.1, 3, 0.2)],
		});
		const shot = shotOf(crownUndersideShot(low, lens, { turn: 90 * DEG }));
		expect(shot.camera.position[1]).toBeCloseTo(0.6, 9);
		// Foliage that hangs to the ground does not lower the eye: the limb's own joint sets it.
		const skirted = shotOf(crownUndersideShot(tree({ crownBase: 0.05 }), lens, { turn: 90 * DEG }));
		expect(skirted.camera.position[1]).toBeCloseTo(1.6, 9);
		const ground = tree({
			trunk: trunkOf(1, 0.1, 0.1),
			crownBase: 0.1,
			limbs: [limbOf(1, 0.1, [1, 0.1, 0], 0.05, 0.6, 0.1)],
		});
		expect(isAbsent(crownUndersideShot(ground, lens, { turn: 90 * DEG }))).toBe(true);
	});
});

describe('the view from inside the crown', () => {
	const lens = { fov: 75, aspect: 3 / 4 };

	test('stands beside the trunk above the crown base and looks up along it', () => {
		const subjects = tree();
		const shot = shotOf(insideShot(subjects, lens, { turn: 0 }));
		expect(shot.facts.wood).toBe('trunk');
		// Inside the crown: above its base, and near the trunk.
		expect(shot.camera.position[1]).toBeGreaterThan(5);
		expect(shot.camera.position[1]).toBeLessThan(9);
		expect(Math.hypot(shot.camera.position[0], shot.camera.position[2])).toBeLessThan(3);
		expect(pitchOf(shot.camera)).toBeCloseTo(40, 0);
		const check = checkShot(shot, lens);
		expect(check.present).toBe(true);
		expect(check.points[0]?.size as number).toBeCloseTo(0.28, 1);
	});

	test('stands in the widest gap between the limbs that leave near its height', () => {
		const limbs = [
			limbOf(1, 6.5, [1, 0.3, 0], 0.3, 8, 0.4),
			limbOf(2, 6.8, [0, 0.3, 1], 0.25, 6, 0.4),
			limbOf(3, 7, [1, 0.3, 1], 0.2, 6, 0.4),
		];
		const shot = shotOf(insideShot(tree({ limbs }), lens, { turn: 0 }));
		// The limbs leave between +X and +Z, so the camera stands on the far side of the trunk.
		expect(shot.camera.position[0]).toBeLessThan(0);
		expect(shot.camera.position[2]).toBeLessThan(0);
		expect(shot.facts.gap as number).toBeCloseTo(270, 4);
	});

	test('stays inside the crown beside a trunk too thick to take its share from there', () => {
		// A sequoia: the trunk 5 m through inside a crown that reaches 8 m.
		const subjects = tree({
			trunk: trunkOf(57, 3, 20),
			height: 57,
			reach: 8,
			crownBase: 19,
			limbs: [limbOf(1, 20, [1, 0, 0], 0.5, 6, 2.6), limbOf(2, 30, [0, 0, 1], 0.5, 6, 2.4)],
		});
		const shot = shotOf(insideShot(subjects, lens, { turn: 0 }));
		const out = Math.hypot(shot.camera.position[0], shot.camera.position[2]);
		expect(out).toBeLessThanOrEqual(0.5 * 8 + 1e-9);
		// It stands above where the bole ends, not at the lowest foliage.
		expect(shot.camera.position[1]).toBeGreaterThan(20);
		expect(checkShot(shot, lens).present).toBe(true);
	});

	test('looks along the thickest limb where the trunk does not run on into the crown', () => {
		const subjects = tree({ trunk: trunkOf(5.2, 0.5, 5) });
		const shot = shotOf(insideShot(subjects, lens, { turn: 90 * DEG }));
		expect(shot.facts.wood).toBe('limb');
		expect(shot.facts.limb).toBe(1);
		// Beside the limb and under it.
		expect(shot.camera.position[1]).toBeLessThan(5.5);
		expect(checkShot(shot, lens).present).toBe(true);
	});
});

describe('the bark views', () => {
	test("the foot fills half the frame's width, whatever the trunk's thickness", () => {
		for (const radius of [0.08, 0.5, 2.5]) {
			const subjects = tree({ trunk: trunkOf(14, radius, 5) });
			for (const lens of [WIDE, TALL]) {
				const shot = shotOf(barkBaseShot(subjects, lens, { turn: 0 }));
				const foot = landing(shot, lens, "the trunk's foot");
				expect(foot.x).toBeCloseTo(0.5, 6);
				expect(foot.y).toBeCloseTo(0.85, 6);
				expect(shareOfWidth(shot, lens, [0, 0, 0], 2 * radius)).toBeCloseTo(0.5, 6);
				expect(pitchOf(shot.camera)).toBeCloseTo(-12, 6);
				expect(checkShot(shot, lens).present).toBe(true);
			}
		}
	});

	test('the mid-trunk frame narrows to the bark a thin trunk has', () => {
		const thin = tree({ trunk: trunkOf(10, 0.12, 5) });
		const lens = { fov: 40, aspect: 1 };
		const shot = shotOf(barkMidShot(thin, lens, { turn: 0 }));
		// The frame covers no more than four fifths of the trunk's width, so no backdrop shows.
		expect(shot.facts.span as number).toBeLessThan(0.6);
		expect(shot.facts.barkShare).toBe(1);
		expect(checkShot(shot, lens).present).toBe(true);
		// A great bole keeps the default span.
		const great = shotOf(barkMidShot(tree({ trunk: trunkOf(14, 1, 5) }), lens, { turn: 0 }));
		expect(great.facts.span).toBe(0.6);
		expect(great.facts.height).toBe(1.5);
	});

	test('the mid-trunk frame keeps a named span, and asks only for the bark the trunk can give', () => {
		const thin = tree({ trunk: trunkOf(10, 0.12, 5) });
		const lens = { fov: 40, aspect: 1 };
		const shot = shotOf(barkMidShot(thin, lens, { turn: 0, span: 0.6 }));
		expect(shot.facts.span).toBe(0.6);
		expect(shot.facts.barkShare as number).toBeLessThan(0.5);
		const region = shot.regions[0];
		expect((region?.box[2] as number) - (region?.box[0] as number)).toBeLessThan(0.4);
		expect(checkShot(shot, lens).present).toBe(true);
		expect(isAbsent(barkMidShot(thin, lens, { turn: 0, height: 40 }))).toBe(true);
	});

	test("the limb's thickness takes its girth of the frame, the limb crossing it", () => {
		const subjects = tree();
		const shot = shotOf(barkLimbShot(subjects, TALL, { girth: 0.38, along: 0.3 }));
		const check = checkShot(shot, TALL);
		expect(check.present).toBe(true);
		expect(check.points[0]?.size as number).toBeCloseTo(0.38, 6);
		const one = landing(shot, TALL, 'the limb running one way');
		const other = landing(shot, TALL, 'the limb running the other way');
		expect(Math.abs(one.x - other.x)).toBeGreaterThan(0.6);
		// The camera stands level, square across the limb's run.
		const limb = (subjects.limbs as readonly GreatLimb[])[0] as GreatLimb;
		expect(dot(cameraAxes(shot.camera).forward, limb.direction)).toBeCloseTo(0, 9);
	});

	test('a limb that rises steeply runs up the frame, and still counts as crossing it', () => {
		const steep = tree({ limbs: [limbOf(1, 5, [0.2, 1, 0], 0.2, 9, 0.4)] });
		const shot = shotOf(barkLimbShot(steep, TALL, { girth: 0.38 }));
		const one = landing(shot, TALL, 'the limb running one way');
		const other = landing(shot, TALL, 'the limb running the other way');
		expect(Math.abs(one.y - other.y)).toBeGreaterThan(0.4);
		expect(checkShot(shot, TALL).present).toBe(true);
	});

	test('a bark view of a plant with no wood gives no shot', () => {
		const tuft = tree({ trunk: absent('a tuft has no stem'), limbs: absent('a tuft has no stem') });
		expect(barkBaseShot(tuft, WIDE, { turn: 0 })).toEqual({ absent: 'a tuft has no stem' });
		expect(barkMidShot(tuft, WIDE, { turn: 0 })).toEqual({ absent: 'a tuft has no stem' });
		expect(barkLimbShot(tuft, WIDE)).toEqual({ absent: 'a tuft has no stem' });
	});
});

/** The share of the frame's width that `metres` take at a point's depth. */
function shareOfWidth(shot: SubjectShot, lens: typeof WIDE, at: V3, metres: number): number {
	const depth = project(shot.camera, lens, at).depth;
	return metres / (2 * depth * Math.tan((lens.fov * DEG) / 2) * lens.aspect);
}

describe('the view of one branch piece', () => {
	const piece = {
		socket: [2, 6, 1] as V3,
		direction: normalize([1, -0.6, 0.2]),
		length: 1.1,
		spread: 0.3,
	};

	test('stands the piece on its cut, filling the frame from cut to tip', () => {
		const shot = shotOf(branchPieceShot(piece, TALL));
		const cut = landing(shot, TALL, 'the cut');
		const tip = landing(shot, TALL, 'the tip');
		expect(cut.x).toBeCloseTo(0.5, 6);
		expect(tip.x).toBeCloseTo(0.5, 6);
		expect(cut.y - tip.y).toBeCloseTo(0.85, 6);
		expect(checkShot(shot, TALL).present).toBe(true);
	});

	test('lays the piece across the frame with its cut at the left', () => {
		const shot = shotOf(branchPieceShot(piece, WIDE, { laid: true }));
		const cut = landing(shot, WIDE, 'the cut');
		const tip = landing(shot, WIDE, 'the tip');
		expect(cut.y).toBeCloseTo(0.5, 6);
		expect(tip.x - cut.x).toBeCloseTo(0.85, 6);
		expect(checkShot(shot, WIDE).present).toBe(true);
	});

	test('widens the frame for a piece that spreads more than it runs', () => {
		const wide = shotOf(branchPieceShot({ ...piece, spread: 2 }, TALL));
		expect(wide.facts.frame as number).toBeCloseTo(4 / (0.85 * TALL.aspect), 9);
		expect(isAbsent(branchPieceShot({ ...piece, length: 0 }, TALL))).toBe(true);
	});
});

describe('the subject check', () => {
	test('says which point is missing when the camera does not hold the subject', () => {
		const shot = shotOf(junctionShot(tree(), TALL));
		// The same contract through a camera that stands back and looks away from the joint.
		const away: SubjectShot = {
			...shot,
			camera: { position: [0, 5, 30], target: [20, 5, 0] },
		};
		const check = checkShot(away, TALL);
		expect(check.present).toBe(false);
		expect(check.reason).toContain('the collar, where the limb meets the trunk lands at');
		// A camera pressed against the bark holds the collar but not the limb's size.
		const pressed: SubjectShot = {
			...shot,
			camera: {
				position: [
					shot.camera.target[0] + (shot.camera.position[0] - shot.camera.target[0]) * 0.05,
					shot.camera.target[1] + (shot.camera.position[1] - shot.camera.target[1]) * 0.05,
					shot.camera.target[2] + (shot.camera.position[2] - shot.camera.target[2]) * 0.05,
				],
				target: shot.camera.target,
			},
		};
		expect(checkShot(pressed, TALL).present).toBe(false);
	});

	test('fails a fork whose arms do not part across the frame', () => {
		const shot = shotOf(forkShot(tree({ forks: [forkOf()] }), TALL));
		const closed: SubjectShot = {
			...shot,
			points: shot.points.map((p) =>
				p.name === 'the other arm' ? { ...p, at: shot.points[2]?.at as V3 } : p,
			),
		};
		const check = checkShot(closed, TALL);
		expect(check.present).toBe(false);
		expect(check.reason).toContain(
			'one arm and the other arm do not stand 0.12 of the width apart',
		);
	});
});

describe('what stands on a sight line', () => {
	test('names the trunk or the limb whose wood the line passes through, less the subject', () => {
		const subjects = tree();
		expect(blockedBy(subjects, [0, 2, 5], [0, 2, -5])).toBe('the trunk');
		expect(blockedBy(subjects, [0, 2, 5], [0, 2, -5], { trunk: true })).toBe(undefined);
		// The first limb runs toward +X from 5 m up.
		expect(blockedBy(subjects, [4, 9, 3], [4, 3, -3], { trunk: true })).toBe('limb 1');
		expect(blockedBy(subjects, [4, 9, 3], [4, 3, -3], { trunk: true, limbs: [1] })).toBe(undefined);
		expect(blockedBy(subjects, [10, 1, 5], [10, 1, -5])).toBe(undefined);
	});
});
