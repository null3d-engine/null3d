// The island's placed objects stand on the surface beneath them and clear of what they must not
// touch. This checks the drawn park surfaces by their own lifts, the square's paving, the sand under
// each parasol's loungers, the water and room under each moored boat and the road's shoulder under
// each parked car's wheels. A bench must stand clear of a gazebo's stepped base and of a lamp, no
// two parasol canvases may overlap, and every prop's ground contacts must lie over the surface that
// carries it.
import { describe, expect, it } from 'bun:test';
import { hypot } from './island';
import { type Build, bareTable, bench, pavilion, planter, streetLamp } from './kit';
import { groundHeight, ROADS, SQUARE } from './plan';
import { LOUNGER_OFFSETS, loungerStands } from './props';
import {
	HULL_HALF,
	HULL_WATER,
	hullDepth,
	MOORINGS,
	parasolClubs,
	parkPlans,
	squareFloor,
	squarePropPlaces,
} from './town';
import { CAR_HALF_LENGTH, CAR_HALF_WIDTH, planTraffic } from './traffic';

/** The plan's parked cars, built once for the two checks that read them. */
let parked: ReturnType<typeof planTraffic>['parked'] | undefined;
const parkedCars = (): ReturnType<typeof planTraffic>['parked'] =>
	(parked ??= planTraffic().parked);

/** A shape's reach on the ground: the bounds of the vertices at its own base, and its widest radius. */
function groundFootprint(
	build: Build,
	lift = 0.02,
): {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	reach: number;
} {
	let [minX, maxX, minZ, maxZ, reach] = [Infinity, -Infinity, Infinity, -Infinity, 0];
	for (let at = 0; at < build.positions.length; at += 3) {
		const y = build.positions[at + 1] as number;
		if (y > lift) continue;
		const [x, z] = [build.positions[at] as number, build.positions[at + 2] as number];
		minX = Math.min(minX, x);
		maxX = Math.max(maxX, x);
		minZ = Math.min(minZ, z);
		maxZ = Math.max(maxZ, z);
		reach = Math.max(reach, hypot(x, z));
	}
	return { minX, maxX, minZ, maxZ, reach };
}

/** The corners, the edge middles and the middle of a footprint, turned about +y by a yaw. */
function footprintGrid(
	foot: { minX: number; maxX: number; minZ: number; maxZ: number },
	x: number,
	z: number,
	yaw: number,
): readonly (readonly [number, number])[] {
	const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
	const us = [foot.minX, (foot.minX + foot.maxX) / 2, foot.maxX];
	const vs = [foot.minZ, (foot.minZ + foot.maxZ) / 2, foot.maxZ];
	const points: [number, number][] = [];
	for (const u of us) for (const v of vs) points.push([x + u * c + v * s, z - u * s + v * c]);
	return points;
}

/** How far a point stands from a line of points on the ground, in meters. */
function lineGap(line: readonly { x: number; z: number }[], x: number, z: number): number {
	let least = Infinity;
	for (let k = 0; k + 1 < line.length; k++) {
		const a = line[k] as { x: number; z: number };
		const b = line[k + 1] as { x: number; z: number };
		const [dx, dz] = [b.x - a.x, b.z - a.z];
		const length2 = dx * dx + dz * dz || 1;
		const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2));
		least = Math.min(least, hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
	}
	return least;
}

/**
 * The height of the surface that a park draws at a place, from the lifts that its meshes use: the
 * base over the park's level, the lawn's and the apron's lift, and the gravel's on the walk and the
 * branch. Off the apron it is the open ground.
 */
function parkGround(plan: ReturnType<typeof parkPlans>[number], x: number, z: number): number {
	const [dx, dz] = [x - plan.x, z - plan.z];
	const edge = plan.shape(Math.atan2(dz, dx));
	const d = hypot(dx, dz);
	let height = -Infinity;
	if (lineGap(plan.walk, x, z) <= 1.5) height = Math.max(height, plan.y + 0.02 + 0.13);
	if (lineGap(plan.branch, x, z) <= 1.2) height = Math.max(height, plan.y + 0.02 + 0.14);
	if (d <= edge) height = Math.max(height, plan.y + 0.02 + 0.1);
	else if (d <= edge + 3) height = Math.max(height, plan.y + 0.02 + 0.07);
	return height > -Infinity ? height : groundHeight(x, z);
}

