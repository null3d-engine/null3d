// The garden's planting: where its trees and its ground cover stand. The trees stand by hand where
// the concept has them. The ground cover follows rules: each scores a candidate place by how well
// the ground there suits its kind, grows clumps, and keeps its room from what stood before. Every
// rule scores zero where nothing grows: past the rim, in the creek and on its stones, on the gravel
// outside its moss islands, on the steps, the landing and the terrace, under the garden's models
// and walls, and where a plant would stand in the view to the statue. One seed places it all, so
// every device and both GPU paths draw the same garden. A plant that the camera's route would fly
// into is left out, so no pass crosses a crown.
import { type LevelView, levelAt, levelDistances } from '@null3d/engine';
import { routePosition, routeTimeline } from '../../lib/cinematic';
import { Noise, random } from '../../lib/procedural';
import { gardenPlaces, terraceStones, underGarden } from './garden';
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
	WATER,
} from './land';
import { SHOTS, WIDE } from './route';
import { onSteps } from './steps';
import { ROCK_REACH, rockPlaces } from './stones';

/** The seed that places the garden. */
export const SEED = 7;
/** The slow, uneven wave over the garden whose crests gather a kind into patches. */
const PATCHES = new Noise(SEED);

/** The trees that stand by hand: the three forms of the cloud-pruned pine. */
export const TREE_KINDS = ['pine-tall', 'pine-narrow', 'pine-low', 'maple'] as const;
export type TreeKind = (typeof TREE_KINDS)[number];
/** The ground cover that the rules place. */
export const PLANT_KINDS = [
	'rim-conifer',
	'clipped-shrub',
	'azalea',
	'autumn-clump',
	'moss-cushion',
	'fern',
	'hosta',
] as const;
export type PlantKind = (typeof PLANT_KINDS)[number];

/**
 * The size of each model at scale 1: its height, the reach of its foliage across its broad side,
 * and its reach toward and away from that side, as the pine helper's builds measure them.
 */
export const SIZES: Record<TreeKind | PlantKind, { height: number; reach: number; depth: number }> =
	{
		'pine-tall': { height: 7.41, reach: 5.4, depth: 3.15 },
		'pine-narrow': { height: 7.32, reach: 2.81, depth: 2.3 },
		'pine-low': { height: 3.69, reach: 2.59, depth: 1.66 },
		maple: { height: 5.6, reach: 3.85, depth: 3.85 },
		'rim-conifer': { height: 1.3, reach: 1.1, depth: 1.1 },
		'clipped-shrub': { height: 1.3, reach: 0.79, depth: 0.79 },
		azalea: { height: 0.67, reach: 0.9, depth: 0.9 },
		'autumn-clump': { height: 0.6, reach: 1.1, depth: 1.1 },
		'moss-cushion': { height: 0.25, reach: 0.72, depth: 0.72 },
		fern: { height: 0.77, reach: 0.82, depth: 0.82 },
		hosta: { height: 0.52, reach: 0.6, depth: 0.6 },
	};

/** How far a pine's trunk reaches about its foot at scale 1, in meters, the widest of the three. */
export const TRUNK = 0.66;

/**
 * The scale table of the placed pines: each one's height, in meters, from the least to the most,
 * as the concept and the fidelity rulings ask. The two tall pines stand 7 to 8 m and the low pines
 * 2.8 to 3.7 m; the tall pine close behind the statue, whose pads stand beside its head, the two
 * small pines on the right hillside and the clipped tiny pines on the gravel's islands take rows of
 * their own.
 */
export const SCALE: Readonly<Record<string, readonly [number, number]>> = {
	P1: [7, 8],
	P2: [7, 8],
	P3: [2.8, 3.7],
	P4: [2.8, 3.7],
	P5: [7.5, 9],
	P6: [2.8, 3.7],
	P7: [4, 5],
	P8: [3, 3.7],
	P10: [1, 1.5],
	P11: [0.5, 1],
};

/**
 * The render height, in pixels, at which the ground cover's triangle budget is measured: High's own
 * render, at its one-pixel threshold.
 */
export const LEVEL_RULER = 1080;

/** The camera's vertical field of view, in degrees, which the levels' switches follow. */
const FOV = 45;

/** High's level-of-detail threshold, in pixels. */
const THRESHOLD = 1;

/**
 * Each ground plant's parts: their triangles at each of their three levels; each lower level's
 * error, in the units of the model's own mesh, and the node scale that turns those units into
 * meters; and the part's bounding sphere, its centre in meters from the model's foot and its
 * radius, both at scale 1, which the engine measures its levels from. All of them are read from the
 * pinned models' own bounds, node scales and `NULL3D_lod_error` values.
 */
