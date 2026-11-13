// The rules the shared curve states: a path cut for a level of detail never turns more between two
// neighbouring segments than that level allows, whatever count is asked for; it turns one way only;
// its length is the arch's; a straight run costs one segment; a chain of arches holds the same
// bound where two of them meet; and the arch fitted to a part's measured figures stands on them.
import { describe, expect, it } from 'bun:test';
import {
	type Arch,
	type ArchChain,
	archFromFigures,
	archPath,
	archSegments,
	chainArches,
	chainLength,
	chainPath,
	MOST_TURN,
} from './arch';
import { unitAt } from './hash';
import { acos, radians } from './math';

/** The levels of detail. */
const LEVELS = [0, 1, 2] as const;

/** Degrees between each pair of neighbouring segments of a path, signed: positive toward the ground. */
function turns(path: ReturnType<typeof archPath>): number[] {
	const found: number[] = [];
	for (let i = 1; i < path.segments; i++) {
		const ax = (path.out[i] as number) - (path.out[i - 1] as number);
		const ay = (path.up[i] as number) - (path.up[i - 1] as number);
		const bx = (path.out[i + 1] as number) - (path.out[i] as number);
		const by = (path.up[i + 1] as number) - (path.up[i] as number);
		const dot = (ax * bx + ay * by) / Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by));
		const angle = (acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
		found.push(ax * by - ay * bx <= 0 ? angle : -angle);
	}
	return found;
}

