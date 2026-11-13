import { describe, expect, test } from 'bun:test';
import type { StillResult, TurnResult, WindResult } from './compare.ts';
import { coverageMarkdown, coverageOf } from './coverage.ts';
import type { ReferenceSet } from './references.ts';

/** A reference folder of a still, a texture source, a turning video, a wind video and a superseded still. */
const set: ReferenceSet = {
	folder: '/refs/oak',
	slug: 'oak',
	files: [
		{ file: '01-whole-distant.png', kind: 'still', inUse: true, listed: true },
		{
			file: '02-whole-profile.png',
			kind: 'still',
			inUse: false,
			listed: true,
			supersededBy: '02-whole-profile-b.png',
		},
		{ file: '26-bark-texture.png', kind: 'texture', inUse: true, listed: true },
		{ file: 'oak-turntable.mp4', kind: 'turntable', inUse: true, listed: true },
		{ file: 'oak-wind-motion-b.mp4', kind: 'wind', inUse: true, listed: true },
	],
	stills: [],
	turns: [],
	winds: [],
	unknown: [],
};

const still = (file: string): StillResult => ({
	reference: file,
	render: 'r',
	shapeIou: 0.8,
	frameIou: 0.7,
	edgeDifference: 0.2,
	pieces: null,
	connectivity: null,
	profileError: 0.05,
	gap: null,
	crownBoxGap: null,
	frameGap: null,
	foliageDeltaE: 3,
	barkDeltaE: null,
	barkColour: null,
	crownBox: null,
	foliage: { reference: null, render: null },
	file,
	kind: 'still',
	view: 'whole',
	renderFile: `stills/${file}`,
	masked: true,
	surfaceDeltaE: null,
});

const turn = (covered: number): TurnResult => ({
	video: 'oak-turntable.mp4',
	arc: 360,
	frames: 193,
	renders: 193,
	frameStep: 360 / 193,
	renderStep: 360 / 193,
	alignment: { start: 0, direction: 1, coarseIou: 0.7 },
	meanShapeIou: 0.6,
	covered,
	pairs: [],
	spread: {
		angles: [],
		reference: { width: 0, height: 0 },
		render: { width: 0, height: 0 },
		metres: [],
	},
	maskCheck: null,
	maskCheckFrames: 0,
	maskCheckUnreadable: 0,
	maskCheckThreshold: null,
	maskCheckFailed: false,
	maskCheckSmall: false,
	maskCheckSubject: null,
	sheets: [],
});

const wind = (span: number, interval: number): WindResult => ({
	video: 'oak-wind-motion-b.mp4',
	duration: 8,
	span,
	interval,
	frames: Math.round(span / interval) + 1,
	motion: { reference: [0, 0.1], render: [0, 0.05] },
	sheets: [],
});

