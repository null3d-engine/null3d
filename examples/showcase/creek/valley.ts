// The garden's planting: where its trees and its ground cover stand. The trees stand by hand where
// the concept has them. The ground cover follows rules: each scores a candidate place by how well
// the ground there suits its kind, grows clumps, and keeps its room from what stood before. Every
// rule scores zero where nothing grows: past the rim, in the creek and on its stones, on the gravel
// outside its moss islands, on the steps, the landing and the terrace, under the garden's models
// and walls, and where a plant would stand in the view to the statue. One seed places it all, so
// every device and both GPU paths draw the same garden. A plant that the camera's route would fly
// into is left out, so no pass crosses a crown.
import { routePosition, routeTimeline } from '../../lib/cinematic';
import { Noise, random } from '../../lib/procedural';
import { gardenPlaces, underGarden } from './garden';
import {
	bearingOf,
	gravelPlace,
	groundHeight,
	islandDistance,
	LANDING,
	rimRadius,
	streamHalf,
	streamZ,
	TERRACE,
} from './land';
import { SHOTS, WIDE } from './route';
import { onSteps } from './steps';
import { ROCK_REACH, rockPlaces } from './stones';

/** The seed that places the garden. */
export const SEED = 7;
/** The slow, uneven wave over the garden whose crests gather a kind into patches. */
const PATCHES = new Noise(SEED);

/** The trees that stand by hand: the three forms of the cloud-pruned pine. */
export const TREE_KINDS = ['pine-tall', 'pine-narrow', 'pine-low'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];
/** The ground cover that the rules place. */
export const PLANT_KINDS = ['fern', 'hosta'] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];

/** The size of each model at scale 1: its height and the reach of its foliage about its foot. */
export const SIZES: Record<TreeKind | PlantKind, { height: number; reach: number }> = {
	'pine-tall': { height: 7.7, reach: 5 },
	'pine-narrow': { height: 7.6, reach: 3.3 },
	'pine-low': { height: 3.5, reach: 2.8 },
	fern: { height: 0.77, reach: 0.82 },
	hosta: { height: 0.52, reach: 0.6 },
};

/**
 * The trees, by hand where the concept has them, from the references helper's planting map: each
 * one's label on the map, its place, its kind, its size and its turn about y away from showing its
 * broad side to the opening camera. The map's points come from the concept's pixels moved onto this
 * land by landmarks, then onto the ground through the opening camera. P1 is the tall pine beyond
 * the gravel's west end, P2 the tall narrow pine on the hill's top left, P3 leans over the front
 * lantern, P4 stands east of the steps' foot, its crown clear of them, and P6 at the hill's left
 * foot, both larger than the scale table's low pine as the concept's flatter lens shows them, P5
 * behind the statue's right shoulder, P7 and P8 small on the right hillside, a little inside the
 * rim, and P10 and P11 are the clipped tiny pines on the gravel's moss islands.
 */
export const TREES: readonly (readonly [string, number, number, TreeKind, number, number])[] = [
	['P1', -16.2, 0, 'pine-tall', 1, 0.2],
	['P2', -5.8, -16.6, 'pine-narrow', 1.05, -0.15],
	['P3', 1.6, 22.2, 'pine-low', 0.9, 0.3],
	['P4', 16.2, 8.6, 'pine-low', 1.4, -0.2],
	['P5', 8.4, -22.4, 'pine-narrow', 0.9, 0.1],
	['P6', -0.2, -7.6, 'pine-low', 1.5, -0.25],
	['P7', 18.3, -15.3, 'pine-narrow', 0.4, 0.25],
	['P8', 25.4, -1.9, 'pine-narrow', 0.35, -0.3],
	['P10', 2, 5.3, 'pine-low', 0.37, 0.4],
	['P11', 6.1, 7.1, 'pine-low', 0.2, -0.4],
];

/**
 * The turn about y that shows a model's broad side, along its own x, across the opening camera's
 * line of sight to a point.
 */
export function broadSideToCamera(x: number, z: number): number {
	const [dx, dz] = [x - WIDE[0], z - WIDE[2]];
	// The model's x turns to (cos, -sin) of the turn, which lies across the line of sight (dx, dz)
	// when the turn is the line's own bearing.
	return Math.atan2(dx, dz);
}

/**
 * The maples' and shrub-trees' places on the planting map, kept for when the maple model is
 * pinned: each one's label, its place and its color. M5 and S3 fall on the banks' stones and M9 on
 * the hill's rock, so each moves to the nearest growing ground when it stands.
 */
