import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { Material, MeshGeometry } from './resources';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/**
 * Meshes 1 to 4 of one core, which records each set of levels it receives: the base mesh's id,
 * its levels' ids, their switch values, their switch measures, their material ids and the levels
 * that fade.
 */
function meshes() {
	const memory = new WebAssembly.Memory({ initial: 1 });
	const sets: {
		base: number;
		ids: number[];
		values: number[];
		switches: number[];
		materials: number[];
		fades: number;
	}[] = [];
	const staging = 1024;
	const glue = {
		meshArrays: () => staging,
		setMeshLevels: (base: number, count: number, fades: number) => {
			const ids = [...new Uint32Array(memory.buffer, staging, count)];
			const values = [...new Float32Array(memory.buffer, staging + 4 * count, count)];
			const switches = [...new Uint32Array(memory.buffer, staging + 8 * count, count)];
			const materials = [...new Uint32Array(memory.buffer, staging + 12 * count, count)];
			sets.push({ base, ids, values, switches, materials, fades });
			return 0;
		},
		destroyMaterial: () => 0,
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
	return { base, a, b, c, core, sets };
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
	test('hands the core the levels, from the most detailed down, with their switch values', () => {
		const { base, a, b, sets } = meshes();
		base.setLevels([
			{ mesh: a, error: 0.02 },
			{ mesh: b, error: 0.1 },
		]);
		expect(sets).toHaveLength(1);
		expect(sets[0]?.base).toBe(1);
		expect(sets[0]?.ids).toEqual([2, 3]);
		expect(sets[0]?.values.map((e) => Math.round(e * 1000) / 1000)).toEqual([0.02, 0.1]);
		expect(sets[0]?.switches).toEqual([0, 0]);
		expect(sets[0]?.materials).toEqual([0, 0]);
		// Every level of a hand-set error fades, and the base level's fade bucket comes with it.
		expect(sets[0]?.fades).toBe(0b110);
		expect(base.levels.map((level) => level.mesh)).toEqual([a, b]);
		base.setLevels([], { fade: false });
		expect(sets[1]).toEqual({
			base: 1,
			ids: [],
			values: [],
			switches: [],
			materials: [],
			fades: 0,
		});
		expect(base.levels).toEqual([]);
	});

	test("hands the core a level's own material, and 0 for a level that inherits it", () => {
		const { base, a, b, core, sets } = meshes();
		const masked = new Material(5, core, 'materials.standard.set');
		const rough = new Material(6, core, 'materials.standard.set');
		base.setLevels([
			{ mesh: a, error: 0.02, material: masked },
			{ mesh: b, error: 0.1, material: rough },
			{ mesh: a, error: 0.3 },
		]);
		expect(sets[0]?.materials).toEqual([5, 6, 0]);
	});

	test('refuses a material that is destroyed or from another engine, with E1221', () => {
		const { base, a, core, sets } = meshes();
		const destroyed = new Material(5, core, 'materials.standard.set');
		destroyed.destroy();
		const error = thrown(() => base.setLevels([{ mesh: a, error: 0.1, material: destroyed }]));
		expect(error?.code).toBe('E1221');
		expect(error?.message).toContain('a material that is destroyed');
		const other = new Material(
			5,
			new CoreMemory(
				{
					meshArrays: () => 0,
					lastErrorCode: () => 0,
					lastErrorDetail: () => 0,
				} as unknown as CoreGlue,
				new WebAssembly.Memory({ initial: 1 }),
			),
			'materials.standard.set',
		);
		expect(
			thrown(() => base.setLevels([{ mesh: a, error: 0.1, material: other }]))?.message,
		).toContain('a material from another engine');
		expect(sets).toEqual([]);
	});

	test('keeps a measure of its own for a level given by distance or by coverage', () => {
		const { base, a, b, sets } = meshes();
		base.setLevels([
			{ mesh: a, distance: 50 },
			{ mesh: b, coverage: 0.03125 },
		]);
		expect(sets[0]?.values).toEqual([50, 0.03125]);
		expect(sets[0]?.switches).toEqual([1, 2]);
		// A coverage of a thirty-second of the screen is farther than a distance of 50 m for this
		// sphere of radius 1: 1 × 2.1445 / 0.03125 is 68.6 m. The value is a binary fraction, so
		// the level's stored measure reads back unchanged.
		expect(sets[0]?.fades).toBe(0b110);
	});

	test('switches a level at once where it says so, and fades the others', () => {
		const { base, a, b, sets } = meshes();
		base.setLevels([
			{ mesh: a, error: 0.02, fade: false },
			{ mesh: b, error: 0.1 },
		]);
		expect(sets[0]?.fades).toBe(0b100);
	});

	test('refuses levels whose switches do not grow, or that give no single measure, with E1221', () => {
		const { base, a, b, c, sets } = meshes();
		const cases: [() => void, string][] = [
			[
				() =>
					base.setLevels([
						{ mesh: a, error: 0.05 },
						{ mesh: b, error: 0.02 },
					]),
				'not past the',
			],
			[() => base.setLevels([{ mesh: a }]), 'none of an error, a distance and a coverage'],
			[
				() => base.setLevels([{ mesh: a, error: 0.1, distance: 4 }]),
				'more than one of an error, a distance and a coverage',
			],
			[() => base.setLevels([{ mesh: a, error: Number.NaN }]), 'not a number above 0'],
			[() => base.setLevels([{ mesh: a, coverage: 0 }]), 'not a number above 0'],
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
