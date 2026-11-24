// The island's crows: their perches stand apart and clear of the plan's trees, the keeps' perches
// stand on the drawn stone, the form stands on its feet with smooth normals, one bird holds each
// perch by a claim, a flight lands on the perch it aimed at and leaves its perch outward, the flock
// roosts while the town's lamps are lit, and only the nearest perched birds scatter when the camera
// comes inside the startle range.
import { describe, expect, it } from 'bun:test';
import type { MeshArrays } from '@null3d/engine';
import {
	BIRD_COUNT,
	BIRD_MAX_SPEED,
	BIRD_SLOW_SPEED,
	createFlock,
	crowBody,
	crowWing,
	type Flight,
	type Flock,
	flightLength,
	HOP_METERS,
	islandPerches,
	PERCH_GAP,
	PERCH_TREE_CLEAR,
	type Perch,
	STARTLE_BIRDS,
	STARTLE_FUSE,
	STARTLE_RANGE,
} from './birds';
import { TOWN, VILLAGES } from './island';
import { fillSpots, KEEPS, treeSpots } from './plan';

/** The plan's trees, read once for every test. */
const TREE_SPOTS = treeSpots();
const FILL_SPOTS = fillSpots();

/** Long enough for every bird to have flown and landed at least once, in seconds. */
const SETTLE = 200;

/** The highest drawn stone of a keep's merlons and of the walk inside them, from the landmark model. */
const KEEP_MERLON_TOP = 23;
const KEEP_WALK_TOP = 21.9;

/** Runs the flock for some seconds, and answers the fewest and most meters apart two birds came. */
function run(
	flock: Flock,
	seconds: number,
	night = false,
	camera?: readonly [number, number, number],
) {
	const step = 1 / 60;
	for (let t = 0; t < seconds; t += step) flock.step(step, { night, camera });
	return flock;
}

/** The vertices of a form that the builders make, as plain numbers. */
function vertices(values: MeshArrays['positions']): readonly number[] {
	return values as readonly number[];
}

/** The lowest height of a form's vertices. */
function lowest(values: MeshArrays['positions']): number {
	const positions = vertices(values);
	let low = Number.POSITIVE_INFINITY;
	for (let k = 1; k < positions.length; k += 3) low = Math.min(low, positions[k] as number);
	return low;
}

describe('the perches', () => {
	const perches = islandPerches();

	it('stand at least the gap apart, and clear of the plan’s trees', () => {
		expect(perches.length).toBeGreaterThan(0);
		let closest = Number.POSITIVE_INFINITY;
		for (const [k, a] of perches.entries())
			for (const b of perches.slice(k + 1))
				closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
		expect(closest).toBeGreaterThanOrEqual(PERCH_GAP - 1e-9);
		const trees = [...TREE_SPOTS, ...FILL_SPOTS];
		let nearestTree = Number.POSITIVE_INFINITY;
		for (const perch of perches)
			for (const tree of trees)
				nearestTree = Math.min(nearestTree, Math.hypot(perch.x - tree.x, perch.z - tree.z));
		expect(nearestTree).toBeGreaterThanOrEqual(PERCH_TREE_CLEAR - 1e-9);
	});

	it('give every settlement some', () => {
		for (const [x, z, , radius] of VILLAGES)
			expect(perches.some((p) => Math.hypot(p.x - x, p.z - z) <= radius)).toBe(true);
		expect(perches.some((p) => Math.hypot(p.x - TOWN.x, p.z - TOWN.z) <= TOWN.radius)).toBe(true);
	});

	it('hold more places than the default flock needs, so every bird stands on its own', () => {
		expect(perches.length).toBeGreaterThanOrEqual(BIRD_COUNT);
	});

	it('stand on the keeps’ drawn stone, in the middle of the corner merlons', () => {
		for (const [kx, kz, ky] of KEEPS) {
			for (const [ox, oz] of [
				[4, 5],
				[-4, 5],
				[4, -5],
				[-4, -5],
			] as const) {
				const perch = perches.find(
					(p) =>
						Math.abs(p.x - (kx + ox)) < 1e-9 &&
						Math.abs(p.z - (kz + oz)) < 1e-9 &&
						Math.abs(p.y - (ky + KEEP_MERLON_TOP)) < 1e-9,
				);
				expect(perch).toBeDefined();
				// The bird looks out over the wall, not into the tower.
				expect(Math.sin(perch?.yaw ?? 0) * ox + Math.cos(perch?.yaw ?? 0) * oz).toBeGreaterThan(0);
			}
			expect(
				perches.some(
					(p) =>
						Math.abs(p.x - kx) < 1e-9 &&
						Math.abs(p.z - kz) < 1e-9 &&
						Math.abs(p.y - (ky + KEEP_WALK_TOP)) < 1e-9,
				),
			).toBe(true);
		}
	});
});

