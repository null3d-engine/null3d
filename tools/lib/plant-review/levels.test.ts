// A cell's level record names the level its picture draws: the level the query forces, the source
// level a plain-background picture draws from its colour picture's first cell, or the level the
// cell's own distance draws.
import { describe, expect, test } from 'bun:test';
import {
	cellLevel,
	type DrawnLevel,
	levelWord,
} from '../../../tests/pages/lib/plant-review/levels.ts';

const NAMES = ['leaf form', 'first card level', 'second card level', 'far card'] as const;

/** A drawn level as a page reads it, with the bands' starts. */
const drawn = (level: 0 | 1 | 2 | 3, starts = [0, 3.7, 156.6, 1e9]): DrawnLevel => ({
	level,
	name: NAMES[level],
	starts,
});

describe("a cell's level record", () => {
	test('names a forced level, and keeps the bands that name the level the engine draws', () => {
		for (const level of [0, 1, 2, 3] as const) {
			const cell = cellLevel(drawn(0), level, undefined, 80);
			expect(cell).toEqual({
				forced: true,
				level,
				name: NAMES[level],
				distance: 80,
				starts: [0, 3.7, 156.6, 1e9],
			});
			expect(cell.starts?.[1]).toBe(3.7);
		}
	});

	test('names the source level a plain-background picture draws, not the band it keeps it in', () => {
		// The shaped plant keeps the source level's parts in its nearest band, so its own band reads
		// the leaf form whichever level the picture shows.
		const cell = cellLevel(drawn(0), undefined, 1, 80);
		expect(cell).toEqual({
			forced: false,
			level: 1,
			name: 'first card level',
			distance: 80,
			starts: [0, 3.7, 156.6, 1e9],
		});
		expect(cellLevel(drawn(0), undefined, 2, 120).name).toBe('second card level');
		expect(cellLevel(drawn(0), undefined, 3, 400).name).toBe('far card');
	});

	test("names the level the cell's own distance draws when no level is forced or drawn from a source", () => {
		const starts = [0, 4, 90, 500];
		const cell = cellLevel(drawn(2, starts), undefined, undefined, 200);
		expect(cell).toEqual({
			forced: false,
			level: 2,
			name: 'second card level',
			distance: 200,
			starts,
		});
	});

	test('names a level past the table as the far card', () => {
		expect(levelWord(3)).toBe('far card');
		expect(levelWord(9)).toBe('far card');
	});
});
