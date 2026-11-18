// Creek's valley: where its trees, its bank plants and its dead wood stand. The trees stand in
// groves on the far bank and in a looser line on the near bank, the lines that the camera's route
// runs behind. The plants below them follow the ground's own rules: ferns in the shade and the damp
// under the crowns, hostas in the moist shade near the water, shrubs at the woods' edges,
// wildflower clumps in the open sun, and fallen wood on the woods' floor. Each rule scores a
// candidate place by how well the ground there suits it, so the valley's look follows the land.
// One seed places it all, so every device and both GPU paths draw the same valley. A plant that the
// camera's route would fly into is left out, so no pass crosses a crown.
import { routePosition, routeTimeline } from '../../lib/cinematic';
import { random } from '../../lib/procedural';
import { groundHeight, streamHalf, streamZ, WATER } from './land';
import type { PlantKind, TreeKind } from './models';
import { SHOTS } from './route';

/** The seed that places the valley. */
export const SEED = 7;

/** The size of each model at scale 1: its height and the reach of its leaves about its foot. */
export const SIZES: Record<TreeKind | PlantKind | 'deadwood', { height: number; reach: number }> = {
	oak: { height: 9.5, reach: 4.9 },
	beech: { height: 11.8, reach: 4 },
	birch: { height: 9.7, reach: 4.6 },
	fern: { height: 0.7, reach: 0.7 },
	hosta: { height: 0.5, reach: 0.65 },
	shrub: { height: 1.35, reach: 0.85 },
	flowers: { height: 0.56, reach: 0.25 },
	deadwood: { height: 0.45, reach: 2.5 },
};

/**
 * The trees: each one's place along the stream, its distance from the stream's middle, its kind and
 * its size. Groves stand on the far bank, with young trees among them, and a few trees on the near
 * bank frame the view.
 */
const TREES: readonly (readonly [number, number, TreeKind, number])[] = [
	[-3, -8.5, 'oak', 0.85],
	[5.5, -10, 'beech', 0.85],
	[15, -7.5, 'birch', 0.8],
	[-16, -9, 'beech', 0.9],
	[13, 8.5, 'oak', 0.85],
	[-9, -12, 'birch', 0.75],
	[21, -10, 'oak', 0.9],
	[1, -13.5, 'beech', 1],
	[8.5, -14, 'oak', 0.95],
	[18, -13, 'beech', 0.9],
	[24, -6, 'birch', 0.7],
	[-20, -6, 'oak', 0.8],
	[2, -6.8, 'birch', 0.5],
	[17, 6.5, 'birch', 0.65],
	[22, 9, 'beech', 0.85],
	[8, 9.5, 'oak', 0.75],
	[-14, 7.5, 'birch', 0.7],
];

/** One placed model: its kind, its foot on the ground, its turn about y and its size. */
export interface Spot<Kind extends string = string> {
	readonly kind: Kind;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly yaw: number;
	readonly size: number;
}

/** The ground's measures that a rule reads, at one point. */
interface Ground {
	/** The ground's height over the water, in meters. */
	readonly height: number;
	/** The distance from the water's edge, in meters. */
	readonly water: number;
	/** The rise over the run of the ground. */
	readonly slope: number;
	/** How deep in a crown's shade the point lies, from 0 in the open to 1 at a trunk. */
	readonly shade: number;
	/** How near a crown's rim the point lies, from 0 away from it to 1 just past it. */
	readonly edge: number;
	/** A slow wave over the banks, from 0 to 1, whose crests gather a kind into patches. */
	readonly patch: number;
}

/**
 * A tolerance of one measure: no plant below `min` or above `max`, every plant from `best` to
 * `worst`, and fewer toward each end.
 */
type Tolerance = readonly [keyof Ground, number, number, number, number];

/** A rule of the ground cover: what it places, how far apart, how large, and where. */
interface Rule {
	readonly kind: PlantKind | 'deadwood';
	/** The side of the grid's cell that holds one candidate, in meters. */
	readonly spacing: number;
	/** The smallest and largest size of a copy. */
	readonly scale: readonly [number, number];
	readonly tolerances: readonly Tolerance[];
	/**
	 * The most copies that gather around each placed one, and how far from it, in meters: ferns,
	 * hostas and wildflowers grow in clumps, as they spread from their roots and their seed.
	 */
	readonly clump?: readonly [number, number];
}

/**
 * The rules of the ground cover, in the order they place. A plant keeps its room from every plant
 * that stood before it, so the rules that place first take the best ground.
 */
