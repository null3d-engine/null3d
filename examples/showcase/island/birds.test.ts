// The island's crows: their perches stand apart and clear of the plan's trees, one bird holds each
// perch by a claim, a flight lands on the perch it aimed at, the flock roosts while the town's lamps
// are lit, and only the nearest perched birds scatter when the camera comes inside the startle range.
import { describe, expect, it } from 'bun:test';
import {
	BIRD_COUNT,
	createFlock,
	type Flock,
	islandPerches,
	PERCH_GAP,
	PERCH_TREE_CLEAR,
	type Perch,
	STARTLE_BIRDS,
	STARTLE_FUSE,
	STARTLE_RANGE,
} from './birds';
import { TOWN, VILLAGES } from './island';
import { FILL_SPOTS, TREE_SPOTS } from './plan';

/** Long enough for every bird to have flown and landed at least once, in seconds. */
const SETTLE = 200;

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

	it('leaves the flock alone when the camera stays outside the range', () => {
		const flock = createFlock(line(6), 6, 13);
		run(flock, 1, false, [0, 10 + STARTLE_RANGE + 10, 0]);
		for (const bird of flock.birds) expect(bird.perched).toBe(true);
	});
});
