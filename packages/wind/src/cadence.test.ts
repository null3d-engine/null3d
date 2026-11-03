// The wind feature's preset settings, as the sketch's quality gives them: the preset picks each
// row, and the frame-budget governor's steps lengthen the step interval while they scale the
// pressure iterations and the spring trees. The field keeps moving at the lowest step, because the
// owner ruled that a still valley does not meet the bar. The wind's own budget is smaller than the
// room that D-241 leaves beside the vegetation add-on's own budget. D-241's ceilings are whole
// frames that already hold the vegetation and the scene, so the check does not say a frame holds
// both; the governor is what holds the frame when both are spent.
import { describe, expect, test } from 'bun:test';
import type { Camera, FeatureStats, QualityPreset, SketchContext } from '@null3d/engine';
import { CYCLE_STEPS, createWind, type Wind } from './wind';

/** A camera that stands at the world's origin. */
const camera = {
	getPosition(out: number[]): void {
		out[0] = 0;
		out[1] = 0;
		out[2] = 0;
	},
} as unknown as Camera;

/** The field's own budget at each preset, in ms a frame, from the wind cost study. */
const BUDGET_MS = [0.5, 1.2, 4.9, 6.25] as const;
/** The vegetation add-on's own GPU time at each preset, in ms, from D-241. */
const VEGETATION_MS = [5, 12, 49, 62.5] as const;
/**
 * D-241's whole-frame ceiling at each preset, in ms, at its lowest measured figure. The frame it
 * measures already contains the vegetation's time and the scene.
 */
const CEILING_MS = [15.5, 43.9, 62.5, 71.1] as const;
/** The presets from Low to Ultra. */
const PRESETS = ['low', 'medium', 'high', 'ultra'] as const;

/** A scale that the governor gives a budget. */
type OnScale = (scale: number) => void;

/** A pass that the add-on made, as the frame loop reads it. */
interface MadePass {
	name: string;
	writes: string;
	place: number;
	options: { size?: readonly number[]; steps?: number };
}