const RULES: readonly Rule[] = [
	{
		kind: 'deadwood',
		spacing: 5,
		scale: [0.6, 1.2],
		tolerances: [
			['shade', 0.25, 0.5, 1, 1.01],
			['height', 0.1, 0.3, 8, 12],
			['slope', -1, 0, 0.35, 0.7],
		],
	},
	{
		kind: 'shrub',
		spacing: 1.8,
		scale: [0.9, 1.5],
		clump: [2, 1.8],
		tolerances: [
			['edge', 0.15, 0.5, 1, 1.01],
			['height', 0.2, 0.4, 6, 10],
			['slope', -1, 0, 0.5, 0.9],
		],
	},
	{
		kind: 'hosta',
		spacing: 1.8,
		scale: [1, 1.6],
		clump: [3, 1.6],
		tolerances: [
			['shade', -0.4, 0.3, 1, 1.01],
			['water', 0.2, 0.8, 6, 10],
			['height', 0.05, 0.2, 2, 4],
		],
	},
	{
		kind: 'fern',
		spacing: 1.2,
		scale: [1, 1.6],
		clump: [4, 1.8],
		tolerances: [
			['shade', -0.5, 0.35, 1, 1.01],
			['water', 0.3, 0.8, 8, 14],
			['height', 0.1, 0.3, 4, 8],
		],
	},
	{
		kind: 'flowers',
		spacing: 1.2,
		scale: [1.3, 1.9],
		clump: [5, 1.2],
		tolerances: [
			['shade', -1, 0, 0.05, 0.2],
			['water', 0.6, 1.5, 9, 14],
			['slope', -1, 0, 0.4, 0.8],
			['patch', 0.5, 0.62, 1, 1.01],
		],
	},
];

/** How far along the valley the ground cover reaches from the middle, in meters. */
const REACH_X = 44;
/** How far from the stream's middle the ground cover reaches, in meters. */
const REACH_Z = 24;
/** How close the camera may come to a model, in meters, beyond the reach of its leaves. */
const CLEARANCE = 0.6;
/** The points along the route that the clearance is measured from. */
const ROUTE_SAMPLES = 2000;

/** What the placement reads of the scene: where the stones and the cave stand. */
export interface ValleyOptions {
	/** True where a stone covers the ground, which nothing grows through. */
	readonly rocks?: (x: number, z: number) => boolean;
}

/** The placed valley. */
export interface Valley {
	readonly trees: readonly Spot<TreeKind>[];
	readonly plants: readonly Spot<PlantKind>[];
	readonly deadwood: readonly Spot<'deadwood'>[];
}

/** The share of a tolerance that a value meets, from 0 to 1. */
function meets(value: number, [, min, best, worst, max]: Tolerance): number {
	if (value <= min || value >= max) return 0;
	if (value < best) return (value - min) / (best - min);
	if (value > worst) return (max - value) / (max - worst);
	return 1;
}

/** The ground's measures at a point, with the shade and the woods' edges of the trees. */
function groundAt(x: number, z: number, trees: readonly Spot[]): Ground {
	const step = 0.5;
	const height = groundHeight(x, z);
	const slope =
		Math.hypot(
			groundHeight(x + step, z) - groundHeight(x - step, z),
			groundHeight(x, z + step) - groundHeight(x, z - step),
		) /
		(2 * step);
	let shade = 0;
	let edge = 0;
	for (const tree of trees) {
		const reach = SIZES[tree.kind as TreeKind].reach * tree.size;
		const across = Math.hypot(x - tree.x, z - tree.z) / reach;
		shade = Math.max(shade, Math.min(1, Math.max(0, (1.05 - across) / 0.7)));
		edge = Math.max(edge, Math.max(0, 1 - Math.abs(across - 1.15) / 0.45));
	}
	return {
		height: height - WATER,
		water: Math.max(0, Math.abs(z - streamZ(x)) - streamHalf(x)),
		slope,
		shade,
		edge,
		patch: (Math.sin(x * 0.45 + 1.7) + Math.sin(z * 0.6 - x * 0.2) + 2) / 4,
	};
}

/** The camera's route as a list of places, finely enough that no bend slips between two points. */
function routeSamples(): [number, number, number][] {
	const route = routeTimeline(SHOTS);
	const pose = new Float32Array(6);
	const places: [number, number, number][] = [];
	for (let step = 0; step <= ROUTE_SAMPLES; step++) {
		routePosition(route, (step / ROUTE_SAMPLES) * route.total, pose);
		places.push([pose[0] as number, pose[1] as number, pose[2] as number]);
	}
	return places;
}

/** A model's room, as a cylinder about its foot: the reach of its leaves and its top. */
export interface Solid {
	readonly kind: string;
	readonly x: number;
	readonly z: number;
	/** The reach about its foot, with the camera's clearance, in meters. */
	readonly radius: number;
	/** The height of its top, with the camera's clearance, in meters. */
	readonly top: number;
}

