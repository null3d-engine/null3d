import { describe, expect, test } from 'bun:test';
import { QUALITY_SETTINGS } from '../../../packages/engine/src/quality/presets';
import { HOLD_TIME, MEASURE_SECONDS, WARMUP_SECONDS } from '../../scenes/spec';
import { engineOptionsOf, readChoice, readRunOptions } from './options';

describe('readRunOptions', () => {
	const read = (query: string) => readRunOptions(new URLSearchParams(query));

	test('reads hold, demo, keep, the count, the warm-up and measured seconds, the soak, the shadow cascades, the far cascade interval, the governor, the anti-aliasing mode, the cloud step count and the pixel ratio', () => {
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
			cloudSteps: null,
			maxPixelRatio: null,
			governor: true,
			renderScale: null,
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
			cloudSteps: null,
			maxPixelRatio: null,
			governor: true,
			renderScale: null,
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
		expect(read('?cloudSteps=0').cloudSteps).toBe(0);
		expect(read('?cloudSteps=64').cloudSteps).toBe(64);
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
		expect(read('?renderScale=0.5').renderScale).toBe(0.5);
	});

	test('takes only off for the governor', () => {
		expect(() => read('governor=on')).toThrow('"on" is not a valid governor. Use ?governor=off.');
	});

	// The shared path a page builds its engine options with. Every switch that names a quality
	// setting reaches the engine through it, so a page cannot lose one by listing them itself.
	test('forwards every switch that names a quality setting to the engine', () => {
		const samples: Record<string, string> = {
			antialias: 'fxaa',
			cloudSteps: '0',
			shadowCascades: '2',
			shadowMapSize: '1024',
			shadowCascadeBlend: '0.25',
		};
		// The page caps its own pixel ratio, and the sketch applies the rest to the engine.
		const elsewhere = new Set(['governor', 'maxPixelRatio', 'renderScale', 'shadowFilter']);
		const names = new Set(Object.keys(read('')));
		const parsed = Object.keys(QUALITY_SETTINGS).filter(
			(name) => names.has(name) && !elsewhere.has(name),
		);
		expect(parsed.length).toBeGreaterThan(3);
		for (const name of parsed) {
			const sample = samples[name];
			if (sample === undefined) throw new Error(`the test needs a sample value for ${name}`);
			const forwarded = engineOptionsOf(read(`?${name}=${sample}`)) as unknown as Record<
				string,
				unknown
			>;
			// The parsed value, so a zero or an empty string proves it was not read as "absent".
			expect(forwarded[name]).toBe(name === 'antialias' ? sample : Number(sample));
		}
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
			'renderScale=0.2',
			'renderScale=1.5',
			'renderScale=x',
			'cloudSteps=-1',
			'cloudSteps=65',
			'cloudSteps=1.5',
			'cloudSteps=x',
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
