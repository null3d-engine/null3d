// The frond-colony grower: bracken. The plant has no crown. A few buried rhizome lines run out from
// the colony's middle and wander, and fronds rise from them one by one at the rhizome's spacing,
// each alone on a bare stipe. A stipe stands near upright with its own lean and bows a little toward
// where its blade reaches; at its top the rachis turns over so the blade is held near level, each
// frond at its own height, so the blades stand in loose tiers.
//
// Each frond is two axes: the stipe (AXIS_STIPE, rooted at the ground, so the wood mesher draws it
// as a stem with the species' bark zones by height: black at the soil, green above) and the rachis
// (AXIS_RACHIS, leading on from the stipe's top). One bud site at the blade's base carries the frond:
// +Y along the rachis, +Z its upper face, and its vigor is the frond's age, 0 a new crozier, 0.5
// mature, 1 brown and dead. The foliage reads only the skeleton, so a cut piece keeps its fronds.
//
// The season sets the ages: spring croziers unrolling; summer mature fronds with the record's few
// late croziers; autumn browning fronds; winter dead fronds lying flat in a mat, a few stipes
// standing broken.
import {
	AXIS_RACHIS,
	AXIS_ROOT,
	AXIS_STIPE,
	BUD_TERMINAL,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { unitAt } from '../core/hash';
import {
	atan2,
	cos,
	normalize3,
	PI,
	quatFromFrame,
	radians,
	sin,
	tan,
	type Vector3,
} from '../core/math';
import type { FrondColony, Species } from '../core/record';
import { type Season, spreadAt } from '../core/types';
import { frondAge, frondFoliage, MATURE_AGE, rachisCurve } from '../leaf/frond';
import type { GrowInput } from '../stages';
import type { Grower } from './models';
import { growSoil } from './soil';

/** Draw purposes, so no two draws share a key. */
const DRAW = {
	count: 1,
	lines: 2,
	lineTurn: 3,
	wander: 4,
	spacing: 5,
	offset: 6,
	age: 7,
	young: 8,
	stipe: 9,
	lean: 10,
	leanTurn: 11,
	heading: 12,
	blade: 13,
	bow: 14,
	broken: 15,
	soilRoot: 30,
	soilRhizome: 31,
} as const;

/** Metres between the points that trace a rhizome line. */
const RHIZOME_STEP = 0.1;
/** The most a rhizome line turns over one step, in radians. */
const RHIZOME_WANDER = 0.35;
/** Metres between a stipe's nodes. */
const STIPE_NODE = 0.08;
/** Degrees a stipe bows toward its blade's reach over its upper half. */
const STIPE_BOW = 10;
/** A stipe's radius at its top, as a share of its foot's. */
const STIPE_TAPER = 0.75;
/** The thinnest a rachis gets at its tip, in metres of radius. */
const RACHIS_TIP = 0.0005;
/** Degrees a dead winter frond's stipe lies from upright, least and most: flat on the ground. */
const SLUMPED = [84, 89] as const;
/** The share of dead winter fronds whose stipe stands broken, its blade gone. */
const BROKEN = 0.18;
/** Metres a lying frond's rachis stays above the ground, over its radius. */
const GROUND_CLEARANCE = 0.004;
/** The size a crozier rises at, as a share of its mature size, when it has not unrolled at all. */
const YOUNG_SIZE = 0.35;

/** The record's frond-colony growth, or a fault for another model. */
function colonyOf(record: Species): FrondColony {
	if (record.growth.model !== 'frond-colony')
		throw new Error(
			`@null3d/vegetation: the frond-colony grower got a '${record.growth.model}' record`,
		);
	return record.growth;
}

/** One frond's place and form before its axes are laid. */
interface FrondPlan {
	readonly x: number;
	readonly z: number;
	readonly line: number;
	readonly age: number;
}

/**
 * Where the fronds rise: along rhizome lines that leave the colony's middle at even turns and
 * wander, a frond at each spacing along a line, a little to either side of it, the lines taking
 * turns so the colony spreads evenly.
 */
function frondPlaces(
	input: GrowInput,
	colony: FrondColony,
): { places: { x: number; z: number; line: number }[]; lines: number } {
	const { seed, variant } = input;
	const salt = input.record.seedSalt >>> 0;
	const draw = (purpose: number, index = 0) => unitAt(seed, salt, variant, purpose, index);
	const count = Math.max(1, Math.round(spreadAt(colony.fronds, draw(DRAW.count))));
	const lines = Math.max(1, 1 + Math.round(spreadAt(colony.rhizome.branches, draw(DRAW.lines))));
	const start = draw(DRAW.lineTurn) * 2 * PI;
	// Each line traced from the middle out, a point each step.
	const traces: number[][] = [];
	for (let l = 0; l < lines; l++) {
		let heading = start + (2 * PI * l) / lines;
		let x = 0;
		let z = 0;
		const trace = [x, z];
		const steps = Math.ceil(colony.rhizome.length / RHIZOME_STEP);
		for (let s = 0; s < steps; s++) {
			heading += (draw(DRAW.wander, l * 4096 + s) * 2 - 1) * RHIZOME_WANDER;
			x += cos(heading) * RHIZOME_STEP;
			z += sin(heading) * RHIZOME_STEP;
			trace.push(x, z);
		}
		traces.push(trace);
	}
	const reached = new Float64Array(lines);
	const places: { x: number; z: number; line: number }[] = [];
	for (let f = 0; f < count; f++) {
		const l = f % lines;
		const gap = Math.max(0.02, spreadAt(colony.rhizome.spacing, draw(DRAW.spacing, f)));
		// The first frond of each line rises half a spacing out, so the middle is not crowded.
		const along = (reached[l] as number) + (f < lines ? gap / 2 : gap);
		if (along > colony.rhizome.length) continue;
		reached[l] = along;
		const trace = traces[l] as number[];
		const at = Math.min(trace.length / 2 - 1.001, along / RHIZOME_STEP);
		const i = Math.floor(at);
		const t = at - i;
		const x0 = trace[i * 2] as number;
		const z0 = trace[i * 2 + 1] as number;
		const x1 = trace[i * 2 + 2] as number;
		const z1 = trace[i * 2 + 3] as number;
		const dx = x1 - x0;
		const dz = z1 - z0;
		const d = Math.sqrt(dx * dx + dz * dz) || 1;
		const aside = (draw(DRAW.offset, f) * 2 - 1) * gap * 0.35;
		places.push({
			x: x0 + dx * t - (dz / d) * aside,
			z: z0 + dz * t + (dx / d) * aside,
			line: l,
		});
	}
	return { places, lines };
}

/** A frond's age for the season: its share of the way from a new crozier to dead. */
function ageFor(
	season: Season,
	colony: FrondColony,
	input: GrowInput,
	index: number,
	count: number,
): number {
	const salt = input.record.seedSalt >>> 0;
	const draw = (purpose: number) => unitAt(input.seed, salt, input.variant, purpose, index);
	const unit = draw(DRAW.age);
	switch (season) {
		case 'blossom':
			return 0.04 + unit * (MATURE_AGE - 0.06);
		case 'autumn':
			return 0.65 + unit * 0.3;
		case 'winter':
			return 1;
		default: {
			const croziers = Math.max(0, spreadAt(colony.croziers, draw(DRAW.young)));
			return unit < croziers / Math.max(1, count)
				? 0.08 + draw(DRAW.young + 32) * 0.36
				: MATURE_AGE;
		}
	}
}

/**
 * Grows a frond colony: its rhizome's fronds, each a stipe and a rachis with one bud site.
 *
 * @param input The record, the seed, the variant and the season.
 * @returns The skeleton.
 * @category api/vegetation
 */
export function growFrondColony(input: GrowInput): MacroSkeleton {
	const { record, seed, variant, season } = input;
	const colony = colonyOf(record);
	const shape = colony.frond;
	const salt = record.seedSalt >>> 0;
	const draw = (purpose: number, index: number) => unitAt(seed, salt, variant, purpose, index);
	const { places, lines } = frondPlaces(input, colony);
	const plans: FrondPlan[] = places.map((place, f) => ({
		...place,
		age: ageFor(season, colony, input, f, places.length),
	}));
	const builder = new SkeletonBuilder();
	const frame = new Float32Array(4);
	// The first stipe's foot is where a soil without its own rhizome would root.
	let firstStipe = -1;
	let firstBase = -1;
	plans.forEach((plan, f) => {
		const age = frondAge(plan.age);
		const size = YOUNG_SIZE + (1 - YOUNG_SIZE) * age.unrolled;
		const stipeLength = Math.max(0.05, spreadAt(colony.stipe.length, draw(DRAW.stipe, f)) * size);
		const bladeLength = Math.max(0.05, spreadAt(shape.length, draw(DRAW.blade, f)) * size);
		// Blades reach outward from the colony's middle, give or take.
		const outward = plan.x * plan.x + plan.z * plan.z > 1e-6 ? atan2(plan.z, plan.x) : 0;
		const heading = outward + (draw(DRAW.heading, f) * 2 - 1) * 0.6 * PI;
		// A dead winter frond lies flat, or stands as a broken stipe with its blade gone.
		const dead = age.brown >= 1 && season === 'winter';
		const broken = dead && draw(DRAW.broken, f) < BROKEN;
		const lying = dead && !broken;
		const leanDegrees = lying
			? SLUMPED[0] + draw(DRAW.lean, f) * (SLUMPED[1] - SLUMPED[0])
			: Math.abs(spreadAt(colony.stipe.lean, draw(DRAW.lean, f))) * (broken ? 3 : 1);
		const leanTurn = lying ? heading : draw(DRAW.leanTurn, f) * 2 * PI;
		const lean = tan(radians(Math.min(leanDegrees, SLUMPED[1])));
		const bowDegrees = lying ? 0 : STIPE_BOW * (0.5 + draw(DRAW.bow, f));
		const standing = broken ? stipeLength * (0.2 + 0.3 * draw(DRAW.broken + 32, f)) : stipeLength;
		// The stipe from the soil up, its nodes tracing its lean and its bow.
		const stipeAxis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STIPE });
		const radius = Math.max(shape.petiole.width / 2, RACHIS_TIP) * (0.6 + 0.4 * size);
		const nodes = Math.max(2, Math.ceil(standing / STIPE_NODE));
		let x = plan.x;
		let y = 0;
		let z = plan.z;
		let node = -1;
		const direction: Vector3 = [0, 1, 0];
		const stipeDirection = (share: number): Vector3 => {
			const bow = tan(radians(bowDegrees * share * share));
			return normalize3([
				lean * cos(leanTurn) + bow * cos(heading),
				1,
				lean * sin(leanTurn) + bow * sin(heading),
			]);
		};
		node = builder.addNode({ x, y, z, radius, parent: -1, axis: stipeAxis });
		if (f === 0) {
			firstStipe = stipeAxis;
			firstBase = node;
		}
		for (let n = 1; n <= nodes; n++) {
			const step = stipeDirection((n - 0.5) / nodes);
			x += (step[0] * standing) / nodes;
			y += (step[1] * standing) / nodes;
			z += (step[2] * standing) / nodes;
			node = builder.addNode({
				x,
				y,
				z,
				radius: radius * (1 - (1 - STIPE_TAPER) * (n / nodes)),
				parent: node,
				axis: stipeAxis,
			});
		}
		if (broken) return;
		const top = stipeDirection(1);
		direction[0] = top[0];
		direction[1] = top[1];
		direction[2] = top[2];
		// The rachis's plane: its base direction, and toward its lower face, where the blade reaches;
		// a lying frond's lower face is toward the ground, and its rachis runs on straight.
		const reach: Vector3 = lying ? [0, -1, 0] : [cos(heading), 0, sin(heading)];
		const dot = reach[0] * direction[0] + reach[1] * direction[1] + reach[2] * direction[2];
		const lower = normalize3([
			reach[0] - dot * direction[0],
			reach[1] - dot * direction[1],
			reach[2] - dot * direction[2],
		]);
		const curve = rachisCurve(lying ? { ...shape, droop: 0 } : shape, age, bladeLength);
		const rachisAxis = builder.addAxis({
			parent: stipeAxis,
			parentNode: node,
			parentT: 0,
			order: 1,
			kind: AXIS_RACHIS,
		});
		const baseRadius = radius * STIPE_TAPER;
		const points = curve.length / 3;
		let previous = node;
		let firstRachis = -1;
		for (let i = 1; i < points; i++) {
			const a = curve[i * 3] as number;
			const b = curve[i * 3 + 1] as number;
			const along = i / (points - 1);
			const rachisRadius = Math.max(RACHIS_TIP, baseRadius + (RACHIS_TIP - baseRadius) * along);
			previous = builder.addNode({
				x: x + direction[0] * a + lower[0] * b,
				y: Math.max(rachisRadius + GROUND_CLEARANCE, y + direction[1] * a + lower[1] * b),
				z: z + direction[2] * a + lower[2] * b,
				radius: rachisRadius,
				parent: previous,
				axis: rachisAxis,
			});
			if (firstRachis < 0) firstRachis = previous;
		}
		// The bud at the blade's base: +Y along the rachis, +Z its upper face, away from its reach.
		const bend = curve[2] as number;
		const along: Vector3 = normalize3([
			direction[0] * cos(bend) + lower[0] * sin(bend),
			direction[1] * cos(bend) + lower[1] * sin(bend),
			direction[2] * cos(bend) + lower[2] * sin(bend),
		]);
		const upper: Vector3 = [
			direction[0] * sin(bend) - lower[0] * cos(bend),
			direction[1] * sin(bend) - lower[1] * cos(bend),
			direction[2] * sin(bend) - lower[2] * cos(bend),
		];
		quatFromFrame(along, upper, frame);
		builder.addBud({
			node: firstRachis,
			x,
			y,
			z,
			frame,
			kind: BUD_TERMINAL,
			vigor: plan.age,
			light: 1,
			axis: rachisAxis,
			woodRadius: baseRadius,
		});
	});
	if (colony.soil && firstBase >= 0) {
		// The colony's rhizome and roots: the soil draws from its own purposes, so adding it after
		// the fronds cannot move a frond. Each rhizome line carries its own fronds, so its body runs
		// from the colony's middle through the feet of the stipes that line rises.
		const soilDraw = (purpose: number, a = 0, b = 0) =>
			unitAt(seed, salt, variant, purpose, a * 4096 + b);
		const reach = 2 * spreadAt(colony.soil.rhizome ?? 0, soilDraw(DRAW.soilRhizome) as number);
		const spines: [number, number][][] = [];
		for (let l = 0; l < lines; l++) {
			const spine: [number, number][] = [[0, 0]];
			for (const plan of plans)
				if (plan.line === l && Math.hypot(plan.x, plan.z) <= reach) spine.push([plan.x, plan.z]);
			if (spine.length > 1) spines.push(spine);
		}
		growSoil(
			builder,
			colony.soil,
			soilDraw,
			DRAW.soilRoot,
			DRAW.soilRhizome,
			firstStipe,
			firstBase,
			0.02,
			spines,
		);
	}
	const finished = builder.finish();
	if (!colony.soil) return finished;
	// The soil's nodes sit below the ground, outside every picture and the crown's light grid, so
	// the box is the fronds' alone and every view stands where it did before the rhizome was drawn.
	const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
	const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (let n = 0; n < finished.nodeCount; n++) {
		if ((finished.axes.kind[finished.axisOf[n] as number] as number) === AXIS_ROOT) continue;
		const radius = finished.radius[n] as number;
		for (let k = 0; k < 3; k++) {
			const value = finished.position[n * 3 + k] as number;
			min[k] = Math.min(min[k] as number, k === 1 ? value : value - radius);
			max[k] = Math.max(max[k] as number, k === 1 ? value : value + radius);
		}
	}
	if (!Number.isFinite(min[0])) return finished;
	return {
		...finished,
		bounds: {
			min: [min[0] as number, min[1] as number, min[2] as number],
			max: [max[0] as number, max[1] as number, max[2] as number],
		},
		height: max[1] as number,
	};
}

/** The frond-colony grower: the colony's skeleton, and its fronds as the variant's own foliage. */
export const grower: Grower = {
	grow: growFrondColony,
	foliage: frondFoliage,
};
