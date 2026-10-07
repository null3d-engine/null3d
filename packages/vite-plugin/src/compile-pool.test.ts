import { afterAll, describe, expect, it } from 'bun:test';
import { CompilerPool } from './compile-pool';
import {
	compileMaterial,
	compileShader,
	joinShares,
	type MaterialResult,
	type ShaderProblem,
} from './shader-compiler';

/**
 * `bun run test:shader-compiler` sets this. The module must be built first with `bun run build`,
 * so plain `bun run test` skips the tests that compile.
 */
const ENABLED = process.env.NULL3D_SHADER_COMPILER !== undefined;

const SURFACE = `fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.roughness = fract(input.uv.x * 4.0);
    return s;
}
`;

/** A problem of the tests' material in some builds. */
const problem = (message: string, variants: string[]): ShaderProblem => ({
	file: 'a.wgsl',
	line: 2,
	column: 5,
	feature: null,
	message,
	variants,
});

describe('joinShares', () => {
	it('lists each problem once, with every build of every share that has it', () => {
		const shares: MaterialResult[] = [
			{ ok: false, problems: [problem('one', ['webgl2']), problem('two', [])] },
			{ ok: false, problems: [problem('one', ['webgl2_skin', 'webgl2'])] },
		];
		expect(joinShares(shares)).toEqual({
			ok: false,
			problems: [problem('one', ['webgl2', 'webgl2_skin']), problem('two', [])],
		});
	});

	it('fails when one share fails, with its problems', () => {
		const built = { ok: true, material: {} } as unknown as MaterialResult;
		const failed: MaterialResult = { ok: false, problems: [problem('one', ['webgpu'])] };
		expect(joinShares([built, failed])).toEqual(failed);
	});
});

describe.skipIf(!ENABLED)('the compiler pool', () => {
	const pool = new CompilerPool(3);
	afterAll(() => pool.close());

	it('gives the output of a compile on this thread, for materials split into shares', async () => {
		const path = 'src/stripes.wgsl';
		const pooled = await pool.material({ path, source: SURFACE });
		expect(JSON.stringify(pooled)).toBe(JSON.stringify(compileMaterial({ path, source: SURFACE })));
		const broken = SURFACE.replace('fract(', 'fract(1u, ');
		const problems = await pool.material({ path, source: broken });
		expect(problems.ok).toBe(false);
		const here = compileMaterial({ path, source: broken });
		if (problems.ok || here.ok) throw new Error('the broken material built');
		expect(problems.problems.map((p) => p.message)).toEqual(here.problems.map((p) => p.message));
	});

	it('compiles whole shaders, and many at once', async () => {
		const shader = {
			path: 'a.wgsl',
			source: '@compute @workgroup_size(1) fn main() {}\n',
			variants: { webgpu: { targets: ['wgsl'] as const } },
		};
		const results = await Promise.all([1, 2, 3, 4, 5].map(() => pool.shader(shader)));
		for (const result of results) expect(result).toEqual(compileShader(shader));
	});
});
