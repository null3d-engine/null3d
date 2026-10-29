// The plan of the city that Skyway flies through: where its blocks and streets stand, and the
// buildings that fill them. The scene builders, the traffic lanes and the route test all read this
// one plan, so a change to the skyline cannot quietly open a hole in the camera's route.
import { math } from '@null3d/engine';

/** The number of blocks along each side of the streets that the route and the lanes use. */
export const BLOCKS = 9;
/** The blocks along each side that the skyline fills, street grid included: two more than the
 * route uses, so the city runs on into the fog on every side of the route. */
const CITY_BLOCKS = BLOCKS + 4;
/** The distance from one block's centre to the next, streets included, in meters. */
export const PITCH = 150;
/** The width of a street, in meters. */
export const STREET = 34;
/** The city's half width in meters: from its middle to the outermost street's centre line. */
export const HALF = (BLOCKS * PITCH) / 2;
/** The ground that a block offers its buildings, in meters. */
export const BLOCK = PITCH - STREET;
/** The height of the roads, in meters, which the hero car's reflection turns about. */
export const ROAD = 0;
/** The layer of the hero car alone, which the wet ground's mirror camera draws. The car keeps the
 * effect layer too, so the scene's camera draws it as it draws every effect. */
export const HERO_LAYER = 1 << 2;
/** The height of the landmark tower over the middle of the city, in meters. */
export const TOWER_HEIGHT = 268;

/** The coordinate of a street's centre line, from 0 at the south-west edge to `BLOCKS`. */
export const streetLine = (k: number): number => -HALF + k * PITCH;

/** The coordinate of a block's centre, by its index from the west or the south. */
export const blockCentre = (i: number): number => streetLine(i) + PITCH / 2;

/**
 * The sky lanes' levels: how many each street carries, the lowest one's height and the climb from
 * one level to the next, in meters. The streets that run along z fly half a level higher than those
 * along x, so two crossing streets never share a height.
 */
export const LANE_LEVELS = 6;
export const LANE_LOW = 22;
export const LANE_STEP = 24;
/** How many lanes each direction takes on one level, the inner one's distance from the street's
 * centre line, and the gap between two lanes of one direction, in meters. */
export const LANES_EACH_WAY = 2;
export const LANE_INNER = 4.5;
export const LANE_GAP = 5;
/** The length of a sky lane, in meters: longer than the city, so cars stream in from the haze. */
export const LANE_SPAN = 2400;

/** One sky lane: its heading, as the traffic add-on numbers them, its line, height and speed. */
export interface SkyLane {
	heading: 0 | 1 | 2 | 3;
	across: number;
	altitude: number;
	speed: number;
}

/**
 * The sky lanes of every street. Traffic keeps to the right: each direction flies on its own side
 * of the centre line, so the two never meet head on. The inner lane of each side is the fast one.
 * Every lane has one speed, so its cars keep their gaps.
 */
export function skyLanes(): SkyLane[] {
	math.seed(53);
	const lanes: SkyLane[] = [];
	// A lane along +x keeps to +z, along -x to -z, along +z to -x and along -z to +x.
	const headings = [
		{ heading: 0, side: 1, lift: 0 },
		{ heading: 1, side: -1, lift: 0 },
		{ heading: 2, side: -1, lift: LANE_STEP / 2 },
		{ heading: 3, side: 1, lift: LANE_STEP / 2 },
	] as const;
	for (let k = 0; k <= BLOCKS; k++) {
		const line = streetLine(k);
		for (const { heading, side, lift } of headings) {
			for (let level = 0; level < LANE_LEVELS; level++) {
				for (let lane = 0; lane < LANES_EACH_WAY; lane++) {
					lanes.push({
						heading,
						across: line + side * (LANE_INNER + lane * LANE_GAP),
						altitude: LANE_LOW + lift + level * LANE_STEP,
						speed: lane === 0 ? math.randFloat(30, 36) : math.randFloat(21, 27),
					});
				}
			}
		}
	}
	return lanes;
}

/** One building of the skyline. */
export interface Building {
	/** The middle of its footprint. */
	x: number;
	z: number;
	/** Its footprint's sides, in meters. */
	width: number;
	depth: number;
	/** Its height above the ground, in meters. */
	height: number;
	/** The seed that picks its windows and its signs, from 0 to 1. */
	seed: number;
}

/**
 * The buildings of the city, block by block: one tall tower over the middle, four or six towers in
 * each block nearer to it, and six in each block towards the edge. Every building stands inside its
 * block and leaves a strip of pavement round it, so the streets and the corners between them stay
 * clear for the camera and the traffic.
 */
export function cityBuildings(): Building[] {
	math.seed(41);
	const buildings: Building[] = [];
	const first = -(CITY_BLOCKS - BLOCKS) / 2;
	for (let i = first; i < BLOCKS - first; i++) {
		for (let j = first; j < BLOCKS - first; j++) {
			const cx = blockCentre(i);
			const cz = blockCentre(j);
			const middle = Math.hypot(cx, cz);
			if (middle < PITCH * 0.6) {
				buildings.push({
					x: cx,
					z: cz,
					width: BLOCK * 0.78,
					depth: BLOCK * 0.78,
					height: TOWER_HEIGHT,
					seed: math.random(),
				});
				continue;
			}
			// Near the middle, four roomy towers to a block; towards the edge, six slimmer ones.
			const [across, along] = middle < HALF * 0.62 ? [2, 2] : [3, 2];
			const rise = 1 + 1.5 * Math.exp(-(middle * middle) / (HALF * 0.62) ** 2);
			for (let a = 0; a < across; a++) {
				for (let b = 0; b < along; b++) {
					const slotW = BLOCK / across;
					const slotD = BLOCK / along;
					const width = slotW * math.randFloat(0.56, 0.76);
					const depth = slotD * math.randFloat(0.56, 0.76);
					const tall = 26 + 132 * math.random() ** 2 * rise;
					buildings.push({
						x: cx - BLOCK / 2 + (a + 0.5) * slotW + math.randFloatSpread(1.5),
						z: cz - BLOCK / 2 + (b + 0.5) * slotD + math.randFloatSpread(1.5),
						width,
						depth,
						height: Math.min(238, tall),
						seed: math.random(),
					});
				}
			}
		}
	}
	return buildings;
}
