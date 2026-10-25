import { describe, expect, test } from 'bun:test';
import {
	analyticVelocity,
	defaultFieldState,
	divergence,
	type FieldState,
	PUSH_LIFE,
	type Push,
	profile,
	value3,
} from './analytic';

const still = (over: Partial<FieldState> = {}): FieldState => ({
	...defaultFieldState(),
	gustStrength: 0,
	swirl: 0,
	...over,
});

const at = (
	state: FieldState,
	x: number,
	y: number,
	z: number,
	t: number,
	pushes: readonly (Push | undefined)[] = [],
) => analyticVelocity(state, pushes, x, y, z, t, [0, 0, 0]);

/**
 * The engine library's value noise written again with exact whole-number arithmetic, as an
 * independent reference: the field's own form uses 32-bit multiplication, which this checks.
 */
function referenceValue3(px: number, py: number, pz: number): number {
	const U = 0xffffffffn;
	const pcg = (v: bigint): bigint => {
		const state = (v * 747796405n + 2891336453n) & U;
		const shift = (state >> 28n) + 4n;
		const word = (((state >> shift) ^ state) * 277803737n) & U;
		return ((word >> 22n) ^ word) & U;
	};
	const pcg3d = (x: bigint, y: bigint, z: bigint): bigint[] => {
		let [p, q, r] = [x, y, z].map((v) => (v * 1664525n + 1013904223n) & U) as [
			bigint,
			bigint,
			bigint,
		];
		const mix = () => {
			p = (p + q * r) & U;
			q = (q + r * p) & U;
			r = (r + p * q) & U;
		};
		mix();
		p = (p ^ (p >> 16n)) & U;
		q = (q ^ (q >> 16n)) & U;
		r = (r ^ (r >> 16n)) & U;
		mix();
		return [p, q, r];
	};
	const unit = (hash: bigint): number => Number(hash >> 8n) / 16777216;
	const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
	const fx = BigInt(Math.floor(px));
	const fy = BigInt(Math.floor(py));
	const fz = BigInt(Math.floor(pz));
	const u = fade(px - Math.floor(px));
	const v = fade(py - Math.floor(py));
	const w = fade(pz - Math.floor(pz));
	const cell = (dx: bigint, dy: bigint, dz: bigint): number =>
		unit(pcg3d(fx + dx, fy + dy, fz + dz)[0] as bigint);
	const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
	return mix(
		mix(mix(cell(0n, 0n, 0n), cell(1n, 0n, 0n), u), mix(cell(0n, 1n, 0n), cell(1n, 1n, 0n), u), v),
		mix(mix(cell(0n, 0n, 1n), cell(1n, 0n, 1n), u), mix(cell(0n, 1n, 1n), cell(1n, 1n, 1n), u), v),
		w,
	);
}

describe('the noise the field is built from', () => {
	test('is the engine library’s value noise, which gives the same bits everywhere', () => {
		expect(value3(0, 0, 0)).toBeCloseTo(0.608_151_853_1, 9);
		for (let i = 0; i < 40; i++) {
			const p = [i * 0.713 - 4, i * 0.291 + 1, i * 0.517 - 2] as const;
			expect(value3(...p)).toBeCloseTo(referenceValue3(...p), 12);
		}
	});

	test('stays within 0 and 1 and varies smoothly', () => {
		for (let i = 0; i < 200; i++) {
			const n = value3(i * 0.37, i * 0.11, i * 0.73);
			expect(n).toBeGreaterThanOrEqual(0);
			expect(n).toBeLessThanOrEqual(1);
		}
		const near = value3(3.1, 2.2, 1.3);
		const next = value3(3.1001, 2.2, 1.3);
		expect(Math.abs(near - next)).toBeLessThan(0.01);
	});
});

