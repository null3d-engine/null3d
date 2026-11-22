// The island's placed objects stand on the surface beneath them and clear of what they must not
// touch. This checks the drawn park surfaces by their own lifts, the square's paving, the sand under
// each parasol's loungers, the water and room under each moored boat and the road's shoulder under
// each parked car's wheels. A bench must stand clear of a gazebo's stepped base and of a lamp, no
// two parasol canvases may overlap, and every prop's ground contacts must lie over the surface that
// carries it.
import { describe, expect, it } from 'bun:test';
import { hypot } from './island';
import { type Build, bareTable, bench, HOUSE_KINDS, pavilion, planter, streetLamp } from './kit';
import { groundHeight, LOTS, ROADS } from './plan';
import { LOUNGER_OFFSETS, loungerStands } from './props';
import {
	HULL_HALF,
	HULL_WATER,
	hullDepth,
	MOORINGS,
	parasolClubs,
	parkPlans,
	squareFloor,
	squarePavingHeight,
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
 * The height of the surface that a park draws at a place, from the lifts that its meshes use over
 * the ground that they cross: the lawn's and the apron's lift, and the gravel's on the walk and the
 * branch. Off the apron it is the open ground.
 */
function parkGround(plan: ReturnType<typeof parkPlans>[number], x: number, z: number): number {
	const [dx, dz] = [x - plan.x, z - plan.z];
	const edge = plan.shape(Math.atan2(dz, dx));
	const d = hypot(dx, dz);
	const ground = groundHeight(x, z);
	let height = -Infinity;
	if (lineGap(plan.walk, x, z) <= 1.5) height = Math.max(height, ground + 0.02 + 0.33);
	if (lineGap(plan.branch, x, z) <= 1.2) height = Math.max(height, ground + 0.02 + 0.34);
	if (d <= edge) height = Math.max(height, ground + 0.02 + 0.3);
	else if (d <= edge + 3) height = Math.max(height, ground + 0.02 + 0.26);
	return height > -Infinity ? height : ground;
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
		for (const plan of parkPlans())
			expect(plan.gazebo.y).toBeCloseTo(groundHeight(plan.gazebo.x, plan.gazebo.z) + 0.02 + 0.3, 6);
	});

	it('lays every drawn park surface on the ground it crosses', () => {
		for (const plan of parkPlans()) {
			for (let a = 0; a < Math.PI * 2; a += 0.07)
				for (const f of [0.5, 0.85, 1, 1.05]) {
					const r = plan.shape(a) * f;
					const x = plan.x + Math.cos(a) * r;
					const z = plan.z + Math.sin(a) * r;
					const lift = parkGround(plan, x, z) - groundHeight(x, z);
					expect(lift).toBeGreaterThanOrEqual(-0.01);
					expect(lift).toBeLessThanOrEqual(0.4);
				}
			// The lookout wall's foot is the ground along its whole length.
			for (const { a, b } of plan.wall) {
				expect(a.y).toBeCloseTo(groundHeight(a.x, a.z), 6);
				expect(b.y).toBeCloseTo(groundHeight(b.x, b.z), 6);
			}
		}
	});

	it('lays the square paving on the ground it meets', () => {
		const floor = squareFloor();
		// The open piazza lies one level; its flags follow the ground everywhere, at their drape.
		const atHouseFront = (x: number, z: number, reach: number) =>
			LOTS.some((lot) => {
				const [hw, hd] = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half;
				const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
				const [dx, dz] = [x - lot.x, z - lot.z];
				return Math.abs(dx * c - dz * s) <= hw + reach && Math.abs(dx * s + dz * c) <= hd + reach;
			});
		for (let x = floor.x - floor.halfX; x <= floor.x + floor.halfX; x += 1)
			for (let z = floor.z - floor.halfZ; z <= floor.z + floor.halfZ; z += 1) {
				const ground = groundHeight(x, z);
				// The flags lie their drape over the ground, so no part of the paving can hang free.
				expect(squarePavingHeight(x, z) - ground).toBeCloseTo(0.14, 6);
				if (!atHouseFront(x, z, 3))
					// The open piazza's ground is one level, so its flags lie flat.
					expect(Math.abs(floor.top - ground - 0.14)).toBeLessThan(0.02);
			}
	});

	it('keeps the square cafe tables apart', () => {
		const { covered, open } = squarePropPlaces();
		const places = [...covered, ...open];
		const offenders: string[] = [];
		for (let i = 0; i < places.length; i++)
			for (let j = i + 1; j < places.length; j++) {
				const a = places[i] as readonly [number, number];
				const b = places[j] as readonly [number, number];
				if (hypot(a[0] - b[0], a[1] - b[1]) < 2.4)
					offenders.push(
						`${a[0].toFixed(1)},${a[1].toFixed(1)} and ${b[0].toFixed(1)},${b[1].toFixed(1)}`,
					);
			}
		expect(offenders).toEqual([]);
	});

	it('stands the square tables and pots on its paving', () => {
		const floor = squareFloor();
		const { covered, open, pots } = squarePropPlaces();
		const tableReach = footprintReach(groundFootprint(bareTable()));
		const potReach = footprintReach(groundFootprint(planter()));
		const offenders: string[] = [];
		const inside = (reach: number, x: number, z: number) =>
			Math.abs(x - floor.x) + reach <= floor.halfX && Math.abs(z - floor.z) + reach <= floor.halfZ;
		// The ground under a prop's footprint, from a 3 by 3 sample of it.
		const spread = (reach: number, x: number, z: number) => {
			let [low, high] = [Infinity, -Infinity];
			for (const u of [-reach, 0, reach])
				for (const v of [-reach, 0, reach]) {
					const ground = groundHeight(x + u, z + v);
					low = Math.min(low, ground);
					high = Math.max(high, ground);
				}
			return high - low;
		};
		for (const [x, z] of [...covered, ...open]) {
			// Each table's ground contacts are on the piazza's level floor, and its base meets the paving.
			if (!inside(tableReach, x, z)) offenders.push(`table ${x.toFixed(1)},${z.toFixed(1)}`);
			if (spread(tableReach, x, z) > 0.07)
				offenders.push(`table ${x.toFixed(1)},${z.toFixed(1)} on a bank`);
			if (Math.abs(groundHeight(x, z) + 0.14 - floor.top) > 0.03)
				offenders.push(`table ${x.toFixed(1)},${z.toFixed(1)} off the flags`);
		}
		for (const [x, z] of pots) {
			if (!inside(potReach, x, z)) offenders.push(`pot ${x.toFixed(1)},${z.toFixed(1)}`);
			if (spread(potReach, x, z) > 0.07)
				offenders.push(`pot ${x.toFixed(1)},${z.toFixed(1)} on a bank`);
			if (Math.abs(groundHeight(x, z) + 0.14 - floor.top) > 0.03)
				offenders.push(`pot ${x.toFixed(1)},${z.toFixed(1)} off the flags`);
		}
		expect(offenders).toEqual([]);
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
