// The sweep's tables: its six rungs, the orbit's cameras, the pull-back series, and the verdicts.
// A rung with no reference view, a picture missing, a piece that meets nothing, a crown outside its
// bar, an orbit that jumps and a series that opens all fail; a switch the camera cannot reach is an
// open fault that names both distances.
import { describe, expect, test } from 'bun:test';
import type { PlantReviewQuery } from '../../../tests/pages/lib/plant-review/query.ts';
import type { PlantView } from '../../../tests/pages/lib/plant-review/views.ts';
import { VIEW_SPECS } from '../../../tests/pages/lib/plant-review/views.ts';
import type { SweepMeasures } from './compare.ts';
import type { ReferenceSet, Slot } from './references.ts';
import type { RunFrame } from './render.ts';
import {
	PATCH_SIZES,
	patchCorners,
	planFromManifest,
	SERIES_COLUMNS,
	SERIES_OPEN,
	SWEEP_COLUMNS,
	SWEEP_HEIGHTS,
	SWEEP_PICTURES,
	SWEEP_RUNGS,
	SWEEP_SERIES_STEPS,
	SWEEP_STEP,
	SWEEP_TURNS,
	type SweepPicture,
	type SweepReference,
	type SweepSeriesRow,
	sweepCameras,
	sweepCoverage,
	sweepDistanceOf,
	sweepGreen,
	sweepManifest,
	sweepMarkdown,
	sweepOrbitJumps,
	sweepPictures,
	sweepReference,
	sweepRow,
	sweepSeriesDistances,
	sweepSeriesRows,
	sweepSeriesShots,
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
	components = 1,
): SweepMeasures {
	return {
		components,
		footRow: 100,
		groundBand: null,
		floating,
		workWidth: null,
		crownBoxGap: 0.2,
	};
}

/** One drawn picture of an orbit. */
function picture(
	file: string,
	level: number | null,
	rest: Partial<SweepPicture> = {},
): SweepPicture {
	const covered = rest.covered === undefined ? 0.8 : rest.covered;
	return {
		file,
		turn: 0,
		height: 'low',
		level,
		forced: false,
		away: null,
		measures: measures(),
		skyGap: covered === null ? null : 1 - covered,
		covered,
		width: 400,
		cutTop: false,
		...rest,
	};
}

/** Every picture an orbit draws, at a level and a covered share. */
function orbit(level: number | null, covered = 0.8, turn?: number): SweepPicture[] {
	const out: SweepPicture[] = [];
	for (const angle of SWEEP_TURNS)
		for (const height of SWEEP_HEIGHTS)
			out.push(
				picture(`sweep/rung-t${angle}-h${height.id}.png`, level, {
					turn: angle,
					height: height.id,
					covered: turn === angle ? 0.5 : covered,
				}),
			);
	return out;
}

/** The reference of a rung, separable with the sky gap and pieces it shows. */
function refOf(rest: Partial<SweepReference> = {}): SweepReference {
	return {
		file: '01-whole.png',
		separable: true,
		skyGap: 0.2,
		solidity: 0.75,
		pieces: 1,
		...rest,
	};
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
		pictures: drawn,
	});
}

/** The level a rung's ladder draws, for a clean picture of it. */
function levelFor(rung: (typeof SWEEP_RUNGS)[number]): number {
	if (rung.level === 'far') return 3;
	if (rung.level === 'card') return 1;
	return 0;
}

/** A rung's row with a clean orbit and a reference beside it. */
function row(
	rung: (typeof SWEEP_RUNGS)[number] = SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number],
	drawn = orbit(levelFor(rung)),
) {
	return rowWith(rung, drawn, refOf());
}

/** One series step's row. */
function seriesStep(
	file: string,
	distance: number,
	covered: number | null,
	field = '4 m patch',
	charged = true,
): SweepSeriesRow {
	return {
		file,
		distance,
		level: 0,
		covered,
		field,
		charged,
		change: null,
		verdict: 'pass',
		reason: '',
	};
}

