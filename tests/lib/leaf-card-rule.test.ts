// The leaf-card level rule is written twice: once in the vegetation add-on, which thins a plant's
// shoot cards for its second card level, and once in the level planner that the asset tool and the
// engine share, which thins cards of a mesh from a file or from arrays. D-241 chose that split, so
// this test holds both to one rule: a level keeps every second card of the one above in a
// space-filling order, and each kept card grows about its middle by the square root of that step.
// The add-on holds that growth inside the plant's leaf form, so its levels are one size; the tool
// has no leaf form to hold it to. A change to either side that breaks the rule fails here.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cardKeep } from '../../packages/vegetation/src/lod/cards.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const CARDS = readFileSync(join(ROOT, 'packages/vegetation/src/lod/cards.ts'), 'utf8');
const ORDER = readFileSync(join(ROOT, 'packages/vegetation/src/leaf/instancer.ts'), 'utf8');
const TOOL = readFileSync(join(ROOT, 'packages/engine/levels/planner.js'), 'utf8');

describe('the leaf-card level rule, which the vegetation add-on and the asset tool share', () => {
	test('both order cards by a space-filling curve that interleaves the axes', () => {
		expect(/const ORDER_BITS = (\d+);/.exec(ORDER)?.[1]).toBe('10');
		expect(/const CARD_KEY_BITS = (\d+);/.exec(TOOL)?.[1]).toBe('16');
		// Both keys interleave the axes of a card's middle, so every second kept card spreads over
		// the crown. The widths differ, and the add-on's coarser key still orders the same way.
		expect(ORDER).toContain('key = key * 2 + ((axis >> bit) & 1)');
		expect(TOOL).toContain('key = key * 2 + ((axis >> bit) & 1)');
	});

	test('both keep every second card of the level above', () => {
		// The add-on's first card level holds every row; its second keeps every second. The step is
		// written as a shift so the count is exact in every engine.
		expect(CARDS).toContain('const own = 1 << (level - 1);');
		// The planner's step names the base mesh's cards for each kept card: 2 ** level.
		expect(TOOL).toContain('const every = 2 ** (levels.length + 1);');
		expect(TOOL).toContain('thinCards(list, Math.min(every, Math.max(1, list.cards.length)))');
		expect(cardKeep(0, 2)).toBeGreaterThan(0);
		expect(cardKeep(1, 2)).toBe(0);
	});

	test('both grow a kept card about its middle by the square root of the step', () => {
		expect(CARDS).toContain('const grow = Math.sqrt(every);');
		expect(TOOL).toContain('const grow = Math.sqrt(every);');
		expect(cardKeep(2, 2)).toBeCloseTo(Math.SQRT2, 12);
		// The add-on scales each plane's half-extents about the plane's centre, by that factor where
		// the leaf form has the room; the tool rewrites the vertices around the card's middle by it.
		expect(CARDS).toContain(
			'const grow = growthInHull(input, r, most, undefined, NO_SHIFT, back);',
		);
		expect(CARDS).toContain(
			'grow * (sx * (plane.right[c] as number) + sy * (plane.up[c] as number))',
		);
		expect(TOOL).toContain('centre + (value - centre) * grow');
	});
});
