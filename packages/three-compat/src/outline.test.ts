// Checks that the outline adds three.js's OutlinePass passes and effect with its settings and
// defaults, and that a setting change reaches the pass or the effect that reads it.
import { describe, expect, test } from 'bun:test';
import type { SketchContext } from '@null3d/engine';
import { createOutlinePass, type OutlinePassOptions } from './outline';

/** What the fake context recorded. */
interface Calls {
	/** Each pass that `render.addPass` made, by its options. */
	passes: Record<string, unknown>[];
	/** Each effect that `post.addEffect` made, by its options. */
	effects: Record<string, unknown>[];
	/** Each pass uniform that `render.setPassUniform` set, as its pass's name, its name and value. */
	passValues: [string, string, unknown][];
	/** Each uniform that `post.setEffectUniform` set, as its name and value. */
	effectValues: [string, unknown][];
	/** Each setting that `post.set` changed. */
	settings: Record<string, unknown>[];
}

/** A context that records what the outline asks it to do. */
function fakeContext(): { ctx: SketchContext; calls: Calls } {
	const calls: Calls = { passes: [], effects: [], passValues: [], effectValues: [], settings: [] };
	const ctx = {
		post: {
			set: (settings: Record<string, unknown>) => calls.settings.push(settings),
			addEffect: (options: Record<string, unknown>) => {
				calls.effects.push(options);
				return { effect: true };
			},
			setEffectUniform: (_effect: unknown, name: string, value: unknown) =>
				calls.effectValues.push([name, value]),
		},
		render: {
			addPass: (options: Record<string, unknown>) => {
				calls.passes.push(options);
				return { name: options.writes as string };
			},
			setPassUniform: (pass: { name: string }, name: string, value: unknown) =>
				calls.passValues.push([pass.name, name, value]),
		},
		textures: { fromPass: (pass: { name: string }) => ({ pass: pass.name }) },
	} as unknown as SketchContext;
	return { ctx, calls };
}

/** The options of the one pass that writes a name ending in `suffix`. */
function passOptions(calls: Calls, suffix: string): Record<string, unknown> {
	const found = calls.passes.find((options) => (options.writes as string).endsWith(suffix));
	if (!found) throw new Error(`no pass writes a name ending in ${suffix}`);
	return found;
}

/** The name of the one pass that writes a name ending in `suffix`. */
const passName = (calls: Calls, suffix: string) => passOptions(calls, suffix).writes as string;

describe('createOutlinePass', () => {
	test('turns on the mask with no crisp line, and adds the edge, two blurs and two wider ones', () => {
		const { ctx, calls } = fakeContext();
		createOutlinePass(ctx);
		expect(calls.settings).toEqual([{ outline: { width: 0 } }]);
		const suff = ['-edge', '-edge-x', '-edge-y', '-glow-x', '-glow-y'];
		for (const [at, suffix] of suff.entries()) {
			const writes = calls.passes[at]?.writes as string | undefined;
			expect(writes?.endsWith(suffix) ?? false).toBe(true);
		}
		expect(calls.passes.map((options) => options.scale)).toEqual([0.5, 0.5, 0.5, 0.25, 0.25]);
		expect(passOptions(calls, '-edge').input).toBe('outlineMask');
		// A blur names the scene's color so that the graph places it after the camera's passes,
		// where the mask and the edge are drawn.
		for (const suffix of ['-edge-x', '-edge-y', '-glow-x', '-glow-y'])
			expect(passOptions(calls, suffix).input).toBe('sceneColor');
		expect(passOptions(calls, '-edge-x').textures).toEqual({
			source: { pass: passName(calls, '-edge') },
		});
		expect(passOptions(calls, '-glow-y').textures).toEqual({
			source: { pass: passName(calls, '-glow-x') },
		});
	});

	test("uses three.js's OutlinePass defaults", () => {
		const { ctx, calls } = fakeContext();
		createOutlinePass(ctx);
		expect(passOptions(calls, '-edge').uniforms).toEqual({
			visibleColor: [1, 1, 1],
			hiddenColor: [0.1, 0.04, 0.02],
		});
		expect(passOptions(calls, '-edge-x').uniforms).toEqual({ direction: [1, 0], kernelRadius: 1 });
		expect(passOptions(calls, '-glow-x').uniforms).toEqual({ direction: [1, 0], kernelRadius: 4 });
		const [effect] = calls.effects;
		expect(effect?.uniforms).toEqual({ settings: [3, 0, 0, 0] });
		expect(effect?.textures).toEqual({
			edges: { pass: passName(calls, '-edge-y') },
			halo: { pass: passName(calls, '-glow-y') },
		});
	});

	test('gives each outline its own passes and effect', () => {
		const { ctx, calls } = fakeContext();
		createOutlinePass(ctx);
		createOutlinePass(ctx);
		expect(calls.passes).toHaveLength(10);
		expect(calls.effects).toHaveLength(2);
		const names = calls.passes.map((options) => options.writes as string);
		expect(new Set(names).size).toBe(names.length);
	});

	test('sets each option on the pass or effect that reads it', () => {
		const { ctx, calls } = fakeContext();
		const options: OutlinePassOptions = {
			color: '#ffaa00',
			hiddenColor: '#3070ff',
			strength: 5,
			thickness: 2,
			glow: 1,
			pulsePeriod: 0.5,
		};
		createOutlinePass(ctx, options);
		expect(passOptions(calls, '-edge').uniforms).toEqual({
			visibleColor: '#ffaa00',
			hiddenColor: '#3070ff',
		});
		expect(passOptions(calls, '-edge-x').uniforms).toEqual({ direction: [1, 0], kernelRadius: 2 });
		expect(calls.effects[0]?.uniforms).toEqual({ settings: [5, 1, 0.5, 0] });
	});

	test('changes the passes and the effect from the next frame on', () => {
		const { ctx, calls } = fakeContext();
		const outline = createOutlinePass(ctx);
		outline.set({ color: '#00ff00', thickness: 3, strength: 4, glow: 2, pulsePeriod: 1 });
		expect(calls.passValues).toEqual([
			[passName(calls, '-edge'), 'visibleColor', '#00ff00'],
			[passName(calls, '-edge-x'), 'kernelRadius', 3],
			[passName(calls, '-edge-y'), 'kernelRadius', 3],
		]);
		expect(calls.effectValues).toEqual([['settings', [4, 2, 1, 0]]]);
	});

	test('keeps a setting that a call leaves out', () => {
		const { ctx, calls } = fakeContext();
		const outline = createOutlinePass(ctx, { strength: 5, glow: 1 });
		outline.set({ pulsePeriod: 2 });
		expect(calls.effectValues).toEqual([['settings', [5, 1, 2, 0]]]);
	});

	test('refuses a number outside its range, and names the setting', () => {
		const { ctx } = fakeContext();
		expect(() => createOutlinePass(ctx, { strength: -1 })).toThrow('strength');
		expect(() => createOutlinePass(ctx, { thickness: 0 })).toThrow('thickness');
		expect(() => createOutlinePass(ctx, { glow: Number.NaN })).toThrow('glow');
		expect(() => createOutlinePass(ctx, { pulsePeriod: -1 })).toThrow('pulsePeriod');
	});

	test('refuses a wrong value from set, before it changes anything', () => {
		const { ctx, calls } = fakeContext();
		const outline = createOutlinePass(ctx);
		expect(() => outline.set({ strength: -1 })).toThrow('OutlinePass.set()');
		expect(calls.effectValues).toEqual([]);
	});
});