/** The radius of a gazebo's lowest step, read from its own mesh. */
function gazeboStep(): number {
	const stone = pavilion().stone;
	let most = 0;
	for (let at = 0; at < stone.positions.length; at += 3) {
		const [x, y, z] = [
			stone.positions[at] as number,
			stone.positions[at + 1] as number,
			stone.positions[at + 2] as number,
		];
		if (y > 0.3) continue;
		most = Math.max(most, hypot(x, z));
	}
	// The lowest ring spans its full reach, so its widest vertex is the step's radius.
	return most;
}

/** How far a footprint reaches from its own middle, in meters, whichever way it is turned. */
function footprintReach(foot: { reach: number }): number {
	return foot.reach;
}

describe('the island props stand on their surfaces', () => {
	it('stands every park bench on the surface under its own feet', () => {
		const foot = groundFootprint(bench());
		const offenders = parkPlans().flatMap((plan) =>
			plan.seats
				.filter((seat) => {
					const surface = Math.max(
						...footprintGrid(foot, seat.x, seat.z, seat.yaw).map(([x, z]) =>
							parkGround(plan, x, z),
						),
					);
					// A bench rests on the highest contact; it may stand a little above a lower one
					// but must never sink into any.
					return seat.y < surface - 0.01 || seat.y > surface + 0.05;
				})
				.map((seat) => `${seat.x.toFixed(1)},${seat.z.toFixed(1)} at ${seat.y.toFixed(2)}`),
		);
		expect(offenders).toEqual([]);
	});

	it('keeps every park bench off the branch to the gazebo', () => {
		const foot = groundFootprint(bench());
		const offenders = parkPlans().flatMap((plan) =>
			plan.seats
				.filter((seat) =>
					footprintGrid(foot, seat.x, seat.z, seat.yaw).some(
						([x, z]) => lineGap(plan.branch, x, z) < 1.2,
					),
				)
				.map((seat) => `${seat.x.toFixed(1)},${seat.z.toFixed(1)}`),
		);
		expect(offenders).toEqual([]);
	});

	it('stands every park lamp on the surface under its base', () => {
		const offenders = parkPlans().flatMap((plan) =>
			plan.lamps
				.filter((lamp) => {
					const surface = parkGround(plan, lamp.x, lamp.z);
					return lamp.y < surface - 0.01 || lamp.y > surface + 0.05;
				})
				.map((lamp) => `${lamp.x.toFixed(1)},${lamp.z.toFixed(1)} at ${lamp.y.toFixed(2)}`),
		);
		expect(offenders).toEqual([]);
	});

	it('keeps every park lamp clear of every bench', () => {
		const clearance =
			footprintReach(groundFootprint(bench())) + footprintReach(groundFootprint(streetLamp()));
		const offenders = parkPlans().flatMap((plan) =>
			plan.lamps.flatMap((lamp) =>
				plan.seats
					.filter((seat) => hypot(seat.x - lamp.x, seat.z - lamp.z) < clearance)
					.map(
						(seat) =>
							`lamp ${lamp.x.toFixed(1)},${lamp.z.toFixed(1)} and bench ${seat.x.toFixed(1)},${seat.z.toFixed(1)}`,
					),
			),
		);
		expect(offenders).toEqual([]);
	});

	it('keeps every park bench clear of the gazebo and its stepped base', () => {
		const step = gazeboStep();
		const reach = footprintReach(groundFootprint(bench()));
		const offenders = parkPlans().flatMap((plan) =>
			plan.seats
				.filter((seat) => hypot(seat.x - plan.gazebo.x, seat.z - plan.gazebo.z) < step + reach)
				.map((seat) => `${seat.x.toFixed(1)},${seat.z.toFixed(1)}`),
		);
		expect(step).toBeCloseTo(4.7, 1);
		expect(offenders).toEqual([]);
	});

	it('stands the gazebo on its lawn', () => {
		// The branch's gravel runs under the gazebo's steps, so the lawn's own lift sets its base.
		for (const plan of parkPlans()) expect(plan.gazebo.y).toBeCloseTo(plan.y + 0.02 + 0.1, 6);
	});

	it('stands the square tables and pots on its paving', () => {
		const floor = squareFloor();
		const { covered, open, pots } = squarePropPlaces();
		const tableReach = footprintReach(groundFootprint(bareTable()));
		const potReach = footprintReach(groundFootprint(planter()));
		const offenders: string[] = [];
		const inside = (reach: number, x: number, z: number) =>
			Math.abs(x - floor.x) + reach <= floor.halfX && Math.abs(z - floor.z) + reach <= floor.halfZ;
		for (const [x, z] of [...covered, ...open])
			if (!inside(tableReach, x, z)) offenders.push(`table ${x.toFixed(1)},${z.toFixed(1)}`);
		for (const [x, z] of pots)
			if (!inside(potReach, x, z)) offenders.push(`pot ${x.toFixed(1)},${z.toFixed(1)}`);
		expect(offenders).toEqual([]);
		// Every prop stands at the floor's own height.
		const top = groundHeight(SQUARE.x, SQUARE.z) + 0.14;
		expect(floor.top).toBeCloseTo(top, 6);
	});

	it('stands every beach parasol and lounger on its own sand', () => {
		const spots = parasolClubs().map((spot) => ({ ...spot, y: groundHeight(spot.x, spot.z) }));
		const stands = loungerStands(spots, groundHeight);
		expect(stands.length).toBe(spots.length * LOUNGER_OFFSETS.length);
		const offenders = stands
			.filter((stand) => Math.abs(stand.y - groundHeight(stand.x, stand.z)) > 0.01)
			.map((stand) => `${stand.x.toFixed(1)},${stand.z.toFixed(1)}`);
		expect(offenders).toEqual([]);
	});

	it('keeps every parasol canvas clear of every other', () => {
		const spots = parasolClubs();
		const offenders: string[] = [];
		for (let i = 0; i < spots.length; i++)
			for (let j = i + 1; j < spots.length; j++) {
				const a = spots[i] as (typeof spots)[number];
				const b = spots[j] as (typeof spots)[number];
				if (hypot(a.x - b.x, a.z - b.z) < 3) offenders.push(`${i} and ${j}`);
			}
		expect(offenders).toEqual([]);
	});

	it('keeps every moored boat in water deep enough for its hull', () => {
		const offenders = MOORINGS.filter(([x, z, yaw]) => hullDepth(x, z, yaw) < HULL_WATER).map(
			([x, z]) => `${x.toFixed(0)},${z.toFixed(0)}`,
		);
		expect(offenders).toEqual([]);
	});

	it('keeps every boat hull clear of every other', () => {
		const [halfBeam, halfLength] = HULL_HALF;
		const corners = (m: readonly [number, number, number]): [number, number][] => {
			const [c, s] = [Math.cos(m[2]), Math.sin(m[2])];
			const out: [number, number][] = [];
			for (const across of [-halfBeam, halfBeam])
				for (const along of [-halfLength, halfLength])
					out.push([m[0] + across * c + along * s, m[1] - across * s + along * c]);
			return out;
		};
		// Two boxes overlap unless one of their own face axes finds a gap between them.
		const meets = (a: readonly [number, number, number], b: readonly [number, number, number]) => {
			const [pa, pb] = [corners(a), corners(b)];
			for (const m of [a, b]) {
				const [c, s] = [Math.cos(m[2]), Math.sin(m[2])];
				for (const [ax, az] of [
					[c, -s],
					[s, c],
				] as const) {
					const on = (p: [number, number]) => p[0] * ax + p[1] * az;
					const [amin, amax] = [Math.min(...pa.map(on)), Math.max(...pa.map(on))];
					const [bmin, bmax] = [Math.min(...pb.map(on)), Math.max(...pb.map(on))];
					if (amax <= bmin || bmax <= amin) return false;
				}
			}
			return true;
		};
		const offenders: string[] = [];
		for (let i = 0; i < MOORINGS.length; i++)
			for (let j = i + 1; j < MOORINGS.length; j++)
				if (
					meets(MOORINGS[i] as (typeof MOORINGS)[number], MOORINGS[j] as (typeof MOORINGS)[number])
				)
					offenders.push(`${i} and ${j}`);
		expect(offenders).toEqual([]);
	});

	it('stands every parked car on the road or its shoulder, under each wheel', () => {
		// A car's wheels sit inside its body's edge, across the car and along it.
		const WHEEL_ACROSS = 0.72;
		const WHEEL_ALONG = 1.25;
		/** The drawn surface of a road at a place: its crowned asphalt, its flat shoulder, its skirt, or the ground. */
		const roadSurface = (x: number, z: number): number => {
			let best = { d: Infinity, along: 0, half: 0, y: 0 };
			for (const road of ROADS)
				for (let k = 0; k + 1 < road.points.length; k++) {
					const a = road.points[k] as { x: number; y: number; z: number };
					const b = road.points[k + 1] as { x: number; y: number; z: number };
					const [dx, dz] = [b.x - a.x, b.z - a.z];
					const length2 = dx * dx + dz * dz || 1;
					const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2));
					const d = hypot(x - (a.x + dx * t), z - (a.z + dz * t));
					if (d < best.d) best = { d, along: t, half: road.half, y: a.y + (b.y - a.y) * t };
				}
			const { d, half, y } = best;
			if (d <= half) return y + 0.3 + 0.06 * (1 - (d / half) ** 2);
			if (d <= half + 1.35) return y + 0.25;
			if (d <= half + 2.25) return y + 0.25 - 0.4 * ((d - half - 1.35) / 0.9);
			return groundHeight(x, z);
		};
		const offenders: string[] = [];
		parkedCars().forEach((car, row) => {
			const [c, s] = [Math.cos(car.yaw), Math.sin(car.yaw)];
			for (const u of [-WHEEL_ACROSS, WHEEL_ACROSS])
				for (const v of [-WHEEL_ALONG, WHEEL_ALONG]) {
					const x = car.x + u * c + v * s;
					const z = car.z - u * s + v * c;
					// A parked car's body cannot pitch to the road's grade, so an end of it may stand
					// a little over the surface where the road falls or rises under its length.
					if (car.y - roadSurface(x, z) > 0.2)
						offenders.push(`car ${row} wheel ${x.toFixed(0)},${z.toFixed(0)}`);
				}
		});
		expect(offenders).toEqual([]);
		// The wheels sit inside the body's own edges, so the shoulder that holds them holds the car.
		expect(WHEEL_ACROSS).toBeLessThan(CAR_HALF_WIDTH);
		expect(WHEEL_ALONG).toBeLessThan(CAR_HALF_LENGTH);
	});

	it('places every parked car apart from every other', () => {
		const cars = parkedCars();
		const offenders: string[] = [];
		for (let i = 0; i < cars.length; i++)
			for (let j = i + 1; j < cars.length; j++) {
				const a = cars[i] as (typeof cars)[number];
				const b = cars[j] as (typeof cars)[number];
				// Bodies are axis-aligned in each car's own frame; a centre gap below the body's
				// diagonal means that the two outlines may touch.
				if (hypot(a.x - b.x, a.z - b.z) < 2 * hypot(CAR_HALF_LENGTH, CAR_HALF_WIDTH))
					offenders.push(`${i} and ${j}`);
			}
		expect(offenders).toEqual([]);
	});
});
