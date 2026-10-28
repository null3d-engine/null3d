// The splats add-on's feature: its drawn count and its budget on each preset, the governor's share
// of them, and the figures that the stats overlay shows. Its draw records inside the transparent
// pass, so it names no GPU scope.
import { describe, expect, it } from 'bun:test';
import {
	declareAddonNamespace,
	FeatureHost,
	type FeatureStats,
	type QualityPreset,
} from '@null3d/engine';
import { PRESET_SPLATS, splatsFeature, WEBGL2_SPLATS } from './feature';

/** The test's own namespace, which no other add-on of the thread claims. */
const NAMESPACE = declareAddonNamespace({ name: 'splats_test', package: '@null3d/test-splats' });

/** A scale that the governor gives a budget. */
type OnScale = (scale: number) => void;

/** A sketch quality whose preset the test moves, and which keeps what the page was told. */
function fakeQuality(start: QualityPreset = 'medium') {
	const handlers = new Set<() => void>();
	let level = 0;
	const budgets = new Map<string, { min: number; onScale: OnScale | undefined; scale: number }>();
	const posted: unknown[] = [];
	const quality = {
		preset: start,
		settings: {},
		onChange(handler: () => void) {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
		setBudget(options: { name: string; ms: number; min?: number; onScale?: OnScale }) {
			const min = options.min ?? 0;
			const budget = { min, onScale: options.onScale, scale: Math.max(min, 1 - level * 0.25) };
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
	return {
		quality,
		page: {
			post(_type: string, data?: unknown) {
				posted.push(data);
			},
		},
		posted,
		/** The last figures that the page was told. */
		figures: () =>
			(posted.at(-1) as { features?: readonly FeatureStats[] } | undefined)?.features?.find(
				(figure) => figure.name === 'splats',
			),
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

/** A host over a fake quality, which the caller must destroy. */
function hostOn(context: ReturnType<typeof fakeQuality>, tier: 'webgpu' | 'webgl2') {
	return new FeatureHost({
		quality: context.quality,
		tier,
		page: context.page,
		namespace: NAMESPACE,
	} as unknown as ConstructorParameters<typeof FeatureHost>[0]);
}

describe('the splats feature', () => {
	it('takes its drawn count and budget from the preset', () => {
		const context = fakeQuality('medium');
		const host = hostOn(context, 'webgpu');
		const feature = host.add(splatsFeature(() => 4096));
		expect(feature.settings.drawn).toBe(PRESET_SPLATS[1] as number);
		expect(feature.budgetMs).toBe(3);
		expect(context.figures()).toMatchObject({ budgetMs: 3, allowedMs: 3, bytes: 4096 });
		context.presetTo('ultra');
		expect(feature.settings.drawn).toBe(PRESET_SPLATS[3] as number);
		expect(feature.budgetMs).toBe(6);
		context.presetTo('low');
		expect(feature.settings.drawn).toBe(PRESET_SPLATS[0] as number);
		host.destroy();
	});

	it('takes the WebGL2 column on that path', () => {
		const context = fakeQuality('high');
		const host = hostOn(context, 'webgl2');
		const feature = host.add(splatsFeature(() => 0));
		expect(feature.settings.drawn).toBe(WEBGL2_SPLATS[2] as number);
		host.destroy();
	});

	it('takes the budget’s share of the count at each governor step, down to its floor', () => {
		const context = fakeQuality('high');
		const host = hostOn(context, 'webgpu');
		const feature = host.add(splatsFeature(() => 0));
		const base = PRESET_SPLATS[2] as number;
		context.step(1);
		expect(feature.settings.drawn).toBe(Math.round(base * 0.75));
		expect(feature.budgetMs).toBe(4 * 0.75);
		context.step(4);
		expect(feature.settings.drawn).toBe(Math.round(base * 0.2));
		host.destroy();
	});

	it('names no GPU scope, because its draw records inside the transparent pass', () => {
		const context = fakeQuality('high');
		const host = hostOn(context, 'webgpu');
		host.add(splatsFeature(() => 0));
		expect(context.figures()).toMatchObject({ name: 'splats', gpuMs: null, scope: [] });
		host.destroy();
	});
});
