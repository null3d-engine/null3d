import { beforeEach, describe, expect, test } from 'bun:test';
import { type EngineError, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	MAP_SLOT_BASE_COLOR,
	MAP_SLOT_LIGHT,
	MAP_SLOT_NORMAL,
	MAP_SLOT_SPECULAR_COLOR,
	MAP_SLOT_SPECULAR_INTENSITY,
	MATERIAL_FEATURE_ADDITIVE,
	MATERIAL_FEATURE_ALPHA_HASH,
	MATERIAL_FEATURE_ALPHA_MASK,
	MATERIAL_FEATURE_ALPHA_TO_COVERAGE,
	MATERIAL_FEATURE_BLEND,
	MATERIAL_FEATURE_DOUBLE_SIDED,
	MATERIAL_FEATURE_FLAT_SHADING,
	MATERIAL_FEATURE_MULTIPLY,
	MATERIAL_FEATURE_NO_DEPTH_TEST,
	MATERIAL_FEATURE_NO_DEPTH_WRITE,
	MATERIAL_FEATURE_NO_FOG,
	MATERIAL_FEATURE_SINGLE_PASS,
	MATERIAL_FEATURE_VERTEX_COLORS,
	MATERIAL_PARAM_ALPHA_CUTOFF,
	MATERIAL_PARAM_COLOR,
	MATERIAL_PARAM_EMISSIVE,
	MATERIAL_PARAM_EMISSIVE_INTENSITY,
	MATERIAL_PARAM_ENV_INTENSITY,
	MATERIAL_PARAM_LIGHT_MAP_INTENSITY,
	MATERIAL_PARAM_METALNESS,
	MATERIAL_PARAM_NORMAL_SCALE,
	MATERIAL_PARAM_OCCLUSION_STRENGTH,
	MATERIAL_PARAM_OPACITY,
	MATERIAL_PARAM_REFLECTANCE,
	MATERIAL_PARAM_ROUGHNESS,
	MATERIAL_PARAM_SPECULAR_COLOR,
	MATERIAL_PARAM_SPECULAR_INTENSITY,
	MATERIAL_PARAM_UV_U,
	MATERIAL_PARAM_UV_V,
	SHADING_CUSTOM_ATTRIBUTE_SHIFT,
	SHADING_CUSTOM_BASE_COLOR,
	SHADING_CUSTOM_FIRST,
	SHADING_CUSTOM_TEXTURE_SHIFT,
	SHADING_LIT,
	SHADING_UNLIT,
	SHADING_UNLIT_MAP,
} from '../generated/core';
import { SIZE_MATERIAL_BYTES, VERTEX_COLOR, VERTEX_UV0 } from '../generated/gpu';
import { fromHex } from '../math/color';
import type { CoreGlue } from '../shared/core';
import type { CustomShader } from '../shared/images';
import { CoreMemory } from './memory';
import { Materials } from './resources';
import { Texture, type Textures } from './textures';

beforeEach(() => setErrorFixes(ERROR_FIXES));

/** The render error that the core reports for a material id it does not know. */
const UNKNOWN_MATERIAL = { code: 1501, details: [5, 0] };

/** Numbers of each value that `setMaterialValue` writes, by its code. */
const WIDTHS = new Map([
	[MATERIAL_PARAM_COLOR, 3],
	[MATERIAL_PARAM_EMISSIVE, 3],
	[MATERIAL_PARAM_OPACITY, 1],
	[MATERIAL_PARAM_ALPHA_CUTOFF, 1],
	[MATERIAL_PARAM_METALNESS, 1],
	[MATERIAL_PARAM_ROUGHNESS, 1],
	[MATERIAL_PARAM_EMISSIVE_INTENSITY, 1],
	[MATERIAL_PARAM_NORMAL_SCALE, 2],
	[MATERIAL_PARAM_OCCLUSION_STRENGTH, 1],
	[MATERIAL_PARAM_LIGHT_MAP_INTENSITY, 1],
	[MATERIAL_PARAM_ENV_INTENSITY, 1],
	[MATERIAL_PARAM_UV_U, 3],
	[MATERIAL_PARAM_UV_V, 3],
	[MATERIAL_PARAM_REFLECTANCE, 1],
	[MATERIAL_PARAM_SPECULAR_COLOR, 3],
	[MATERIAL_PARAM_SPECULAR_INTENSITY, 1],
]);

