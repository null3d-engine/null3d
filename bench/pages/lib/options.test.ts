import { describe, expect, test } from 'bun:test';
import { HOLD_TIME, MEASURE_SECONDS, WARMUP_SECONDS } from '../../scenes/spec';
import { readChoice, readRunOptions } from './options';

describe('readRunOptions', () => {
	const read = (query: string) => readRunOptions(new URLSearchParams(query));

	test('reads hold, demo, keep, the count, the warm-up and measured seconds, the soak, the shadow cascades, the far cascade interval, the governor, the anti-aliasing mode and the pixel ratio', () => {
		expect(read('')).toEqual({
			hold: null,
			demo: false,
			keep: false,
			count: null,
			warmupSeconds: WARMUP_SECONDS,
			measureSeconds: MEASURE_SECONDS,
			soak: null,
			shadows: null,
			far: null,
			shadowCascades: null,
			shadowMapSize: null,
			shadowFilter: null,
			shadowCascadeBlend: null,
			antialias: null,
			maxPixelRatio: null,
			governor: true,
		});
		expect(read('?hold&n=1000&seconds=2.5&shadows=3&far=1')).toEqual({
			hold: HOLD_TIME,
			demo: false,
			keep: false,
			count: 1000,
			warmupSeconds: 2.5,
			measureSeconds: 2.5,
			soak: null,
			shadows: 3,
			far: 1,
			shadowCascades: null,
			shadowMapSize: null,
			shadowFilter: null,
			shadowCascadeBlend: null,
			antialias: null,
			maxPixelRatio: null,
			governor: true,
		});
		expect(read('?keep&n=500')).toMatchObject({ demo: false, keep: true, count: 500 });
		expect(read('?shadowCascades=2&shadowMapSize=1024&shadowFilter=5')).toMatchObject({
			shadowCascades: 2,
			shadowMapSize: 1024,
			shadowFilter: 5,
		});
		expect(read('?shadowCascadeBlend=0').shadowCascadeBlend).toBe(0);
		expect(read('?antialias=fxaa&maxPixelRatio=1.5')).toMatchObject({
			antialias: 'fxaa',
			maxPixelRatio: 1.5,
		});
		expect(read('?seconds=8&measure=40')).toMatchObject({ warmupSeconds: 8, measureSeconds: 40 });
		expect(read('?measure=40')).toMatchObject({
			warmupSeconds: WARMUP_SECONDS,
			measureSeconds: 40,
		});
		expect(read('?soak=30').soak).toBe(30);
		expect(read('?hold=3.25').hold).toBe(3.25);
		expect(read('?hold=0').hold).toBe(0);
		expect(read('?demo').demo).toBe(true);
		expect(read('?governor=off').governor).toBe(false);
	});

	test('takes only off for the governor', () => {
		expect(() => read('governor=on')).toThrow('"on" is not a valid governor. Use ?governor=off.');
	});

	test("takes only the engine's modes for antialias", () => {
		expect(() => read('antialias=taa')).toThrow('"taa" is not a valid antialias.');
	});

	test('refuses counts and times that make no sense, with a fix in the message', () => {
		for (const query of [
			'n=0',
			'n=-5',
			'n=1.5',
			'n=abc',
			'n=',
			'seconds=0',
			'seconds=x',
			'measure=0',
			'measure=',
			'soak=0',
			'soak=2.5',
			'hold=-1',
			'hold=soon',
			'shadows=0',
			'shadows=5',
			'far=0',
			'far=9',
			'far=1.5',
			'shadows=2.5',
			'shadowMapSize=big',
			'shadowCascades=0',
			'maxPixelRatio=0.25',
			'maxPixelRatio=x',
		]) {
			expect(() => read(query)).toThrow(/is not valid: use/);
		}
	});
});

describe('readChoice', () => {
	const renderers = ['webgl', 'webgpu'] as const;

	test('returns the chosen word', () => {
		expect(readChoice(new URLSearchParams('renderer=webgpu'), 'renderer', renderers)).toBe(
			'webgpu',
		);
	});

	test('names the valid choices when the switch is missing or wrong', () => {
		expect(() => readChoice(new URLSearchParams(''), 'renderer', renderers)).toThrow(
			'Add ?renderer=webgl or ?renderer=webgpu to the page address.',
		);
		expect(() => readChoice(new URLSearchParams('renderer=gl'), 'renderer', renderers)).toThrow(
			'"gl" is not a valid renderer. Use ?renderer=webgl or ?renderer=webgpu.',
		);
	});
});
