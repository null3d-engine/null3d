import { describe, expect, it } from 'bun:test';
import * as C from '../generated/core';
import type { CoreMemory } from './memory';
import { Post, type PostSettings } from './post';

/** A post object whose core records each setOutput and setBloom call. */
function post(hdrEffects = true): {
	post: Post;
	calls: [number, number][];
	blooms: [boolean, number, number, number][];
} {
	const calls: [number, number][] = [];
	const blooms: [boolean, number, number, number][] = [];
	const core = {
		glue: {
			setOutput(toneMapping: number, exposure: number) {
				calls.push([toneMapping, exposure]);
				return 0;
			},
			setBloom(on: boolean, strength: number, radius: number, threshold: number) {
				blooms.push([on, strength, radius, threshold]);
				return 0;
			},
		},
		check: (result: number) => result,
	} as unknown as CoreMemory;
	return { post: new Post(core, hdrEffects), calls, blooms };
}

describe('post.set', () => {
	it('sends the tone mapping by code and the exposure, and keeps a setting it is not given', () => {
		const { post: output, calls } = post();
		output.set({ toneMapping: 'agx' });
		output.set({ exposure: 2 });
		output.set({ toneMapping: 'none', exposure: 0.5 });
		output.set({});
		expect(calls).toEqual([
			[C.TONE_MAPPING_AGX, 1],
			[C.TONE_MAPPING_AGX, 2],
			[C.TONE_MAPPING_NONE, 0.5],
			[C.TONE_MAPPING_NONE, 0.5],
		]);
	});

	it('starts from ACES at an exposure of 1', () => {
		const { post: output, calls } = post();
		output.set({});
		expect(calls).toEqual([[C.TONE_MAPPING_ACES, 1]]);
	});

	it('turns bloom on with its defaults and the values given, keeps them while off, and sends them only with bloom', () => {
		const { post: output, blooms } = post();
		expect(output.bloomOn).toBe(false);
		output.set({ exposure: 1.5 });
		expect(blooms).toEqual([]);
		output.set({ bloom: {} });
		output.set({ bloom: { strength: 1.5, radius: 0.4 } });
		output.set({ bloom: false });
		expect(output.bloomOn).toBe(false);
		output.set({ bloom: { threshold: 0.85 } });
		expect(output.bloomOn).toBe(true);
		expect(blooms).toEqual([
			[true, 1, 0.5, 1],
			[true, 1.5, 0.4, 1],
			[false, 1.5, 0.4, 1],
			[true, 1.5, 0.4, 0.85],
		]);
	});

	it('warns once where the device has no HDR target, and still tells the core', () => {
		const { post: output, blooms } = post(false);
		const warnings: unknown[] = [];
		const warn = console.warn;
		console.warn = (message: unknown) => warnings.push(message);
		try {
			output.set({ bloom: {} });
			output.set({ bloom: { strength: 2 } });
		} finally {
			console.warn = warn;
		}
		expect(warnings).toHaveLength(1);
		expect(String(warnings[0])).toContain('no HDR target');
		expect(blooms).toHaveLength(2);
	});

	it('refuses an unknown setting or tone mapping, and a value out of range, with E1213', () => {
		const { post: output, calls, blooms } = post();
		for (const bad of [
			{ glow: { strength: 1 } },
			{ toneMapping: 'filmic' },
			{ toneMapping: 'toString' },
			{ exposure: -1 },
			{ bloom: true },
			{ bloom: { intensity: 1 } },
			{ bloom: { strength: -1 } },
			{ bloom: { radius: 1.5 } },
			{ bloom: { threshold: -0.1 } },
		])
			expect(() => output.set(bad as PostSettings)).toThrow('E1213');
		expect(calls).toEqual([]);
		expect(blooms).toEqual([]);
	});

	it('refuses a value that is not a finite number with E1203', () => {
		const { post: output } = post();
		for (const exposure of [Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => output.set({ exposure })).toThrow('E1203');
		expect(() => output.set({ bloom: { strength: Number.NaN } })).toThrow('E1203');
	});
});
