import { describe, expect, it } from 'bun:test';
import * as C from '../generated/core';
import type { CoreMemory } from './memory';
import { Post, type PostSettings } from './post';

/** A post object whose core records each setOutput call. */
function post(): { post: Post; calls: [number, number][] } {
	const calls: [number, number][] = [];
	const core = {
		glue: {
			setOutput(toneMapping: number, exposure: number) {
				calls.push([toneMapping, exposure]);
				return 0;
			},
		},
		check: (result: number) => result,
	} as unknown as CoreMemory;
	return { post: new Post(core), calls };
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

	it('refuses an unknown setting or tone mapping, and a negative exposure, with E1213', () => {
		const { post: output, calls } = post();
		for (const bad of [
			{ bloom: { strength: 1 } },
			{ toneMapping: 'filmic' },
			{ toneMapping: 'toString' },
			{ exposure: -1 },
		])
			expect(() => output.set(bad as PostSettings)).toThrow('E1213');
		expect(calls).toEqual([]);
	});

	it('refuses an exposure that is not a finite number with E1203', () => {
		const { post: output } = post();
		for (const exposure of [Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => output.set({ exposure })).toThrow('E1203');
	});
});