/** A texture as materials see it: its handle, and the coordinates its maps read. */
const texture = (handle: number, uvSet: 0 | 1 = 0) => ({ handle, uvSet }) as unknown as Texture;

/**
 * A core that keeps each material's row of values, from the linear color and opacity on, as the
 * engine core's table does, and each material's features and depth bias.
 */
function fakeCore() {
	const table: number[][] = [];
	const features: number[] = [];
	const shadings: number[] = [];
	const sent: [number, CustomShader][] = [];
	/** Each material's row of custom values. */
	const custom: number[][] = [];
	/** Each map a material got: its material, slot, texture handle and coordinate set. */
	const maps: number[][] = [];
	const biases: [number, number][] = [];
	/** The ids of the destroyed materials, in order. */
	const destroyed: number[] = [];
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
		createMaterial: (
			shading: number,
			bits: number,
			r: number,
			g: number,
			b: number,
			a: number,
			biasConstant: number,
			biasSlope: number,
		) => {
			const row = new Array<number>(SIZE_MATERIAL_BYTES / 4).fill(0);
			row.splice(0, 4, r, g, b, a);
			row[MATERIAL_PARAM_ALPHA_CUTOFF] = 0.5;
			row[MATERIAL_PARAM_ROUGHNESS] = 1;
			row[MATERIAL_PARAM_EMISSIVE_INTENSITY] = 1;
			features.push(bits);
			shadings.push(shading);
			custom.push(new Array<number>(32).fill(0));
			biases.push([biasConstant, biasSlope]);
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
		setMaterialValues: (material: number, at: number, count: number, ...xyzw: number[]) => {
			custom[material - 1]?.splice(at, count, ...xyzw.slice(0, count));
			return 0;
		},
		destroyMaterial: (material: number) =>
			change(material, () => {
				destroyed.push(material);
				table[material - 1] = undefined as unknown as number[];
			}),
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
		maps,
		destroyed,
		biases,
		materials: new Materials(core, (template, shader) => sent.push([template, shader])),
	};
}

/** A custom material's WGSL as the Vite plugin compiles it, with a stand-in for its variants. */
function compiledMaterial(
	uniforms: { name: string; type: string; offset: number }[] = [],
	textures: { name: string; offset: number }[] = [],
) {
	return {
		kind: 'material',
		functions: ['surface'],
		variants: {},
		uniforms,
		textures,
		locations: [0, 1, 2],
		attributes: VERTEX_UV0,
		baseColor: true,
	} as const;
}