/** The room that one placed model keeps. */
export function solidOf(spot: Spot): Solid {
	const size = SIZES[spot.kind as keyof typeof SIZES];
	return {
		kind: spot.kind,
		x: spot.x,
		z: spot.z,
		radius: size.reach * spot.size + CLEARANCE,
		top: spot.y + size.height * spot.size + CLEARANCE,
	};
}

/** True when a route pose passes through a model's room. */
export function hits(solid: Solid, pose: readonly [number, number, number]): boolean {
	return pose[1] <= solid.top && Math.hypot(pose[0] - solid.x, pose[2] - solid.z) < solid.radius;
}

/**
 * Places the valley: the trees on the banks, then each rule of the ground cover over a jittered
 * grid, where the ground suits it, with room from what stood before and clear of the route.
 *
 * @param options Where the stones stand.
 * @returns The trees, the plants and the dead wood.
 */
export function placeValley(options: ValleyOptions = {}): Valley {
	const next = random(SEED);
	const route = routeSamples();
	const clearOfRoute = (spot: Spot) => {
		const solid = solidOf(spot);
		return !route.some((pose) => hits(solid, pose));
	};
	const trees = TREES.map(([x, dz, kind, size]): Spot<TreeKind> => {
		const z = streamZ(x) + dz;
		return {
			kind,
			x,
			y: groundHeight(x, z) - 0.1,
			z,
			yaw: next() * Math.PI * 2,
			size: size * (0.92 + 0.16 * next()),
		};
	}).filter(clearOfRoute);
	/** The rooms that the placed ground cover keeps, and the trunks, which nothing grows through. */
	const taken: { x: number; z: number; r: number }[] = trees.map(({ x, z }) => ({ x, z, r: 0.8 }));
	const plants: Spot<PlantKind>[] = [];
	const deadwood: Spot<'deadwood'>[] = [];
	/** How well the ground at a point suits a rule, from 0 to 1, or 0 where a stone covers it. */
	const scoreAt = (rule: Rule, x: number, z: number): number => {
		if (options.rocks?.(x, z)) return 0;
		const ground = groundAt(x, z, trees);
		let score = 1;
		for (const tolerance of rule.tolerances) score *= meets(ground[tolerance[0]], tolerance);
		return score;
	};
	/** Places a copy of a rule's kind where it keeps its room and the route misses it. */
	const place = (rule: Rule, x: number, z: number, yaw: number, size: number): boolean => {
		const r = SIZES[rule.kind].reach * size * 0.8;
		if (taken.some((t) => (x - t.x) ** 2 + (z - t.z) ** 2 < (r + t.r) ** 2)) return false;
		const spot = { kind: rule.kind, x, y: groundHeight(x, z), z, yaw, size };
		if (!clearOfRoute(spot)) return false;
		taken.push({ x, z, r });
		if (spot.kind === 'deadwood') deadwood.push(spot as Spot<'deadwood'>);
		else plants.push(spot as Spot<PlantKind>);
		return true;
	};
	for (const rule of RULES) {
		for (let gx = -REACH_X; gx < REACH_X; gx += rule.spacing)
			for (let gz = -REACH_Z; gz < REACH_Z; gz += rule.spacing) {
				const x = gx + next() * rule.spacing;
				const z = streamZ(x) + gz + next() * rule.spacing;
				const chance = next();
				const size = rule.scale[0] + (rule.scale[1] - rule.scale[0]) * next();
				const yaw = next() * Math.PI * 2;
				if (chance >= scoreAt(rule, x, z)) continue;
				if (!place(rule, x, z, yaw, size)) continue;
				// The clump: copies that gather about this one, where the ground suits them too.
				const [count, spread] = rule.clump ?? [0, 0];
				for (let k = 0; k < count; k++) {
					const turn = next() * Math.PI * 2;
					const away = spread * Math.sqrt(next());
					const cx = x + Math.cos(turn) * away;
					const cz = z + Math.sin(turn) * away;
					const grown = size * (0.7 + 0.3 * next());
					const cyaw = next() * Math.PI * 2;
					if (next() < scoreAt(rule, cx, cz)) place(rule, cx, cz, cyaw, grown);
				}
			}
	}
	return { trees, plants, deadwood };
}

/**
 * The room that every placed model keeps, which the camera's route must miss.
 *
 * @param valley The models that `placeValley` placed.
 * @returns One cylinder for each tree and plant.
 */
export function valleySolids(valley: Valley): Solid[] {
	return [...valley.trees, ...valley.plants].map(solidOf);
}
