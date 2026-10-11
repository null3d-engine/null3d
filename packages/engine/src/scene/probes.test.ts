import { beforeEach, describe, expect, it } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import * as C from '../generated/core';
import type { CoreMemory } from './memory';
import { type ProbeHost, ReflectionProbes } from './probes';

/**
 * The scene's probes over a core that records each call, whose probe calls fail while `full` says
 * the views are taken.
 */
function probesOf(floatTargets = true) {
	const calls: unknown[][] = [];
	const sent: number[] = [];
	const state = { full: false };
	const core = {
		check(result: number, _call: string, _what?: string, isStatus = false) {
			if (isStatus ? result !== 0 : result === 0) throw new Error('core failure');
			return result;
		},
		glue: {
			setReflectionProbe: (...args: unknown[]) => {
				calls.push(['set', ...args]);
				return state.full ? 1 : 0;
			},
			removeReflectionProbe: (slot: number) => calls.push(['remove', slot]),
			captureReflectionProbe: (slot: number) => {
				calls.push(['capture', slot]);
				return 0;
			},
			probeGenerator: () => 7,
		},
	} as unknown as CoreMemory;
	const host: ProbeHost = {
		sendGenerator: (id) => sent.push(id),
		floatTargets,
		time: { frame: 12 },
	};
	return { probes: new ReflectionProbes(core, host), calls, sent, state };
}

const BOX = { min: [-2, 0, -3], max: [2, 3, 3] } as const;

describe('reflection probes', () => {
	beforeEach(() => setErrorFixes(ERROR_FIXES));

	it('sends every option with its default, the capture point at the box center', () => {
		const { probes, calls, sent } = probesOf();
		const probe = probes.create({ box: BOX }, 'scene.createReflectionProbe');
		expect(probe.slot).toBe(0);
		expect(calls).toEqual([
			['set', 0, -2, 0, -3, 2, 3, 3, 0, 1.5, 0, 1, 1, C.REFLECTION_PROBE_BOX_PROJECTION, 1, 0],
		]);
		expect(sent).toEqual([7]);
		probes.create(
			{
				box: BOX,
				position: [1, 1, 1],
				blend: 0,
				intensity: 2,
				boxProjection: false,
				refresh: 'always',
				layers: 4,
				priority: 3,
			},
			'scene.createReflectionProbe',
		);
		expect(calls[1]).toEqual([
			'set',
			1,
			-2,
			0,
			-3,
			2,
			3,
			3,
			1,
			1,
			1,
			0,
			2,
			C.REFLECTION_PROBE_ALWAYS,
			4,
			3,
		]);
		expect(sent).toEqual([7]);
	});

	it('reuses a destroyed probe slot, and refuses a call after destroy', () => {
		const { probes, calls } = probesOf();
		const first = probes.create({ box: BOX }, 'create');
		first.capture();
		first.destroy();
		expect(calls.slice(1)).toEqual([
			['capture', 0],
			['remove', 0],
		]);
		expect(() => first.capture()).toThrow('E1101');
		expect(probes.create({ box: BOX }, 'create').slot).toBe(0);
	});

	it('throws E1430 past the most probes, and when the views are taken', () => {
		const { probes, state } = probesOf();
		for (let k = 0; k < C.REFLECTION_PROBE_MAX; k++) probes.create({ box: BOX }, 'create');
		expect(() => probes.create({ box: BOX }, 'create')).toThrow('E1430');
		const other = probesOf();
		other.state.full = true;
		expect(() => other.probes.create({ box: BOX }, 'create')).toThrow('E1430');
		expect(state.full).toBe(false);
	});

	it('checks the options', () => {
		const { probes } = probesOf();
		const make = (options: unknown) =>
			probes.create(options as Parameters<ReflectionProbes['create']>[0], 'create');
		expect(() => make({ box: BOX, size: 2 })).toThrow('E1213');
		expect(() => make({ box: { min: [0, 0, 0], max: [1, 0, 1] } })).toThrow('E1108');
		expect(() => make({ box: { min: [0, Number.NaN, 0], max: [1, 1, 1] } })).toThrow('E1203');
		expect(() => make({ box: BOX, blend: -1 })).toThrow('E1108');
		expect(() => make({ box: BOX, refresh: 'sometimes' })).toThrow('E1213');
		expect(() => make({ box: BOX, boxProjection: 1 })).toThrow('E1213');
	});

	it('sends nothing to the core where the device draws no half-float targets', () => {
		const { probes, calls, sent } = probesOf(false);
		const probe = probes.create({ box: BOX }, 'create');
		probe.destroy();
		expect(calls).toEqual([]);
		expect(sent).toEqual([]);
	});
});
