// The sweep's table: its six rungs, the cameras it stands them at, the pictures it draws, and the
// verdicts it reads. A rung with no reference view, a picture missing and a piece that meets
// nothing fail; a reference that does not separate leaves its row open rather than passing it.
import { describe, expect, test } from 'bun:test';
import type { PlantReviewQuery } from '../../../tests/pages/lib/plant-review/query.ts';
import type { PlantView } from '../../../tests/pages/lib/plant-review/views.ts';
import { VIEW_SPECS } from '../../../tests/pages/lib/plant-review/views.ts';
import type { SweepMeasures } from './compare.ts';
import type { ReferenceSet, Slot } from './references.ts';
import type { RunFrame } from './render.ts';
import {
	planFromManifest,
	SWEEP_COLUMNS,
	SWEEP_HEIGHTS,
	SWEEP_PICTURES,
	SWEEP_RUNGS,
	SWEEP_TURNS,
	type SweepPicture,
	type SweepReference,
	sweepCameras,
	sweepCoverage,
	sweepDistanceOf,
	sweepGreen,
	sweepManifest,
	sweepMarkdown,
	sweepReference,
	sweepRow,
	sweepShots,
	sweepStarts,
} from './sweep.ts';

/** A reference still of a view, with the number its file name carries. */
function slot(number: number, view: PlantView, extra: Partial<Slot> = {}): Slot {
	return {
		file: `${String(number).padStart(2, '0')}-${view}.png`,
		number,
		name: view,
		kind: 'still',
		view,
		background: VIEW_SPECS[view].background,
		framed: VIEW_SPECS[view].whole === true,
		...extra,
	};
}

/** A reference folder holding the stills it is given. */
function set(stills: readonly Slot[]): ReferenceSet {
	return {
		folder: '/refs/species',
		slug: 'species',
		files: [],
		stills,
		turns: [],
		winds: [],
		unknown: [],
	};
}

/** A frame whose cell names the plant's level distances. */
function frame(file: string, starts?: readonly number[]): RunFrame {
	return {
		group: 'sweep-probe',
		file,
		turn: 0,
		query: { species: 'species' },
		hold: 1,
		...(starts && { cell: { level: { level: 0, name: 'leaf form', starts } } }),
		ms: 1,
	};
}

/** A picture's connectivity, clean unless a piece is given to float. */
function measures(
	floating: readonly { area: number; box: string }[] = [],
	gap = 0.2,
): SweepMeasures {
	return {
		components: 1,
		footRow: 100,
		groundBand: null,
		floating,
		workWidth: null,
		crownBoxGap: gap,
	};
}

/** One drawn picture of a rung. */
function picture(
	file: string,
	level: number | null,
	rest: Partial<SweepPicture> = {},
): SweepPicture {
	return { file, level, away: null, measures: measures(), ...rest };
}

/** Every picture a rung draws, at its level, with the gap its measures carry. */
function pictures(level: number | null, gap = 0.2): SweepPicture[] {
	return Array.from({ length: SWEEP_PICTURES }, (_, index) =>
		picture(`sweep/rung-${index}.png`, level, { measures: measures([], gap) }),
	);
}

/** The reference of a rung, separable with the gap and pieces it shows. */
function refOf(rest: Partial<SweepReference> = {}): SweepReference {
	return { file: '01-whole.png', separable: true, gap: 0.2, pieces: 1, ...rest };
}

/** A rung's row from its pictures and the reference it is compared beside. */
function rowWith(
	rung: (typeof SWEEP_RUNGS)[number],
	drawn: readonly SweepPicture[],
	ref: SweepReference | undefined,
) {
	return sweepRow({
		species: 'species',
		slug: 'species',
		rung,
		reference: ref,
		distance: 18.5,
		band: 0.25,
		pictures: drawn,
	});
}

/** The level a rung's ladder draws, for a clean picture of it. */
function levelFor(rung: (typeof SWEEP_RUNGS)[number]): number {
	if (rung.level === 'far') return 3;
	if (rung.level === 'card') return 1;
	return 0;
}

