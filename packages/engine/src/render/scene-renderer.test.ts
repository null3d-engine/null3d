import { describe, expect, it } from 'bun:test';
import {
	OP_CREATE_RENDER_PIPELINE,
	OP_SUBMIT,
	PERMUTATION_DRAW_INDEX,
	PERMUTATION_FXAA,
	PERMUTATION_TONE_MAP,
	TEMPLATE_FINAL,
	TEMPLATE_INSTANCED_LIT,
} from '../generated/gpu';
import type { DeviceShaders } from '../generated/shaders';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { FrameReplay } from './scene-renderer';

/** Words of a `CreateRenderPipeline` command, with its header. */
const PIPELINE_WORDS = 11;

/**
 * A backend that holds the shader builds of the permutations in `has`, and gets more from each
 * device module that it adds.
 */
function fakeBackend(has: number[]) {
	return {
		building: false,
		prepared: 0,
		added: [] as DeviceShaders[],
		prepare(_words: Uint32Array, start: number, end: number) {
			this.prepared++;
			return Math.min(end, start + PIPELINE_WORDS * 2);
		},
		replay() {},
		hasShader: (_template: number, permutation: number) => has.includes(permutation),
		addShaders(shaders: DeviceShaders) {
			this.added.push(shaders);
		},
	};
}

/**
 * A frame replay whose device loaded the module of `first`, over a draw list that creates two
 * pipelines of the given templates and permutations, then submits.
 */
function setup(first: number, has: number[], pipelines: [number, number][]) {
	const memory = new WebAssembly.Memory({ initial: 1 });
	const words = new Uint32Array(memory.buffer);
	let at = 0;
	for (const [k, [template, permutation]] of pipelines.entries()) {
		words[at] = OP_CREATE_RENDER_PIPELINE | (PIPELINE_WORDS << 8);
		words[at + 1] = k + 1;
		words[at + 2] = template;
		words[at + 3] = permutation;
		at += PIPELINE_WORDS;
	}
	words[at] = OP_SUBMIT | (1 << 8);
	const control = createControlBuffer(false);
	const { slots } = controlViews(control);
	for (const parity of [0, 1]) {
		Atomics.store(slots, Slot.DrawListAddress0 + parity, 0);
		Atomics.store(slots, Slot.DrawListWords0 + parity, at + 1);
	}
	const loads: number[] = [];
	let finish: (shaders: DeviceShaders) => void = () => {};
	let fail: (error: Error) => void = () => {};
	const load = (bits: number) => {
		loads.push(bits);
		return new Promise<DeviceShaders>((resolve, reject) => {
			finish = resolve;
			fail = reject;
		});
	};
	const backend = fakeBackend(has);
	const replay = new FrameReplay(backend, memory, control, { first, load });
	return {
		backend,
		replay,
		loads,
		finish: (s: DeviceShaders) => finish(s),
		fail: (e: Error) => fail(e),
	};
}

const MODULE = {} as DeviceShaders;

describe('FrameReplay', () => {
	it('holds a frame while the device module of a new pipeline loads, and loads it once', async () => {
		// A compatibility mode device that started with FXAA, then switched to MSAA on the 8-bit path.
		const { backend, replay, loads, finish } = setup(
			0,
			[0, PERMUTATION_FXAA],
			[
				[TEMPLATE_INSTANCED_LIT, PERMUTATION_TONE_MAP],
				[TEMPLATE_INSTANCED_LIT, PERMUTATION_TONE_MAP],
			],
		);
		expect(replay.prepare(1)).toBe(false);
		expect(replay.building).toBe(true);
		expect(replay.prepare(1)).toBe(false);
		expect(loads).toEqual([PERMUTATION_TONE_MAP]);
		expect(backend.prepared).toBe(0);
		finish(MODULE);
		await Promise.resolve();
		expect(backend.added).toEqual([MODULE]);
		expect(replay.building).toBe(false);
		expect(replay.prepare(1)).toBe(true);
		expect(backend.prepared).toBe(1);
		replay.replay(1);
		// The module stays: a later frame that creates the same kind of pipeline loads nothing.
		expect(replay.prepare(2)).toBe(true);
		expect(loads).toEqual([PERMUTATION_TONE_MAP]);
	});

	it('loads nothing for a pipeline whose build the device has, whatever its bits', () => {
		// The final pass builds without the draw index, and every device module holds it.
		const { replay, loads } = setup(
			PERMUTATION_DRAW_INDEX,
			[PERMUTATION_FXAA],
			[
				[TEMPLATE_FINAL, PERMUTATION_FXAA],
				[TEMPLATE_FINAL, PERMUTATION_FXAA],
			],
		);
		expect(replay.prepare(1)).toBe(true);
		expect(loads).toEqual([]);
	});

	it('reports a device module that failed to load at the next frame', async () => {
		const { replay, fail } = setup(
			0,
			[],
			[
				[TEMPLATE_INSTANCED_LIT, PERMUTATION_TONE_MAP],
				[TEMPLATE_INSTANCED_LIT, PERMUTATION_TONE_MAP],
			],
		);
		expect(replay.prepare(1)).toBe(false);
		fail(new Error('the network failed'));
		await Promise.resolve();
		await Promise.resolve();
		expect(() => replay.prepare(1)).toThrow(
			'null3D could not load shader builds: the network failed',
		);
	});
});
