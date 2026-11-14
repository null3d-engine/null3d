import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as gpu from '../../engine/src/generated/gpu';
import {
	buildsOfSet,
	DRAW_INDEX,
	MATERIAL_BUILDS,
	MATERIAL_BUILDS_ADDRESS,
	MaterialBuilds,
	ModuleBuilds,
	SKIN,
	setsOf,
	TONE_MAP,
} from './material-builds';
import { ShaderPack } from './pack';
import type {
	CompiledEffect,
	CompiledMaterial,
	CompiledToneCurve,
	ShaderVariant,
} from './shader-types';

/** Another permutation bit, which no device fixes. */
const SHADOWS = 16;
/** The bit of a shadow caster's builds, which never tone map. */
const CASTER = 1 << 20;

/** A build of one GPU path with the permutation bits of `permutation`. */
const build = (target: 'wgsl' | 'glsl', permutation: number): ShaderVariant => {
	const stage = (kind: string) => ({
		source: `// ${kind} ${permutation}`,
		uniformBlocks: [],
		textures: [],
	});
	return target === 'wgsl'
		? {
				permutation,
				wgsl: {
					source: `// wgsl ${permutation}`,
					pipelines: { main: { vertex: 'vs', fragment: 'fs' } },
				},
				glsl: null,
			}
		: {
				permutation,
				wgsl: null,
				glsl: { main: { vertex: stage('vertex'), fragment: stage('fragment') } },
			};
};

/**
 * The builds of a custom material: every value of the fixed bits, skinning and shadows on each
 * path, and a shadow caster's builds, which have neither tone mapping nor a twin with it.
 */
function builds(): Record<string, ShaderVariant> {
	const all: Record<string, ShaderVariant> = {};
	for (const target of ['wgsl', 'glsl'] as const) {
		const fixed = target === 'wgsl' ? TONE_MAP : TONE_MAP | DRAW_INDEX;
		for (let bits = 0; bits <= (fixed | SKIN | SHADOWS); bits++)
			if ((bits & ~(fixed | SKIN | SHADOWS)) === 0) all[`${target}_${bits}`] = build(target, bits);
		for (const skin of [0, SKIN])
			for (const draw of target === 'glsl' ? [0, DRAW_INDEX] : [0])
				all[`${target}_caster_${skin | draw}`] = build(target, CASTER | skin | draw);
	}
	return all;
}

/** A custom material with `variants`. */
const material = (variants: Record<string, ShaderVariant>): CompiledMaterial => ({
	kind: 'material',
	functions: ['surface'],
	uniforms: [],
	textures: [],
	variants,
	locations: [0, 1, 2],
	attributes: 0,
	baseColor: true,
	objectIds: false,
	sceneDepth: false,
	alpha: false,
});

/** A custom effect with `variants`. */
const effect = (variants: Record<string, ShaderVariant>): CompiledEffect => ({
	kind: 'effect',
	uniforms: [],
	depth: false,
	bloom: false,
	joins: false,
	textures: [],
	variants,
	pieces: { group: {}, fold: {} },
});

/** A custom tone curve with `variants`. */
const curve = (variants: Record<string, ShaderVariant>): CompiledToneCurve => ({
	kind: 'toneCurve',
	variants,
	pieces: { group: {}, fold: {} },
});