export const GROUND_LEVELS: Record<
	PlantKind,
	readonly {
		readonly triangles: readonly [number, number, number];
		readonly errors: readonly [number, number];
		readonly nodeScale: number;
		readonly offset: readonly [number, number, number];
		readonly radius: number;
	}[]
> = {
	'rim-conifer': [
		{
			triangles: [1088, 722, 618],
			errors: [218.26374143977176, 253.3543751117608],
			nodeScale: 0.00014248816498264698,
			offset: [0.1467, 0.5272, -0.1018],
			radius: 1.6749,
		},
		{
			triangles: [4708, 2356, 1180],
			errors: [230.69843038920993, 387.9342321069955],
			nodeScale: 0.00023277141465333359,
			offset: [0.1305, 0.5234, -0.0705],
			radius: 2.4945,
		},
	],
	'clipped-shrub': [
		{
			triangles: [534, 330, 256],
			errors: [625.5665872788388, 828.2870198176441],
			nodeScale: 0.00009767145695197658,
			offset: [0.0501, 0.4452, 0.037],
			radius: 1.2221,
		},
		{
			triangles: [2640, 1320, 660],
			errors: [439.376187940806, 706.5392513709147],
			nodeScale: 0.00010742502961120624,
			offset: [0.0397, 0.5088, 0.024],
			radius: 1.3097,
		},
	],
	azalea: [
		{
			triangles: [852, 498, 394],
			errors: [601.7364573097244, 704.1596840858477],
			nodeScale: 0.00010153946841308095,
			offset: [0.0287, 0.2577, 0.0133],
			radius: 1.1929,
		},
		{
			triangles: [1568, 784, 392],
			errors: [425.783947888411, 664.8985240512139],
			nodeScale: 0.0001124983697425662,
			offset: [0.0081, 0.3208, 0.0197],
			radius: 1.2913,
		},
	],
	'autumn-clump': [
		{
			triangles: [1744, 1154, 724],
			errors: [402.05586670476777, 564.9742392320552],
			nodeScale: 0.00010496053781249195,
			offset: [-0.1078, 0.2131, 0.0008],
			radius: 1.2425,
		},
		{
			triangles: [2352, 1176, 588],
			errors: [342.32069467543687, 496.5264793051737],
			nodeScale: 0.00012386046376834022,
			offset: [-0.1021, 0.2755, 0.004],
			radius: 1.3953,
		},
	],
	'moss-cushion': [
		{
			triangles: [384, 128, 60],
			errors: [205.04473995537793, 434.01136623888334],
			nodeScale: 0.00008778571936991497,
			offset: [-0.0051, 0.1731, 0.0076],
			radius: 1.0241,
		},
	],
	fern: [
		{
			triangles: [416, 208, 104],
			errors: [174.0882540411963, 518.5409492029215],
			nodeScale: 0.00010741678180984472,
			offset: [-0.0224, 0.3935, 0.0063],
			radius: 1.2136,
		},
	],
	hosta: [
		{
			triangles: [560, 200, 120],
			errors: [220.7641918859763, 978.0692045581228],
			nodeScale: 0.00007156957776993395,
			offset: [0.0036, 0.2583, -0.0482],
			radius: 0.8637,
		},
	],
};

/** The most triangles that the ground cover may draw from the opening camera, at its levels. */
export const GROUND_BUDGET = 320000;

/**
 * The ground cover's triangles: at the finest level of every copy, and as drawn from a camera, each
 * part of each copy at the level that the engine's rule picks for its distance and scale.
 */
export function groundTriangles(
	plants: readonly Spot[],
	from: readonly [number, number, number] = WIDE,
	height = LEVEL_RULER,
): { full: number; drawn: number } {
	const view: LevelView = { height, fov: FOV, threshold: THRESHOLD };
	let full = 0;
	let drawn = 0;
	for (const plant of plants)
		for (const { triangles, errors, nodeScale, offset, radius } of GROUND_LEVELS[
			plant.kind as PlantKind
		]) {
			full += triangles[0];
			// The part's bounding-sphere centre: its place in the model, turned by the copy's yaw and
			// scaled, about the copy's foot, which sinks a little.
			const [ox, oy, oz] = [offset[0] * plant.size, offset[1] * plant.size, offset[2] * plant.size];
			const centre: [number, number, number] = [
				plant.x + Math.cos(plant.yaw) * ox + Math.sin(plant.yaw) * oz,
				plant.y - 0.03 + oy,
				plant.z - Math.sin(plant.yaw) * ox + Math.cos(plant.yaw) * oz,
			];
			const world = radius * plant.size;
			const distance = levelDistances(view, {
				centre: [centre[0] - from[0], centre[1] - from[1], centre[2] - from[2]],
				radius: world,
			});
			const level = levelAt(
				view,
				errors.map((error) => ({ error })),
				nodeScale * plant.size,
				world,
				distance,
			);
			drawn += triangles[level];
		}
	return { full, drawn };
}