describe('the sweep’s rungs and orbit', () => {
	test('names six scales, each with a reference view list and how it is judged', () => {
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
			// The far card and the first card level are whole views; the near form's own switch is
			// drawn from inside the crown.
			else if (rung.distance !== 'near') expect(rung.referenceViews[0]).toBe('whole');
		}
		// The near form's switch lies near the foot, so the rung draws from the inside-crown camera.
		const near = SWEEP_RUNGS.find((rung) => rung.id === 'switch');
		expect(near?.referenceViews[0]).toBe('inside');
	});

	test('draws the pictures a step and an orbit ask, or one alone', () => {
		expect(sweepPictures(30)).toBe(24);
		expect(sweepPictures(60)).toBe(12);
		expect(sweepPictures(45)).toBe(16);
		expect(sweepPictures(60, false)).toBe(1);
		const folder = set([
			slot(1, 'whole'),
			slot(6, 'inside'),
			slot(17, 'trunk'),
			slot(18, 'leaf-upper'),
		]);
		const whole = SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number];
		const orbit = sweepShots(folder, { species: 'species' }, [3.7, 156.6, 900], 60, true);
		expect(
			orbit.shots.filter((shot) => shot.cells[0]?.file.includes('sweep-far-card/')),
		).toHaveLength(12);
		const rungs = sweepShots(folder, { species: 'species' }, [3.7, 156.6, 900], 60, false);
		expect(rungs.shots).toHaveLength(SWEEP_RUNGS.length);
		expect(
			rungs.shots.every(
				(shot) => shot.query.view === whole.referenceViews[0] || shot.reference !== undefined,
			),
		).toBe(true);
	});

	test('orbits each rung at an even step of a full turn and two heights', () => {
		expect(SWEEP_STEP).toBe(30);
		expect(SWEEP_TURNS).toHaveLength(12);
		expect(SWEEP_TURNS[0]).toBe(0);
		expect(SWEEP_TURNS[11]).toBe(330);
		expect(SWEEP_TURNS.length * SWEEP_HEIGHTS.length).toBe(SWEEP_PICTURES);
		const inside = SWEEP_RUNGS.find((rung) => rung.id === 'inside') as (typeof SWEEP_RUNGS)[number];
		const cameras = sweepCameras(inside, slot(6, 'inside', { turn: 45, elevation: 10 }));
		expect(cameras).toHaveLength(SWEEP_PICTURES);
		expect(cameras.slice(0, 4).map((camera) => camera.turn)).toEqual([45, 45, 75, 75]);
		expect(cameras.slice(0, 4).map((camera) => camera.elevation)).toEqual([10, 25, 10, 25]);
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

	test('reads the ladder’s three distances from the probe frame, and refuses one without them', () => {
		expect(sweepStarts(frame('probe.png', [0, 3.7, 156.6, 1e9]))).toEqual([3.7, 156.6, 1e9]);
		expect(sweepStarts(frame('probe.png'))).toBeNull();
		expect(sweepStarts(undefined)).toBeNull();
		expect(sweepStarts(frame('probe.png', [0, 0, 156.6, 1e9]))).toBeNull();
	});

	test('stands each ladder rung at its own switch, the near form nearer and low', () => {
		const starts = [3.7, 156.6, 900] as const;
		const far = sweepDistanceOf(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], starts) as number;
		const first = sweepDistanceOf(SWEEP_RUNGS[1] as (typeof SWEEP_RUNGS)[number], starts) as number;
		const near = sweepDistanceOf(SWEEP_RUNGS[2] as (typeof SWEEP_RUNGS)[number], starts) as number;
		expect(far).toBeGreaterThan(900);
		expect(first).toBeGreaterThan(3.7);
		expect(first).toBeLessThan(156.6);
		expect(near).toBe(3.7);
		expect(sweepDistanceOf(SWEEP_RUNGS[3] as (typeof SWEEP_RUNGS)[number], starts)).toBeNull();
	});

	test('draws every rung beside its reference view, and forces no level', () => {
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
		const near = shots.find((shot) => shot.cells[0]?.file.includes('sweep-switch/'));
		expect(near?.query.distance).toBeCloseTo(3.7 * 0.3, 5);
		expect(near?.query.view).toBe('inside');
		const inside = shots.find((shot) => shot.cells[0]?.file.includes('sweep-inside/'));
		expect(inside?.query.distance).toBeUndefined();
		expect(() => sweepShots(folder, { ...base, lod: 1 }, [3.7, 156.6, 900])).toThrow(
			'cannot force one',
		);
	});

	test('records its plan so a replay compares the same rungs and series', () => {
		const folder = set([slot(1, 'whole'), slot(17, 'trunk')]);
		const { plan } = sweepShots(folder, { species: 'species' }, [3.7, 156.6, 900]);
		const pull = sweepSeriesShots({ species: 'species' }, [3.7, 156.6, 900]);
		const manifest = sweepManifest(plan, [3.7, 156.6, 900], pull.steps);
		expect(manifest.starts).toEqual([3.7, 156.6, 900]);
		expect(manifest.series.length).toBe(pull.steps.length);
		const replay = planFromManifest(folder, manifest);
		expect(replay.map((entry) => entry.rung.id)).toEqual(plan.map((entry) => entry.rung.id));
		expect(replay.map((entry) => entry.slot?.file ?? null)).toEqual(
			plan.map((entry) => entry.slot?.file ?? null),
		);
	});
});

