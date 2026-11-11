// How a turn is split into sheets of cells: how many cells a sheet takes at a cell's size, how its
// cells are laid out, and that the turns run on from sheet to sheet.
import { describe, expect, test } from 'bun:test';
import { readPublished, sheetGrid, turnShots } from './render.ts';

/** A page that answers each read with the next answer, and keeps what each read asked for. */
function pageAnswering(answers: readonly unknown[]): {
	page: Parameters<typeof readPublished>[0];
	reads: readonly unknown[][];
} {
	const reads: unknown[][] = [];
	let read = 0;
	const page = {
		evaluate: async (...args: unknown[]) => {
			reads.push(args);
			return answers[Math.min(read++, answers.length - 1)];
		},
	};
	return { page: page as unknown as Parameters<typeof readPublished>[0], reads };
}

/** The pixels of a sheet's canvas, its empty cells included. */
function canvasPixels(shot: ReturnType<typeof turnShots>[number]): number {
	const columns = shot.query.columns as number;
	return columns * Math.ceil(shot.cells.length / columns) * shot.cell[0] * shot.cell[1];
}

describe('the sheets of a turn', () => {
	const query = { species: 'stub', view: 'whole' } as const;

	test('lay their cells in as few rows as six columns allow, each row as full as it can be', () => {
		expect(sheetGrid(1)).toEqual({ columns: 1, rows: 1 });
		expect(sheetGrid(6)).toEqual({ columns: 6, rows: 1 });
		expect(sheetGrid(8)).toEqual({ columns: 4, rows: 2 });
		expect(sheetGrid(17)).toEqual({ columns: 6, rows: 3 });
		expect(sheetGrid(24)).toEqual({ columns: 6, rows: 4 });
	});

	test('hold 24 small cells, and fewer as each grows, within the pixels a sheet holds', () => {
		const small = turnShots('turn', query, [480, 320], 0, 15, 24, false);
		expect(small.map((shot) => shot.cells.length)).toEqual([24]);
		const large = turnShots('turn', query, [1168, 784], 0, 360 / 193, 193, false);
		expect(large[0]?.cells).toHaveLength(8);
		expect(large[0]?.query.columns).toBe(4);
		for (const shot of large) {
			expect(canvasPixels(shot)).toBeLessThanOrEqual(8_000_000);
			expect(shot.query.columns as number).toBeLessThanOrEqual(6);
		}
		// Every turn is drawn once, and each sheet starts where the last one ended.
		expect(large.reduce((sum, shot) => sum + shot.cells.length, 0)).toBe(193);
		expect(large[1]?.query.turn).toBeCloseTo((8 * 360) / 193, 9);
		expect(large[1]?.cells[0]?.turn).toBeCloseTo((8 * 360) / 193, 9);
	});

	test('keep within the cells a lit turn asks, and take one cell however large it is', () => {
		const lit = turnShots('turn', query, [768, 516], 0, 360 / 193, 193, false, 1, 17);
		expect(lit[0]?.cells).toHaveLength(17);
		expect(lit[0]?.query.columns).toBe(6);
		expect(
			turnShots('turn', query, [4000, 3000], 0, 90, 4, false).map((s) => s.cells.length),
		).toEqual([1, 1, 1, 1]);
	});
});

describe('reading a page that published its result', () => {
	test('takes the result on the first read that returns one', async () => {
		const { page } = pageAnswering([undefined, undefined, { ok: true, width: 4 }]);
		expect(await readPublished(page)).toEqual({ ok: true, width: 4 });
	});

	test('reads a result in pieces when the browser will not pass it back whole', async () => {
		const { page, reads } = pageAnswering([
			undefined,
			undefined,
			undefined,
			undefined,
			{ ok: true, width: 2, height: 3, pixels: 5_000_000 },
			'aaaa',
			'bbbb',
		]);
		expect(await readPublished(page)).toEqual({
			ok: true,
			width: 2,
			height: 3,
			pixels: 'aaaabbbb',
		});
		expect(reads.slice(5)).toEqual([
			[expect.any(Function), [0, 4_000_000]],
			[expect.any(Function), [4_000_000, 4_000_000]],
		]);
	});

	test('gives up with a message of its own when every read returns nothing', async () => {
		const { page } = pageAnswering([undefined]);
		await expect(readPublished(page)).rejects.toThrow(
			'published a result, and the browser returned none of it',
		);
	});
});
