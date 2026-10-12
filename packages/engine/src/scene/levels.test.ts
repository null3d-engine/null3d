import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { MeshGeometry } from './resources';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/**
 * Meshes 1 to 4 of one core, which records each set of levels it receives: the base mesh's id,
 * its levels' ids, their errors and whether they fade.
 */
function meshes() {
	const memory = new WebAssembly.Memory({ initial: 1 });
	const sets: { base: number; ids: number[]; errors: number[]; fades: boolean }[] = [];
	const staging = 1024;
	const glue = {
		meshArrays: () => staging,
		setMeshLevels: (base: number, count: number, fades: boolean) => {
			const ids = [...new Uint32Array(memory.buffer, staging, count)];
			const errors = [...new Float32Array(memory.buffer, staging + 4 * count, count)];
			sets.push({ base, ids, errors, fades });
			return 0;
		},
		lastErrorCode: () => 0,
		lastErrorDetail: () => 0,
	} as unknown as CoreGlue;
	const core = new CoreMemory(glue, memory);
	const [base, a, b, c] = [1, 2, 3, 4].map((id) => new MeshGeometry(id, 1, core)) as [
		MeshGeometry,
		MeshGeometry,
		MeshGeometry,
		MeshGeometry,
	];
	return { base, a, b, c, sets };
}

/** The error that a mesh.setLevels() call throws, or undefined. */
function thrown(call: () => void): EngineError | undefined {
	try {
		call();
	} catch (error) {
		return error as EngineError;
	}
	return undefined;
}

describe('mesh.setLevels', () => {
	test('hands the core the levels, from the most detailed down, with their errors', () => {
		const { base, a, b, sets } = meshes();
		base.setLevels([
			{ mesh: a, error: 0.02 },
			{ mesh: b, error: 0.1 },
		]);
		expect(sets).toHaveLength(1);
		expect(sets[0]?.base).toBe(1);
		expect(sets[0]?.ids).toEqual([2, 3]);
		expect(sets[0]?.errors.map((e) => Math.round(e * 1000) / 1000)).toEqual([0.02, 0.1]);
		expect(sets[0]?.fades).toBe(true);
		expect(base.levels.map((level) => level.mesh)).toEqual([a, b]);
		base.setLevels([], { fade: false });
		expect(sets[1]).toEqual({ base: 1, ids: [], errors: [], fades: false });
		expect(base.levels).toEqual([]);
	});

	test("turns a distance into the error that covers a pixel there, at three.js's field of view on a screen 1,080 pixels high", () => {
		const { base, a, sets } = meshes();
		base.setLevels([{ mesh: a, distance: 50 }]);
		const perMeter = (2 * Math.tan((50 * Math.PI) / 360)) / 1080;
		expect(sets[0]?.errors[0]).toBeCloseTo(50 * perMeter, 6);
		base.setLevels([{ mesh: a, distance: 50 }], { fov: 90 });
		expect(sets[1]?.errors[0]).toBeCloseTo((50 * 2) / 1080, 6);
	});

	test('refuses levels whose errors do not grow, or that give neither an error nor a distance, with E1221', () => {
		const { base, a, b, c, sets } = meshes();
		const cases: [() => void, string][] = [
			[
				() =>
					base.setLevels([
						{ mesh: a, error: 0.05 },
						{ mesh: b, error: 0.02 },
					]),
				'not above the 0.05 of level 1',
			],
			[() => base.setLevels([{ mesh: a }]), 'neither an error nor a distance'],
			[
				() => base.setLevels([{ mesh: a, error: 0.1, distance: 4 }]),
				'both an error and a distance',
			],
			[() => base.setLevels([{ mesh: a, error: Number.NaN }]), 'not a number above 0'],
			[() => base.setLevels([{ mesh: base, error: 0.1 }]), 'the base mesh itself'],
			[() => base.setLevels([{ mesh: c, error: 0.1 }], { fov: 180 }), 'not between 0 and 180'],
			[() => base.setLevels(Array(8).fill({ mesh: a, error: 1 })), 'at most 7'],
		];
		for (const [call, words] of cases) {
			const error = thrown(call);
			expect(error?.code).toBe('E1221');
			expect(error?.message).toContain(words);
		}
		expect(sets).toEqual([]);
	});
});