/** A rung's row with the pictures it draws and a reference beside it. */
function row(
	rung: (typeof SWEEP_RUNGS)[number] = SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number],
	drawn = pictures(levelFor(rung)),
) {
	return rowWith(rung, drawn, refOf());
}

describe('the sweep’s rungs', () => {
	test('names six scales, each with a reference view list and the camera it stands at', () => {
		expect(SWEEP_RUNGS.map((rung) => rung.label)).toEqual([
			'the far card',
			'the first card level',
			'the near form at its switch',
			'inside the crown',
			'the trunk',
			"a leaf's scale",
		]);
		for (const rung of SWEEP_RUNGS) {
			expect(rung.referenceViews.length).toBeGreaterThan(0);
			if (rung.distance === 'fit') expect(rung.level).toBe('any');
			else expect(rung.referenceViews[0]).toBe('whole');
		}
	});

	test('stands every rung at four turns and two heights, from the reference view’s own camera', () => {
		expect(SWEEP_TURNS.length * SWEEP_HEIGHTS.length).toBe(SWEEP_PICTURES);
		const inside = SWEEP_RUNGS.find((rung) => rung.id === 'inside') as (typeof SWEEP_RUNGS)[number];
		const cameras = sweepCameras(inside, slot(6, 'inside', { turn: 45, elevation: 10 }));
		expect(cameras).toHaveLength(SWEEP_PICTURES);
		expect(cameras.map((camera) => camera.turn)).toEqual([45, 45, 135, 135, 225, 225, 315, 315]);
		expect(cameras.map((camera) => camera.elevation)).toEqual([10, 25, 10, 25, 10, 25, 10, 25]);
	});

	test('picks the first in-use still of a rung’s views, and none where the folder carries none', () => {
		const folder = set([slot(1, 'whole'), slot(6, 'crown'), slot(17, 'trunk')]);
		expect(sweepReference(folder, SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number])?.view).toBe(
			'whole',
		);
		expect(sweepReference(folder, SWEEP_RUNGS[3] as (typeof SWEEP_RUNGS)[number])?.view).toBe(
			'crown',
		);
		expect(sweepReference(folder, SWEEP_RUNGS[5] as (typeof SWEEP_RUNGS)[number])).toBeUndefined();
	});

	test('reads the ladder’s three distances from the probe frame, and refuses a frame without them', () => {
		expect(sweepStarts(frame('probe.png', [0, 3.7, 156.6, 1e9]))).toEqual([3.7, 156.6, 1e9]);
		expect(sweepStarts(frame('probe.png'))).toBeNull();
		expect(sweepStarts(undefined)).toBeNull();
		// A zero start is a band the plant does not draw, so the ladder cannot name it.
		expect(sweepStarts(frame('probe.png', [0, 0, 156.6, 1e9]))).toBeNull();
	});

	test('stands each ladder rung at its own switch, and the first card level inside its band', () => {
		const starts = [3.7, 156.6, 900] as const;
		const far = sweepDistanceOf(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], starts) as number;
		const first = sweepDistanceOf(SWEEP_RUNGS[1] as (typeof SWEEP_RUNGS)[number], starts) as number;
		const near = sweepDistanceOf(SWEEP_RUNGS[2] as (typeof SWEEP_RUNGS)[number], starts) as number;
		expect(far).toBeGreaterThan(900);
		expect(first).toBeGreaterThan(3.7);
		expect(first).toBeLessThan(156.6);
		expect(near).toBeLessThan(3.7);
		expect(sweepDistanceOf(SWEEP_RUNGS[3] as (typeof SWEEP_RUNGS)[number], starts)).toBeNull();
	});

	test('draws every rung’s pictures beside its reference view, and forces no level', () => {
		const folder = set([
			slot(1, 'whole'),
			slot(6, 'inside'),
			slot(17, 'trunk'),
			slot(18, 'leaf-upper'),
		]);
		const base: PlantReviewQuery = { species: 'species' };
		const { plan, shots } = sweepShots(folder, base, [3.7, 156.6, 900]);
		expect(plan.map((entry) => entry.rung.label)).toEqual(SWEEP_RUNGS.map((rung) => rung.label));
		expect(shots).toHaveLength(SWEEP_RUNGS.length * SWEEP_PICTURES);
		for (const entry of plan) {
			const drawn = shots.filter((shot) => shot.cells[0]?.file.includes(`sweep-${entry.rung.id}/`));
			expect(drawn).toHaveLength(SWEEP_PICTURES);
			for (const shot of drawn) expect(shot.reference).toBe(entry.slot?.file);
		}
		const far = shots.find((shot) => shot.cells[0]?.file.includes('sweep-far-card/'));
		expect(far?.query.distance).toBeGreaterThan(900);
		const inside = shots.find((shot) => shot.cells[0]?.file.includes('sweep-inside/'));
		expect(inside?.query.distance).toBeUndefined();
		expect(() => sweepShots(folder, { ...base, lod: 1 }, [3.7, 156.6, 900])).toThrow(
			'cannot force one',
		);
	});

	test('records its plan so a replay compares the same rungs', () => {
		const folder = set([slot(1, 'whole'), slot(17, 'trunk')]);
		const { plan } = sweepShots(folder, { species: 'species' }, [3.7, 156.6, 900]);
		const manifest = sweepManifest(plan, [3.7, 156.6, 900]);
		expect(manifest.starts).toEqual([3.7, 156.6, 900]);
		const replay = planFromManifest(folder, manifest);
		expect(replay.map((entry) => entry.rung.id)).toEqual(plan.map((entry) => entry.rung.id));
		expect(replay.map((entry) => entry.slot?.file ?? null)).toEqual(
			plan.map((entry) => entry.slot?.file ?? null),
		);
		expect(replay.map((entry) => entry.distance)).toEqual(plan.map((entry) => entry.distance));
	});
});