describe('the form', () => {
	it('stands on its feet, so no part of it sinks into the stone under it', () => {
		const body = crowBody();
		expect(lowest(body.positions)).toBeGreaterThanOrEqual(0);
		expect(lowest(body.positions)).toBeLessThan(0.05);
		// A wing turns at a shoulder above the feet, and its thinnest edge stays above them too.
		const wing = crowWing(1);
		expect(lowest(wing.positions)).toBeGreaterThan(-0.02);
	});

	it('shares the trunk’s vertices, so its normals shade it as one shape', () => {
		const body = crowBody();
		expect(body.computeNormals).toBe(true);
		expect(vertices(body.positions).length / 3).toBeLessThan((body.indices?.length ?? 0) / 3);
		const wing = crowWing(1);
		expect(wing.computeNormals).toBe(true);
		expect(vertices(wing.positions).length / 3).toBeLessThan((wing.indices?.length ?? 0) / 3);
	});

	it('tapers each wing to a single tip', () => {
		for (const side of [1, -1] as const) {
			const wing = crowWing(side);
			const points = vertices(wing.positions);
			let farthest = 0;
			let atTip = 0;
			for (let k = 0; k < points.length; k += 3)
				farthest = Math.max(farthest, Math.abs(points[k] as number));
			for (let k = 0; k < points.length; k += 3)
				if (Math.abs(Math.abs(points[k] as number) - farthest) < 1e-9) atTip++;
			expect(atTip).toBe(1);
		}
	});
});

/** A stand of test perches in a line, for a flock whose moves are easy to follow. */
function line(count: number, gap = 30): Perch[] {
	return Array.from({ length: count }, (_, k) => ({ x: k * gap, y: 10, z: 0, yaw: 0 }));
}

