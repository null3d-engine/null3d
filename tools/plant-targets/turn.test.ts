import { describe, expect, test } from 'bun:test';
import { nullsOf, type SpeciesTargets, targetsText } from './schema.ts';
import { boxOf, empty, fill, HEIGHT, WIDTH } from './shapes.fixture.ts';
import { gatherTurn, statOf } from './turn.ts';
import { figuresOf } from './whole.ts';

describe('a turn of views', () => {
	/** The figures of a disc crown of a width on a stem. */
	function view(halfWidth: number) {
		const mask = empty();
		fill(mask, 195, 250, 204, 380);
		for (let y = 60; y <= 260; y++) {
			const half = halfWidth * Math.sqrt(Math.max(0, 1 - ((y - 160) / 100) ** 2));
			fill(mask, Math.round(200 - half), y, Math.round(200 + half), y);
		}
		const box = boxOf(mask);
		return figuresOf(
			mask,
			WIDTH,
			HEIGHT,
			box,
			200,
			{
				row: 259,
				width: box.right - box.left + 1,
				enclosedGap: 0,
				boxGap: 0.2,
			},
			null,
		);
	}

	test('gives each figure its range and the reach by direction', () => {
		const wide = view(150);
		const narrow = view(75);
		const turn = gatherTurn({ file: 'turn.mp4', arc: 360 }, [
			{ figures: wide },
			{ figures: narrow },
			{ problem: 'no plant is found' },
			{ figures: narrow },
			{ figures: wide },
		]);
		expect(turn.frames).toBe(5);
		expect(turn.read).toBe(4);
		expect(turn.skipped).toEqual({ 'no plant is found': 1 });
		expect(turn.stats.heightToWidth?.min).toBe(wide.heightToWidth);
		expect(turn.stats.heightToWidth?.max).toBe(narrow.heightToWidth);
		expect(turn.stats.heightToWidth?.frames).toBe(4);
		expect(turn.stats.limbs).toBeNull();
		expect(turn.missing['stats.limbs']).toContain('no frame gives it');
		expect(turn.series.heightToWidth).toEqual([
			wide.heightToWidth,
			narrow.heightToWidth,
			null,
			narrow.heightToWidth,
			wide.heightToWidth,
		]);
		expect(turn.series.angles).toEqual([0, 90, 180, 270, 360]);
		// The widest band's reach: the wide view's at most, and between the two on average.
		const band = wide.envelope.right.indexOf(Math.max(...wide.envelope.right));
		expect(turn.envelope.max[band]).toBe(wide.envelope.right[band]);
		expect(turn.envelope.mean[band]).toBeLessThan(wide.envelope.right[band] as number);
		expect(turn.envelope.mean[band]).toBeGreaterThan(narrow.envelope.right[band] as number);
		// The frames at 0 and 360 degrees face the same way, so their sides share two directions.
		expect(turn.envelope.byDirection[4]?.[band]).toBe(wide.envelope.right[band]);
		expect(turn.envelope.byDirection[8]?.[band]).toBe(narrow.envelope.right[band]);
		expect(turn.envelope.byDirection[2]).toBeNull();
		expect(turn.lobeCounts).toEqual({ 1: 4 });
	});

	test('a range leaves out the nulls', () => {
		expect(statOf([null, 2, undefined, 4])).toEqual({
			min: 2,
			low: 2,
			median: 3,
			high: 4,
			mean: 3,
			max: 4,
			spread: 0.6667,
			frames: 2,
		});
		// One far value moves the largest and the mean, and leaves the middle and the tenths.
		const far = statOf([...Array.from({ length: 19 }, () => 1), 21]);
		expect(far?.max).toBe(21);
		expect(far?.mean).toBe(2);
		expect([far?.low, far?.median, far?.high]).toEqual([1, 1, 1]);
		expect(statOf([null])).toBeNull();
	});
});

describe('a targets file', () => {
	const targets = {
		schema: 1,
		species: 'test',
		whole: {
			secondary: [{ file: '02.png', figures: null, missing: { figures: 'no plant is found' } }],
		},
		pieces: {
			turns: [{ video: 'branch.mp4', stats: { tips: null }, missing: { 'stats.tips': 'none' } }],
		},
		profile: [0.1, 0.25, null],
		nulls: [],
		missing: { stated: 'no sheet' },
	} as unknown as SpeciesTargets;

	test('lists every null with its path and reason', () => {
		expect(nullsOf(targets)).toEqual([
			{ path: 'whole.secondary[02.png].figures', reason: 'no plant is found' },
			{ path: 'pieces.turns[branch.mp4].stats.tips', reason: 'none' },
			{ path: 'stated', reason: 'no sheet' },
		]);
	});

	test('writes the same bytes each time, with a list of plain values on one line', () => {
		const text = targetsText(targets);
		expect(text).toBe(targetsText(JSON.parse(text) as SpeciesTargets));
		expect(text).toContain('\t"profile": [0.1, 0.25, null],\n');
		expect(text.endsWith('}\n')).toBe(true);
		expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(targets)));
	});
});
