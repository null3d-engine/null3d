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
/** The height of the landmark tower over the middle of the city, in meters. */
export const TOWER_HEIGHT = 268;

/** The coordinate of a street's centre line, from 0 at the south-west edge to `BLOCKS`. */
export const streetLine = (k: number): number => -HALF + k * PITCH;

/** The coordinate of a block's centre, by its index from the west or the south. */
export const blockCentre = (i: number): number => streetLine(i) + PITCH / 2;

/** The sky lanes' lowest and highest altitudes, in meters. */
export const LANE_LOW = 26;
export const LANE_HIGH = 88;
/** How many lanes one street carries, and how far either side of its centre they fly, in meters. */
export const LANES_PER_STREET = 8;
export const LANE_OFFSET = 7;
/** The length of a sky lane, in meters: longer than the city, so cars stream in from the haze. */
export const LANE_SPAN = 2400;

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
