// The wind feature's preset settings, as the sketch's quality gives them: the preset picks each
// row, and the frame-budget governor's steps lengthen the step interval while they scale the
// pressure iterations and the spring trees. The field keeps moving at the lowest step, because the
// owner ruled that a still valley does not meet the bar.
import { describe, expect, test } from 'bun:test';
import type { Camera, FeatureStats, QualityPreset, SketchContext } from '@null3d/engine';
import { createWind, type Wind } from './wind';

/** A camera that stands at the world's origin. */
const camera = {
	getPosition(out: number[]): void {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
	},
} as unknown as Camera;

/** A scale that the governor gives a budget. */
type OnScale = (scale: number) => void;

/** A sketch context whose quality the test moves, and which keeps the figures the page was told. */
function fakeContext(start: QualityPreset = 'medium', tier = 'webgpu') {
	const handlers = new Set<() => void>();
	/** The governor's steps that the budgets follow now. */
	let level = 0;
	const budgets = new Map<string, { min: number; onScale: OnScale | undefined; scale: number }>();
	const posted: { features?: readonly FeatureStats[] }[] = [];
	const quality = {
		preset: start,
		settings: {},
		onChange(handler: () => void) {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
		setBudget(options: { name: string; ms: number; min?: number; onScale?: OnScale }) {
			const min = options.min ?? 0;
			const budget = {
				min,
				onScale: options.onScale,
				scale: Math.max(min, 1 - level * 0.25),
			};
			budgets.set(options.name, budget);
			options.onScale?.(budget.scale);
			return {
				name: options.name,
				get scale() {
					return budget.scale;
				},
				get ms() {
					return options.ms * budget.scale;
				},
				remove() {
					if (budgets.get(options.name) === budget) budgets.delete(options.name);
				},
			};
		},
	};
	const pass = { enabled: true, live: true, name: 'wind-field', writes: 'wind', place: 1 };
	const ctx = {
		time: { now: 1 },
		engine: { capabilities: { tier, features: [] } },
		quality,
		page: {
			post(_type: string, data?: unknown) {
				posted.push(data as { features?: readonly FeatureStats[] });
			},
		},
		render: {
			addPass: () => pass,
			setPassUniforms() {},
			setPassSteps() {},
			removePass() {},
		},
		textures: {
			fromPass: () => ({ destroy() {} }),
			fromData: () => ({ destroy() {} }),
		},
	} as unknown as SketchContext;
	return {
		ctx,
		/** The wind's newest figures, as the page was told. */
		stats(): FeatureStats | undefined {
			for (let k = posted.length - 1; k >= 0; k--) {
				const found = posted[k]?.features?.find((feature) => feature.name === 'wind');
				if (found) return found;
			}
			return undefined;
		},
		/** Moves the governor's steps, as the frame loop does. */
		step(next: number) {
			level = next;
			for (const budget of budgets.values()) {
				const scale = Math.max(budget.min, 1 - level * 0.25);
				if (scale === budget.scale) continue;
				budget.scale = scale;
				budget.onScale?.(scale);
			}
		},
		/** Switches the preset, as a menu does, and tells the change handlers. */
		presetTo(preset: QualityPreset) {
			quality.preset = preset;
			for (const handler of handlers) handler();
		},
	};
}

/** The resolved settings of a wind, as the page's figures give them. */
function settingsOf(context: ReturnType<typeof fakeContext>): Readonly<Record<string, unknown>> {
	return context.stats()?.settings ?? {};
}

/** Wind on a sketch context, which the caller must destroy. */
function windOn(context: ReturnType<typeof fakeContext>): Wind {
	return createWind(context.ctx, { camera });
}

describe('the presets', () => {
	test('give each setting its row', () => {
		const context = fakeContext('low');
		const wind = windOn(context);
		expect(settingsOf(context)).toMatchObject({
			windStepMs: 0,
			windPressureSteps: 0,
			windSpringTrees: 0,
			windGrid: '0',
		});
		context.presetTo('medium');
		expect(settingsOf(context)).toMatchObject({
			windStepMs: 33,
			windPressureSteps: 16,
			windSpringTrees: 8,
			windGrid: '64',
		});
		context.presetTo('high');
		expect(settingsOf(context)).toMatchObject({
			windStepMs: 33,
			windPressureSteps: 24,
			windSpringTrees: 32,
			windGrid: '128',
		});
		context.presetTo('ultra');
		expect(settingsOf(context)).toMatchObject({
			windStepMs: 16,
			windPressureSteps: 40,
			windSpringTrees: 64,
			windGrid: '256',
		});
		// The page reads the same values through the add-on's own handle.
		const figures = context.stats();
		expect(figures).toBeDefined();
		if (figures) expect(wind.settings).toEqual(figures.settings);
		wind.destroy();
	});

	test('give WebGL2 its slower step', () => {
		const context = fakeContext('medium', 'webgl2');
		const wind = windOn(context);
		expect(settingsOf(context).windStepMs).toBe(66);
		wind.destroy();
	});
});

describe('the frame-budget governor', () => {
	test('moves the step interval, the pressure steps and the spring trees at each step', () => {
		const context = fakeContext('medium');
		const wind = windOn(context);
		expect(settingsOf(context)).toMatchObject({
			windStepMs: 33,
			windPressureSteps: 16,
			windSpringTrees: 8,
		});
		context.step(1);
		expect(settingsOf(context)).toMatchObject({
			windStepMs: 66,
			windPressureSteps: 12,
			windSpringTrees: 6,
		});
		context.step(2);
		expect(settingsOf(context)).toMatchObject({
			windStepMs: 132,
			windPressureSteps: 8,
			windSpringTrees: 4,
		});
		context.step(3);
		expect(settingsOf(context)).toMatchObject({
			windStepMs: 133,
			windPressureSteps: 4,
			windSpringTrees: 2,
		});
		wind.destroy();
	});

	test('holds the field’s budget down to its lowest share', () => {
		for (const preset of ['medium', 'high', 'ultra'] as const) {
			const context = fakeContext(preset);
			const wind = windOn(context);
			const full = context.stats()?.budgetMs;
			expect(full).toBeGreaterThan(0);
			context.step(3);
			const stats = context.stats();
			expect(stats?.allowedMs).toBeCloseTo((full as number) * 0.25, 5);
			wind.destroy();
		}
	});

	test('keeps the field moving at its lowest step', () => {
		for (const preset of ['medium', 'high', 'ultra'] as const) {
			const context = fakeContext(preset);
			const wind = windOn(context);
			context.step(3);
			const settings = settingsOf(context);
			expect(settings.windPressureSteps as number).toBeGreaterThanOrEqual(1);
			expect(settings.windStepMs as number).toBeLessThanOrEqual(133);
			wind.destroy();
		}
	});
});
