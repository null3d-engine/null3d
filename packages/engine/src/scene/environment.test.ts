import { beforeEach, describe, expect, it } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import { Environment, SceneEnvironment } from './environment';
import type { CoreMemory } from './memory';
import type { Texture } from './textures';

/**
 * The scene's environment over a core that records each setEnvironment call with the values that
 * it reads from the block of the environment's values, and how many views of the block it made.
 */
function sceneEnvironment() {
	const block = new Float32Array(C.ENVIRONMENT_VALUE_COUNT);
	const calls: number[][] = [];
	let views = 0;
	const core = {
		generation: 0,
		f32: () => {
			views++;
			return block;
		},
		check(status: number) {
			if (status !== 0) throw new Error('E1101');
			return status;
		},
		glue: {
			environmentValues: () => 0,
			setEnvironment(texture: number) {
				calls.push([texture, ...block]);
				return texture === 99 ? 1 : 0;
			},
		},
	} as unknown as CoreMemory;
	return { environment: new SceneEnvironment(core), calls, views: () => views };
}

/** An environment whose cube texture has `handle`, and whose coefficients count up from 0. */
function environmentOf(handle: number): Environment {
	const sh = Float32Array.from({ length: 27 }, (_, k) => k);
	return new Environment({ handle } as Texture, 256, 6, 'rgb9e5ufloat', sh);
}

beforeEach(() => setErrorFixes(ERROR_FIXES));

describe('scene environment', () => {
	it('passes the texture, the intensity, the turn and the diffuse light through the block', () => {
		const { environment, calls, views } = sceneEnvironment();
		environment.set(environmentOf(7), { intensity: 0.5, rotation: [0.1, 0.2, 0.3] });
		environment.set(environmentOf(7), undefined);
		environment.set(null, undefined);
		const [first, second, none] = calls as [number[], number[], number[]];
		expect(first.slice(0, 5)).toEqual([7, 0.5, ...[0.1, 0.2, 0.3].map(Math.fround)]);
		expect(first.slice(1 + C.ENVIRONMENT_VALUE_SH)).toEqual(
			Array.from({ length: 27 }, (_, k) => k),
		);
		// Left-out options take their defaults.
		expect(second.slice(0, 5)).toEqual([7, 1, 0, 0, 0]);
		expect(none[0]).toBe(0);
		// One view of the block serves every call while the memory keeps its buffer.
		expect(views()).toBe(1);
	});

	it('refuses values that are not finite or out of range, and things that are no environment', () => {
		const { environment, calls } = sceneEnvironment();
		const env = environmentOf(7);
		expect(() => environment.set(env, { intensity: Number.NaN })).toThrow('E1203');
		expect(() => environment.set(env, { intensity: -1 })).toThrow('E1108');
		expect(() => environment.set(env, { rotation: [0, Number.POSITIVE_INFINITY, 0] })).toThrow(
			'E1203',
		);
		expect(() => environment.set({} as Environment, undefined)).toThrow('E1213');
		expect(calls).toEqual([]);
		// The core refuses a destroyed environment's texture.
		expect(() => environment.set(environmentOf(99), undefined)).toThrow('E1101');
	});
});
