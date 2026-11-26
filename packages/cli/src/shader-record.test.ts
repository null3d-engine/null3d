import { describe, expect, it } from 'bun:test';
import { parseShaderList } from '../../vite-plugin/src/shader-list.ts';
import {
	listText,
	RECORD_GPUS,
	RECORD_PRESETS,
	readExtraWords,
	recordingUrl,
	recordTargets,
	scrollToEnd,
} from './shader-record.js';
import { parseRecordArgs, WRITER } from './shaders.js';

describe('recordTargets', () => {
	it('holds each page at each preset on each GPU path', () => {
		const targets = recordTargets({ held: ['/'] });
		expect(targets.length).toBe(RECORD_GPUS.length * RECORD_PRESETS.length);
		expect(targets.map((target) => target.path)).toContain('/?hold=&gpu=webgl2&preset=low');
		expect(targets.every((target) => !target.live)).toBe(true);
	});

	it("keeps a page's own hold time and query", () => {
		const [first] = recordTargets({ held: ['/game.html?level=2&hold=3'] });
		expect(first?.path).toBe('/game.html?level=2&hold=3&gpu=webgpu&preset=low');
	});

	it('records each live page on each GPU path, scrolled when asked', () => {
		const targets = recordTargets({ live: ['/'], scroll: true });
		expect(targets).toEqual([
			{ path: '/?gpu=webgpu', live: true, scroll: true },
			{ path: '/?gpu=webgl2', live: true, scroll: true },
		]);
	});
});

describe('recordingUrl', () => {
	it('adds the recording switch to the page under the base address', () => {
		expect(recordingUrl('https://localhost:5173', '/?demo=creek')).toBe(
			'https://localhost:5173/?demo=creek&permutations=record',
		);
		expect(recordingUrl('http://localhost:5173/site/', '/game.html')).toBe(
			'http://localhost:5173/site/game.html?permutations=record',
		);
	});
});

describe('readExtraWords', () => {
	it('reads hexadecimal words with or without 0x', () => {
		expect(readExtraWords('0x10, 14,')).toEqual([0x10, 0x14]);
		expect(readExtraWords('')).toEqual([]);
	});

	it('refuses a word that is not hexadecimal', () => {
		expect(() => readExtraWords('0x10,soon')).toThrow(/"soon" is not a permutation word/);
	});
});

describe('listText', () => {
	it("writes the words in order, once each, in the form the plugin's list reads", () => {
		const text = listText([0x14, 0, 0x14, 0x8000_0000], WRITER);
		expect(text).toContain(`# Written by ${WRITER}.`);
		expect(text.split('\n').filter((line) => line.startsWith('0x'))).toEqual([
			'0x00000000',
			'0x00000014',
			'0x80000000',
		]);
		expect(parseShaderList(text, 'list.txt')).toEqual([0, 0x14, 0x8000_0000]);
	});
});

describe('scrollToEnd', () => {
	/** A page of three windows' height that scrolls by the wheel, as Playwright's page does. */
	function page() {
		let top = 0;
		const wheels: number[] = [];
		return {
			wheels,
			viewportSize: () => ({ width: 800, height: 600 }),
			mouse: {
				move: async () => {},
				wheel: async (_x: number, y: number) => {
					wheels.push(y);
					top = Math.min(1200, top + y);
				},
			},
			evaluate: async () => top,
		};
	}

	it('steps down a window at a time until a step moves nothing, waiting after each', async () => {
		const fake = page();
		let waits = 0;
		const steps = await scrollToEnd(fake as never, {
			quiet: async () => {
				waits++;
			},
		});
		expect(steps).toBe(2);
		expect(fake.wheels).toEqual([600, 600, 600]);
		expect(waits).toBe(3);
	});
});

describe('parseRecordArgs', () => {
	it('records / held and live when no page is named, into shader-permutations.txt', () => {
		const options = parseRecordArgs([]);
		expect([options.held, options.live, options.out, options.base]).toEqual([
			['/'],
			['/'],
			'shader-permutations.txt',
			undefined,
		]);
	});

	it('takes repeated pages, the scroll, the click and extra words', () => {
		const options = parseRecordArgs([
			'--base',
			'https://localhost:5173',
			'--page',
			'/',
			'--page',
			'/game.html',
			'--live',
			'/story.html',
			'--scroll',
			'--click',
			'#play',
			'--extra',
			'0x10',
		]);
		expect(options.held).toEqual(['/', '/game.html']);
		expect(options.live).toEqual(['/story.html']);
		expect([options.scroll, options.click, options.extra]).toEqual([true, '#play', [0x10]]);
	});

	it('refuses a full address as a page, a base that is no address, and a scroll without a live page', () => {
		expect(() => parseRecordArgs(['--page', 'https://example.com/'])).toThrow(
			/path from the server's root/,
		);
		expect(() => parseRecordArgs(['--base', 'localhost:5173'])).toThrow(/--base takes an address/);
		expect(() => parseRecordArgs(['--page', '/', '--scroll'])).toThrow(/no --live page/);
	});
});