/**
 * The trees, by hand where the concept has them, from the references helper's planting map: each
 * one's label on the map, its place, its kind, its size and its turn about y away from showing its
 * broad side to the opening camera. The map's points come from the concept's pixels moved onto this
 * land by landmarks, then onto the ground through the opening camera. P1 is the tall pine beyond
 * the gravel's west end, P2 the tall narrow pine on the hill's top left, P3 leans over the front
 * lantern, P4 stands at the lower flight's foot with the gate's right lantern above it, its crown
 * over the steps' edge as the concept's is, and P6 at the hill's left foot. P5 stands close behind
 * the statue in the tall pine's flat-topped form, a little larger than the other tall pines and a
 * little left of the head from the opening camera, so its upper pads stand beside the head on both
 * sides and none above it. P7 and P8 are small on the right hillside, a little inside the rim, P7
 * in the tall pine's form, wider than tall; and P10 and P11 are the clipped tiny pines on the
 * gravel's moss islands.
 * A seventh number, where given, narrows the tree across its broad side to that share of its
 * model's width, its height kept: P1 stands a quarter narrower than its form, as the concept's.
 */
export const TREES: readonly (readonly [
	string,
	number,
	number,
	TreeKind,
	number,
	number,
	number?,
])[] = [
	['P1', -16.2, 0, 'pine-tall', 1.065, 0.2, 0.75],
	['P2', -5.8, -16.6, 'pine-narrow', 1.03, -0.15],
	['P3', 1.6, 22.2, 'pine-low', 0.86, 0.3],
	['P4', 13.7, 8.6, 'pine-low', 0.96, -0.2],
	['P5', 8.1, -24.5, 'pine-tall', 1.12, 0.1],
	['P6', -0.2, -7.6, 'pine-low', 1, -0.25],
	['P7', 18.3, -15.3, 'pine-tall', 0.64, 0.25],
	['P8', 25.4, -1.9, 'pine-narrow', 0.43, -0.3],
	['P10', 2, 5.3, 'pine-low', 0.35, 0.4],
	['P11', 6.1, 7.1, 'pine-low', 0.19, -0.4],
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

/** A maple's leaf color: red, orange or yellow, or bare, its leaves fallen. */
export type MapleColor = 'red' | 'orange' | 'yellow' | 'bare';

/**
 * The maples' and shrub-trees' places on the planting map: each one's label, its place, its color
 * and its crown's width in meters, which sets its size against the maple model's. M5 and S3 fall
 * on the banks' stones and M9 on the hill's rock, so each moves to the nearest growing ground.
 */
export const MAPLE_SPOTS: readonly (readonly [string, number, number, MapleColor, number])[] = [
	['M1', -7.8, -5.7, 'red', 9.8],
	['M2', -15.5, -6.5, 'red', 3.6],
	['M3', -20.7, 3.1, 'orange', 3.6],
	['M4', -22.3, 8.6, 'bare', 3.1],
	['M5', -13.4, 17.5, 'red', 5.1],
	['M6', -5.8, 21.1, 'orange', 5.3],
	['M7', 6.2, 22.9, 'red', 7.4],
	['M8', 9.2, 22.1, 'yellow', 5.3],
	['M9', 0.6, -16.4, 'orange', 9],
	['M10', 2.7, -18.5, 'red', 6],
	['M11', 12, -20.5, 'orange', 7],
	['M12', 15, -19, 'bare', 6],
	['M13', 19.9, -12.3, 'orange', 5.9],
	['M14', 23, 2.1, 'yellow', 3.6],
	['M15', 19.6, 4, 'red', 6.5],
	['M16', -10.7, -12.4, 'red', 6.7],
	['S1', -22.5, 5.2, 'red', 2.4],
	['S2', 15.4, -18.6, 'red', 2.4],
	['S3', 19.8, 14.2, 'orange', 2.4],
];

/** One placed model: its kind, its foot on the ground, its turn about y and its size. */
export interface Spot<Kind extends string = string> {
	readonly kind: Kind;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly yaw: number;
	readonly size: number;
	/** A maple's leaf color. */
	readonly color?: MapleColor;
	/** Its share of its model's width across its broad side, where it stands narrower than its size. */
	readonly width?: number;
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
	/** The distance inside the rim, in meters. */
	readonly rim: number;
	/** The ground's height over the water, in meters: the hill rises to about 5. */
	readonly height: number;
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
 * gathers in clumps, never in even rows, by the planting map's zones: dark conifer shrubs at the
 * rims, clipped dark green shrubs and crimson azaleas on the moss lawns, mounds of mixed autumn
 * shrubs over the hill and the right rim, hostas and ferns by the water where the patches gather
 * them, ferns in the trees' shade, and last moss cushions on the low lawns and the gravel's islands
 * between them.
 */
const RULES: readonly Rule[] = [
	{
		kind: 'rim-conifer',
		spacing: 4,
		scale: [1.05, 1.45],
		clump: [1, 1.4],
		tolerances: [
			['rim', 0.4, 0.8, 3, 4.5],
			['patch', 0.4, 0.5, 1, 1.01],
		],
	},
	{
		kind: 'clipped-shrub',
		spacing: 2.8,
		scale: [0.9, 1.3],
		clump: [1, 1.4],
		tolerances: [
			['water', 1, 2.5, 9, 13],
			['patch', 0.44, 0.56, 1, 1.01],
		],
	},
	{
		kind: 'azalea',
		spacing: 2.9,
		scale: [0.8, 1.15],
		clump: [2, 1.7],
		tolerances: [
			['water', 0.3, 1, 8, 11],
			['patch', 0.2, 0.28, 0.55, 0.62],
		],
	},
	{
		kind: 'autumn-clump',
		spacing: 4.55,
		scale: [0.8, 1.1],
		clump: [2, 1.8],
		tolerances: [
			['height', 0.4, 1, 8, 9],
			['patch', 0.25, 0.4, 1, 1.01],
		],
	},
	{
		kind: 'hosta',
		spacing: 1.15,
		scale: [0.9, 1.3],
		clump: [5, 1.1],
		tolerances: [
			['water', 0, 0.3, 2.5, 4.5],
			['patch', 0.35, 0.55, 1, 1.01],
		],
	},
	{
		kind: 'fern',
		spacing: 1.7,
		scale: [0.9, 1.4],
		clump: [4, 1.3],
		tolerances: [['shade', 0.1, 0.35, 1, 1.01]],
	},
	{
		kind: 'fern',
		spacing: 1.6,
		scale: [0.9, 1.3],
		clump: [4, 1.2],
		tolerances: [
			['water', 0.2, 0.8, 3.5, 6],
			['patch', 0.4, 0.6, 1, 1.01],
		],
	},
	{
		kind: 'fern',
		spacing: 1.9,
		scale: [1, 1.5],
		clump: [3, 1.3],
		tolerances: [
			['height', 0.5, 1, 8, 9],
			['patch', 0.3, 0.4, 0.75, 0.85],
		],
	},
	{
		kind: 'moss-cushion',
		spacing: 0.68,
		scale: [0.8, 1.6],
		clump: [3, 1.4],
		tolerances: [
			['water', 0.2, 0.5, 20, 30],
			['height', -1, 0, 6, 8],
		],
	},
];

/** How far from the garden's middle the ground cover's grid reaches each way, in meters. */
const REACH = 30;
/** How far inside the rim nothing grows, in meters: a little, since the rim's plants may lean out. */
const RIM_KEEP = 0.5;
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
		rim: rimRadius(bearingOf(x, z)) - Math.hypot(x, z),
		height: groundHeight(x, z) - WATER,
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
	/** Its turn about y, along which its depth runs. */
	readonly yaw: number;
	/** Its reach across its broad side and along its turn, with any clearance, in meters. */
	readonly reach: number;
	readonly depth: number;
	/** The height of its top, with the camera's clearance, in meters. */
	readonly top: number;
}

/**
 * A placed model's crown with a clearance round it: an upright cylinder over an ellipse, as wide as
 * its broad side and as deep as its depth along its turn.
 */
export function crownOf(spot: Spot, clearance = 0): Solid {
	const size = SIZES[spot.kind as keyof typeof SIZES];
	return {
		kind: spot.kind,
		x: spot.x,
		z: spot.z,
		yaw: spot.yaw,
		reach: size.reach * spot.size * (spot.width ?? 1) + clearance,
		depth: size.depth * spot.size + clearance,
		top: spot.y + size.height * spot.size + clearance,
	};
}

/** The room that one placed model keeps from the camera. */
export function solidOf(spot: Spot): Solid {
	return crownOf(spot, CLEARANCE);
}

/** True when a ground point lies under a solid: inside its ellipse. */
export function underSolid(solid: Solid, x: number, z: number): boolean {
	const [dx, dz] = [x - solid.x, z - solid.z];
	const along = dx * Math.sin(solid.yaw) + dz * Math.cos(solid.yaw);
	const across = dx * Math.cos(solid.yaw) - dz * Math.sin(solid.yaw);
	return (across / solid.reach) ** 2 + (along / solid.depth) ** 2 < 1;
}

/** True when a route pose passes through a model's room. */
export function hits(solid: Solid, pose: readonly [number, number, number]): boolean {
	return pose[1] <= solid.top && underSolid(solid, pose[0], pose[2]);
}

/**
 * True when a model would stand in the opening camera's view of the statue: some line from the
 * camera to a point of the statue passes through its room.
 */
export function blocksStatue(spot: Spot): boolean {
	const { statue } = gardenPlaces();
	const crown = crownOf(spot);
	return STATUE_VIEW.some(([ox, oy, oz]) => {
		const target = [statue.x + ox, statue.y + oy * statue.size, statue.z + oz] as const;
		// The line, sampled every 0.25 m, passes under the crown's top inside its ellipse.
		const length = Math.hypot(target[0] - WIDE[0], target[1] - WIDE[1], target[2] - WIDE[2]);
		for (let d = 0; d < length; d += 0.25) {
			const t = d / length;
			const y = WIDE[1] + (target[1] - WIDE[1]) * t;
			if (
				y < crown.top &&
				underSolid(crown, WIDE[0] + (target[0] - WIDE[0]) * t, WIDE[2] + (target[2] - WIDE[2]) * t)
			)
				return true;
		}
		return false;
	});
}

/** The placed garden. */
export interface Valley {
	readonly trees: readonly Spot<TreeKind>[];
	readonly plants: readonly Spot<PlantKind>[];
}

/**
 * The nearest point to a tree's mapped place where its trunk stands on growing ground, clear of the
 * garden's models by its own reach, and where `fits` holds: the place itself when it does, else the
 * first such point on rings about it, a quarter of a meter apart, out to 4 m, or undefined.
 */
function growingNear(
	x: number,
	z: number,
	trunk: number,
	fits: (x: number, z: number) => boolean,
): [number, number] | undefined {
	const { statue, gate, lanterns, rocks, ring } = gardenPlaces();
	const models = [statue, gate, ...lanterns, ...rocks, ...ring, ...terraceStones()];
	const clear = (px: number, pz: number) =>
		!bare(px, pz) &&
		models.every((m) => Math.hypot(px - m.x, pz - m.z) > m.reach + trunk) &&
		fits(px, pz);
	if (clear(x, z)) return [x, z];
	for (let ring = 0.25; ring <= 4; ring += 0.25)
		for (let k = 0; k < 24; k++) {
			const turn = (k / 24) * Math.PI * 2;
			const [px, pz] = [x + Math.cos(turn) * ring, z + Math.sin(turn) * ring];
			if (clear(px, pz)) return [px, pz];
		}
	return undefined;
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
	const pines = TREES.map(
		([, x, z, kind, size, turn, width]): Spot<TreeKind> => ({
			kind,
			x,
			y: groundHeight(x, z) - 0.1,
			z,
			yaw: broadSideToCamera(x, z) + turn,
			size,
			...(width !== undefined && { width }),
		}),
	);
	// Each maple stands at the nearest growing ground to its mapped place that keeps the camera's
	// route clear, at its mapped width, or a little smaller where the route passes close.
	const maples = MAPLE_SPOTS.flatMap(([, mx, mz, color, width]): Spot<TreeKind>[] => {
		const yaw = next() * Math.PI * 2;
		for (const share of [1, 0.9, 0.8, 0.7]) {
			const size = (width * share) / (2 * SIZES.maple.reach);
			const at = (x: number, z: number): Spot<TreeKind> => ({
				kind: 'maple',
				x,
				y: groundHeight(x, z) - 0.1,
				z,
				yaw,
				size,
				color,
			});
			const found = growingNear(mx, mz, TRUNK * size, (x, z) => clearOfRoute(at(x, z)));
			if (found) return [at(found[0], found[1])];
		}
		return [];
	});
	const trees = [...pines.filter(clearOfRoute), ...maples];
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
 * @returns One upright cylinder over an ellipse for each tree and plant.
 */
export function valleySolids(valley: Valley): Solid[] {
	return [...valley.trees, ...valley.plants].map(solidOf);
}