/** Degrees between the last segment of one path and the first of the next laid on from its end. */
function joinTurn(a: ReturnType<typeof archPath>, b: ReturnType<typeof archPath>): number {
	const n = a.segments;
	const ax = (a.out[n] as number) - (a.out[n - 1] as number);
	const ay = (a.up[n] as number) - (a.up[n - 1] as number);
	const bx = (b.out[1] as number) - (b.out[0] as number);
	const by = (b.up[1] as number) - (b.up[0] as number);
	const dot = (ax * bx + ay * by) / Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by));
	return (acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

/** The length of a path's segments together. */
function measured(path: ReturnType<typeof archPath>): number {
	let sum = 0;
	for (let i = 0; i < path.segments; i++)
		sum += Math.sqrt(
			((path.out[i + 1] as number) - (path.out[i] as number)) ** 2 +
				((path.up[i + 1] as number) - (path.up[i] as number)) ** 2,
		);
	return sum;
}

/** An arch drawn from a seed: any leaving angle, a turn either way, any stretch and power. */
function drawn(seed: number): Arch {
	const from = unitAt(seed, 1) < 0.5 ? 0 : unitAt(seed, 2) * 0.8;
	const to = unitAt(seed, 3) < 0.5 ? 1 : from + (1 - from) * (0.05 + 0.95 * unitAt(seed, 4));
	return {
		length: 0.05 + 12 * unitAt(seed, 5),
		leave: -30 + 120 * unitAt(seed, 6),
		turn: -200 + 470 * unitAt(seed, 7),
		power: 1 + 3 * unitAt(seed, 8),
		from,
		to,
	};
}

describe('the shared curve', () => {
	it('never turns more between two segments than its level allows', () => {
		for (let seed = 0; seed < 400; seed++) {
			const arch = drawn(seed);
			for (const level of LEVELS) {
				const most = Math.max(0, ...turns(archPath(arch, level)).map(Math.abs));
				expect(most).toBeLessThanOrEqual(MOST_TURN[level] + 1e-6);
			}
		}
	});

	it('keeps that bound when more segments are asked for, and gives at least as many', () => {
		for (let seed = 0; seed < 120; seed++) {
			const arch = drawn(seed);
			const least = 1 + Math.floor(40 * unitAt(seed, 9));
			for (const level of LEVELS) {
				const path = archPath(arch, level, least);
				expect(path.segments).toBeGreaterThanOrEqual(least);
				expect(path.segments).toBeGreaterThanOrEqual(archSegments(arch, level));
				const most = Math.max(0, ...turns(path).map(Math.abs));
				expect(most).toBeLessThanOrEqual(MOST_TURN[level] + 1e-6);
			}
		}
	});

	it('turns one way only', () => {
		for (let seed = 0; seed < 400; seed++) {
			const arch = drawn(seed);
			for (const turn of turns(archPath(arch, 0)))
				expect(turn * Math.sign(arch.turn)).toBeGreaterThanOrEqual(-1e-9);
		}
	});

	it('needs fewer segments at each farther level, and never fewer than the turn divides into', () => {
		for (let seed = 0; seed < 200; seed++) {
			const arch = drawn(seed);
			const counts = LEVELS.map((level) => archSegments(arch, level));
			expect(counts[1] as number).toBeLessThanOrEqual(counts[0] as number);
			expect(counts[2] as number).toBeLessThanOrEqual(counts[1] as number);
			for (const level of LEVELS)
				expect(counts[level] as number).toBeGreaterThanOrEqual(
					Math.ceil(Math.abs(arch.turn) / MOST_TURN[level]),
				);
		}
	});

	it('cuts a straight part into one segment', () => {
		const path = archPath({ length: 3, leave: 80, turn: 0 }, 0);
		expect(path.segments).toBe(1);
		expect(path.out[1] as number).toBeCloseTo(3 * Math.cos(radians(80)), 9);
		expect(path.up[1] as number).toBeCloseTo(3 * Math.sin(radians(80)), 9);
	});

	it('spends one segment on each straight run beside a bend', () => {
		// A stalk that runs straight for four fifths and bows through 120 degrees at its end.
		const stalk: Arch = { length: 1, leave: 75, turn: 120, from: 0.8, power: 2 };
		const path = archPath(stalk, 0);
		expect(path.along[1] as number).toBeCloseTo(0.8, 12);
		expect(path.segments).toBe(1 + archSegments({ ...stalk, from: 0 }, 0));
	});

	it('lays the same curve at every level', () => {
		for (let seed = 0; seed < 100; seed++) {
			const arch = drawn(seed);
			const tips = LEVELS.map((level) => {
				const path = archPath(arch, level);
				return [path.out[path.segments] as number, path.up[path.segments] as number];
			});
			for (const level of [1, 2] as const) {
				expect(Math.abs((tips[level]?.[0] as number) - (tips[0]?.[0] as number))).toBeLessThan(
					2e-5 * arch.length,
				);
				expect(Math.abs((tips[level]?.[1] as number) - (tips[0]?.[1] as number))).toBeLessThan(
					2e-5 * arch.length,
				);
			}
		}
	});

	it('keeps the length of the part', () => {
		for (let seed = 0; seed < 100; seed++) {
			const arch = drawn(seed);
			const length = measured(archPath(arch, 0, 64));
			expect(length).toBeLessThanOrEqual(arch.length * (1 + 1e-9));
			expect(length).toBeGreaterThan(arch.length * 0.995);
		}
	});

	it('draws an even quarter turn as an arc of one radius', () => {
		// An arm that leaves level and turns up through a quarter circle of radius 2.
		const length = Math.PI;
		const path = archPath({ length, leave: 0, turn: -90 }, 0);
		const tip = path.segments;
		expect(path.out[tip] as number).toBeCloseTo(2, 5);
		expect(path.up[tip] as number).toBeCloseTo(2, 5);
		for (let i = 0; i <= tip; i++) {
			const radius = Math.sqrt((path.out[i] as number) ** 2 + ((path.up[i] as number) - 2) ** 2);
			expect(radius).toBeCloseTo(2, 5);
		}
	});

	it('is the same path each time', () => {
		const arch = drawn(7);
		const a = archPath(arch, 1, 9);
		const b = archPath(arch, 1, 9);
		expect([...a.out, ...a.up, ...a.elevation, ...a.along]).toEqual([
			...b.out,
			...b.up,
			...b.elevation,
			...b.along,
		]);
	});
});

/** A chain drawn from a seed: two to five links, each turning either way with any stretch and power. */
function drawnChain(seed: number): ArchChain {
	const count = 2 + Math.floor(unitAt(seed, 20) * 4);
	const links = Array.from({ length: count }, (_, k) => {
		const { leave: _leave, ...link } = drawn(seed * 8 + k + 1);
		return link;
	});
	return { leave: -30 + 120 * unitAt(seed, 21), links };
}

describe('a chain of arches', () => {
	it('is the arch itself when it has one link', () => {
		const arch = drawn(3);
		const { leave, ...link } = arch;
		const chain = chainPath({ leave, links: [link] }, 1, 7);
		const alone = archPath(arch, 1, 7);
		expect([...chain.out, ...chain.up, ...chain.along]).toEqual([
			...alone.out,
			...alone.up,
			...alone.along,
		]);
	});

	it('leaves each link in the direction the one before it ends in', () => {
		for (let seed = 0; seed < 50; seed++) {
			const chain = drawnChain(seed);
			const arches = chainArches(chain);
			expect(arches[0]?.leave).toBe(chain.leave);
			for (let k = 1; k < arches.length; k++) {
				const before = arches[k - 1] as Arch;
				expect((arches[k] as Arch).leave).toBeCloseTo(before.leave - before.turn, 9);
			}
		}
	});

	it('never turns more between two segments than its level allows, joins included', () => {
		for (let seed = 0; seed < 200; seed++) {
			const chain = drawnChain(seed);
			for (const level of LEVELS) {
				const most = Math.max(...turns(chainPath(chain, level)).map(Math.abs));
				expect(most).toBeLessThanOrEqual(MOST_TURN[level] + 1e-6);
			}
		}
	});

	it('cuts a join finer where its links cut alone would turn more than the level allows', () => {
		// A short turn gathered hard toward its end, then an even turn: each link cut alone ends and
		// starts within the bound, and the two half-turns at the join add up past it.
		for (const level of LEVELS) {
			const most = MOST_TURN[level];
			const chain: ArchChain = {
				leave: 30,
				links: [
					{ length: 1, turn: most * 0.92, power: 8.4 },
					{ length: 0.62, turn: most * 1.96 },
				],
			};
			const [a, b] = chainArches(chain).map((arch) => archPath(arch, level)) as [
				ReturnType<typeof archPath>,
				ReturnType<typeof archPath>,
			];
			expect(joinTurn(a, b)).toBeGreaterThan(most);
			const joinedPath = chainPath(chain, level);
			expect(Math.max(...turns(joinedPath).map(Math.abs))).toBeLessThanOrEqual(most + 1e-6);
		}
	});

	it('keeps the length of its links and shares the length along the whole chain', () => {
		for (let seed = 0; seed < 50; seed++) {
			const chain = drawnChain(seed);
			const path = chainPath(chain, 0, 64);
			const total = chainLength(chain);
			expect(measured(path)).toBeLessThanOrEqual(total * (1 + 1e-9));
			expect(measured(path)).toBeGreaterThan(total * 0.995);
			expect(path.along[0]).toBe(0);
			expect(path.along[path.segments]).toBe(1);
			for (let i = 1; i <= path.segments; i++)
				expect(path.along[i] as number).toBeGreaterThan(path.along[i - 1] as number);
		}
	});

	it('brings a blade down to the soil and lays it there', () => {
		// A blade that rises, turns over to 75 degrees below level, then turns back up through those
		// 75 degrees on a radius of 5 cm and lies level for 20 cm.
		const radius = 0.05;
		const chain: ArchChain = {
			leave: 75,
			links: [
				{ length: 0.9, turn: 150, power: 2 },
				{ length: radius * radians(75), turn: -75 },
				{ length: 0.2, turn: 0 },
			],
		};
		const path = chainPath(chain, 0);
		const tip = path.segments;
		expect(path.elevation[tip] as number).toBeCloseTo(0, 9);
		// The lying run is level: its two ends stand at one height.
		expect(path.up[tip] as number).toBeCloseTo(path.up[tip - 1] as number, 9);
		expect(Math.max(...turns(path).map(Math.abs))).toBeLessThanOrEqual(MOST_TURN[0] + 1e-6);
	});

	it('is the same path each time', () => {
		const chain = drawnChain(9);
		expect([...chainPath(chain, 2, 5).out]).toEqual([...chainPath(chain, 2, 5).out]);
	});
});

describe('an arch fitted to measured figures', () => {
	it('stands on figures that one arch can meet', () => {
		// The figures of a known arch, read back from its own path.
		for (let seed = 0; seed < 40; seed++) {
			const leave = 20 + 65 * unitAt(seed, 1);
			const known: Arch = {
				length: 1,
				leave,
				turn: (leave + 90) * (0.1 + 0.9 * unitAt(seed, 2)),
				power: 1 + 2 * unitAt(seed, 3),
			};
			const path = archPath(known, 0, 200);
			let apex = 0;
			for (let i = 0; i <= path.segments; i++) apex = Math.max(apex, path.up[i] as number);
			const figures = {
				length: 1,
				leave: known.leave,
				apex,
				drop: apex - (path.up[path.segments] as number),
				reach: path.out[path.segments] as number,
			};
			expect(archFromFigures(figures).miss).toBeLessThan(0.02);
		}
	});

	it('never curls a fitted part back past plumb', () => {
		for (let seed = 0; seed < 60; seed++) {
			const fit = archFromFigures({
				length: 1,
				apex: unitAt(seed, 1),
				drop: unitAt(seed, 2),
				reach: unitAt(seed, 3),
			});
			expect(fit.arch.leave - fit.arch.turn).toBeGreaterThanOrEqual(-90 - 1e-9);
			expect(fit.arch.turn).toBeGreaterThanOrEqual(0);
		}
	});

	it('finds the leaving angle when it is not given', () => {
		const known: Arch = { length: 1, leave: 70, turn: 110, power: 2 };
		const path = archPath(known, 0, 200);
		let apex = 0;
		for (let i = 0; i <= path.segments; i++) apex = Math.max(apex, path.up[i] as number);
		const fit = archFromFigures({
			length: 1,
			apex,
			drop: apex - (path.up[path.segments] as number),
			reach: path.out[path.segments] as number,
		});
		expect(fit.miss).toBeLessThan(0.01);
	});

	it('finds the length when it is not given', () => {
		const known: Arch = { length: 2.6, leave: 35, turn: 80, power: 2 };
		const path = archPath(known, 0, 200);
		let apex = 0;
		for (let i = 0; i <= path.segments; i++) apex = Math.max(apex, path.up[i] as number);
		const fit = archFromFigures({
			leave: 35,
			apex,
			drop: apex - (path.up[path.segments] as number),
			reach: path.out[path.segments] as number,
		});
		expect(fit.miss).toBeLessThan(0.01);
		expect(fit.arch.length).toBeGreaterThan(2.5);
		expect(fit.arch.length).toBeLessThan(2.7);
	});

	it('points the tip at the angle read on the photograph', () => {
		for (const tip of [0, 40, 75, 90]) {
			const fit = archFromFigures({ leave: 80, tip, apex: 0.6, drop: 0.5, reach: 0.9 });
			expect(fit.arch.leave - fit.arch.turn).toBeCloseTo(-tip, 9);
		}
	});

	it('says how far it misses figures that no arch can meet', () => {
		// A part cannot reach farther than its own length.
		expect(archFromFigures({ length: 1, leave: 60, apex: 0.2, reach: 1.4 }).miss).toBeGreaterThan(
			0.2,
		);
	});

	it('hangs a blade straight once its tip is plumb', () => {
		// A blade that rises 0.98 m, hangs 0.69 m below its top and ends 0.47 m out: a steep rise, a
		// turn right over and a straight hang, which no arch that bends to its very tip can make.
		const fit = archFromFigures({ leave: 85, apex: 0.98, drop: 0.69, reach: 0.47 });
		expect(fit.miss).toBeLessThan(0.05);
		expect(fit.arch.to ?? 1).toBeLessThan(0.9);
		expect(fit.arch.leave - fit.arch.turn).toBeLessThan(-80);
	});

	it('gives the same arch each time', () => {
		const figures = { length: 2, leave: 35, apex: 0.3, drop: 0.5, reach: 1.6 };
		expect(archFromFigures(figures)).toEqual(archFromFigures(figures));
	});
});
