import { describe, expect, it } from 'bun:test';
import { UsageError } from './args.js';
import type { HeldPage } from './runner.js';
import {
	byteSize,
	parseShotArgs,
	type ShotOptions,
	type ShotReport,
	shotReport,
	shotSummary,
	shownPath,
} from './shot.js';

const DEFAULTS: ShotOptions = {
	out: 'shot.png',
	size: [1280, 720],
	page: '/',
	timeoutMs: 60_000,
	help: false,
};

/** What parsing `args` throws, as the message a person sees. */
function mistake(args: string[]): string {
	try {
		parseShotArgs(args);
	} catch (error) {
		expect(error).toBeInstanceOf(UsageError);
		return (error as Error).message;
	}
	throw new Error(`${args.join(' ')} parsed without a mistake`);
}

describe('parseShotArgs', () => {
	it('draws a 1280 x 720 window of the main page into shot.png by default', () => {
		expect(parseShotArgs([])).toEqual(DEFAULTS);
	});

	it('reads every option', () => {
		const args = ['--out', 'out/boat.PNG', '--time', '1.5', '--size', '320x180', '--gpu', 'compat'];
		args.push('--page', '/harbor.html?view=dock', '--timeout', '5');
		expect(parseShotArgs(args)).toEqual({
			...DEFAULTS,
			out: 'out/boat.PNG',
			time: 1.5,
			size: [320, 180],
			gpu: 'compat',
			page: '/harbor.html?view=dock',
			timeoutMs: 5000,
		});
		expect(parseShotArgs(['--time', '0']).time).toBe(0);
		expect(parseShotArgs(['-h']).help).toBe(true);
	});

	it('says what is wrong with each bad option', () => {
		expect(mistake(['--out', 'shot.jpg'])).toBe('--out must name a .png file, not "shot.jpg"');
		expect(mistake(['--gpu', 'vulkan'])).toBe('--gpu takes webgpu, compat, webgl2, not "vulkan"');
		expect(mistake(['--time=-1'])).toContain('--time takes a number of seconds from 0');
		expect(mistake(['--time', ''])).toContain('--time takes a number of seconds from 0');
		expect(mistake(['--time', '1s'])).toContain('--time takes a number of seconds from 0');
		expect(mistake(['--timeout', '0'])).toContain('--timeout takes a number of seconds above 0');
		expect(mistake(['--page', 'https://example.com/'])).toContain(
			"--page takes a path on the project's server",
		);
		for (const size of ['1280', '12x', '0x10', '1.5x10', '8193x10', '10x10x10'])
			expect(mistake(['--size', size])).toBe(
				`--size takes a width and a height in pixels from 1 to 8192, such as 1280x720, not "${size}"`,
			);
	});

	it('names an option it lacks, an option without its value, and an argument it does not take', () => {
		expect(mistake(['--bogus'])).toBe('--bogus is not one of its options');
		expect(mistake(['--out'])).toBe('--out needs a value');
		expect(mistake(['--time', '-1'])).toBe(
			'--time got a value that starts with a dash: write it as --time=<value>',
		);
		expect(mistake(['extra'])).toBe('it takes options only, not "extra"');
	});
});

const FACTS = { environment: 'chrome-real-gpu', browser: 'Chrome 154', image: 'shot.png' } as const;
const FILES = { page: '/', size: [4, 2] as const, png: 'shot.png', json: 'shot.json' };

/** The figures of a held frame, as the engine summarizes one frame. */
const STATS = {
	frames: 1,
	drawCalls: { count: 1, median: 3 },
	uploadBytes: { count: 1, median: 46_285 },
	pipelines: 4,
};

/** A page that drew a 4 x 2 frame of one color. */
function drawn(extra: Partial<HeldPage> = {}): HeldPage {
	const pixels = Buffer.from(new Uint8Array(4 * 2 * 4).fill(7)).toString('base64');
	return {
		path: '/?hold=1.5',
		result: {
			ok: true,
			...{ time: 1.5, frame: 91, tier: 'webgl2', width: 4, height: 2, pixels, stats: STATS },
		},
		errors: [],
		warnings: [],
		ms: 120,
		...extra,
	};
}