describe('the pull-back series', () => {
	test('projects a fixed patch at the camera target, and refuses one that leaves the frame', () => {
		const far = patchCorners({ position: [0, 0, 40], target: [0, 0, 0], fov: 38 }, 960, 720);
		expect(far.inside).toBe(true);
		const centre = far.corners[0] as readonly [number, number];
		expect(centre[0]).toBeLessThan(960);
		expect(centre[1]).toBeLessThan(720);
		const close = patchCorners({ position: [0, 0, 2], target: [0, 0, 0], fov: 38 }, 960, 720);
		expect(close.inside).toBe(false);
	});

	test('spans a far step on the larger patch and not on the smaller', () => {
		const spanOf = (metres: number) => {
			const patch = patchCorners(
				{ position: [0, 0, 284], target: [0, 0, 0], fov: 38 },
				480,
				360,
				metres,
			);
			const [a, b, , d] = patch.corners as readonly [
				readonly [number, number],
				readonly [number, number],
				readonly [number, number],
				readonly [number, number],
			];
			return Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(d[0] - a[0], d[1] - a[1]));
		};
		// At the far card's distance a sixteen-metre patch spans the pixels a figure needs, and
		// the four-metre patch no longer does.
		expect(spanOf(16)).toBeGreaterThanOrEqual(24);
		expect(spanOf(4)).toBeLessThan(24);
		expect(PATCH_SIZES[0]).toBe(16);
		expect(PATCH_SIZES).toContain(1);
	});

	test('refuses a patch whose projected span is under the least a figure needs', () => {
		const spanOf = (corners: readonly (readonly [number, number])[]) => {
			const [a, b, , d] = corners as readonly [
				readonly [number, number],
				readonly [number, number],
				readonly [number, number],
				readonly [number, number],
			];
			return Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(d[0] - a[0], d[1] - a[1]));
		};
		const near = patchCorners({ position: [0, 0, 40], target: [0, 0, 0], fov: 38 }, 960, 720);
		const far = patchCorners({ position: [0, 0, 442], target: [0, 0, 0], fov: 38 }, 960, 720);
		expect(spanOf(near.corners)).toBeGreaterThan(24);
		expect(spanOf(far.corners)).toBeLessThan(24);
	});

	test('joins the rungs with intermediate distances, from inside the crown past the far start', () => {
		const distances = sweepSeriesDistances([3.7, 156.6, 900]);
		expect(distances.length).toBeGreaterThanOrEqual(SWEEP_SERIES_STEPS);
		expect(distances[0]).toBeLessThan(3.7);
		expect(distances[distances.length - 1]).toBeCloseTo(945, 3);
		// The switches themselves are steps, so a crossing cannot hide between two of them.
		expect(distances).toContain(3.7);
		expect(distances).toContain(945);
		for (let index = 1; index < distances.length; index++)
			expect(distances[index]).toBeGreaterThan(distances[index - 1] as number);
	});

	test('reads a frame at every distance, at the page’s own camera', () => {
		const { shots, steps } = sweepSeriesShots({ species: 'species' }, [3.7, 156.6, 900]);
		expect(shots).toHaveLength(steps.length);
		for (const [index, shot] of shots.entries()) {
			expect(shot.query.view).toBe('whole');
			expect(shot.query.distance).toBe(steps[index]?.distance);
			expect(shot.cells[0]?.file).toBe(steps[index]?.file);
		}
	});

	test('passes a series that holds or closes, and fails a step that opens by more than a point', () => {
		const held = sweepSeriesRows([
			seriesStep('a.png', 10, 0.6),
			seriesStep('b.png', 20, 0.6),
			seriesStep('c.png', 40, 0.65),
		]);
		expect(held.every((step) => step.verdict === 'pass')).toBe(true);
		const opened = sweepSeriesRows([seriesStep('a.png', 10, 0.6), seriesStep('b.png', 20, 0.55)]);
		expect(opened[1]?.verdict).toBe('fail');
		expect(opened[1]?.reason).toContain('falls 0.050');
		expect(opened[1]?.reason).toContain('0.600 to 0.550');
		expect(SERIES_OPEN).toBe(0.01);
	});

	test('names why a cut silhouette reads no share, and fails a solid far card', () => {
		const cut = sweepSeriesRows([
			{
				file: 'a.png',
				distance: 3,
				level: 1,
				covered: null,
				field: null,
				charged: true,
				change: null,
				verdict: 'pass',
				reason: 'the plant fills the frame; its own silhouette is cut by it',
			},
		]);
		expect(cut[0]?.verdict).toBe('unmeasured');
		expect(cut[0]?.reason).toContain('plant fills the frame');
		const solid = sweepSeriesRows([
			{
				file: 'b.png',
				distance: 284,
				level: 3,
				covered: 1,
				field: '16 m patch',
				charged: true,
				change: null,
				verdict: 'pass',
				reason: '',
			},
		]);
		expect(solid[0]?.verdict).toBe('fail');
		expect(solid[0]?.reason).toContain('fills its own span');
	});

	test('reports a fall on a smaller patch without charging it, and charges the four-metre one', () => {
		const crop = sweepSeriesRows([
			seriesStep('a.png', 2.1, 0.7, '2 m patch, frame-capped', false),
			seriesStep('b.png', 2.7, 0.683, '2 m patch, frame-capped', false),
		]);
		expect(crop[1]?.verdict).toBe('pass');
		expect(crop[1]?.reason).toContain('crop cannot see a crown fall');
		const crown = sweepSeriesRows([
			seriesStep('a.png', 14, 0.7, '4 m patch'),
			seriesStep('b.png', 16, 0.683, '4 m patch'),
		]);
		expect(crown[1]?.verdict).toBe('fail');
	});

	test('does not compare across a change of patch, and names the change', () => {
		const across = sweepSeriesRows([
			seriesStep('a.png', 5, 0.7, '2 m patch'),
			seriesStep('b.png', 7, 0.6, '4 m patch'),
		]);
		expect(across[1]?.verdict).toBe('pass');
		expect(across[1]?.change).toBeNull();
		expect(across[1]?.reason).toContain('not compared across');
		const within = sweepSeriesRows([
			seriesStep('a.png', 7, 0.7, '4 m patch'),
			seriesStep('b.png', 9, 0.6, '4 m patch'),
		]);
		expect(within[1]?.verdict).toBe('fail');
	});

	test('passes a step that opens exactly one point, and fails one that opens more', () => {
		const edge = sweepSeriesRows([seriesStep('a.png', 10, 0.6), seriesStep('b.png', 20, 0.59)]);
		expect(edge[1]?.verdict).toBe('pass');
		const more = sweepSeriesRows([seriesStep('a.png', 10, 0.6), seriesStep('b.png', 20, 0.589)]);
		expect(more[1]?.verdict).toBe('fail');
	});

	test('marks a step unmeasured where no share reads, never as an opening', () => {
		const rows = sweepSeriesRows([seriesStep('a.png', 10, null)]);
		expect(rows[0]?.verdict).toBe('unmeasured');
		expect(rows[0]?.reason).toContain('unmeasured: no covered share');
		const coverage = sweepCoverage('species', [], rows, 24, 24);
		expect(coverage.green).toBe(false);
		expect(coverage.series.join('; ')).toContain('unmeasured');
	});
});