/** The shading code of a custom material of the standard template, from its template. */
const standardCustom = (template: number) =>
	template | (VERTEX_UV0 << SHADING_CUSTOM_ATTRIBUTE_SHIFT) | SHADING_CUSTOM_BASE_COLOR;

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
		materials.unlit({ vertexColors: true, fog: false });
		materials.standard({ fog: true });
		materials.standard({ fog: false });
		materials.standard();
		expect(features).toEqual([
			MATERIAL_FEATURE_DOUBLE_SIDED | MATERIAL_FEATURE_FLAT_SHADING,
			MATERIAL_FEATURE_VERTEX_COLORS | MATERIAL_FEATURE_NO_FOG,
			0,
			MATERIAL_FEATURE_NO_FOG,
			0,
		]);
	});

	test('passes the blend alpha mode with each blending', () => {
		const { features, materials } = fakeCore();
		materials.standard({ alphaMode: 'blend' });
		materials.unlit({ alphaMode: 'blend', blending: 'additive', depthWrite: false });
		materials.unlit({ alphaMode: 'blend', blending: 'multiply' });
		materials.unlit({ alphaMode: 'blend', blending: 'normal' });
		expect(features).toEqual([
			MATERIAL_FEATURE_BLEND,
			MATERIAL_FEATURE_BLEND | MATERIAL_FEATURE_ADDITIVE | MATERIAL_FEATURE_NO_DEPTH_WRITE,
			MATERIAL_FEATURE_BLEND | MATERIAL_FEATURE_MULTIPLY,
			MATERIAL_FEATURE_BLEND,
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
		stone.set({ envIntensity: 0.25 });
		expect(row()[MATERIAL_PARAM_ENV_INTENSITY]).toBe(0.25);
	});

	test('writes the specular values, with the reflectance that the index of refraction gives', () => {
		const { table, maps, materials } = fakeCore();
		const glass = materials.standard({
			ior: 2,
			specularIntensity: 0.5,
			specularColor: [2, 0.5, 0],
			specularIntensityMap: texture(5),
			specularColorMap: texture(6, 1),
		});
		const row = () => table[0] as number[];
		expect(row()[MATERIAL_PARAM_REFLECTANCE]).toBeCloseTo(1 / 9, 12);
		expect(row()[MATERIAL_PARAM_SPECULAR_INTENSITY]).toBe(0.5);
		// Linear components above 1 stay, as glTF's specular color factor allows.
		expect(row().slice(MATERIAL_PARAM_SPECULAR_COLOR, MATERIAL_PARAM_SPECULAR_COLOR + 3)).toEqual([
			2, 0.5, 0,
		]);
		expect(maps).toEqual([
			[1, MAP_SLOT_SPECULAR_INTENSITY, 5, 0],
			[1, MAP_SLOT_SPECULAR_COLOR, 6, 1],
		]);
		glass.set({ ior: 1.5, specularColor: '#ffffff' });
		expect(row()[MATERIAL_PARAM_REFLECTANCE]).toBeCloseTo(0.04, 15);
		expect(row().slice(MATERIAL_PARAM_SPECULAR_COLOR, MATERIAL_PARAM_SPECULAR_COLOR + 3)).toEqual([
			1, 1, 1,
		]);
	});

	test('refuses an index of refraction below 1 and a specular intensity above 1', () => {
		const { table, materials } = fakeCore();
		const glass = materials.standard();
		const before = [...(table[0] as number[])];
		for (const values of [
			{ ior: 0.5 },
			{ ior: Number.POSITIVE_INFINITY },
			{ specularIntensity: 2 },
		])
			expect(thrown(() => glass.set(values)).code).toBe('E1108');
		expect(thrown(() => glass.set({ specularColor: [-1, 0, 0] })).code).toBe('E1204');
		expect(table[0]).toEqual(before);
	});

	test('checks the map values before it changes any', () => {
		const { table, materials } = fakeCore();
		const stone = materials.standard();
		const before = [...(table[0] as number[])];
		expect(thrown(() => stone.set({ aoMapIntensity: 1.5 })).code).toBe('E1108');
		expect(thrown(() => stone.set({ lightMapIntensity: -1 })).code).toBe('E1108');
		expect(thrown(() => stone.set({ envIntensity: -0.5 })).code).toBe('E1108');
		expect(thrown(() => stone.set({ normalScale: [Number.NaN, 1] })).code).toBe('E1108');
		const turned = thrown(() => stone.set({ roughness: 0.5, uvTransform: { rotation: Infinity } }));
		expect(turned.code).toBe('E1108');
		expect(table[0]).toEqual(before);
	});

	test('passes the alpha mode and the depth options, and none by default', () => {
		const { features, biases, materials } = fakeCore();
		materials.standard({ alphaMode: 'mask', depthWrite: false });
		materials.unlit({ alphaMode: 'opaque', depthTest: false, depthBias: { constant: -4 } });
		materials.unlit({ depthBias: { slopeScale: -1.5 }, depthWrite: true, depthTest: true });
		expect(features).toEqual([
			MATERIAL_FEATURE_ALPHA_MASK |
				MATERIAL_FEATURE_ALPHA_TO_COVERAGE |
				MATERIAL_FEATURE_NO_DEPTH_WRITE,
			MATERIAL_FEATURE_NO_DEPTH_TEST,
			0,
		]);
		expect(biases).toEqual([
			[0, 0],
			[-4, 0],
			[0, -1.5],
		]);
	});

	test('passes the alpha hash, alpha to coverage on masks by default, and one pass for both faces', () => {
		const { features, materials } = fakeCore();
		materials.standard({ alphaMode: 'hash' });
		materials.unlit({ alphaMode: 'mask', alphaToCoverage: true });
		materials.unlit({ alphaMode: 'mask', alphaToCoverage: false });
		materials.standard({ alphaMode: 'blend', doubleSided: true, forceSinglePass: true });
		materials.unlit({ alphaToCoverage: true, forceSinglePass: false });
		expect(features).toEqual([
			MATERIAL_FEATURE_ALPHA_MASK | MATERIAL_FEATURE_ALPHA_HASH,
			MATERIAL_FEATURE_ALPHA_MASK | MATERIAL_FEATURE_ALPHA_TO_COVERAGE,
			MATERIAL_FEATURE_ALPHA_MASK,
			MATERIAL_FEATURE_BLEND | MATERIAL_FEATURE_DOUBLE_SIDED | MATERIAL_FEATURE_SINGLE_PASS,
			0,
		]);
	});

	test('writes the alpha cutoff when created and when set, within 0 to 1', () => {
		const { table, materials } = fakeCore();
		const leaves = materials.unlit({ alphaMode: 'mask', alphaCutoff: 0.3 });
		const cutoff = () => (table[0] as number[])[MATERIAL_PARAM_ALPHA_CUTOFF];
		expect(cutoff()).toBe(0.3);
		leaves.set({ alphaCutoff: 0.75 });
		expect(cutoff()).toBe(0.75);
		const error = thrown(() => leaves.set({ alphaCutoff: 1.5 }));
		expect(error.code).toBe('E1108');
		expect(error.message).toStartWith(
			'E1108: materials.unlit.set() got the alpha cutoff 1.5, outside 0 to 1.',
		);
		materials.standard({ alphaMode: 'mask' });
		expect((table[1] as number[])[MATERIAL_PARAM_ALPHA_CUTOFF]).toBe(0.5);
	});

	test('rejects an alpha mode it does not know and a depth bias that is not finite', () => {
		const { table, materials } = fakeCore();
		const mode = thrown(() =>
			materials.standard({ alphaMode: 'cutout' as unknown as 'mask', color: 0xff0000 }),
		);
		expect(mode.code).toBe('E1217');
		expect(mode.message).toStartWith(
			`E1217: materials.standard() got the alpha mode "cutout"; it takes 'opaque', 'mask', 'hash' or 'blend'.`,
		);
		const blending = thrown(() =>
			materials.unlit({ alphaMode: 'blend', blending: 'screen' as unknown as 'normal' }),
		);
		expect(blending.code).toBe('E1217');
		expect(blending.message).toStartWith(
			`E1217: materials.unlit() got the blending "screen"; it takes 'normal', 'additive' or 'multiply'.`,
		);
		const bias = thrown(() => materials.unlit({ depthBias: { slopeScale: Number.NaN } }));
		expect(bias.code).toBe('E1203');
		expect(bias.message).toStartWith('E1203: materials.unlit() got NaN for depthBias.slopeScale.');
		expect(table).toHaveLength(0);
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
			[SHADING_CUSTOM_FIRST, { variants: stripes.variants, locations: [0, 1, 2], textures: 0 }],
			[SHADING_CUSTOM_FIRST + 1, { variants: rings.variants, locations: [0, 1, 2], textures: 0 }],
		]);
	});

	test('refuses the alpha hash and alpha to coverage, which custom materials do not take', () => {
		const { shadings, materials } = fakeCore();
		const wgsl = compiledMaterial();
		const hashed = thrown(() => materials.shader({ wgsl, alphaMode: 'hash' }));
		expect(hashed.code).toBe('E1217');
		expect(hashed.message).toStartWith("E1217: materials.shader() got the alpha mode 'hash';");
		const covered = thrown(() =>
			materials.shader({ wgsl, alphaMode: 'mask', alphaToCoverage: true }),
		);
		expect(covered.message).toStartWith('E1217: materials.shader() got alphaToCoverage;');
		expect(shadings).toEqual([]);
	});

	test('passes a full shader the vertex attributes it reads, without vertex colors', () => {
		const { shadings, sent, materials } = fakeCore();
		const full = {
			...compiledMaterial(),
			functions: [],
			locations: [0, 1, 5],
			attributes: VERTEX_COLOR,
			baseColor: false,
		};
		materials.shader({ wgsl: full, vertexColors: true });
		expect(shadings).toEqual([
			SHADING_CUSTOM_FIRST | (VERTEX_COLOR << SHADING_CUSTOM_ATTRIBUTE_SHIFT),
		]);
		expect(sent).toEqual([
			[SHADING_CUSTOM_FIRST, { variants: {}, locations: [0, 1, 5], textures: 0 }],
		]);
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

/** A texture of the engine core's handle `handle`, with `depth` layers. */
const layered = (handle: number, depth = 1) =>
	new Texture(handle, 4, 4, depth, 'rgba8unorm', 'srgb', 0, undefined as unknown as Textures);

describe('custom material textures', () => {
	const TEXTURES = [
		{ name: 'detail', offset: 31 },
		{ name: 'noise', offset: 30 },
	];

	test('take the map slots in the order the WGSL declares them', () => {
		const { shadings, sent, maps, materials } = fakeCore();
		const wgsl = compiledMaterial([], TEXTURES);
		materials.shader({ wgsl, textures: { noise: layered(7) } });
		materials.shader({ wgsl, textures: { detail: layered(5), noise: layered(6) } });
		expect(shadings).toEqual([
			standardCustom(SHADING_CUSTOM_FIRST) | (2 << SHADING_CUSTOM_TEXTURE_SHIFT),
			standardCustom(SHADING_CUSTOM_FIRST) | (2 << SHADING_CUSTOM_TEXTURE_SHIFT),
		]);
		expect(sent).toEqual([
			[SHADING_CUSTOM_FIRST, { variants: {}, locations: [0, 1, 2], textures: 2 }],
		]);
		expect(maps).toEqual([
			[1, 1, 7, 0],
			[2, 0, 5, 0],
			[2, 1, 6, 0],
		]);
	});

	test('refuse names that the WGSL does not declare, and values that are not one texture', () => {
		const { table, materials } = fakeCore();
		const wgsl = compiledMaterial([], TEXTURES);
		for (const [textures, message] of [
			[
				{ detial: layered(5) },
				"got the texture detial, which the material's WGSL does not declare. Its textures: detail, noise.",
			],
			[
				{ detail: 5 as unknown as Texture },
				'got 5 for the texture detail; it takes a texture of one layer',
			],
			[{ noise: layered(5, 4) }, 'got a texture of 4 layers for the texture noise'],
		] as const) {
			const error = thrown(() => materials.shader({ wgsl, textures }));
			expect(error.code).toBe('E1216');
			expect(error.message).toStartWith(`E1216: materials.shader() ${message}`);
		}
		const none = thrown(() =>
			materials.shader({ wgsl: compiledMaterial(), textures: { detail: layered(5) } }),
		);
		expect(none.message).toContain('Its textures: none.');
		expect(table).toHaveLength(0);
	});
});

describe('material.destroy', () => {
	test('destroys the material in the engine core once, and later calls throw E1101', () => {
		const { destroyed, materials } = fakeCore();
		const paint = materials.standard();
		const custom = materials.shader({ wgsl: compiledMaterial(UNIFORMS) });
		paint.destroy();
		custom.destroy();
		expect(destroyed).toEqual([1, 2]);
		for (const [call, name] of [
			[() => paint.set({ roughness: 0.5 }), 'materials.standard'],
			[() => paint.destroy(), 'materials.standard'],
			[() => custom.set({ speed: 1 }), 'materials.shader'],
			[() => paint.id, 'materials.standard'],
		] as const) {
			const error = thrown(call);
			expect(error.code).toBe('E1101');
			expect(error.message).toStartWith(
				`E1101: a call used a material of ${name}() after its destroy().`,
			);
		}
		expect(destroyed).toEqual([1, 2]);
	});
});