describe('the coverage list', () => {
	test('is complete only when every file in use has a full comparison', () => {
		const coverage = coverageOf(
			set,
			{
				stills: new Map([
					['01-whole-distant.png', still('01-whole-distant.png')],
					[
						'26-bark-texture.png',
						{ ...still('26-bark-texture.png'), kind: 'texture', masked: false, surfaceDeltaE: 4 },
					],
				]),
				turns: new Map([['oak-turntable.mp4', turn(193)]]),
				winds: new Map([['oak-wind-motion-b.mp4', wind(7.875, 0.125)]]),
			},
			0.125,
		);
		expect(coverage.inUse).toBe(4);
		expect(coverage.complete).toBe(true);
		expect(coverage.superseded).toEqual([
			{ file: '02-whole-profile.png', by: '02-whole-profile-b.png' },
		]);
		expect(coverageMarkdown('stub', 'oak', coverage)).toContain(
			'Every one of the 4 reference files',
		);
	});

	test('blocks a pass for a missing render, an unmatched frame or a short wind clip', () => {
		const coverage = coverageOf(
			set,
			{
				stills: new Map([['01-whole-distant.png', still('01-whole-distant.png')]]),
				turns: new Map([['oak-turntable.mp4', turn(17)]]),
				winds: new Map([['oak-wind-motion-b.mp4', wind(4, 0.5)]]),
			},
			0.125,
		);
		const status = Object.fromEntries(coverage.lines.map((line) => [line.file, line.status]));
		expect(status).toEqual({
			'01-whole-distant.png': 'compared',
			'26-bark-texture.png': 'missing',
			'oak-turntable.mp4': 'partial',
			'oak-wind-motion-b.mp4': 'partial',
		});
		expect(coverage.complete).toBe(false);
		expect(coverageMarkdown('stub', 'oak', coverage)).toContain('cannot pass');
	});

	test('counts a void picture as drawn and not compared, with the reason beside it', () => {
		const coverage = coverageOf(
			set,
			{
				stills: new Map([
					[
						'01-whole-distant.png',
						{
							...still('01-whole-distant.png'),
							masked: false,
							void: 'the view has no subject: no limb divides into two arms of like size',
						},
					],
					[
						'26-bark-texture.png',
						{ ...still('26-bark-texture.png'), kind: 'texture', masked: false, surfaceDeltaE: 4 },
					],
				]),
				turns: new Map([['oak-turntable.mp4', turn(193)]]),
				winds: new Map([['oak-wind-motion-b.mp4', wind(7.875, 0.125)]]),
			},
			0.125,
		);
		const line = coverage.lines.find((entry) => entry.file === '01-whole-distant.png');
		expect(line?.status).toBe('void');
		expect(line?.render).toBe('stills/01-whole-distant.png (view whole)');
		expect(line?.result).toBe(
			'void: the view has no subject: no limb divides into two arms of like size',
		);
		expect(coverage.compared).toBe(3);
		expect(coverage.complete).toBe(false);
	});

	test('lists a picture with no figure as drawn where the standard states none, and as a fault elsewhere', () => {
		const bare = (file: string, over: Partial<StillResult>): [string, StillResult] => [
			file,
			{ ...still(file), masked: false, foliageDeltaE: null, shapeIou: null, ...over },
		];
		const of = (over: Partial<StillResult>) =>
			coverageOf(
				set,
				{
					stills: new Map([
						bare('01-whole-distant.png', over),
						[
							'26-bark-texture.png',
							{ ...still('26-bark-texture.png'), kind: 'texture', masked: false, surfaceDeltaE: 4 },
						],
					]),
					turns: new Map([['oak-turntable.mp4', turn(193)]]),
					winds: new Map([['oak-wind-motion-b.mp4', wind(7.875, 0.125)]]),
				},
				0.125,
			);
		// A limb's join against leaves has no figure to give: the eye judges it, and the run is whole.
		const eye = of({ view: 'junction', subjectChecked: true });
		expect(eye.lines[0]?.status).toBe('drawn');
		expect(eye.drawn).toEqual(['01-whole-distant.png']);
		expect(eye.compared).toBe(3);
		expect(eye.complete).toBe(true);
		expect(coverageMarkdown('stub', 'oak', eye)).toContain(
			'and 1 more was drawn for the eye with no figure',
		);
		// The same picture with no check of its subject cannot be said to show the join.
		const unchecked = of({ view: 'junction' });
		expect(unchecked.lines[0]?.status).toBe('unmeasured');
		expect(unchecked.lines[0]?.result).toContain('no check confirmed its subject');
		expect(unchecked.complete).toBe(false);
		// A whole view has figures, so one that gave none is the tool's fault.
		const whole = of({ view: 'whole', subjectChecked: true });
		expect(whole.lines[0]?.status).toBe('unmeasured');
		expect(whole.lines[0]?.result).toContain('a whole view has a figure and the tool read none');
		expect(whole.complete).toBe(false);
	});

	test('does not hold a pass back for a stand picture, which is not judged', () => {
		const coverage = coverageOf(
			set,
			{
				stills: new Map([
					[
						'01-whole-distant.png',
						{
							...still('01-whole-distant.png'),
							masked: false,
							standing: { kind: 'stand', reason: 'the photograph shows a stand' },
						},
					],
					[
						'26-bark-texture.png',
						{ ...still('26-bark-texture.png'), kind: 'texture', masked: false, surfaceDeltaE: 4 },
					],
				]),
				turns: new Map([['oak-turntable.mp4', turn(193)]]),
				winds: new Map([['oak-wind-motion-b.mp4', wind(7.875, 0.125)]]),
			},
			0.125,
		);
		const line = coverage.lines.find((entry) => entry.file === '01-whole-distant.png');
		expect(line?.status).toBe('not judged');
		expect(line?.result).toBe('the photograph shows a stand');
		expect(coverage.complete).toBe(true);
	});
});