/** A sketch context whose quality the test moves, and which keeps the figures the page was told. */
function fakeContext(start: QualityPreset = 'medium', tier = 'webgpu') {
	const handlers = new Set<() => void>();
	/** The governor's steps that the budgets follow now. */
	let level = 0;
	const budgets = new Map<string, { min: number; onScale: OnScale | undefined; scale: number }>();
	const posted: { features?: readonly FeatureStats[] }[] = [];
	const passes: MadePass[] = [];
	const removed: MadePass[] = [];
	/** The runs that each frame set for the pass. */
	const steps: number[] = [];
	/** The textures that `fromPass` gave, one for each pass. */
	const textures: { destroy(): void }[] = [];
	let place = 0;
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
		time: { now: 1, held: false, drawn: true },
		engine: { capabilities: { tier, hdr: tier !== 'webgl2' } },
		quality,
		page: {
			post(_type: string, data?: unknown) {
				posted.push(data as { features?: readonly FeatureStats[] });
			},
		},
		render: {
			addPass: (options: MadePass['options']) => {
				const pass = { name: 'wind-field', writes: 'wind', place: ++place, options };
				passes.push(pass);
				return pass;
			},
			setPassUniforms() {},
			setPassSteps(_pass: unknown, count: number) {
				steps.push(count);
			},
			removePass(pass: MadePass) {
				removed.push(pass);
			},
		},
		textures: {
			fromPass: () => {
				const texture = { destroy() {} };
				textures.push(texture);
				return texture;
			},
			fromData: () => ({ destroy() {} }),
		},
	} as unknown as SketchContext;
	return {
		ctx,
		passes,
		removed,
		steps,
		textures,
		/** The features that the page was told of last, which is none after the wind goes. */
		latest(): readonly FeatureStats[] | undefined {
			return posted.at(-1)?.features;
		},
		/** The wind's newest figures, as the page was told. */
		stats(): FeatureStats | undefined {
			return this.latest()?.find((feature) => feature.name === 'wind');
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
function windOn(context: ReturnType<typeof fakeContext>, options = {}): Wind {
	return createWind(context.ctx, { camera, ...options });
}

describe('the presets', () => {
	test('give each setting its row', () => {
		const rows = [
			{ windStepMs: 0, windPressureSteps: 0, windSpringTrees: 0, windGrid: 0 },
			{ windStepMs: 33, windPressureSteps: 16, windSpringTrees: 8, windGrid: 64 },
			{ windStepMs: 33, windPressureSteps: 24, windSpringTrees: 32, windGrid: 128 },
			{ windStepMs: 16, windPressureSteps: 40, windSpringTrees: 64, windGrid: 256 },
		];
		for (const [index, preset] of PRESETS.entries()) {
			const context = fakeContext(preset);
			const wind = windOn(context);
			expect(settingsOf(context)).toEqual(rows[index] as Record<string, unknown>);
			wind.destroy();
		}
	});

	test('move every setting somewhere along the row', () => {
		const context = fakeContext('low');
		const wind = windOn(context);
		/** The values that one setting takes as the preset moves from Low to Ultra. */
		const values: Record<string, unknown[]> = {};
		for (const preset of PRESETS) {
			context.presetTo(preset);
			for (const [name, value] of Object.entries(settingsOf(context))) {
				values[name] ??= [];
				values[name].push(value);
			}
		}
		for (const name of ['windStepMs', 'windPressureSteps', 'windSpringTrees', 'windGrid'])
			expect(new Set(values[name]).size, `${name} moves with the preset`).toBeGreaterThan(1);
		wind.destroy();
	});

	test('give WebGL2 its own step row', () => {
		const context = fakeContext('medium', 'webgl2');
		const wind = windOn(context);
		// A run of the fragment form costs far more than a compute dispatch, so the field steps
		// less often there. The other settings keep their rows.
		expect(settingsOf(context)).toEqual({
			windStepMs: 66,
			windPressureSteps: 16,
			windSpringTrees: 8,
			windGrid: 64,
		});
		wind.destroy();
	});
});

describe('the frame-budget governor', () => {
	test('moves the step interval, the pressure steps and the spring trees at each step', () => {
		/** Each preset's settings at the governor's steps, from none to its lowest share. */
		const steps: Record<string, readonly [number, number, number][]> = {
			medium: [
				[33, 16, 8],
				[66, 12, 6],
				[132, 8, 4],
				[133, 4, 2],
			],
			high: [
				[33, 24, 32],
				[66, 18, 24],
				[132, 12, 16],
				[133, 6, 8],
			],
			ultra: [
				[16, 40, 64],
				[32, 30, 48],
				[64, 20, 32],
				[128, 10, 16],
			],
		};
		for (const preset of ['medium', 'high', 'ultra'] as const) {
			const context = fakeContext(preset);
			const wind = windOn(context);
			for (const [level, row] of (steps[preset] as readonly (readonly number[])[]).entries()) {
				context.step(level);
				const settings = settingsOf(context);
				expect(
					[settings.windStepMs, settings.windPressureSteps, settings.windSpringTrees],
					`${preset} at the governor's step ${level}`,
				).toEqual([...row]);
			}
			wind.destroy();
		}
	});

	test('reaches 30 field steps a second at Ultra on its first step', () => {
		// A display that owes the field two cycles a frame, such as a 30 Hz phone, steps the field
		// once its frame passes the budget. One step then halves the field's rate to 30 steps a
		// second, which is the cost the Ultra row carries on that device.
		const context = fakeContext('ultra');
		const wind = windOn(context);
		context.step(1);
		expect(1000 / (settingsOf(context).windStepMs as number)).toBeGreaterThanOrEqual(30);
		wind.destroy();
	});

	test('keeps the grid that the preset put, because a new size needs a new pass', () => {
		const context = fakeContext('ultra');
		const wind = windOn(context);
		const made = context.passes.length;
		for (const level of [1, 2, 3, 0]) {
			context.step(level);
			expect(settingsOf(context).windGrid).toBe(256);
		}
		// No step of the governor makes the pass again.
		expect(context.passes.length).toBe(made);
		wind.destroy();
	});

	test('holds the field’s budget down to its lowest share', () => {
		for (const [index, preset] of PRESETS.entries()) {
			const context = fakeContext(preset);
			const wind = windOn(context);
			const full = BUDGET_MS[index] as number;
			expect(wind.budget.ms).toBe(full);
			expect(wind.budget.scale).toBe(1);
			expect(wind.budget.allowedMs).toBe(full);
			context.step(3);
			expect(wind.budget.scale).toBe(0.25);
			expect(wind.budget.allowedMs).toBeCloseTo(full * 0.25, 6);
			wind.destroy();
		}
	});

	test('keeps the field moving at its lowest step', () => {
		for (const preset of ['medium', 'high', 'ultra'] as const) {
			const context = fakeContext(preset);
			const wind = windOn(context);
			context.step(3);
			const settings = settingsOf(context);
			// The interval stays finite and short enough to read as wind, and the cycle keeps a
			// pressure solve.
			expect(settings.windStepMs as number).toBeGreaterThan(0);
			expect(settings.windStepMs as number).toBeLessThanOrEqual(133);
			expect(settings.windPressureSteps as number).toBeGreaterThanOrEqual(1);
			wind.destroy();
		}
	});

	test('keeps the wind’s budget inside the room that D-241 leaves beside the vegetation', () => {
		for (const [index, preset] of PRESETS.entries()) {
			const context = fakeContext(preset);
			const wind = windOn(context);
			const budget = context.stats()?.budgetMs as number;
			// D-241's ceiling is a whole frame, and it already holds the vegetation's time and the
			// scene. The wind's budget must be smaller than the room beside the vegetation's own
			// budget. A frame that spends both grows by the field's share, and the governor is what
			// holds such a frame.
			const room = (CEILING_MS[index] as number) - (VEGETATION_MS[index] as number);
			expect(budget).toBeLessThan(room);
			wind.destroy();
		}
	});
});

describe('a preset change', () => {
	test('makes the pass again when the grid changes, from an empty state', () => {
		const context = fakeContext('medium');
		const wind = windOn(context);
		expect(context.passes.map((pass) => pass.options.size)).toEqual([[64, 64]]);
		const texture = wind.field.texture;
		context.presetTo('high');
		wind.update();
		// The old pass goes, and the new one takes the row's size. The readers see a new texture.
		expect(context.removed.length).toBe(1);
		expect(context.passes.at(-1)?.options.size).toEqual([128, 128]);
		expect(wind.field.texture).not.toBe(texture);
		// The new grid takes the new preset's pressure count.
		expect(context.passes.at(-1)?.options.steps).toBe(26);
		wind.destroy();
	});

	test('keeps no pass on the preset that reads the steady field', () => {
		const context = fakeContext('ultra');
		const wind = windOn(context);
		context.presetTo('low');
		wind.update();
		expect(context.removed.length).toBe(1);
		// Low keeps no grid, so the field has no width and every reader works out the steady field.
		expect(context.passes.length).toBe(1);
		expect(wind.field.size).toBe(0);
		expect(settingsOf(context)).toMatchObject({ windGrid: 0, windStepMs: 0 });
		wind.destroy();
	});

	test('gives a page that keeps a grid at a preset with no field the add-on’s own field', () => {
		const context = fakeContext('low');
		const wind = windOn(context, { grid: 8 });
		// Low names no field, but the page asked for a grid, so the add-on's own step and pressure
		// count run the cycle. Air that never steps would never move.
		expect(context.passes.map((pass) => pass.options.size)).toEqual([[8, 8]]);
		expect(context.passes[0]?.options.steps).toBe(CYCLE_STEPS);
		(context.ctx.time as { now: number }).now = 1 + 1 / 60;
		wind.update();
		expect(context.steps.at(-1)).toBe(CYCLE_STEPS);
		wind.destroy();
	});

	test('leaves a page’s own grid alone', () => {
		const context = fakeContext('medium');
		const wind = windOn(context, { grid: 32 });
		expect(context.passes.map((pass) => pass.options.size)).toEqual([[32, 32]]);
		for (const preset of PRESETS) context.presetTo(preset);
		wind.update();
		// The page named the grid, so the preset moves the other settings and no pass is made again.
		expect(context.passes.map((pass) => pass.options.size)).toEqual([[32, 32]]);
		expect(context.removed).toEqual([]);
		wind.destroy();
	});
});

describe('the wind’s figures in the stats overlay', () => {
	test('report the settings, the pass, the budget and the memory under the add-on’s name', () => {
		const context = fakeContext('medium');
		const wind = windOn(context);
		const figure = context.stats();
		expect(figure?.name).toBe('wind');
		expect(figure?.settings).toEqual({
			windStepMs: 33,
			windPressureSteps: 16,
			windSpringTrees: 8,
			windGrid: 64,
		});
		expect(figure?.budgetMs).toBe(1.2);
		expect(figure?.allowedMs).toBe(1.2);
		// The figure counts the pass's frame time, which the engine times over the runs of a frame.
		expect(figure?.scope).toEqual([{ name: 'wind-field', place: 1 }]);
		expect(figure?.gpuMs).toBeNull();
		// The grid holds two states of eight bytes a texel.
		expect(figure?.bytes).toBe(64 * 64 * 2 * 8);
		expect([wind.budget.ms, wind.budget.scale, wind.budget.allowedMs]).toEqual([1.2, 1, 1.2]);
		context.step(1);
		expect(wind.budget.scale).toBe(0.75);
		expect(wind.budget.allowedMs).toBeCloseTo(0.9, 6);
		wind.destroy();
		expect(context.latest()).toEqual([]);
	});
});
