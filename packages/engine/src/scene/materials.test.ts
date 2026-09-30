import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	MATERIAL_FEATURE_DOUBLE_SIDED,
	MATERIAL_FEATURE_FLAT_SHADING,
	MATERIAL_FEATURE_VERTEX_COLORS,
	MATERIAL_PARAM_COLOR,
	MATERIAL_PARAM_EMISSIVE,
	MATERIAL_PARAM_EMISSIVE_INTENSITY,
	MATERIAL_PARAM_METALNESS,
	MATERIAL_PARAM_OPACITY,
	MATERIAL_PARAM_ROUGHNESS,
	SHADING_CUSTOM_ATTRIBUTE_SHIFT,
	SHADING_CUSTOM_FIRST,
	SHADING_CUSTOM_VERTEX_COLORS,
	SHADING_LIT,
} from '../generated/core';
import { VERTEX_COLOR, VERTEX_UV0 } from '../generated/gpu';
import { fromHex } from '../math/color';
import type { CoreGlue } from '../shared/core';
import type { CustomShader } from '../shared/images';
import { CoreMemory } from './memory';
import { Materials } from './resources';

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
]);

/**
 * A core that keeps each material's row of values, from the linear color and opacity on, as the
 * engine core's table does, and each material's features.
 */
function fakeCore() {
	const table: number[][] = [];
	const features: number[] = [];
	const shadings: number[] = [];
	const sent: [number, CustomShader][] = [];
	/** Each material's row of custom values. */
	const custom: number[][] = [];
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
			const row = new Array<number>(16).fill(0);
			row.splice(0, 4, r, g, b, a);
			row[MATERIAL_PARAM_ROUGHNESS] = 1;
			row[MATERIAL_PARAM_EMISSIVE_INTENSITY] = 1;
			features.push(bits);
			shadings.push(shading);
			custom.push(new Array<number>(32).fill(0));
			return table.push(row);
		},
		setMaterialValue: (material: number, param: number, x: number, y: number, z: number) =>
			change(material, (values) => values.splice(param, WIDTHS.get(param) ?? 0, x, y, z)),
		setMaterialValues: (material: number, at: number, count: number, ...xyzw: number[]) => {
			custom[material - 1]?.splice(at, count, ...xyzw.slice(0, count));
			return 0;
		},
		lastErrorCode: () => failure.code,
		lastErrorDetail: (index: number) => failure.details[index] ?? 0,
	};
	const memory = new WebAssembly.Memory({ initial: 1 });
	const core = new CoreMemory(glue as unknown as CoreGlue, memory);
	return {
		table,
		features,
		shadings,
		sent,
		custom,
		materials: new Materials(core, (template, shader) => sent.push([template, shader])),
	};
}

/** A custom material's WGSL as the Vite plugin compiles it, with a stand-in for its variants. */
function compiledMaterial(uniforms: { name: string; type: string; offset: number }[] = []) {
	return {
		kind: 'material',
		functions: ['surface'],
		variants: {},
		uniforms,
		locations: [0, 1, 2],
		attributes: VERTEX_UV0,
		vertexColors: true,
	} as const;
}

/** The shading code of a custom material of the standard template, from its template. */
const standardCustom = (template: number) =>
	template | (VERTEX_UV0 << SHADING_CUSTOM_ATTRIBUTE_SHIFT) | SHADING_CUSTOM_VERTEX_COLORS;

/** The uniforms of a WGSL `struct Uniforms { speed: f32, tint: vec3f, scale: vec2f, count: u32 }`. */
const UNIFORMS = [
	{ name: 'speed', type: 'f32', offset: 0 },
	{ name: 'tint', type: 'vec3f', offset: 4 },
	{ name: 'scale', type: 'vec2f', offset: 8 },
	{ name: 'count', type: 'u32', offset: 10 },
];

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

