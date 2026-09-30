import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	MAP_SLOT_BASE_COLOR,
	MAP_SLOT_LIGHT,
	MAP_SLOT_NORMAL,
	MATERIAL_FEATURE_DOUBLE_SIDED,
	MATERIAL_FEATURE_FLAT_SHADING,
	MATERIAL_FEATURE_VERTEX_COLORS,
	MATERIAL_PARAM_COLOR,
	MATERIAL_PARAM_EMISSIVE,
	MATERIAL_PARAM_EMISSIVE_INTENSITY,
	MATERIAL_PARAM_LIGHT_MAP_INTENSITY,
	MATERIAL_PARAM_METALNESS,
	MATERIAL_PARAM_NORMAL_SCALE,
	MATERIAL_PARAM_OCCLUSION_STRENGTH,
	MATERIAL_PARAM_OPACITY,
	MATERIAL_PARAM_ROUGHNESS,
	MATERIAL_PARAM_UV_U,
	MATERIAL_PARAM_UV_V,
	SHADING_UNLIT,
	SHADING_UNLIT_MAP,
} from '../generated/core';
import { fromHex } from '../math/color';
import type { CoreGlue } from '../shared/core';
import { CoreMemory } from './memory';
import { Materials } from './resources';
import type { Texture } from './textures';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** The render error that the core reports for a material id it does not know. */
const UNKNOWN_MATERIAL = { code: 1501, details: [5, 0] };

/** Numbers of each value that `setMaterialValue` writes, by its code. */
const WIDTHS = new Map([
	[MATERIAL_PARAM_COLOR, 3],
	[MATERIAL_PARAM_EMISSIVE, 3],
	[MATERIAL_PARAM_OPACITY, 1],
	[MATERIAL_PARAM_METALNESS, 1],
	[MATERIAL_PARAM_ROUGHNESS, 1],
	[MATERIAL_PARAM_EMISSIVE_INTENSITY, 1],
	[MATERIAL_PARAM_NORMAL_SCALE, 2],
	[MATERIAL_PARAM_OCCLUSION_STRENGTH, 1],
	[MATERIAL_PARAM_LIGHT_MAP_INTENSITY, 1],
	[MATERIAL_PARAM_UV_U, 3],
	[MATERIAL_PARAM_UV_V, 3],
]);

/** A texture as materials see it: its handle, and the coordinates its maps read. */
const texture = (handle: number, uvSet: 0 | 1 = 0) => ({ handle, uvSet }) as unknown as Texture;

/**
 * A core that keeps each material's row of values, from the linear color and opacity on, as the
 * engine core's table does, and each material's features.
 */
function fakeCore() {
	const table: number[][] = [];
	const features: number[] = [];
	const shadings: number[] = [];
	/** Each map a material got: its material, slot, texture handle and coordinate set. */
	const maps: number[][] = [];
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
		createMaterial: (shading: number, bits: number, r: number, g: number, b: number, a: number) => {
			const row = new Array<number>(32).fill(0);
			row.splice(0, 4, r, g, b, a);
			row[MATERIAL_PARAM_ROUGHNESS] = 1;
			row[MATERIAL_PARAM_EMISSIVE_INTENSITY] = 1;
			features.push(bits);
			shadings.push(shading);
			return table.push(row);
		},
		setMaterialValue: (material: number, param: number, x: number, y: number, z: number) =>
			change(material, (values) => {
				const width = WIDTHS.get(param) ?? 0;
				values.splice(param, width, ...[x, y, z].slice(0, width));
			}),
		setMaterialMap: (material: number, slot: number, handle: number, second: number) =>
			change(material, () => {
				maps.push([material, slot, handle, second]);
			}),
		lastErrorCode: () => failure.code,
		lastErrorDetail: (index: number) => failure.details[index] ?? 0,
	};
	const memory = new WebAssembly.Memory({ initial: 1 });
	return {
		table,
		features,
		shadings,
		maps,
		materials: new Materials(new CoreMemory(glue as unknown as CoreGlue, memory)),
	};
}