export const MAPLE_SPOTS: readonly (readonly [
	string,
	number,
	number,
	'red' | 'orange' | 'yellow' | 'bare',
])[] = [
	['M1', -7.8, -5.7, 'red'],
	['M2', -15.5, -6.5, 'red'],
	['M3', -20.7, 3.1, 'orange'],
	['M4', -22.3, 8.6, 'bare'],
	['M5', -13.4, 17.5, 'red'],
	['M6', -5.8, 21.1, 'orange'],
	['M7', 6.2, 22.9, 'red'],
	['M8', 9.2, 22.1, 'yellow'],
	['M9', 0.6, -16.4, 'orange'],
	['M10', 2.7, -18.5, 'red'],
	['M11', 12, -20.5, 'orange'],
	['M12', 15, -19, 'bare'],
	['M13', 19.9, -12.3, 'orange'],
	['M14', 23, 2.1, 'yellow'],
	['M15', 19.6, 4, 'red'],
	['M16', -10.7, -12.4, 'red'],
	['S1', -22.5, 5.2, 'red'],
	['S2', 15.4, -18.6, 'red'],
	['S3', 19.8, 14.2, 'orange'],
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
	/** The distance from the water's edge, in meters. */
	readonly water: number;
	/** The rise over the run of the ground. */
	readonly slope: number;
	/** How deep in a crown's shade the point lies, from 0 in the open to 1 at a trunk. */
	readonly shade: number;
	/** A slow wave over the garden, from 0 to 1, whose crests gather a kind into patches. */
	readonly patch: number;
}

/**
 * A tolerance of one measure: no plant below `min` or above `max`, every plant from `best` to
 * `worst`, and fewer toward each end.
 */
type Tolerance = readonly [keyof Ground, number, number, number, number];

/** A rule of the ground cover: what it places, how far apart, how large, and where. */
interface Rule {
	readonly kind: PlantKind;
	/** The side of the grid's cell that holds one candidate, in meters. */
	readonly spacing: number;
	/** The smallest and largest size of a copy. */
	readonly scale: readonly [number, number];
	readonly tolerances: readonly Tolerance[];
	/** The most copies that gather around each placed one, and how far from it, in meters. */
	readonly clump: readonly [number, number];
}

/**
 * The rules of the ground cover, in the order they place. A plant keeps its room from every plant
 * that stood before it, so the rules that place first take the best ground. The concept's low growth
 * gathers in clumps, never in even rows: hostas and ferns by the water where the patches gather
 * them, and ferns in the pines' shade.
 */
const RULES: readonly Rule[] = [
	{
		kind: 'hosta',
		spacing: 1.8,
		scale: [1, 1.5],
		clump: [4, 1.1],
		tolerances: [
			['water', 0, 0.3, 2.5, 4.5],
			['patch', 0.35, 0.55, 1, 1.01],
		],
	},
	{
		kind: 'fern',
		spacing: 1.6,
		scale: [0.9, 1.4],
		clump: [5, 1.3],
		tolerances: [['shade', 0.1, 0.35, 1, 1.01]],
	},
	{
		kind: 'fern',
		spacing: 2,
		scale: [0.9, 1.3],
		clump: [4, 1.2],
		tolerances: [
			['water', 0.2, 0.8, 3.5, 6],
			['patch', 0.4, 0.6, 1, 1.01],
		],
	},
];

/** How far from the garden's middle the ground cover's grid reaches each way, in meters. */
const REACH = 30;
/** How far inside the rim nothing grows, in meters, so no plant hangs over the edge. */
const RIM_KEEP = 0.8;
/** How far past the creek's half width its banks and stones stay bare, as a share of it. */
const BANK_KEEP = 1.3;
/** How close the camera may come to a model, in meters, beyond the reach of its leaves. */
const CLEARANCE = 0.6;
/** The points along the route that the clearance is measured from. */
const ROUTE_SAMPLES = 2000;
/**
 * The points of the statue that the opening camera keeps in view, from its foot to its head and
 * out to its knees, as offsets in meters from its foot.
 */
const STATUE_VIEW: readonly (readonly [number, number, number])[] = [
	[0, 1, 0],
	[0, 4, 0],
	[0, 7.5, 0],
	[-3, 1.5, 0],
	[3, 1.5, 0],
];

/** The share of a tolerance that a value meets, from 0 to 1. */
function meets(value: number, [, min, best, worst, max]: Tolerance): number {
	if (value <= min || value >= max) return 0;
	if (value < best) return (value - min) / (best - min);
	if (value > worst) return (max - value) / (max - worst);
	return 1;
}

let stoneList: readonly { x: number; z: number; r: number }[] | undefined;

/**
 * True where nothing grows: past the rim, in the creek or on its stones, on the gravel outside its
 * moss islands, on the steps, the landing or the terrace, and under the garden's models and walls.
 */
export function bare(x: number, z: number): boolean {
	if (Math.hypot(x, z) > rimRadius(bearingOf(x, z)) - RIM_KEEP) return true;
	if (Math.abs(z - streamZ(x)) < streamHalf(x) * BANK_KEEP) return true;
	if (gravelPlace(x, z).edge < 0.25 && islandDistance(x, z) > -0.3) return true;
	if (Math.hypot(x - LANDING.x, z - LANDING.z) < LANDING.radius) return true;
	if (Math.hypot(x - TERRACE.x, z - TERRACE.z) < TERRACE.top) return true;
	if (onSteps(x, z) || underGarden(x, z)) return true;
	stoneList ??= rockPlaces().map((stone) => ({
		x: stone.x,
		z: stone.z,
		r: stone.size * ROCK_REACH,
	}));
	return stoneList.some((stone) => Math.hypot(x - stone.x, z - stone.z) < stone.r);
}