describe('materials.shader', () => {
	test('gives each compiled WGSL its own template, sent to the thread that draws once', () => {
		const { shadings, sent, materials } = fakeCore();
		const stripes = compiledMaterial();
		const rings = compiledMaterial();
		materials.standard();
		materials.shader({ wgsl: stripes, color: '#ff0000' });
		materials.shader({ wgsl: rings });
		materials.shader({ wgsl: stripes, color: '#0000ff' });
		expect(shadings).toEqual([
			SHADING_LIT,
			standardCustom(SHADING_CUSTOM_FIRST),
			standardCustom(SHADING_CUSTOM_FIRST + 1),
			standardCustom(SHADING_CUSTOM_FIRST),
		]);
		expect(sent).toEqual([
			[SHADING_CUSTOM_FIRST, { variants: stripes.variants, locations: [0, 1, 2] }],
			[SHADING_CUSTOM_FIRST + 1, { variants: rings.variants, locations: [0, 1, 2] }],
		]);
	});

	test('passes a full shader the vertex attributes it reads, without vertex colors', () => {
		const { shadings, sent, materials } = fakeCore();
		const full = {
			...compiledMaterial(),
			functions: [],
			locations: [0, 1, 5],
			attributes: VERTEX_COLOR,
			vertexColors: false,
		};
		materials.shader({ wgsl: full, vertexColors: true });
		expect(shadings).toEqual([
			SHADING_CUSTOM_FIRST | (VERTEX_COLOR << SHADING_CUSTOM_ATTRIBUTE_SHIFT),
		]);
		expect(sent).toEqual([[SHADING_CUSTOM_FIRST, { variants: {}, locations: [0, 1, 5] }]]);
	});

	test('takes every standard option, and set changes the standard values', () => {
		const { table, features, materials } = fakeCore();
		const custom = materials.shader({
			wgsl: compiledMaterial(),
			color: 0x888888,
			metalness: 1,
			roughness: 0.25,
			doubleSided: true,
			flatShading: true,
		});
		const row = () => table[0] as number[];
		expect(colorOf(row())).toEqual([...linear(0x888888), 1]);
		expect([row()[MATERIAL_PARAM_METALNESS], row()[MATERIAL_PARAM_ROUGHNESS]]).toEqual([1, 0.25]);
		expect(features).toEqual([MATERIAL_FEATURE_DOUBLE_SIDED | MATERIAL_FEATURE_FLAT_SHADING]);
		custom.set({ roughness: 0.75 });
		expect(row()[MATERIAL_PARAM_ROUGHNESS]).toBe(0.75);
		const error = thrown(() => custom.set({ roughness: 2 }));
		expect(error.message).toStartWith('E1108: materials.shader.set() got the roughness 2');
	});

	test('refuses WGSL that the Vite plugin did not compile, and whole shaders', () => {
		const { table, sent, materials } = fakeCore();
		const text = thrown(() => materials.shader({ wgsl: 'fn surface() {}' }));
		expect(text.code).toBe('E1215');
		expect(text.message).toStartWith(
			'E1215: materials.shader() got WGSL as text, which the null3D Vite plugin did not compile.',
		);
		const whole = thrown(() => materials.shader({ wgsl: { kind: 'shader' } }));
		expect(whole.message).toStartWith(
			'E1215: materials.shader() got a whole shader whose @vertex entry point takes no InstanceIn.',
		);
		const missing = thrown(() =>
			materials.shader({} as unknown as Parameters<typeof materials.shader>[0]),
		);
		expect(missing.message).toStartWith('E1215: materials.shader() got WGSL as undefined');
		expect(table).toHaveLength(0);
		expect(sent).toHaveLength(0);
	});
});

describe('uniforms of materials.shader', () => {
	test('start at their first values or 0, and set changes them with the standard values', () => {
		const { table, custom, materials } = fakeCore();
		const water = materials.shader({
			wgsl: compiledMaterial(UNIFORMS),
			roughness: 0.5,
			uniforms: { speed: 1.5, tint: '#ff8000', scale: [2, 3] },
		});
		const row = () => custom[0] as number[];
		expect(row().slice(0, 12)).toEqual([1.5, 0, 0, 0, ...linear(0xff8000), 0, 2, 3, 0, 0]);
		water.set({ speed: 2, tint: [0.1, 0.2, 0.3], count: 8, roughness: 0.25 });
		expect(row().slice(0, 12)).toEqual([2, 0, 0, 0, 0.1, 0.2, 0.3, 0, 2, 3, 8, 0]);
		expect((table[0] as number[])[MATERIAL_PARAM_ROUGHNESS]).toBe(0.25);
	});

	test('checks every value before it changes any', () => {
		const { table, custom, materials } = fakeCore();
		const water = materials.shader({ wgsl: compiledMaterial(UNIFORMS), uniforms: { speed: 1 } });
		const before = [[...(table[0] as number[])], [...(custom[0] as number[])]];
		for (const [values, message] of [
			[
				{ speeed: 2 },
				"got speeed, which is not a uniform of the material's WGSL. Its uniforms: speed, tint, scale, count.",
			],
			[{ speed: 'fast' }, 'got "fast" for the f32 uniform speed; it takes a number.'],
			[{ count: 2.5 }, 'got 2.5 for the u32 uniform count; it takes a whole number.'],
			[
				{ scale: [1, 2, 3] },
				'got [1,2,3] for the vec2f uniform scale; it takes an array of 2 numbers.',
			],
			[
				{ roughness: 0.5, tint: [1, 2] },
				'got [1,2] for the vec3f uniform tint; it takes an array of 3 numbers, or a color.',
			],
		] as const) {
			const error = thrown(() => water.set(values));
			expect(error.code).toBe('E1216');
			expect(error.message).toStartWith(`E1216: materials.shader.set() ${message}`);
		}
		expect([table[0], custom[0]]).toEqual(before);
	});

	test('refuses unknown first values and uniforms named as standard values', () => {
		const { table, sent, materials } = fakeCore();
		const unknown = thrown(() =>
			materials.shader({ wgsl: compiledMaterial(UNIFORMS), uniforms: { speeed: 1 } }),
		);
		expect(unknown.message).toStartWith('E1216: materials.shader() got speeed, which is not');
		const named = thrown(() =>
			materials.shader({ wgsl: compiledMaterial([{ name: 'roughness', type: 'f32', offset: 0 }]) }),
		);
		expect(named.message).toStartWith(
			'E1216: materials.shader() got WGSL whose uniform roughness has the name of a standard value.',
		);
		expect(table).toHaveLength(0);
		expect(sent).toHaveLength(0);
	});
});
