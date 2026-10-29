// The reflection cadence, as the sketch's quality gives it: the preset picks the row, the
// frame-budget governor lengthens it while frames take too long, and the feature host reports the
// cadence and the pass's share of a frame to the stats overlay. A page that draws no water has no
// such row, and the figures go when the water goes. The add-on's `water-bounds` debug view draws
// each body's bounds at the surface, and stops when another view replaces it.
import { describe, expect, it } from 'bun:test';
import type { FeatureStats, QualityPreset, SketchContext } from '@null3d/engine';
import { activateAddonDebugView, hasAddonDebugView } from '@null3d/engine/internal';
import { createWater, type Water, type WaterOptions } from './water';

/** A scale that the governor gives a budget. */
type OnScale = (scale: number) => void;

/** A sketch context whose quality the test moves, and which keeps what the page was told. */
function fakeContext(start: QualityPreset = 'medium') {
	const handlers = new Set<() => void>();
	/** The governor's steps of the budgets' scale that the budgets follow now. */
	let level = 0;
	const budgets = new Map<string, { min: number; onScale: OnScale | undefined; scale: number }>();
	const posted: unknown[] = [];
	/** The boxes that the add-on's debug view draws. */
	const boxes: [readonly number[], readonly number[], string][] = [];
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
				posted.push(data);
			},
		},
		scene: { createMesh: () => ({ destroy() {} }) },
		geometry: { fromArrays: (arrays: unknown) => arrays },
		materials: { shader: () => ({ set() {}, destroy() {} }) },
		textures: {
			fromPass: () => ({ bytes: 4096, destroy() {} }),
			fromData: () => ({ bytes: 4, destroy() {} }),
		},
		render: {
			addPass: () => ({ name: 'water', writes: 'water', place: 1 }),
			setPassEnabled() {},
			removePass() {},
		},
		debug: {
			box(min: readonly number[], max: readonly number[], color: string) {
				boxes.push([min, max, color]);
			},
		},
	} as unknown as SketchContext;
	return {
		ctx: ctx as unknown as SketchContext & { quality: typeof quality },
		/** The last figures that the page was told. */
		figures: () => (posted.at(-1) as { features?: readonly FeatureStats[] } | undefined)?.features,
		posted,
		/** The boxes that the add-on's debug view drew: each one's low and high corners, and its color. */
		boxes,
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
		// The overlay adds up the GPU time of the reflection pass that the add-on made, which is the
		// feature's scope. The memory counts the mesh arrays and the foam texture that the add-on
		// made; the reflection target is the render graph's.
		expect(figure?.scope).toEqual([{ name: 'water', place: 1 }]);
		expect(figure?.gpuMs).toBeNull();
		expect(figure?.bytes).toBeGreaterThan(0);
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

describe('the water-bounds debug view', () => {
	it('draws the bounds of each body at the surface, and stops when turned off', () => {
		const context = fakeContext('medium');
		const water = waterOn(context, { level: 1.5 } as Partial<WaterOptions>);
		expect(hasAddonDebugView('water-bounds')).toBe(true);
		activateAddonDebugView('water-bounds');
		water.update();
		expect(context.boxes.length).toBe(water.bodies.length);
		const [min, max, color] = context.boxes[0] as [readonly number[], readonly number[], string];
		expect(color).toBe('#4fc3f7');
		expect([min[1], max[1]]).toEqual([1.5, 1.5]);
		// The river runs from (0, 0) to (10, 0), two meters to each side.
		expect(min[0]).toBeLessThanOrEqual(0);
		expect(max[0]).toBeGreaterThanOrEqual(10);
		expect(min[2]).toBeLessThanOrEqual(0);
		expect(max[2]).toBeGreaterThanOrEqual(0);
		activateAddonDebugView(undefined);
		water.update();
		expect(context.boxes.length).toBe(water.bodies.length);
		water.destroy();
		expect(hasAddonDebugView('water-bounds')).toBe(false);
	});
});