describe('shotReport', () => {
	it("keeps the frame's facts and gives its pixels for the image", () => {
		const { report, image } = shotReport(drawn(), FACTS);
		expect(report).toEqual({
			ok: true,
			page: '/?hold=1.5',
			...FACTS,
			time: 1.5,
			frame: 91,
			tier: 'webgl2',
			width: 4,
			height: 2,
			stats: STATS,
			ms: 120,
			errors: [],
			warnings: [],
		});
		expect(image).toEqual({ width: 4, height: 2, data: new Uint8Array(32).fill(7) });
	});

	it('keeps the error of a failed hold, and gives no image', () => {
		const failed = drawn({ result: { ok: false, code: 'E1408', error: 'E1408: it threw' } });
		const { report, image } = shotReport(failed, FACTS);
		expect(image).toBeUndefined();
		const { image: _image, ...facts } = FACTS;
		expect(report).toEqual({
			ok: false,
			page: '/?hold=1.5',
			...facts,
			code: 'E1408',
			error: 'E1408: it threw',
			ms: 120,
			errors: [],
			warnings: [],
		});
	});
});

describe('shotSummary', () => {
	const report = (extra: Partial<HeldPage> = {}) => shotReport(drawn(extra), FACTS).report;

	it('says what it drew and where it saved it', () => {
		expect(shotSummary(report(), FILES)).toBe(
			[
				'Drew / at 1.5 s, frame 91, on webgl2: 4 x 2 pixels.',
				'It made 3 draw calls, uploaded 45.2 KB and built 4 pipelines.',
				"Saved shot.png, and the frame's facts and what the page logged in shot.json.",
				'The page logged no errors or warnings.',
			].join('\n'),
		);
	});

	it('says when the page sets a canvas size other than the window', () => {
		expect(shotSummary(report(), { ...FILES, size: [8, 2] })).toContain(
			"The canvas is 4 x 2 pixels in a 8 x 2 window, as the page's own CSS sets it.",
		);
	});

	it('lists what the page logged, each entry cut to its first lines', () => {
		const errors = ['page error: one', 'console error: Error: two\n  at a\n  at b\n  at c'];
		expect(shotSummary(report({ errors, warnings: ['console warning: slow'] }), FILES)).toEndWith(
			[
				'2 errors:',
				'  page error: one',
				'  console error: Error: two',
				'    at a',
				'    at b',
				'      ...',
				'1 warning:',
				'  console warning: slow',
			].join('\n'),
		);
	});

	it('says why it drew nothing', () => {
		const failed: ShotReport = {
			ok: false,
			page: '/broken.html?hold=',
			code: null,
			error: 'the page failed before it started the engine in hold mode',
			errors: ['page error: boom (at /broken.html:2:10)'],
			warnings: [],
		};
		expect(shotSummary(failed, { ...FILES, page: '/broken.html' })).toBe(
			[
				'Drew no frame of /broken.html: the page failed before it started the engine in hold mode',
				'Saved what went wrong and what the page logged in shot.json.',
				'1 error:',
				'  page error: boom (at /broken.html:2:10)',
			].join('\n'),
		);
	});
});

describe('byteSize', () => {
	it('gives bytes in the unit that suits them', () => {
		expect([byteSize(512), byteSize(46_285), byteSize(3_250_000)]).toEqual([
			'512 bytes',
			'45.2 KB',
			'3.1 MB',
		]);
	});
});

describe('shownPath', () => {
	it('names a file inside the current folder from there, and any other file in full', () => {
		expect(shownPath('/work/game/out/shot.png', '/work/game')).toBe('out/shot.png');
		expect(shownPath('/tmp/shot.png', '/work/game')).toBe('/tmp/shot.png');
		expect(shownPath('/work/game', '/work/game')).toBe('/work/game');
	});
});
