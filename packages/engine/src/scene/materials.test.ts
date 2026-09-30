import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { fromHex } from '../math/color';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { Materials } from './resources';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** The render error that the core reports for a material id it does not know. */
const UNKNOWN_MATERIAL = { code: 1501, details: [5, 0] };

/** A core that keeps each material's linear color and opacity, as the engine core's table does. */
function fakeCore() {
	const table: number[][] = [];
	let failure = { code: 0, details: [0, 0] };
	/** Runs a change on a known material, or reports the core's error for an unknown one. */
	const change = (material: number, apply: (values: number[]) => void) => {
		const values = table[material - 1];
		if (!values) {
			failure = UNKNOWN_MATERIAL;
			return failure.code;
		}
		apply(values);
		return 0;
	};
	const glue = {
		createMaterial: (_shading: number, r: number, g: number, b: number, a: number) =>
			table.push([r, g, b, a]),
		setMaterialColor: (material: number, r: number, g: number, b: number) =>
			change(material, (values) => values.splice(0, 3, r, g, b)),
		setMaterialOpacity: (material: number, opacity: number) =>
			change(material, (values) => {
				values[3] = opacity;
			}),
		lastErrorCode: () => failure.code,
		lastErrorDetail: (index: number) => failure.details[index] ?? 0,
	};
	const memory = new WebAssembly.Memory({ initial: 1 });
	return { table, materials: new Materials(new CoreMemory(glue as unknown as CoreGlue, memory)) };
}

/** The linear values of an sRGB hex color, as the core stores them. */
const linear = (hex: number) => [...fromHex([0, 0, 0], hex)];

/** The error that `call` throws. */
function thrown(call: () => void): EngineError {
	try {
		call();
	} catch (error) {
		return error as EngineError;
	}
	throw new Error('the call did not throw');
}

describe('Material.set', () => {
	test('changes the opacity alone and keeps the color', () => {
		const { table, materials } = fakeCore();
		const paint = materials.standard({ color: 0xe8554e });
		paint.set({ opacity: 0.5 });
		expect(table[0]).toEqual([...linear(0xe8554e), 0.5]);
	});

	test('changes the color alone and keeps the opacity', () => {
		const { table, materials } = fakeCore();
		const glass = materials.unlit({ color: 0xffffff, opacity: 0.25 });
		glass.set({ color: '#4a8cff' });
		expect(table[0]).toEqual([...linear(0x4a8cff), 0.25]);
	});

	test('changes both values, or nothing without options', () => {
		const { table, materials } = fakeCore();
		const paint = materials.standard({ color: 0xe8554e });
		paint.set({ color: 0x4a8cff, opacity: 0.75 });
		expect(table[0]).toEqual([...linear(0x4a8cff), 0.75]);
		paint.set({});
		expect(table[0]).toEqual([...linear(0x4a8cff), 0.75]);
	});

	test('checks every value before it changes any', () => {
		const { table, materials } = fakeCore();
		const paint = materials.standard({ color: 0xe8554e, opacity: 0.5 });
		const before = [...(table[0] as number[])];
		const color = thrown(() => paint.set({ color: 'blue-ish', opacity: 1 }));
		expect(color.code).toBe('E1204');
		expect(color.message).toStartWith('E1204: materials.standard.set() got the color "blue-ish".');
		const opacity = thrown(() => paint.set({ color: 0x4a8cff, opacity: 2 }));
		expect(opacity.code).toBe('E1108');
		expect(opacity.message).toStartWith(
			'E1108: materials.standard.set() got the opacity 2, outside 0 to 1.',
		);
		expect(thrown(() => paint.set({ opacity: Number.NaN })).code).toBe('E1108');
		expect(table[0]).toEqual(before);
	});

	test('throws the error that the engine core reports', () => {
		const { table, materials } = fakeCore();
		const paint = materials.unlit({ color: 0xe8554e });
		table.length = 0;
		const error = thrown(() => paint.set({ opacity: 0.5 }));
		expect(error.code).toBe('E1103');
		expect(error.message).toStartWith(
			'E1103: materials.unlit.set() got a material that is not from this engine.',
		);
	});
});
