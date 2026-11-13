// The scene's budget of real pieces: the copies nearest the eye draw their pieces to their switch
// while the budget lasts, then to the range where their cards' cells draw at their own texels, and
// every copy past the first that does not fit keeps its cards. The hand-out never passes the budget,
// and a copy at the budget's edge does not flicker as the eye moves.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { loadSpecies } from '../core/registry';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { drawnAtOnce } from '../lod/drawn';
import { CARD_CELL, firstCardStart, texelStart } from '../lod/levels';
import {
	type BudgetCandidate,
	GRANT_NONE,
	GRANT_SWITCH,
	GRANT_TEXEL,
	handOut,
	pieceCosts,
} from './plant-budget';

/** Copies at the given distances, each costing the given triangles to its switch and to its texel range. */
function candidates(
	list: readonly (readonly [distance: number, toSwitch: number, toTexel: number])[],
): BudgetCandidate[] {
	return list.map(([distance, toSwitch, toTexel]) => ({ distance, toSwitch, toTexel }));
}

/** The triangles a hand-out spends. */
function spent(list: readonly BudgetCandidate[], grants: Uint8Array): number {
	let sum = 0;
	list.forEach((c, i) => {
		if (grants[i] === GRANT_SWITCH) sum += c.toSwitch;
		if (grants[i] === GRANT_TEXEL) sum += c.toTexel;
	});
	return sum;
}

describe('the scene budget of real pieces', () => {
	it('gives the nearest copies their pieces to the switch, then the texel range, within the budget', () => {
		const list = candidates([
			[30, 100, 300],
			[5, 100, 300],
			[12, 100, 300],
			[50, 100, 300],
			[70, 300, 300],
		]);
		// Room for four copies to the switch, not the fifth, and then for the nearest to reach its
		// texel range; a new grant takes no more than a twentieth short of the budget.
		const grants = handOut(list, 640);
		expect([...grants]).toEqual([
			GRANT_SWITCH,
			GRANT_TEXEL,
			GRANT_SWITCH,
			GRANT_SWITCH,
			GRANT_NONE,
		]);
		expect(spent(list, grants)).toBeLessThanOrEqual(640);
	});

	it('ends the hand-out at the first copy that does not fit, so no farther copy draws pieces', () => {
		// The second nearest is too dear; the cheap far copy behind it keeps its cards too.
		const list = candidates([
			[4, 100, 100],
			[8, 900, 900],
			[20, 10, 10],
		]);
		// The nearest takes its texel range too, which costs it nothing more.
		expect([...handOut(list, 500)]).toEqual([GRANT_TEXEL, GRANT_NONE, GRANT_NONE]);
	});

	it('never passes the budget, over many stands', () => {
		let seed = 7;
		const next = () => {
			seed = (seed * 1103515245 + 12345) >>> 0;
			return seed / 4294967296;
		};
		for (let stand = 0; stand < 200; stand++) {
			const list: BudgetCandidate[] = [];
			for (let i = 0; i < 40; i++) {
				const toSwitch = Math.round(next() * 2e6);
				list.push({
					distance: next() * 120,
					toSwitch,
					toTexel: toSwitch + Math.round(next() * 3e6),
				});
			}
			const budget = next() * 2e7;
			let last: Uint8Array | undefined;
			for (let step = 0; step < 5; step++) {
				const grants = handOut(list, budget, last);
				expect(spent(list, grants)).toBeLessThanOrEqual(budget);
				last = grants;
				for (const c of list) (c as { distance: number }).distance += next() * 4 - 2;
			}
		}
	});

	it('gives a copy that holds no pieces nothing, whatever its distance', () => {
		const list = candidates([
			[2, 0, 0],
			[3, 100, 200],
		]);
		const grants = handOut(list, 1000);
		expect(grants[0]).toBe(GRANT_NONE);
		expect(grants[1]).toBe(GRANT_TEXEL);
	});

	it('swaps each copy between cards and pieces once on the way in and once on the way out, with no flicker', () => {
		// A row of copies of four costs along a line, some a little off it; the eye walks the line from
		// one end to the other in quarter metres, with the budget's edge falling among them.
		const places = Array.from({ length: 24 }, (_, i) => i * 7 + (i % 3) * 1.3);
		const aside = places.map((_, i) => (i % 4) * 0.4);
		const costs = places.map((_, i) => 3e5 + (i % 4) * 1e5);
		const budget = 1.6e6;
		const history = places.map(() => [] as number[]);
		const changedAt = places.map(() => [] as number[]);
		let last: Uint8Array | undefined;
		for (let eye = -20; eye <= 190; eye += 0.25) {
			const list = places.map((x, i) => ({
				distance: Math.hypot(x - eye, aside[i] as number),
				toSwitch: costs[i] as number,
				toTexel: (costs[i] as number) + (i % 3) * 2e5,
			}));
			const grants = handOut(list, budget, last);
			expect(spent(list, grants)).toBeLessThanOrEqual(budget);
			grants.forEach((g, i) => {
				const seen = history[i] as number[];
				if (seen.length > 0 && seen[seen.length - 1] === g) return;
				seen.push(g);
				(changedAt[i] as number[]).push(eye);
			});
			last = grants;
		}
		for (const [i, seen] of history.entries()) {
			// Whether a copy draws pieces at all rises once and falls once: the switch grants follow
			// the order of distances alone.
			const pieces = seen
				.map((g) => (g === GRANT_NONE ? 0 : 1))
				.filter((v, k, all) => k === 0 || v !== all[k - 1]);
			const shape = pieces.join('');
			expect([i, ['0', '1', '01', '10', '010'].includes(shape)]).toEqual([i, true]);
			// The texel range may come and go as farther copies leave the budget, but never twice within
			// a metre of the eye's walk.
			const at = changedAt[i] as number[];
			for (let k = 2; k < at.length; k++)
				expect([i, (at[k] as number) - (at[k - 1] as number) >= 1]).toEqual([i, true]);
		}
	});

	it('refuses a budget that is no count of triangles', () => {
		for (const budget of [-1, Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => handOut([], budget)).toThrow(/budget/);
	});
});

describe("a variant's costs in the scene budget", () => {
	it(
		'reads the shared drawn-at-once count to the switch and to the texel range',
		async () => {
			const view = { height: 2160, fov: 60 };
			for (const id of ['scots-pine', 'sedge'] as const) {
				const module = await loadSpecies(id);
				await loadPlantCode(module.record);
				const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
				const asset = growPlantNow(kit, { seed: 11, variant: 0 });
				const pixels = kit.record.lod.switchPixels[0];
				const cell = kit.record.lod.cardCell?.low ?? CARD_CELL.low;
				// The texel range starts where the longest shoot spans one cell, never nearer than the switch.
				expect(texelStart(kit, view)).toBeCloseTo(
					firstCardStart(kit, view) * Math.max(1, pixels / cell),
					9,
				);
				const costs = pieceCosts(kit, asset, view);
				expect([id, costs.toSwitch]).toEqual([id, drawnAtOnce(kit, asset, view).triangles]);
				expect([id, costs.toTexel >= costs.toSwitch]).toEqual([id, true]);
				if (pixels <= cell) expect([id, costs.toTexel]).toEqual([id, costs.toSwitch]);
				else expect([id, costs.toTexel > costs.toSwitch]).toEqual([id, true]);
			}
		},
		scaledBudget(60_000),
	);
});