describe('the sweep’s verdicts', () => {
	test('passes a rung whose orbit drew and stands inside its bars', () => {
		const result = row();
		expect(result.verdict).toBe('pass');
		expect(result.pictures).toBe(SWEEP_PICTURES);
		expect(result.covered).toEqual({ least: 0.8, most: 0.8 });
	});

	test('fails a rung with no reference view as uncompared', () => {
		const result = rowWith(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], orbit(3), undefined);
		expect(result.verdict).toBe('fail');
		expect(result.reason).toContain('uncompared');
		expect(result.reference).toBeNull();
	});

	test('leaves a plant drawn as a speck unmeasured, and names its pixel width', () => {
		const drawn = orbit(3).map((entry) => ({ ...entry, width: 6 }));
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], drawn);
		expect(result.verdict).toBe('open');
		expect(result.reason).toContain('6 px wide');
	});

	test('judges the cut crown only where the rung compares the crown', () => {
		// The inside rung frames the plant by design, so its cut top is no crown fault.
		const inside = SWEEP_RUNGS[3] as (typeof SWEEP_RUNGS)[number];
		const drawn = orbit(0).map((entry) => ({ ...entry, cutTop: true }));
		expect(row(inside, drawn).verdict).toBe('pass');
	});

	test('leaves a row whose crown is cut by the frame’s top unmeasured, and names the frame', () => {
		const drawn = orbit(3);
		drawn[5] = { ...drawn[5]!, cutTop: true };
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], drawn);
		expect(result.verdict).toBe('open');
		expect(result.reason).toContain('cut by the frame');
		expect(result.reason).toContain(drawn[5]!.file);
	});

	test('marks a forced level in the row’s level words', () => {
		const drawn = orbit(3).map((entry) => ({ ...entry, forced: true }));
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], drawn);
		expect(result.levels).toContain('far card (forced)');
	});

	test('fails a rung with a missing picture, and names how many drew', () => {
		const drawn = orbit(3).slice(1);
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], drawn);
		expect(result.verdict).toBe('fail');
		expect(result.reason).toContain(`23 of ${SWEEP_PICTURES} pictures drew`);
	});

	test('fails a rung whose picture did not draw or holds no matte', () => {
		const drawn = orbit(3);
		drawn[0] = picture('sweep/rung-0.png', 3, {
			error: 'E1410',
			measures: null,
			skyGap: null,
			covered: null,
		});
		drawn[1] = picture('sweep/rung-1.png', 3, { matteError: 'no matte', measures: null });
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], drawn);
		expect(result.verdict).toBe('fail');
		expect(result.reason).toContain('did not draw: E1410');
		expect(result.reason).toContain('has no matte');
	});

	test('fails a rung where a piece meets nothing', () => {
		const drawn = orbit(3);
		drawn[4] = picture('sweep/rung-4.png', 3, {
			measures: measures([{ area: 120, box: 'x 10..20, y 30..40' }]),
		});
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], drawn);
		expect(result.verdict).toBe('fail');
		expect(result.floating).toBe(1);
		expect(result.reason).toContain('1 piece meets nothing');
	});

	test('refuses enclosed sky on a collapsed outline and reads the filled-frame share', () => {
		// A far card whose outline is a speckle: every picture refused the enclosed figure.
		const filled = orbit(3).map((entry) => ({ ...entry, skyGap: null, covered: 0.7 }));
		const passed = rowWith(
			SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number],
			filled,
			refOf({ skyGap: 0.2, solidity: 0.72 }),
		);
		expect(passed.verdict).toBe('pass');
		expect(passed.gap?.drawn).toBeCloseTo(0.3, 5);
		expect(passed.gap?.reference).toBeCloseTo(0.28, 5);
		expect(passed.gapField).toBe('filled-frame openness');
		const hollow = orbit(3).map((entry) => ({ ...entry, skyGap: null, covered: 0.5 }));
		const failed = rowWith(
			SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number],
			hollow,
			refOf({ skyGap: 0.2, solidity: 0.72 }),
		);
		expect(failed.verdict).toBe('fail');
		expect(failed.reason).toContain('filled-frame openness 0.500');
		expect(failed.reason).toContain('too open');
		// The direction is named: a card under the reference's openness is too closed.
		const closed = orbit(3).map((entry) => ({ ...entry, skyGap: null, covered: 0.9 }));
		const tooClosed = rowWith(
			SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number],
			closed,
			refOf({ skyGap: 0.2, solidity: 0.72 }),
		);
		expect(tooClosed.verdict).toBe('fail');
		expect(tooClosed.reason).toContain('too closed');
	});

	test('fails a crown nearly half again as open as its photograph, with the figure', () => {
		// The hawthorn's far card reads 0.530 against its reference's 0.362: past the five-point bar.
		const drawn = orbit(3, 0.47);
		const result = rowWith(
			SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number],
			drawn,
			refOf({ skyGap: 0.36 }),
		);
		expect(result.verdict).toBe('fail');
		expect(result.reason).toContain("crown's open sky 0.530");
		expect(result.reason).toContain('past the 0.02/0.05 band');
	});

	test('fails a rung with more separate pieces than its photograph and the one-piece band', () => {
		const drawn = orbit(3).map((entry) => ({
			...entry,
			measures: measures([], 4),
		}));
		const result = rowWith(
			SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number],
			drawn,
			refOf({ pieces: 1 }),
		);
		expect(result.verdict).toBe('fail');
		expect(result.reason).toContain("4 pieces against the reference's 1");
	});

	test('fails a ladder rung that drew another level, and leaves a switch the camera cannot reach open', () => {
		const wrong = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], orbit(1));
		expect(wrong.verdict).toBe('fail');
		expect(wrong.reason).toContain('not the far card');
		const near = row(SWEEP_RUNGS[2] as (typeof SWEEP_RUNGS)[number], orbit(1));
		expect(near.verdict).toBe('open');
		expect(near.reason).toContain("near form's switch");
	});

	test('names a forced level in the near-switch reason', () => {
		const drawn = orbit(1).map((entry) => ({ ...entry, forced: true }));
		const result = row(SWEEP_RUNGS[2] as (typeof SWEEP_RUNGS)[number], drawn);
		expect(result.verdict).toBe('open');
		expect(result.reason).toContain('first card level (forced)');
	});

	test('leaves a near rung the camera cannot reach open even where another figure fails', () => {
		const drawn = orbit(1);
		drawn[0] = picture(drawn[0]!.file, 1, {
			turn: drawn[0]!.turn,
			height: drawn[0]!.height,
			measured: undefined,
			measures: measures([{ area: 40, box: 'a' }]),
		} as never);
		const result = row(SWEEP_RUNGS[2] as (typeof SWEEP_RUNGS)[number], drawn);
		expect(result.verdict).toBe('open');
		expect(result.reason).toContain("near form's switch");
		expect(result.reason).toContain('meets nothing');
	});

	test('fails an orbit frame that jumps beyond its neighbours’ covered share, naming its angle', () => {
		const result = row(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], orbit(3, 0.8, 120));
		expect(result.verdict).toBe('fail');
		expect(result.reason).toContain('the orbit jumps');
		expect(result.reason).toContain('at 120°');
	});

	test('reads a close view for pieces that leave the wood, not for its own turning cover', () => {
		const leaf = SWEEP_RUNGS[5] as (typeof SWEEP_RUNGS)[number];
		const jumping = orbit(0, 0.8, 60);
		expect(row(leaf, jumping).verdict).toBe('pass');
		// A pinnate leaf's leaflets are separate pictures: a leaflet is foliage, not a float.
		const floating = orbit(0);
		floating[0] = picture(floating[0]!.file, 0, {
			turn: floating[0]!.turn,
			height: floating[0]!.height,
			measures: measures([{ area: 30, box: 'a' }]),
		});
		const leafRow = row(leaf, floating);
		expect(leafRow.verdict).toBe('pass');
		expect(leafRow.floating).toBe(1);
		expect(leafRow.reason).toContain('read as leaves and not charged');
		// The same piece inside the crown is still a float, so the exclusion is the leaf's alone.
		const inside = SWEEP_RUNGS[3] as (typeof SWEEP_RUNGS)[number];
		expect(row(inside, floating).verdict).toBe('fail');
	});

	test('reads a cluster jump apart from the covered share', () => {
		const drawn = orbit(3);
		drawn[3] = picture('sweep/rung-t60-hlow.png', 3, {
			turn: 60,
			height: 'low',
			measures: measures([
				{ area: 40, box: 'a' },
				{ area: 40, box: 'b' },
			]),
		});
		const jumps = sweepOrbitJumps(drawn);
		expect(jumps.some((jump) => jump.includes('2 pieces that meet nothing'))).toBe(true);
	});

	test('counts every rung and series step, and fails a round with a gap', () => {
		const green = sweepCoverage(
			'species',
			SWEEP_RUNGS.map((rung) => row(rung)),
			sweepSeriesRows([seriesStep('a.png', 10, 0.6), seriesStep('b.png', 20, 0.6)]),
		);
		expect(green.green).toBe(false);
		expect(green.series[0]).toContain('2 of 24');
		const short = sweepCoverage('species', [row()]);
		expect(short.missingRows).toHaveLength(SWEEP_RUNGS.length - 1);
		const uncompared = sweepCoverage(
			'species',
			[
				rowWith(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], orbit(3), undefined),
				...SWEEP_RUNGS.slice(1).map((rung) => row(rung)),
			],
			[],
		);
		expect(uncompared.uncompared).toEqual(['the far card']);
	});

	test('reports a green round only when every row and every series step passes', () => {
		const rows = SWEEP_RUNGS.map((rung) => row(rung));
		const steps = sweepSeriesRows([seriesStep('a.png', 10, 0.6), seriesStep('b.png', 20, 0.6)]);
		const shortSeries = sweepCoverage('species', rows, steps);
		expect(sweepGreen(rows, [shortSeries])).toBe(false);
	});
});

