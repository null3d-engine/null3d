import { describe, expect, it } from 'bun:test';
import {
	GPU_PATH_EVENT as ENGINE_GPU_PATH_EVENT,
	PERMUTATION_WORD_EVENT as ENGINE_WORD_EVENT,
} from '../../engine/src/shared/permutation-words';
import { WGSL_UPDATE_EVENT as ENGINE_EVENT } from '../../engine/src/shared/wgsl-updates';
import {
	changedLiterals,
	contractOf,
	GPU_PATH_EVENT,
	HotState,
	hotClientCode,
	PERMUTATION_WORD_EVENT,
	UNLISTED_WORD_EVENT,
	UNSHIPPED_PATH_EVENT,
	unshippedPathWarning,
	WGSL_UPDATE_EVENT,
} from './hot';
import type {
	CompiledEffect,
	CompiledMaterial,
	CompiledShader,
	CompiledToneCurve,
} from './shader-types';

/** A script with two tagged literals, whose WGSL the tests change. */
const SCRIPT = `const a = /* wgsl */ \`fn surface() {}\`;
const b = /* wgsl */ \`fn other() {}\`;
export default [a, b];
`;

/** A custom material as the plugin compiles it, with stand-in builds. */
function material(uniforms: CompiledMaterial['uniforms'] = []): CompiledMaterial {
	return {
		kind: 'material',
		functions: ['surface'],
		uniforms,
		textures: [],
		variants: {},
		locations: [0, 1, 2],
		attributes: 0,
		baseColor: true,
		objectIds: false,
		sceneDepth: false,
		alpha: false,
	};
}

describe('changedLiterals', () => {
	it('gives each tagged literal whose WGSL alone changed, with its place', () => {
		const after = SCRIPT.replace('fn other() {}', 'fn other() {\n}');
		const changed = changedLiterals(SCRIPT, after, 'src/sketch.ts');
		expect(changed?.map(({ index, literal }) => [index, literal.source])).toEqual([
			[1, 'fn other() {\n}'],
		]);
		expect(changedLiterals(SCRIPT, SCRIPT, 'src/sketch.ts')).toEqual([]);
	});

	it('is null when the code changed outside the literals, or the literals did', () => {
		const file = 'src/sketch.ts';
		expect(changedLiterals(SCRIPT, SCRIPT.replace('[a, b]', '[b, a]'), file)).toBeNull();
		expect(changedLiterals(SCRIPT, SCRIPT.replace('/* wgsl */ `fn other', '`fn other'), file)).toBe(
			null,
		);
		expect(changedLiterals('const a = 1;', 'const a = 2;', file)).toBeNull();
	});
});

describe('hot state', () => {
	it('swaps a material whose uniforms, textures, vertex inputs and vertex offset stay', () => {
		const hot = new HotState();
		const tint = [{ name: 'tint', type: 'vec3f', offset: 0 }] as const;
		hot.remember('a.wgsl', material(tint));
		expect(hot.swaps('a.wgsl', { ...material(tint), functions: ['surface'] })).toBe(true);
		// A vertex offset that comes or goes changes the material's shadow casters.
		expect(hot.swaps('a.wgsl', { ...material(tint), functions: ['surface', 'vertexOffset'] })).toBe(
			false,
		);
		// A surface alpha that comes or goes changes the material's cut-out builds and the draw
		// list's mask, which the engine fixes when it creates the material.
		expect(hot.swaps('a.wgsl', { ...material(tint), alpha: true })).toBe(false);
		expect(hot.swaps('a.wgsl', material())).toBe(false);
		expect(hot.swaps('a.wgsl', { ...material(tint), locations: [0, 1, 2, 5] })).toBe(false);
		expect(hot.swaps('b.wgsl', material(tint))).toBe(false);
	});

	it('never swaps a whole shader, which code outside the engine draws', () => {
		const shader = { kind: 'shader', webgpu: {}, webgl2: null } as unknown as CompiledShader;
		expect(contractOf(shader)).toBeNull();
		const hot = new HotState();
		hot.remember('a.wgsl', shader);
		expect(hot.swaps('a.wgsl', shader)).toBe(false);
	});

	it('never swaps a custom effect or tone curve, so their edits reload the page', () => {
		const effect = {
			kind: 'effect',
			uniforms: [],
			depth: false,
			variants: {},
		} as unknown as CompiledEffect;
		const curve = { kind: 'toneCurve', variants: {} } as unknown as CompiledToneCurve;
		const hot = new HotState();
		for (const shader of [effect, curve]) {
			expect(contractOf(shader)).toBeNull();
			hot.remember('a.wgsl', shader);
			expect(hot.swaps('a.wgsl', shader)).toBe(false);
		}
	});
});

describe('the hot client', () => {
	it("fires the engine's event with the updates, and closes Vite's overlay", () => {
		expect(WGSL_UPDATE_EVENT).toBe(ENGINE_EVENT);
		const code = hotClientCode(false);
		expect(code).toContain(`import.meta.hot.on("${WGSL_UPDATE_EVENT}"`);
		expect(code).toContain(`new CustomEvent("${WGSL_UPDATE_EVENT}"`);
		expect(code).toContain("querySelectorAll('vite-error-overlay')");
		expect(code).not.toContain(PERMUTATION_WORD_EVENT);
	});

	it("sends the engine's words to the dev server in a project with a shader list", () => {
		expect(PERMUTATION_WORD_EVENT).toBe(ENGINE_WORD_EVENT);
		const code = hotClientCode(true);
		expect(code).toContain(`globalThis.addEventListener("${PERMUTATION_WORD_EVENT}"`);
		expect(code).toContain(`import.meta.hot.send("${PERMUTATION_WORD_EVENT}"`);
		expect(code).toContain(`import.meta.hot.on("${UNLISTED_WORD_EVENT}"`);
		expect(code).toContain('console.warn(');
		// A recording run sends none, because it adds the page's words to the list.
		expect(code).toContain("get('permutations') !== 'record'");
	});

	it("sends each engine's GPU path to the dev server in a build that ships one path", () => {
		expect(GPU_PATH_EVENT).toBe(ENGINE_GPU_PATH_EVENT);
		const code = hotClientCode(false, true);
		expect(code).toContain(`globalThis.addEventListener("${GPU_PATH_EVENT}"`);
		expect(code).toContain(`import.meta.hot.send("${GPU_PATH_EVENT}"`);
		expect(code).toContain(`import.meta.hot.on("${UNSHIPPED_PATH_EVENT}"`);
		// A project that ships both paths asks for none of it.
		expect(hotClientCode(false, false)).not.toContain(GPU_PATH_EVENT);
	});

	it('parses as JavaScript', () => {
		// The page's module parses the same code, so a stray quote or brace would stop it there.
		for (const listed of [false, true])
			for (const paths of [false, true])
				expect(
					() => new Function(hotClientCode(listed, paths).replaceAll('import.meta', 'meta')),
				).not.toThrow();
	});
});

describe("the dev server's GPU path warning", () => {
	it('names the page and the option when the page draws WebGL2', () => {
		const message = unshippedPathWarning('webgl2', '/play', false);
		expect(message).toContain('/play');
		expect(message).toContain("shaders.gpuPaths: ['webgpu']");
		expect(message).toContain('E1308');
	});

	it('says nothing for a path that the build ships', () => {
		expect(unshippedPathWarning('webgl2', '/', true)).toBeUndefined();
		expect(unshippedPathWarning('webgpu', '/', false)).toBeUndefined();
	});
});
