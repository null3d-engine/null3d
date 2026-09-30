// Release builds drop the development checks: the Vite plugin defines the development constant as
// false in production builds, and the bundler removes every check as dead code. This builds the
// scene API and the sketch runner, which runs the frame loop, both ways and compares.
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import null3d from '@null3d/vite-plugin';
import { build, type Rollup } from 'vite';

/** The component names of the vector checks, which only the development checks contain. */
const CHECK_CODE = /["']x["'],\s*["']y["'],\s*["']z["'],\s*["']w["']/;
/** The message of the destroyed-object check. */
const LIVE_CHECK = 'which was destroyed in frame ${';
/**
 * Traces of the check for writes to static objects that skip a setter: its message, and the
 * scene's field that holds it, which the runner reads in each frame.
 */
const UNMARKED_TRACES = ['changed without a setter', 'unmarkedWrites'];

async function bundle(module: string, mode: 'production' | 'development'): Promise<string> {
	const output = (await build({
		configFile: false,
		logLevel: 'silent',
		mode,
		plugins: [null3d()],
		build: {
			write: false,
			minify: true,
			lib: {
				entry: join(import.meta.dirname, '..', `${module}.ts`),
				formats: ['es'],
				fileName: module.replace('/', '-'),
			},
		},
	})) as Rollup.RollupOutput[];
	return output
		.flatMap((o) => o.output)
		.map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
		.join('\n');
}

describe('release builds', () => {
	it('drop the development checks and shrink', async () => {
		const [release, development] = await Promise.all([
			bundle('scene/scene', 'production'),
			bundle('scene/scene', 'development'),
		]);
		expect(development).toMatch(CHECK_CODE);
		expect(release).not.toMatch(CHECK_CODE);
		expect(development).toContain(LIVE_CHECK);
		expect(release).not.toContain(LIVE_CHECK);
		expect(release.length).toBeLessThan(development.length);
		console.log(
			`scene API, minified: ${development.length} bytes with checks, ${release.length} without`,
		);
	}, 60_000);

	it('drop the check for writes that skip a setter from the frame loop', async () => {
		const [release, development] = await Promise.all([
			bundle('sketch/runner', 'production'),
			bundle('sketch/runner', 'development'),
		]);
		for (const trace of UNMARKED_TRACES) {
			expect(development).toContain(trace);
			expect(release).not.toContain(trace);
		}
		console.log(
			`sketch runner, minified: ${development.length} bytes with checks, ${release.length} without`,
		);
	}, 60_000);
});