describe('the sweep’s tables', () => {
	test('writes a row a species and a view, and a row a series step', () => {
		const rows = SWEEP_RUNGS.map((rung) => row(rung));
		const steps = sweepSeriesRows([seriesStep('sweep-series/a.png', 10, 0.6)]).map((step) => ({
			...step,
			species: 'species',
		}));
		const table = sweepMarkdown(rows, [sweepCoverage('species', rows, [])], steps);
		expect(table).toContain(`| ${SWEEP_COLUMNS.join(' | ')} |`);
		expect(table).toContain(`| ${SERIES_COLUMNS.join(' | ')} |`);
		const rungRows = table.split('\n').filter((line) => line.startsWith('| species |'));
		expect(rungRows.length).toBeGreaterThanOrEqual(SWEEP_RUNGS.length);
		const cells = (rungRows[0] as string).split(' | ');
		expect(cells).toHaveLength(SWEEP_COLUMNS.length);
		expect(table).toContain('## The pull-back series');
	});

	test('names a round’s faults in its coverage lines', () => {
		const rows = [rowWith(SWEEP_RUNGS[0] as (typeof SWEEP_RUNGS)[number], orbit(3), undefined)];
		const table = sweepMarkdown(rows, [sweepCoverage('species', rows, [])]);
		expect(table).toContain('missing rows:');
		expect(table).toContain('uncompared');
	});
});
