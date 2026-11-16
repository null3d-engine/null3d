// The kinds of road on the island and their limits, shared by the search that lays the roads out
// (network.ts), the stored plan and the meshes.
import { hypot, naturalHeight, SUMMITS } from './island';

/** A place on the ground, x and z. */
export type Point = readonly [number, number];

/** One point of a road's middle line. */
export interface RoadPoint {
	x: number;
	y: number;
	z: number;
}

/** What a road's far end does: it joins another road, closes on itself, ends in a turning circle, or runs on as a footpath. */
export type RoadEnd = 'junction' | 'loop' | 'circle' | 'path';

/** A road: its middle line, every few meters, its half width and how it ends. */
export interface Road {
	points: RoadPoint[];
	half: number;
	end: RoadEnd;
	/** The smallest radius that the road's curves may have, in meters. */
	radius: number;
}

/** The steepest rise over run that a road may take. */
export const MAX_GRADE = 0.095;
/** The half widths of the main road, the coast road, a collector, a town street, a lane and a side lane. */
export const SPINE = 3.5;
export const MAIN = 3;
/** The half width of the road that climbs the highest hill. */
export const CLIMB = 3.2;
export const COLLECTOR = 2.5;
export const STREET = 2.2;
export const LANE = 2;
export const SIDE_LANE = 1.75;
/** The smallest radius of the through roads' curves, of a lane's, and of a town or village street's. */
export const THROUGH_RADIUS = 40;
export const LOCAL_RADIUS = 30;
export const STREET_RADIUS = 18;
/** The tightest bend of the long street around the harbour, in meters. */
export const QUAY_RADIUS = 34;
/** The nearest that two roads' middle lines may run side by side, in meters. */
export const TWIN_GAP = 18;

/** The town's streets on each side of the church and the square, by x. */
export const TOWN_CORE = [-128, -56] as const;

/** The smallest radius along a line, in meters, over a chord of two strides each way, ends included. */
export function tightest(line: readonly { x: number; z: number }[], stride = 2): number {
	let least = Number.POSITIVE_INFINITY;
	for (let k = 0; k < line.length; k++) {
		const a = line[Math.max(0, k - stride)] as { x: number; z: number };
		const p = line[k] as { x: number; z: number };
		const b = line[Math.min(line.length - 1, k + stride)] as { x: number; z: number };
		const [ax, az, bx, bz] = [p.x - a.x, p.z - a.z, b.x - p.x, b.z - p.z];
		const [ra, rb] = [hypot(ax, az), hypot(bx, bz)];
		if (ra < 0.01 || rb < 0.01) continue;
		const bend = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
		if (bend > 1e-4) least = Math.min(least, (ra + rb) / 2 / bend);
	}
	return least;
}

/** The steepest that an access road near a hilltop may run, as a rise over a run. */
export const STEEPEST_ACCESS = 0.115;
/** The longest stretch of road that may run at that grade, in meters. */
export const ACCESS_RUN = 145;

/** Where the forest keeps its ground: the upper slopes, which only the climbing roads cross. */
export function inForest(x: number, z: number): boolean {
	return (
		naturalHeight(x, z) > 118 && !SUMMITS.some(([sx, sz, , r]) => hypot(x - sx, z - sz) < r * 1.5)
	);
}

/** The parks: each one's middle and radius, in meters. */
export const PARKS: readonly (readonly [number, number, number])[] = [
	[-40, -225, 24],
	[-330, 48, 30],
];