/** The ground's measures at a point, with the shade of the trees. */
function groundAt(x: number, z: number, trees: readonly Spot[]): Ground {
	const step = 0.5;
	const slope =
		Math.hypot(
			groundHeight(x + step, z) - groundHeight(x - step, z),
			groundHeight(x, z + step) - groundHeight(x, z - step),
		) /
		(2 * step);
	let shade = 0;
	for (const tree of trees) {
		const across =
			Math.hypot(x - tree.x, z - tree.z) / (SIZES[tree.kind as TreeKind].reach * tree.size);
		shade = Math.max(shade, Math.min(1, Math.max(0, (1.05 - across) / 0.7)));
	}
	return {
		water: Math.max(0, Math.abs(z - streamZ(x)) - streamHalf(x)),
		slope,
		shade,
		patch: 0.5 + 0.5 * PATCHES.fbm2(x * 0.18, z * 0.18, 3),
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
 * True when a model would stand in the opening camera's view of the statue: some line from the
 * camera to a point of the statue passes through its room.
 */
export function blocksStatue(spot: Spot): boolean {
	const { statue } = gardenPlaces();
	const size = SIZES[spot.kind as keyof typeof SIZES];
	const [reach, top] = [size.reach * spot.size, spot.y + size.height * spot.size];
	return STATUE_VIEW.some(([ox, oy, oz]) => {
		const target = [statue.x + ox, statue.y + oy * statue.size, statue.z + oz];
		const [dx, dz] = [(target[0] as number) - WIDE[0], (target[2] as number) - WIDE[2]];
		// The nearest point of the line's ground track to the model's foot, and the line's height there.
		const t = Math.min(
			1,
			Math.max(0, ((spot.x - WIDE[0]) * dx + (spot.z - WIDE[2]) * dz) / (dx * dx + dz * dz)),
		);
		const near = Math.hypot(WIDE[0] + dx * t - spot.x, WIDE[2] + dz * t - spot.z);
		const height = WIDE[1] + ((target[1] as number) - WIDE[1]) * t;
		return near < reach && height < top;
	});
}

/** The placed garden. */
export interface Valley {
	readonly trees: readonly Spot<TreeKind>[];
	readonly plants: readonly Spot<PlantKind>[];
}

/**
 * Places the garden: the trees by hand, then each rule of the ground cover over a jittered grid,
 * where the ground suits it, with room from what stood before, clear of the view to the statue
 * and of the route.
 *
 * @returns The trees and the plants.
 */
export function placeValley(): Valley {
	const next = random(SEED);
	const route = routeSamples();
	const clearOfRoute = (spot: Spot) => {
		const solid = solidOf(spot);
		return !route.some((pose) => hits(solid, pose));
	};
	const trees = TREES.map(
		([, x, z, kind, size, turn]): Spot<TreeKind> => ({
			kind,
			x,
			y: groundHeight(x, z) - 0.1,
			z,
			yaw: broadSideToCamera(x, z) + turn,
			size,
		}),
	).filter(clearOfRoute);
	/** The rooms that the placed ground cover keeps, and the trunks, which nothing grows through. */
	const taken: { x: number; z: number; r: number }[] = trees.map(({ x, z }) => ({ x, z, r: 0.8 }));
	const plants: Spot<PlantKind>[] = [];
	/** How well the ground at a point suits a rule, from 0 to 1, or 0 where nothing grows. */
	const scoreAt = (rule: Rule, x: number, z: number): number => {
		if (bare(x, z)) return 0;
		const ground = groundAt(x, z, trees);
		let score = 1;
		for (const tolerance of rule.tolerances) score *= meets(ground[tolerance[0]], tolerance);
		return score;
	};
	/** Places a copy of a rule's kind where it keeps its room and misses the view and the route. */
	const place = (rule: Rule, x: number, z: number, yaw: number, size: number): boolean => {
		const r = SIZES[rule.kind].reach * size * 0.8;
		if (taken.some((t) => (x - t.x) ** 2 + (z - t.z) ** 2 < (r + t.r) ** 2)) return false;
		const spot = { kind: rule.kind, x, y: groundHeight(x, z), z, yaw, size };
		if (blocksStatue(spot) || !clearOfRoute(spot)) return false;
		taken.push({ x, z, r });
		plants.push(spot);
		return true;
	};
	for (const rule of RULES) {
		for (let gx = -REACH; gx < REACH; gx += rule.spacing)
			for (let gz = -REACH; gz < REACH; gz += rule.spacing) {
				const x = gx + next() * rule.spacing;
				const z = gz + next() * rule.spacing;
				const chance = next();
				const size = rule.scale[0] + (rule.scale[1] - rule.scale[0]) * next();
				const yaw = next() * Math.PI * 2;
				if (chance >= scoreAt(rule, x, z)) continue;
				if (!place(rule, x, z, yaw, size)) continue;
				// The clump: copies that gather about this one, where the ground suits them too.
				const [count, spread] = rule.clump;
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
	return { trees, plants };
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
