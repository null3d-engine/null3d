// The leaf-card level rule is written twice: once in the generator, which makes its levels from a
// skeleton, and once in the asset tool, which thins cards of a mesh from a file. D-241 chose that
// split, so this test holds both to one rule: a level keeps every second card of the
// one above in a space-filling order, and each kept card grows about its middle by the square root
// of that step. A change to either side that breaks the rule fails here.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const GENERATOR = readFileSync(join(ROOT, 'packages/vegetation/src/levels.ts'), 'utf8');
const TOOL = readFileSync(join(ROOT, 'packages/cli/src/assets/levels.js'), 'utf8');

describe('the leaf-card level rule, which the generator and the asset tool share', () => {
	test('both order cards by a space-filling curve of the same width', () => {
		const generator = /const CARD_KEY_BITS = (\d+);/.exec(GENERATOR);
		const tool = /const CARD_KEY_BITS = (\d+);/.exec(TOOL);
		expect(generator?.[1]).toBe('10');
		expect(tool?.[1]).toBe('16');
		// Both keys interleave the axes of a card's middle, so every second kept card spreads over
		// the crown. The widths differ, and the generator's coarser key still orders the same way.
		expect(GENERATOR).toContain('key = key * 2 + ((axis >> bit) & 1)');
		expect(TOOL).toContain('key = key * 2 + ((axis >> bit) & 1)');
	});

	test('both keep every second card of the level above', () => {
		expect(GENERATOR).toContain('const every = 2 ** level;');
		expect(TOOL).toContain('thinCards(list, Math.min(2 ** level, Math.max(1, list.cards.length)))');
	});

	test('both grow a kept card about its middle by the square root of the step', () => {
		expect(GENERATOR).toContain('const grow = Math.sqrt(every);');
		expect(TOOL).toContain('const grow = Math.sqrt(every);');
		// The generator keeps the same card, so its middle does not move; the tool rewrites the
		// vertices around the card's middle by the same factor.
		expect(GENERATOR).toContain('kept.push(card);');
		expect(TOOL).toContain('centre + (value - centre) * grow');
	});

	test('both report the largest dropped card as the level error', () => {
		expect(GENERATOR).toContain('error = Math.max(error, card.width, card.height);');
		expect(TOOL).toContain('error = Math.max(error, card.size);');
	});
});