describe('the sweep’s verdicts', () => {
	test('passes a rung whose pictures all drew beside a reference within its band', () => {
		const result = row();
		expect(result.verdict).toBe('pass');
		expect(result.pictures).toBe(SWEEP_PICTURES);
		expect(result.gap).toEqual({ drawn: 0.2, reference: 0.2 });
		expect(result.reason).toContain(`8 of ${SWEEP_PICTURES} pictures beside the reference`);
	});

	test('fails a rung with no reference view as uncompared', () => {
		const result = rowWith(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], pictures(3), undefined);
		expect(result.verdict).toBe('fail');
		expect(result.reason).toContain('uncompared');
		expect(result.reference).toBeNull();
	});

	test('fails a rung with a missing picture, and names how many drew', () => {
		const drawn = pictures(3).slice(1);
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], drawn);
		expect(result.verdict).toBe('fail');
		expect(result.reason).toContain(`7 of ${SWEEP_PICTURES} pictures drew`);
	});

	test('fails a rung whose picture did not draw or holds no matte', () => {
		const drawn = pictures(3);
		drawn[0] = { file: 'sweep/rung-0.png', level: 3, away: null, error: 'E1410', measures: null };
		drawn[1] = {
			file: 'sweep/rung-1.png',
			level: 3,
			away: null,
			matteError: 'no matte',
			measures: null,
		};
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], drawn);
		expect(result.verdict).toBe('fail');
		expect(result.reason).toContain('did not draw: E1410');
		expect(result.reason).toContain('has no matte');
	});

	test('fails a rung where a piece meets nothing', () => {
		const drawn = pictures(3);
		drawn[4] = picture('sweep/rung-4.png', 3, {
			measures: measures([{ area: 120, box: 'x 10..20, y 30..40' }]),
		});
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], drawn);
		expect(result.verdict).toBe('fail');
		expect(result.floating).toBe(1);
		expect(result.reason).toContain('1 piece meets nothing');
	});

	test('fails a distance rung whose crown’s open sky stands past the band', () => {
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], pictures(3, 0.5));
		expect(result.verdict).toBe('fail');
		expect(result.reason).toContain('past the 0.25 band');
	});

	test('fails a ladder rung that drew another level than the ladder asked', () => {
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], pictures(1));
		expect(result.verdict).toBe('fail');
		expect(result.reason).toContain('not the far card');
	});

	test('leaves the near form open where the whole camera cannot reach its switch', () => {
		const drawn = Array.from({ length: SWEEP_PICTURES }, (_, index) => ({
			file: `sweep/near-${index}.png`,
			level: 1,
			away: 3.28,
			measures: measures(),
		}));
		const result = rowWith(SWEEP_RUNGS[2] as (typeof SWEEP_RUNGS)[number], drawn, refOf());
		expect(result.verdict).toBe('open');
		expect(result.reason).toContain("near form's switch");
		expect(result.reason).toContain('3.3 m');
		// A failing near row names both its own fault and the switch it could not reach.
		const floating = [...drawn];
		floating[0] = {
			...drawn[0]!,
			measures: measures([{ area: 40, box: 'x 1..2, y 3..4' }]),
		};
		const failed = rowWith(SWEEP_RUNGS[2] as (typeof SWEEP_RUNGS)[number], floating, refOf());
		expect(failed.verdict).toBe('fail');
		expect(failed.reason).toContain('1 piece meets nothing');
		expect(failed.reason).toContain("near form's switch");
	});

	test('leaves a distance rung open where its reference does not separate', () => {
		const result = rowWith(
			SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number],
			pictures(3),
			refOf({ separable: false, gap: null, pieces: null }),
		);
		expect(result.verdict).toBe('open');
		expect(result.reason).toContain('does not separate');
	});

	test('counts every rung, and fails a round with a missing row or an uncompared view', () => {
		const green = sweepCoverage(
			'species',
			SWEEP_RUNGS.map((rung) => row(rung)),
		);
		expect(green.green).toBe(true);
		expect(green.missingRows).toEqual([]);
		const short = sweepCoverage('species', [row()]);
		expect(short.green).toBe(false);
		expect(short.missingRows).toHaveLength(SWEEP_RUNGS.length - 1);
		const uncompared = sweepCoverage('species', [
			rowWith(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], pictures(3), undefined),
		]);
		expect(uncompared.uncompared).toEqual(['the far card']);
	});

	test('reports a green round only when every row passes and every view is compared', () => {
		const rows = SWEEP_RUNGS.map((rung) => row(rung));
		const coverage = [sweepCoverage('species', rows)];
		expect(sweepGreen(rows, coverage)).toBe(true);
		const open = sweepCoverage('species', [
			rowWith(
				SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number],
				pictures(3),
				refOf({ separable: false, gap: null, pieces: null }),
			),
		]);
		expect(sweepGreen([row()], [open])).toBe(false);
	});
});

describe('the sweep’s table', () => {
	test('writes a row a species and a view, with each column’s figure', () => {
		const rows = SWEEP_RUNGS.map((rung) => row(rung));
		const table = sweepMarkdown(rows, [sweepCoverage('species', rows)]);
		expect(table).toContain(`| ${SWEEP_COLUMNS.join(' | ')} |`);
		const dataRows = table.split('\n').filter((line) => line.startsWith('| species |'));
		expect(dataRows).toHaveLength(SWEEP_RUNGS.length);
		for (const line of dataRows) {
			const cells = line.split(' | ');
			// The first and last cells carry the row's own pipes.
			expect(cells).toHaveLength(SWEEP_COLUMNS.length);
			expect(cells[0]).toBe('| species');
			expect(cells[SWEEP_COLUMNS.length - 1]).toContain('|');
		}
		expect(table).toContain('species: every row drawn and compared');
	});

	test('names the round’s faults in its coverage lines', () => {
		const rows = [rowWith(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], pictures(3), undefined)];
		const table = sweepMarkdown(rows, [sweepCoverage('species', rows)]);
		expect(table).toContain('missing rows:');
		expect(table).toContain('uncompared');
	});
});