/** The first four values of a material's row: its linear color and opacity. */
const colorOf = (row: number[] | undefined) => row?.slice(0, 4);

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
		expect(colorOf(table[0])).toEqual([...linear(0xe8554e), 0.5]);
	});

	test('changes the color alone and keeps the opacity', () => {
		const { table, materials } = fakeCore();
		const glass = materials.unlit({ color: 0xffffff, opacity: 0.25 });
		glass.set({ color: '#4a8cff' });
		expect(colorOf(table[0])).toEqual([...linear(0x4a8cff), 0.25]);
	});

	test('changes both values, or nothing without options', () => {
		const { table, materials } = fakeCore();
		const paint = materials.standard({ color: 0xe8554e });
		paint.set({ color: 0x4a8cff, opacity: 0.75 });
		expect(colorOf(table[0])).toEqual([...linear(0x4a8cff), 0.75]);
		paint.set({});
		expect(colorOf(table[0])).toEqual([...linear(0x4a8cff), 0.75]);
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

	test('changes the standard values, and colors are linear', () => {
		const { table, materials } = fakeCore();
		const steel = materials.standard({ color: 0x888888, metalness: 1, roughness: 0.25 });
		const row = () => table[0] as number[];
		expect([row()[MATERIAL_PARAM_METALNESS], row()[MATERIAL_PARAM_ROUGHNESS]]).toEqual([1, 0.25]);
		steel.set({ emissive: 0xff8000, emissiveIntensity: 2.5 });
		expect(row().slice(MATERIAL_PARAM_EMISSIVE, MATERIAL_PARAM_EMISSIVE + 3)).toEqual(
			linear(0xff8000),
		);
		expect(row()[MATERIAL_PARAM_EMISSIVE_INTENSITY]).toBe(2.5);
		steel.set({ roughness: 0.75 });
		expect([row()[MATERIAL_PARAM_METALNESS], row()[MATERIAL_PARAM_ROUGHNESS]]).toEqual([1, 0.75]);
		expect(colorOf(row())).toEqual([...linear(0x888888), 1]);
	});

	test('checks the range of each number, when created and when set', () => {
		const { table, materials } = fakeCore();
		for (const [options, message] of [
			[{ metalness: 1.5 }, 'got the metalness 1.5, outside 0 to 1.'],
			[{ roughness: -0.1 }, 'got the roughness -0.1, outside 0 to 1.'],
			[{ emissiveIntensity: -1 }, 'got the emissive intensity -1; it takes 0 or more.'],
		] as const) {
			const error = thrown(() => materials.standard(options));
			expect(error.code).toBe('E1108');
			expect(error.message).toStartWith(`E1108: materials.standard() ${message}`);
		}
		expect(table).toHaveLength(0);
		const paint = materials.standard({ emissiveIntensity: 1e6 });
		const before = [...(table[0] as number[])];
		expect(thrown(() => paint.set({ metalness: 0.5, roughness: 2 })).code).toBe('E1108');
		expect(thrown(() => paint.set({ color: 0x4a8cff, emissive: 'glow' })).code).toBe('E1204');
		expect(table[0]).toEqual(before);
	});

	test('passes the features that the material fixes when it is created', () => {
		const { features, materials } = fakeCore();
		materials.standard({ doubleSided: true, flatShading: true });
		materials.unlit({ vertexColors: true });
		materials.standard();
		expect(features).toEqual([
			MATERIAL_FEATURE_DOUBLE_SIDED | MATERIAL_FEATURE_FLAT_SHADING,
			MATERIAL_FEATURE_VERTEX_COLORS,
			0,
		]);
	});

	test('maps go into their slots, on the coordinates of their texture', () => {
		const { maps, shadings, materials } = fakeCore();
		materials.standard({ map: texture(5), normalMap: texture(6), lightMap: texture(7, 1) });
		materials.unlit({ map: texture(8) });
		materials.unlit();
		expect(maps).toEqual([
			[1, MAP_SLOT_BASE_COLOR, 5, 0],
			[1, MAP_SLOT_NORMAL, 6, 0],
			[1, MAP_SLOT_LIGHT, 7, 1],
			[2, MAP_SLOT_BASE_COLOR, 8, 0],
		]);
		expect(shadings.slice(1)).toEqual([SHADING_UNLIT_MAP, SHADING_UNLIT]);
	});

	test('writes map values, and the transform as three.js places a texture', () => {
		const { table, materials } = fakeCore();
		const stone = materials.standard({ normalScale: [0.5, -1], aoMapIntensity: 0.25 });
		const row = () => table[0] as number[];
		expect(row().slice(MATERIAL_PARAM_NORMAL_SCALE, MATERIAL_PARAM_NORMAL_SCALE + 2)).toEqual([
			0.5, -1,
		]);
		expect(row()[MATERIAL_PARAM_OCCLUSION_STRENGTH]).toBe(0.25);
		stone.set({ uvTransform: { offset: [0.5, 0.25], repeat: [2, 3], rotation: Math.PI / 2 } });
		const u = row().slice(MATERIAL_PARAM_UV_U, MATERIAL_PARAM_UV_U + 3);
		const v = row().slice(MATERIAL_PARAM_UV_V, MATERIAL_PARAM_UV_V + 3);
		const close = (values: number[], expected: number[]) => {
			for (const [k, value] of values.entries())
				expect(value).toBeCloseTo(expected[k] as number, 12);
		};
		close(u, [0, 2, 0.5]);
		close(v, [-3, 0, 0.25]);
		stone.set({ uvTransform: { repeat: [4, 4] } });
		close(row().slice(MATERIAL_PARAM_UV_U, MATERIAL_PARAM_UV_U + 3), [4, 0, 0]);
		stone.set({ lightMapIntensity: 3 });
		expect(row()[MATERIAL_PARAM_LIGHT_MAP_INTENSITY]).toBe(3);
	});

	test('checks the map values before it changes any', () => {
		const { table, materials } = fakeCore();
		const stone = materials.standard();
		const before = [...(table[0] as number[])];
		expect(thrown(() => stone.set({ aoMapIntensity: 1.5 })).code).toBe('E1108');
		expect(thrown(() => stone.set({ lightMapIntensity: -1 })).code).toBe('E1108');
		expect(thrown(() => stone.set({ normalScale: [Number.NaN, 1] })).code).toBe('E1108');
		const turned = thrown(() => stone.set({ roughness: 0.5, uvTransform: { rotation: Infinity } }));
		expect(turned.code).toBe('E1108');
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