describe('the analytic field', () => {
	test('blows along its heading, slower near the ground', () => {
		const state = still({ speed: 5, heading: Math.PI / 2, ground: 0.6 });
		const high = at(state, 1, 20, 2, 0);
		expect(high[0]).toBeCloseTo(0, 6);
		expect(high[2]).toBeCloseTo(5, 3);
		const low = at(state, 1, 0, 2, 0);
		expect(low[2]).toBeCloseTo(5 * (1 - 0.6), 3);
		expect(profile(state, 0)).toBeCloseTo(0.4, 6);
		expect(profile(state, 50)).toBeCloseTo(1, 6);
	});

	test('moves a probe as the time passes, and holds it still when it is frozen', () => {
		const state = defaultFieldState();
		const a = at(state, 3, 4, -2, 1);
		const b = at(state, 3, 4, -2, 1.2);
		const moved = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
		expect(moved).toBeGreaterThan(0.05);

		// The check that the moving one gives teeth to: a field without a gust and without a swirl
		// cannot move, so this test fails when the field is frozen.
		const frozen = still();
		const c = at(frozen, 3, 4, -2, 1);
		const d = at(frozen, 3, 4, -2, 1.2);
		expect(Math.hypot(c[0] - d[0], c[1] - d[1], c[2] - d[2])).toBe(0);
	});

	test('a gust travels through the air', () => {
		const state = still({ gustStrength: 4, gustSpeed: 6, gustRadius: 6, gustWave: 1 });
		// The gust's centre starts at the origin and moves along +x at 6 m a second.
		expect(Math.hypot(...(at(state, 0, 5, 0, 0) as [number, number, number]))).toBeGreaterThan(0.5);
		const later = at(state, 12, 5, 0, 2);
		expect(Math.abs(later[2]) + Math.abs(later[0] - 0)).toBeGreaterThan(0.5);
		// Far from the gust's wake, the air keeps its base wind alone.
		const quiet = at(state, 0, 5, 40, 2);
		expect(Math.abs(quiet[2])).toBeLessThan(0.01);
	});

	test('a push turns the air and fades away', () => {
		const state = still();
		const push: Push = { x: 0, z: 0, strength: 5, heading: 0, born: 1 };
		const near = at(state, 3, 4, 0, 1.1, [push]);
		const base = at(state, 3, 4, 0, 1.1);
		expect(Math.abs(near[2] - base[2])).toBeGreaterThan(0.5);
		const old = at(state, 3, 4, 0, 1 + PUSH_LIFE + 0.1, [push]);
		const oldBase = at(state, 3, 4, 0, 1 + PUSH_LIFE + 0.1);
		expect(old[2]).toBeCloseTo(oldBase[2], 12);
		// It turns about its centre: the two points either side of it are turned opposite ways.
		const above = at(state, 0, 4, 3, 1.1, [push]);
		const aboveBase = at(state, 0, 4, 3, 1.1);
		const below = at(state, 0, 4, -3, 1.1, [push]);
		const belowBase = at(state, 0, 4, -3, 1.1);
		expect(Math.sign(above[0] - aboveBase[0])).toBe(-Math.sign(below[0] - belowBase[0]));
	});

	test('keeps the air’s volume: its divergence is near zero', () => {
		const state = defaultFieldState();
		const push: Push = { x: 4, z: -3, strength: 6, heading: 1, born: 0.5 };
		let most = 0;
		let speed = 0;
		for (let i = 0; i < 24; i++) {
			const x = Math.cos(i * 1.7) * 9 + i * 0.3;
			const z = Math.sin(i * 2.3) * 9;
			const y = (i % 5) * 1.5;
			most = Math.max(most, Math.abs(divergence(state, [push], x, y, z, 1.3)));
			const v = at(state, x, y, z, 1.3, [push]);
			speed = Math.max(speed, Math.hypot(v[0], v[2]));
		}
		// The base wind and every turn keep the volume of an air parcel. The residual is the short
		// step's rounding, about a hundred-thousandth of the speed. A source of air, such as a push
		// that spreads outward instead of turning, adds a thousand times this.
		expect(speed).toBeGreaterThan(1);
		expect(most).toBeLessThan(speed * 1e-3);
	});

	test('is deterministic: the same place and time give the same air', () => {
		const state = defaultFieldState();
		const a = at(state, 2.5, 3, -1.5, 4.25);
		const b = at(state, 2.5, 3, -1.5, 4.25);
		expect(a).toEqual(b);
		expect(a[0]).not.toBe(0);
	});

	test('a second seed gives a different swirl, so two pages may differ', () => {
		const one = still({ swirl: 2, seed: 0 });
		const two = still({ swirl: 2, seed: 11 });
		expect(at(one, 3, 4, 3, 1)[2]).not.toBeCloseTo(at(two, 3, 4, 3, 1)[2], 3);
	});
});
