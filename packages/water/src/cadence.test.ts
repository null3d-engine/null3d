// The reflection cadence, as the sketch's quality gives it: the preset picks the row, the
// frame-budget governor lengthens it while frames take too long, and the feature host reports the
// cadence and the pass's share of a frame to the stats overlay. A page that draws no water has no
// such row, and the figures go when the water goes.
import { describe, expect, it } from 'bun:test';
import type { FeatureStats, QualityPreset, SketchContext } from '@null3d/engine';
import { createWater, type Water, type WaterOptions } from './water';

/** A scale that the governor gives a budget. */
type OnScale = (scale: number) => void;

/** A sketch context whose quality the test moves, and which keeps what the page was told. */
function fakeContext(start: QualityPreset = 'medium') {
	const handlers = new Set<() => void>();
	/** The governor's steps of the budgets' scale that the budgets follow now. */
	let level = 0;
	const budgets = new Map<string, { min: number; onScale: OnScale | undefined; scale: number }>();
	const posted: (readonly FeatureStats[] | undefined)[] = [];
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
	const ctx = {
		quality,
		// The tier picks a setting's WebGL2 column, which the cadence has none of.
		engine: { capabilities: { tier: 'webgpu' } },
		page: {
			post(_type: string, data?: unknown) {
				posted.push(data as readonly FeatureStats[] | undefined);
			},
		},
		scene: { createMesh: () => ({ destroy() {} }) },
		geometry: { fromArrays: (arrays: unknown) => arrays },
		materials: { shader: () => ({ set() {}, destroy() {} }) },
		textures: {
			fromPass: () => ({ destroy() {} }),
			fromData: () => ({ destroy() {} }),
		},
		render: { addPass: () => ({}), setPassEnabled() {}, removePass() {} },
	} as unknown as SketchContext;
	return {
		ctx: ctx as unknown as SketchContext & { quality: typeof quality },
		/** The last figures that the page was told. */
		figures: () => posted.at(-1),
		posted,
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

/** A short river, from (0, 0) to (10, 0). */
const RIVER = {
	kind: 'river',
	middle: [
		[0, 0],
		[10, 0],
	],
	halfWidth: 2,
} as const;

/** Water on a sketch context, which the caller must destroy. */
function waterOn(
	context: ReturnType<typeof fakeContext>,
	options: Partial<WaterOptions> = {},
): Water {
	return createWater(
		context.ctx as unknown as SketchContext,
		{
			shapes: RIVER,
			...options,
		} as WaterOptions,
	);
}

/** The water's own figures, from what the page was told. */
function waterFigure(context: ReturnType<typeof fakeContext>): FeatureStats | undefined {
	return context.figures()?.find((figure) => figure.name === 'water');
}

describe('the reflection cadence', () => {
	it('takes its row from the preset', () => {
		const context = fakeContext('medium');
		const water = waterOn(context);
		expect(water.reflectionEvery).toBe(2);
		context.presetTo('ultra');
		expect(water.reflectionEvery).toBe(1);
		context.presetTo('low');
		expect(water.reflectionEvery).toBe(2);
		water.destroy();
	});

	it('doubles for each step that the governor takes, up to its cap', () => {
		const context = fakeContext('low');
		const water = waterOn(context);
		expect(water.reflectionEvery).toBe(2);
		context.step(1);
		expect(water.reflectionEvery).toBe(4);
		context.step(2);
		expect(water.reflectionEvery).toBe(8);
		context.step(3);
		expect(water.reflectionEvery).toBe(16);
		water.destroy();
	});

	it('takes the caller’s cadence for the presets that it names, and the governor still steps it', () => {
		const context = fakeContext('low');
		const water = waterOn(context, { reflectionEvery: { low: 3 } });
		expect(water.reflectionEvery).toBe(3);
		context.step(1);
		expect(water.reflectionEvery).toBe(6);
		// The governor keeps its steps across a preset change, so the new row starts there.
		context.presetTo('high');
		expect(water.reflectionEvery).toBe(2);
		context.step(0);
		expect(water.reflectionEvery).toBe(1);
		water.destroy();
	});

	it('refuses a cadence outside the frames that the reflection can wait', () => {
		const context = fakeContext('low');
		expect(() => waterOn(context, { reflectionEvery: { low: 0 } })).toThrow(/1 to 16 frames/);
		expect(() => waterOn(context, { reflectionEvery: { low: 20 } })).toThrow(/1 to 16 frames/);
	});
});

describe('the water’s figures in the stats overlay', () => {
	it('reports the cadence and the pass’s share of a frame under the add-on’s own name', () => {
		const context = fakeContext('medium');
		const water = waterOn(context);
		const figure = waterFigure(context);
		expect(figure?.settings).toEqual({ reflectionEvery: 2 });
		expect(figure?.budgetMs).toBe(1.7);
		expect(figure?.allowedMs).toBe(1.7);
		// The pass draws through the engine's own reflection kind, so the engine times no scope of
		// the feature, and the add-on owns no buffer or texture of its own to report.
		expect(figure?.gpuMs).toBeNull();
		expect(figure?.bytes).toBeNull();
		context.step(1);
		expect(waterFigure(context)?.settings).toEqual({ reflectionEvery: 4 });
		expect(waterFigure(context)?.allowedMs).toBe(1.275);
		water.destroy();
	});

	it('gives no row to a page that draws no water, and none after the water goes', () => {
		const context = fakeContext('medium');
		expect(context.posted).toEqual([]);
		const water = waterOn(context);
		expect(waterFigure(context)?.name).toBe('water');
		water.destroy();
		expect(context.figures()).toEqual([]);
	});
});
