import { describe, expect, it } from 'bun:test';
import { WGSL_UPDATE_EVENT as ENGINE_EVENT } from '../../engine/src/shared/wgsl-updates';
import { changedLiterals, contractOf, HOT_CLIENT_CODE, HotState, WGSL_UPDATE_EVENT } from './hot';
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
	it('swaps a material whose uniforms, textures and vertex inputs stay', () => {
		const hot = new HotState();
		const tint = [{ name: 'tint', type: 'vec3f', offset: 0 }] as const;
		hot.remember('a.wgsl', material(tint));
		expect(hot.swaps('a.wgsl', { ...material(tint), functions: ['surface', 'vertexOffset'] })).toBe(
			true,
		);
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
		const effect = { kind: 'effect', uniforms: [], depth: false, variants: {} } as CompiledEffect;
		const curve = { kind: 'toneCurve', variants: {} } as CompiledToneCurve;
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
		expect(HOT_CLIENT_CODE).toContain(`import.meta.hot.on("${WGSL_UPDATE_EVENT}"`);
		expect(HOT_CLIENT_CODE).toContain(`new CustomEvent("${WGSL_UPDATE_EVENT}"`);
		expect(HOT_CLIENT_CODE).toContain("querySelectorAll('vite-error-overlay')");
	});
});
