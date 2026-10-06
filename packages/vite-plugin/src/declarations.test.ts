import { describe, expect, it } from 'bun:test';
import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from '../../../tools/lib/fixture';
import { declarationPath, wgslDeclaration, writeWgslDeclaration } from './declarations';
import type {
	CompiledEffect,
	CompiledMaterial,
	CompiledShader,
	CompiledToneCurve,
} from './shader-types';
import { compileWgslFile } from './wgsl';

/**
 * `bun run test:shader-compiler` sets this. The shader compiler must be built first with
 * `bun run build`, so plain `bun run test` skips the tests that compile.
 */
const ENABLED = process.env.NULL3D_SHADER_COMPILER !== undefined;

/** The repository's root. */
const ROOT = join(import.meta.dirname, '../../..');

/** A custom material with the given uniforms and textures, and nothing else that a declaration reads. */
function material(
	uniforms: CompiledMaterial['uniforms'],
	textures: CompiledMaterial['textures'] = [],
): CompiledMaterial {
	return {
		kind: 'material',
		functions: ['surface'],
		uniforms,
		textures,
		variants: {},
		locations: [],
		attributes: 0,
		baseColor: true,
	};
}

/** A whole shader, with nothing that a declaration reads. */
const SHADER = { kind: 'shader' } as CompiledShader;

/** The comment that starts each declaration of a file named `glow.wgsl`. */
const HEADER = `// The types of glow.wgsl, which the null3D Vite plugin writes when it compiles the file.
// Edit the WGSL, not this file.
`;

describe('wgslDeclaration', () => {
	it('gives a custom material the type of each uniform, in order', () => {
		const uniforms = [
			{ name: 'tint', type: 'vec3f', offset: 0 },
			{ name: 'width', type: 'f32', offset: 3 },
			{ name: 'größe', type: 'u32', offset: 4 },
		] as const;
		expect(wgslDeclaration('/project/src/glow.wgsl', material(uniforms))).toBe(`${HEADER}\
import type { CompiledMaterial } from '@null3d/vite-plugin';

declare const shader: CompiledMaterial<
	{
		readonly tint: 'vec3f';
		readonly width: 'f32';
		readonly "größe": 'u32';
	},
	never
>;
export default shader;
`);
	});

	it('gives a custom material the names of its textures', () => {
		const textures = [
			{ name: 'detail', offset: 31 },
			{ name: 'noise', offset: 30 },
		];
		expect(wgslDeclaration('glow.wgsl', material([], textures))).toContain(
			"declare const shader: CompiledMaterial<Record<never, never>, 'detail' | 'noise'>;",
		);
	});

	it('gives a custom material without uniforms an empty record, which takes no name', () => {
		expect(wgslDeclaration('glow.wgsl', material([]))).toContain(
			'declare const shader: CompiledMaterial<Record<never, never>, never>;',
		);
	});

	it('gives a whole shader its own type', () => {
		expect(wgslDeclaration('glow.wgsl', SHADER)).toBe(`${HEADER}\
import type { CompiledShader } from '@null3d/vite-plugin';

declare const shader: CompiledShader;
export default shader;
`);
	});
});

describe('the declarations of effects and tone curves', () => {
	it('gives an effect the type of each uniform', () => {
		const effect: CompiledEffect = {
			kind: 'effect',
			uniforms: [
				{ name: 'amount', type: 'f32', offset: 0 },
				{ name: 'tint', type: 'vec3f', offset: 4 },
			],
			depth: false,
			joins: true,
			variants: {},
			pieces: { group: {}, fold: {} },
		};
		expect(wgslDeclaration('/project/src/glow.wgsl', effect)).toBe(`${HEADER}\
import type { CompiledEffect } from '@null3d/vite-plugin';

declare const shader: CompiledEffect<{
	readonly amount: 'f32';
	readonly tint: 'vec3f';
}>;
export default shader;
`);
		const plain: CompiledEffect = { ...effect, uniforms: [] };
		expect(wgslDeclaration('glow.wgsl', plain)).toContain(
			'declare const shader: CompiledEffect<Record<never, never>>;',
		);
	});

	it('gives a tone curve its own type', () => {
		const curve: CompiledToneCurve = {
			kind: 'toneCurve',
			variants: {},
			pieces: { group: {}, fold: {} },
		};
		expect(wgslDeclaration('glow.wgsl', curve)).toContain(
			"import type { CompiledToneCurve } from '@null3d/vite-plugin';\n\ndeclare const shader: CompiledToneCurve;",
		);
	});
});

describe('writeWgslDeclaration', () => {
	it('writes the declaration beside the file, and leaves an unchanged one alone', () => {
		const root = fixture({ 'glow.wgsl': '' });
		const file = join(root, 'glow.wgsl');
		const path = declarationPath(file);
		expect(path).toBe(join(root, 'glow.wgsl.d.ts'));
		writeWgslDeclaration(file, SHADER);
		expect(readFileSync(path, 'utf8')).toBe(wgslDeclaration(file, SHADER));
		const past = new Date(2000, 0, 1);
		utimesSync(path, past, past);
		writeWgslDeclaration(file, SHADER);
		expect(statSync(path).mtime).toEqual(past);
		writeWgslDeclaration(file, material([{ name: 'speed', type: 'f32', offset: 0 }]));
		expect(readFileSync(path, 'utf8')).toContain('readonly speed: ');
	});

	it('replaces a declaration that someone edited', () => {
		const root = fixture({ 'glow.wgsl': '' });
		const file = join(root, 'glow.wgsl');
		writeFileSync(declarationPath(file), 'declare const shader: unknown;\n');
		writeWgslDeclaration(file, SHADER);
		expect(readFileSync(declarationPath(file), 'utf8')).toBe(wgslDeclaration(file, SHADER));
	});
});

describe.skipIf(!ENABLED)('the declarations in the repository', () => {
	it('match what the plugin writes for their WGSL files', () => {
		for (const path of [
			'tests/fixtures/typed-uniforms/waves.wgsl',
			'tests/pages/sketches/shaders/tint.wgsl',
		]) {
			const file = join(ROOT, path);
			const compiled = compileWgslFile(path, file, readFileSync(file, 'utf8'));
			if ('error' in compiled) throw new Error(compiled.error.message);
			expect(readFileSync(declarationPath(file), 'utf8')).toBe(
				wgslDeclaration(file, compiled.shader),
			);
		}
	});
});