describe('the flock', () => {
	it('starts every bird on a perch of its own', () => {
		const flock = createFlock(line(8), 8, 11);
		const used = new Set(flock.birds.map((bird) => bird.perch));
		expect(flock.birds).toHaveLength(8);
		expect(used.size).toBe(8);
		for (const bird of flock.birds) expect(bird.perched).toBe(true);
	});

	it('never lets two birds stand on one perch', () => {
		const flock = run(createFlock(line(10), 10, 5), SETTLE, false, [500, 200, 500]);
		const used = new Set<number>();
		for (const bird of flock.birds)
			if (bird.perched) {
				expect(used.has(bird.perch)).toBe(false);
				used.add(bird.perch);
			}
	});

	it('lands a flight on the perch it aimed at', () => {
		// Two birds share four perches, so one is always free to fly to.
		const perches = line(4, 120);
		const flock = createFlock(perches, 2, 3);
		const bird = flock.birds[0];
		if (!bird) throw new Error('the flock has no birds');
		// The first bird leaves at its clock's first tick; follow it until it stands again.
		let flew = false;
		for (let t = 0; t < SETTLE; t += 1 / 60) {
			flock.step(1 / 60, { night: false });
			if (!bird.perched) flew = true;
			if (flew && bird.perched) break;
		}
		expect(flew).toBe(true);
		const perch = perches[bird.perch] as Perch;
		expect(bird.x).toBeCloseTo(perch.x, 6);
		expect(bird.y).toBeCloseTo(perch.y, 6);
		expect(bird.z).toBeCloseTo(perch.z, 6);
	});

	it('roosts with nothing in the air while the lamps are lit', () => {
		const flock = createFlock(line(6), 6, 17);
		run(flock, SETTLE, true);
		for (const bird of flock.birds) expect(bird.perched).toBe(true);
	});

	it('scatters only the nearest perched birds, after its fuse, when the camera comes close', () => {
		// Two perches stand inside the camera's range, two outside it, and two spare perches lie far
		// off, so a startled bird has somewhere to fly. The flock spreads over the perches, so the test
		// finds a seed whose birds stand where it needs them.
		const perches = [
			{ x: 0, y: 10, z: 0, yaw: 0 },
			{ x: 1.5, y: 10, z: 0, yaw: 0 },
			{ x: 40, y: 10, z: 0, yaw: 0 },
			{ x: 80, y: 10, z: 0, yaw: 0 },
			{ x: 1000, y: 10, z: 0, yaw: 0 },
			{ x: 1060, y: 10, z: 0, yaw: 0 },
		];
		const camera: readonly [number, number, number] = [1, 10, 0];
		let flock = createFlock(perches, 3, 1);
		for (let seed = 1; seed < 80; seed++) {
			flock = createFlock(perches, 3, seed);
			const near = flock.birds.filter(
				(bird) => Math.hypot(bird.x - camera[0], bird.z - camera[2]) <= STARTLE_RANGE,
			);
			if (near.length >= 1 && near.length <= STARTLE_BIRDS) break;
		}
		const near = flock.birds
			.map((bird, k) => ({ bird, k }))
			.filter(({ bird }) => Math.hypot(bird.x - camera[0], bird.z - camera[2]) <= STARTLE_RANGE);
		expect(near.length).toBeGreaterThan(0);
		flock.step(1 / 120, { night: false, camera });
		for (const bird of flock.birds) expect(bird.perched).toBe(true);
		run(flock, STARTLE_FUSE + 0.1, false, camera);
		for (const bird of flock.birds) {
			const close = near.some(({ k }) => flock.birds[k] === bird);
			expect(bird.perched).toBe(!close);
		}
	});

	it('hops between perches no farther than a crow’s hop', () => {
		const flock = createFlock(islandPerches(), BIRD_COUNT);
		const tracked = new Map<number, Flight>();
		let flights = 0;
		for (let t = 0; t < SETTLE; t += 1 / 60) {
			flock.step(1 / 60, { night: false });
			for (const [bird, flight] of flock.flights) {
				if (tracked.get(bird) === flight) continue;
				tracked.set(bird, flight);
				flights++;
				const [ax, , az] = [flight.path[0], flight.path[1], flight.path[2]];
				const [bx, , bz] = [flight.path[9], flight.path[10], flight.path[11]];
				const hop = Math.hypot((bx as number) - (ax as number), (bz as number) - (az as number));
				expect(hop).toBeGreaterThanOrEqual(HOP_METERS[0] - 1e-6);
				expect(hop).toBeLessThanOrEqual(HOP_METERS[1] + 1e-6);
			}
		}
		expect(flights).toBeGreaterThan(0);
	});

	it('flies every path no faster than the crow’s cruise', () => {
		// The flock's own perches, the shipped count and the shipped seed: each flight's path, at the
		// duration the flock gave it, stays within the crow's slow and fast cruise speeds.
		const flock = createFlock(islandPerches(), BIRD_COUNT);
		const tracked = new Map<number, Flight>();
		let flights = 0;
		let longest = 0;
		for (let t = 0; t < SETTLE; t += 1 / 60) {
			flock.step(1 / 60, { night: false });
			for (const [bird, flight] of flock.flights) {
				if (tracked.get(bird) === flight) continue;
				tracked.set(bird, flight);
				flights++;
				longest = Math.max(longest, flight.seconds);
				const speed = flightLength(flight.path) / flight.seconds;
				expect(speed).toBeLessThanOrEqual(BIRD_MAX_SPEED + 1e-6);
				expect(speed).toBeGreaterThanOrEqual(BIRD_SLOW_SPEED - 1e-6);
			}
		}
		expect(flights).toBeGreaterThan(0);
		expect(longest).toBeGreaterThan(0);
	});

	it('leaves a battlements perch outward, away from the keep’s stone', () => {
		// A crow on a corner merlon, with one spare perch far off for it to fly to. The camera stands
		// on the merlon, so its startle takes the one bird, after its fuse.
		const merlon: Perch = { x: 4, y: KEEP_MERLON_TOP, z: 5, yaw: Math.atan2(4, 5) };
		const spare: Perch = { x: 400, y: 10, z: 400, yaw: 0 };
		let flock = createFlock([merlon, spare], 1, 1);
		for (let seed = 1; seed < 80 && flock.birds[0]?.x !== merlon.x; seed++)
			flock = createFlock([merlon, spare], 1, seed);
		const bird = flock.birds[0];
		if (!bird) throw new Error('the flock has no birds');
		expect(bird.perched).toBe(true);
		expect(bird.x).toBe(merlon.x);
		const camera: readonly [number, number, number] = [merlon.x, merlon.y, merlon.z];
		const fromCentre = Math.hypot(merlon.x, merlon.z);
		let outward = fromCentre;
		let rose = 0;
		for (let t = 0; t < 1; t += 1 / 60) {
			flock.step(1 / 60, { night: false, camera });
			if (bird.perched) continue;
			outward = Math.max(outward, Math.hypot(bird.x, bird.z));
			rose = Math.max(rose, bird.y - merlon.y);
		}
		expect(bird.perched).toBe(false);
		expect(outward).toBeGreaterThan(fromCentre + 0.25);
		expect(rose).toBeGreaterThan(0.5);
	});

	it('leaves the flock alone when the camera stays outside the range', () => {
		const flock = createFlock(line(6), 6, 13);
		run(flock, 1, false, [0, 10 + STARTLE_RANGE + 10, 0]);
		for (const bird of flock.birds) expect(bird.perched).toBe(true);
	});
});