/** The folders of the modules that the tests ran. */
const folders: string[] = [];
afterAll(() => {
	for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

describe('the sets of a custom material', () => {
	it("use the engine's permutation bits", () => {
		expect([DRAW_INDEX, TONE_MAP, SKIN]).toEqual([
			gpu.PERMUTATION_DRAW_INDEX,
			gpu.PERMUTATION_TONE_MAP,
			gpu.PERMUTATION_SKIN,
		]);
	});

	it('are 4 for WebGPU and 8 for WebGL2', () => {
		expect(setsOf('wgsl')).toEqual([0, 2, 64, 66]);
		expect(setsOf('glsl')).toEqual([0, 1, 2, 3, 64, 65, 66, 67]);
	});

	it("hold each build that a device's pipeline asks for in the set that it asks for", () => {
		const all = builds();
		for (const target of ['wgsl', 'glsl'] as const) {
			const fixed = target === 'wgsl' ? TONE_MAP : TONE_MAP | DRAW_INDEX;
			const seen = new Set<string>();
			for (const set of setsOf(target)) {
				const held = buildsOfSet(all, target, set);
				for (const [name, kept] of Object.entries(held)) {
					seen.add(name);
					// Each build keeps only the output of its path.
					expect(kept[target === 'wgsl' ? 'glsl' : 'wgsl']).toBeNull();
					expect(kept.permutation & SKIN).toBe(set & SKIN);
				}
			}
			for (const [name, kept] of Object.entries(all)) {
				if (kept[target] === null) continue;
				expect(seen.has(name)).toBe(true);
				// A pipeline of the build's own bits finds it in the set of those bits.
				const set = kept.permutation & (fixed | SKIN);
				expect(buildsOfSet(all, target, set)).toHaveProperty(name);
			}
		}
	});

	it("put a build without a fixed bit, and without a twin that has it, in the bit's sets too", () => {
		const all = builds();
		for (const set of setsOf('glsl')) {
			const names = Object.keys(buildsOfSet(all, 'glsl', set));
			// A shadow caster never tone maps, so every set of its skinning and draw index holds it.
			expect(names).toContain(`glsl_caster_${set & (SKIN | DRAW_INDEX)}`);
			// A build that tone maps has a twin without, so the sets keep them apart.
			expect(names).toContain(`glsl_${set | SHADOWS}`);
			expect(names).not.toContain(`glsl_${(set ^ TONE_MAP) | SHADOWS}`);
			expect(names).toHaveLength(2 + 1);
		}
	});
});

describe("a module's custom materials", () => {
	it('keep no builds in the module, and import each set from a module of its own', async () => {
		const all = builds();
		const pack = new ShaderPack();
		const moduleBuilds = new ModuleBuilds();
		const materialBuilds = new MaterialBuilds();
		const values = [
			moduleBuilds.value(pack, material(all), 'src/a.ts#0'),
			moduleBuilds.value(pack, material({ wgsl_0: build('wgsl', 0) })),
		];
		expect(values.join('')).not.toContain('// wgsl');
		const end = materialBuilds.finish('src/a.ts', moduleBuilds);
		const names = [...end.matchAll(/virtual:null3d\/builds\/(material-[\w-]+)/g)].map(
			(match) => match[1] as string,
		);
		expect(names).toHaveLength(12);
		const folder = mkdtempSync(join(tmpdir(), 'null3d-material-builds-'));
		folders.push(folder);
		for (const name of names) {
			expect(MATERIAL_BUILDS_ADDRESS.test(`\0${MATERIAL_BUILDS}${name}`)).toBe(true);
			writeFileSync(
				join(folder, `${name}.mjs`),
				materialBuilds.module(`\0${MATERIAL_BUILDS}${name}`) ?? '',
			);
		}
		const code = `export default [${values.join(', ')}];\n${pack.unpacker()}${end}`.replaceAll(
			MATERIAL_BUILDS,
			'./',
		);
		const file = join(folder, 'module.mjs');
		writeFileSync(file, code.replace(/\.\/(material-[\w-]+)"/g, './$1.mjs"'));
		const [first, second] = (await import(file)).default as CompiledMaterial[];
		expect(first?.variants).toEqual({});
		expect(first?.hot).toBe('src/a.ts#0');
		expect(first?.permutations).toBe(TONE_MAP | DRAW_INDEX | SKIN | SHADOWS | CASTER);
		for (const target of ['wgsl', 'glsl'] as const)
			for (const set of setsOf(target))
				expect(await first?.builds?.(target, set)).toEqual(buildsOfSet(all, target, set));
		expect(await second?.builds?.('wgsl', 0)).toEqual({ wgsl_0: build('wgsl', 0) });
		expect(await second?.builds?.('glsl', 3)).toEqual({});
	});

	it("drop a module's old sets at its next compile, and keep those another module shares", () => {
		const materialBuilds = new MaterialBuilds();
		const compile = (file: string, permutation: number) => {
			const moduleBuilds = new ModuleBuilds();
			moduleBuilds.value(new ShaderPack(), material({ a: build('wgsl', permutation) }));
			const end = materialBuilds.finish(file, moduleBuilds);
			return [...end.matchAll(/virtual:null3d\/builds\/(material-[\w-]+)/g)].map(
				(match) => `\0${MATERIAL_BUILDS}${match[1]}`,
			);
		};
		const [old] = compile('a.ts', 0);
		compile('b.ts', 0);
		compile('a.ts', SHADOWS);
		expect(materialBuilds.module(old as string)).toBeDefined();
		compile('b.ts', SHADOWS);
		expect(materialBuilds.module(old as string)).toBeUndefined();
	});

	it("keep an effect's and a curve's builds out of the module, in a set for each GPU path", async () => {
		const variants: Record<string, ShaderVariant> = {
			webgpu: build('wgsl', 0),
			webgpu_fxaa: build('wgsl', 256),
			webgl2: build('glsl', 0),
			webgl2_fxaa: build('glsl', 256),
		};
		const pack = new ShaderPack();
		const moduleBuilds = new ModuleBuilds();
		const materialBuilds = new MaterialBuilds();
		const values = [
			moduleBuilds.value(pack, effect(variants)),
			moduleBuilds.value(pack, curve(variants)),
		];
		expect(values.join('')).not.toContain('// wgsl');
		const end = materialBuilds.finish('src/b.ts', moduleBuilds);
		const names = [...end.matchAll(/virtual:null3d\/builds\/((?:effect|curve)-[\w-]+)/g)].map(
			(match) => match[1] as string,
		);
		expect(names).toHaveLength(4);
		expect(names.filter((name) => name.startsWith('effect-'))).toHaveLength(2);
		expect(names.filter((name) => name.startsWith('curve-'))).toHaveLength(2);
		const folder = mkdtempSync(join(tmpdir(), 'null3d-effect-builds-'));
		folders.push(folder);
		for (const name of names) {
			expect(MATERIAL_BUILDS_ADDRESS.test(`\0${MATERIAL_BUILDS}${name}`)).toBe(true);
			writeFileSync(
				join(folder, `${name}.mjs`),
				materialBuilds.module(`\0${MATERIAL_BUILDS}${name}`) ?? '',
			);
		}
		const code = `export default [${values.join(', ')}];\n${pack.unpacker()}${end}`.replaceAll(
			MATERIAL_BUILDS,
			'./',
		);
		const file = join(folder, 'module.mjs');
		writeFileSync(file, code.replace(/\.\/((?:effect|curve)-[\w-]+)"/g, './$1.mjs"'));
		const [effectModule, curveModule] = (await import(file)).default as [
			CompiledEffect,
			CompiledToneCurve,
		];
		for (const shader of [effectModule, curveModule]) {
			expect(shader.variants).toEqual({});
			expect(await shader.builds?.('wgsl', 0)).toEqual({
				webgpu: variants.webgpu as ShaderVariant,
				webgpu_fxaa: variants.webgpu_fxaa as ShaderVariant,
			});
			expect(await shader.builds?.('glsl', 0)).toEqual({
				webgl2: variants.webgl2 as ShaderVariant,
				webgl2_fxaa: variants.webgl2_fxaa as ShaderVariant,
			});
			expect(await shader.builds?.('wgsl', 64)).toEqual({});
		}
	});

	it('keep the pieces of an effect that reads its neighbours, which still starts a group', () => {
		const marker = 'the pieces of an effect that reads the pixels beside its own';
		const piece = {
			permutation: 0,
			wgsl: { items: [marker], run: 'run' },
			glsl: null,
		} as const;
		const pieces = { group: { webgpu: piece }, fold: { webgpu: piece } };
		const variants = { webgpu: build('wgsl', 0), webgl2: build('glsl', 0) };
		const joined = { ...effect(variants), joins: true, pieces };
		const head = { ...effect(variants), joins: false, pieces };
		expect(new ModuleBuilds().value(new ShaderPack(), joined)).toContain(marker);
		expect(new ModuleBuilds().value(new ShaderPack(), head)).toContain(marker);
	});

	it('leave other shaders as the pack gives them, and a module without materials ends with nothing', () => {
		const pack = new ShaderPack();
		const moduleBuilds = new ModuleBuilds();
		const shader = { kind: 'shader', webgpu: build('wgsl', 0), webgl2: null } as const;
		expect(moduleBuilds.value(pack, shader)).toBe(new ShaderPack().value(shader));
		expect(new MaterialBuilds().finish('c.ts', moduleBuilds)).toBe('');
	});
});
