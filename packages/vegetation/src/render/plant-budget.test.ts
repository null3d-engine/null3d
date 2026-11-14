// The scene's budget of real pieces: the copies nearest the eye draw their pieces to their switch
// while the budget lasts, then to the range where their cards' cells draw at their own texels, and
// every copy past the first that does not fit keeps its cards. The hand-out never passes the budget,
// spends it up to the first copy that does not fit, keeps each grant by the copy's own key, and a
// copy at the budget's edge does not flicker as the eye moves or sways. The budget caps the settled
// grants: while a moved grant crosses over, both copies draw, one copy's cost over for a quarter second.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset } from '../asset';
import { length3 } from '../core/math';
import { loadSpecies } from '../core/registry';
import { DETAILS } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { drawnAtOnce, SHOOT_REACH } from '../lod/drawn';
import { CARD_CELL, firstCardStart, texelStart } from '../lod/levels';
import {
	type BudgetCandidate,
	GRANT_NONE,
	GRANT_SWITCH,
	GRANT_TEXEL,
	HOLD_MARGIN,
	handOut,
	nearestFirst,
	pieceCosts,
} from './plant-budget';

/** Copies at the given distances, each costing the given triangles to its switch and its texel range. */
function candidates(
	list: readonly (readonly [distance: number, toSwitch: number, toTexel: number])[],
): BudgetCandidate[] {
	return list.map(([distance, toSwitch, toTexel], id) => ({ id, distance, toSwitch, toTexel }));
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

/** The grants of a hand-out by each copy's key, as the next hand-out reads them. */
function keyed(list: readonly BudgetCandidate[], grants: Uint8Array): Map<number, number> {
	const out = new Map<number, number>();
	list.forEach((c, i) => {
		if ((grants[i] as number) !== GRANT_NONE) out.set(c.id, grants[i] as number);
	});
	return out;
}

/**
 * Checks that a hand-out is whole: it passes no budget, and the first copy it refuses, in its own
 * order, is one that does not fit after the copies before it, so a rule that grants too little fails.
 */
function whole(
	list: readonly BudgetCandidate[],
	budget: number,
	grants: Uint8Array,
	last?: Map<number, number>,
) {
	expect(spent(list, grants)).toBeLessThanOrEqual(budget);
	let switches = 0;
	for (const i of nearestFirst(list, last)) {
		const c = list[i] as BudgetCandidate;
		if (c.toSwitch <= 0) continue;
		if ((grants[i] as number) !== GRANT_NONE) {
			switches += c.toSwitch;
			continue;
		}
		const room = (last?.get(c.id) ?? GRANT_NONE) >= GRANT_SWITCH ? budget : budget * 0.95;
		expect([c.id, switches + c.toSwitch > room]).toEqual([c.id, true]);
		return;
	}
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
		whole(list, 640, grants);
	});

	it('ends the hand-out at the first copy that does not fit, whatever the list order', () => {
		// The cheap far copy comes first in the list; the dear one at 8 m ends the hand-out before it.
		const list = candidates([
			[20, 10, 10],
			[8, 900, 900],
			[4, 100, 100],
		]);
		expect([...handOut(list, 500)]).toEqual([GRANT_NONE, GRANT_NONE, GRANT_TEXEL]);
	});

	it('stops the texel range at the first copy whose range does not fit', () => {
		// The nearest copy's range is too dear; the farther one's cheap range waits behind it.
		const list = candidates([
			[10, 100, 150],
			[5, 100, 900],
		]);
		expect([...handOut(list, 1000)]).toEqual([GRANT_SWITCH, GRANT_SWITCH]);
	});

	it('lets a held grant keep to the whole budget and a new one only to a twentieth inside it', () => {
		const list = candidates([[5, 970, 970]]);
		expect([...handOut(list, 1000)]).toEqual([GRANT_NONE]);
		expect([...handOut(list, 1000, new Map([[0, GRANT_SWITCH]]))]).toEqual([GRANT_SWITCH]);
	});

	it('keeps each grant by the copy, however the list is ordered or culled', () => {
		const a = { id: 7, distance: 5, toSwitch: 970, toTexel: 970 };
		const b = { id: 3, distance: 6, toSwitch: 970, toTexel: 970 };
		const last = new Map([[7, GRANT_SWITCH]]);
		expect([...handOut([a, b], 1000, last)]).toEqual([GRANT_SWITCH, GRANT_NONE]);
		expect([...handOut([b, a], 1000, last)]).toEqual([GRANT_NONE, GRANT_SWITCH]);
		expect([...handOut([a], 1000, last)]).toEqual([GRANT_SWITCH]);
	});

	it('never passes the budget and spends it to the first copy that does not fit, over many stands', () => {
		let seed = 7;
		const next = () => {
			seed = (seed * 1103515245 + 12345) >>> 0;
			return seed / 4294967296;
		};
		for (let stand = 0; stand < 200; stand++) {
			const list: BudgetCandidate[] = [];
			for (let id = 0; id < 40; id++) {
				const toSwitch = Math.round(next() * 2e6);
				list.push({
					id,
					distance: next() * 120,
					toSwitch,
					toTexel: toSwitch + Math.round(next() * 3e6),
				});
			}
			const budget = next() * 2e7;
			let last: Map<number, number> | undefined;
			for (let step = 0; step < 5; step++) {
				const grants = handOut(list, budget, last);
				whole(list, budget, grants, last);
				last = keyed(list, grants);
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

	/**
	 * Walks an eye along +x past copies on or near the line, swaying back and forth as a held camera
	 * does, and gives each copy's grants and the eye's walk at each change.
	 */
	function walk(
		places: readonly (readonly [x: number, z: number])[],
		costs: readonly number[],
		budget: number,
	): { history: number[][]; at: number[][] } {
		const history = places.map(() => [] as number[]);
		const at = places.map(() => [] as number[]);
		let last: Map<number, number> | undefined;
		for (let step = 0; step <= 1200; step++) {
			const walked = -20 + step * 0.25;
			// The eye sways a quarter metre either way about its path.
			const eye = walked + 0.25 * Math.sin(step * 2.1);
			// The list comes in a fresh order at each step, as a culled list would.
			const list = places
				.map(([x, z], id) => ({
					id,
					distance: Math.hypot(x - eye, z),
					toSwitch: costs[id] as number,
					toTexel: costs[id] as number,
				}))
				.sort((p, q) => ((p.id * 7919 + step) % 101) - ((q.id * 7919 + step) % 101));
			const grants = handOut(list, budget, last);
			whole(list, budget, grants, last);
			// The copies granted are the nearest: none stands farther than a refused one, beyond the
			// margin a held grant keeps.
			let nearestRefused = Number.POSITIVE_INFINITY;
			let farthestGranted = 0;
			list.forEach((c, i) => {
				if ((grants[i] as number) === GRANT_NONE)
					nearestRefused = Math.min(nearestRefused, c.distance);
				else farthestGranted = Math.max(farthestGranted, c.distance);
			});
			expect(farthestGranted <= nearestRefused + HOLD_MARGIN).toBe(true);
			list.forEach((c, i) => {
				const seen = history[c.id] as number[];
				const g = (grants[i] as number) === GRANT_NONE ? 0 : 1;
				if (seen.length > 0 && seen[seen.length - 1] === g) return;
				seen.push(g);
				(at[c.id] as number[]).push(walked);
			});
			last = keyed(list, grants);
		}
		return { history, at };
	}

	it('swaps each copy between cards and pieces once on the way in and once out as the eye walks and sways', () => {
		const places = Array.from(
			{ length: 24 },
			(_, i) => [i * 7 + (i % 3) * 1.3, (i % 4) * 0.4] as const,
		);
		const costs = places.map((_, i) => 3e5 + (i % 4) * 1e5);
		const { history } = walk(places, costs, 1.6e6);
		expect(history.some((seen) => seen.includes(1))).toBe(true);
		for (const [i, seen] of history.entries())
			expect([i, ['0', '1', '01', '10', '010'].includes(seen.join(''))]).toEqual([i, true]);
	});

	it('holds one grant between two copies 0.3 m apart on the eye line, with room for one', () => {
		const { history } = walk(
			[
				[10, 0],
				[10.3, 0],
			],
			[1e6, 1e6],
			1.5e6,
		);
		// The grant passes from one to the other at most once, however the eye sways between them.
		const changes = history.reduce((sum, seen) => sum + seen.length - 1, 0);
		expect(changes).toBeLessThanOrEqual(3);
		for (const seen of history)
			expect(['0', '1', '01', '10', '010'].includes(seen.join(''))).toBe(true);
	});

	it('swaps no copy of a bed of a hundred, 0.4 m apart, more than once in and once out', () => {
		const places = Array.from(
			{ length: 100 },
			(_, i) => [40 + (i % 10) * 0.4, Math.floor(i / 10) * 0.4] as const,
		);
		const { history } = walk(places, new Array(100).fill(1e5), 2.05e6);
		for (const [i, seen] of history.entries())
			expect([i, ['0', '1', '01', '10', '010'].includes(seen.join(''))]).toEqual([i, true]);
	});

	it('refuses a budget that is no count of triangles', () => {
		for (const budget of [-1, Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => handOut([], budget)).toThrow(/budget/);
	});
});

describe("a variant's costs in the scene budget", () => {
	/** The triangles one copy draws from an eye, counted here: its meshes and its rows within a range. */
	function countFrom(
		kit: Parameters<typeof drawnAtOnce>[0],
		asset: PlantAsset,
		eye: readonly number[],
		range: number,
	): number {
		const tier = DETAILS.indexOf(kit.detail);
		const rows = asset.shoots;
		let sum = asset.levels[0].triangles;
		for (let r = 0; r < rows.count; r++) {
			const prototype = kit.prototypes[rows.prototype[r] as number];
			if (!prototype) continue;
			const d =
				length3(
					(rows.position[r * 3] as number) - (eye[0] as number),
					(rows.position[r * 3 + 1] as number) - (eye[1] as number),
					(rows.position[r * 3 + 2] as number) - (eye[2] as number),
				) - Math.fround(prototype.radius * (rows.scale[r] as number));
			if (d < range) sum += (prototype.tiers[tier]?.indices.length ?? 0) / 3;
		}
		return sum;
	}

	it(
		'counts each range from the worst eye, and no nearer eye draws more',
		async () => {
			const view = { height: 2160, fov: 60 };
			for (const id of ['scots-pine', 'sedge'] as const) {
				const module = await loadSpecies(id);
				await loadPlantCode(module.record);
				const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
				const asset = growPlantNow(kit, { seed: 11, variant: 0 });
				const pixels = kit.record.lod.switchPixels[0];
				const cell = kit.record.lod.cardCell?.low ?? CARD_CELL.low;
				const toSwitch = firstCardStart(kit, view) * SHOOT_REACH;
				// The texel range starts where the longest shoot spans one cell, never nearer than the switch.
				const texel = firstCardStart(kit, view) * Math.max(1, pixels / cell);
				expect(texelStart(kit, view)).toBeCloseTo(texel, 9);
				const costs = pieceCosts(kit, asset, view);
				// The switch's cost is what this count reads from the eye the shared count names.
				const worst = drawnAtOnce(kit, asset, view).at;
				expect([id, costs.toSwitch]).toEqual([id, countFrom(kit, asset, worst, toSwitch)]);
				// The texel range's cost is at least this count from that eye, and no more than the most
				// that a standing eye or any shoot's own place sees to that range.
				const reach = texel * SHOOT_REACH;
				expect([id, costs.toTexel >= countFrom(kit, asset, worst, reach)]).toEqual([id, true]);
				const { centre, radius } = asset.crown;
				let most = Math.max(
					countFrom(kit, asset, [0.5, 1.7, 0.5], reach),
					countFrom(kit, asset, [(centre[0] as number) + radius, 1.7, centre[2] as number], reach),
				);
				for (let r = 0; r < asset.shoots.count; r++)
					most = Math.max(
						most,
						countFrom(
							kit,
							asset,
							Array.from(asset.shoots.position.subarray(r * 3, r * 3 + 3)),
							reach,
						),
					);
				expect([id, costs.toTexel <= Math.max(most, countFrom(kit, asset, worst, reach))]).toEqual([
					id,
					true,
				]);
				if (pixels <= cell) expect([id, costs.toTexel]).toEqual([id, costs.toSwitch]);
				else expect([id, costs.toTexel > costs.toSwitch]).toEqual([id, true]);
				// No nearer eye draws more than the cost: a person by the trunk, and one at the crown's middle.
				for (const eye of [[0.5, 1.7, 0.5], [...asset.crown.centre]])
					expect([id, eye, countFrom(kit, asset, eye, toSwitch) <= costs.toSwitch]).toEqual([
						id,
						eye,
						true,
					]);
			}
		},
		scaledBudget(120_000),
	);
});
