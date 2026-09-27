// Release builds drop the development checks: the Vite plugin defines the development constant as
// false in production builds, and the bundler removes every check as dead code. This builds the
// scene API both ways and compares.
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import sokko3d from '@sokko3d/vite-plugin';
import { build, type Rollup } from 'vite';

/** The component names of the vector checks, which only the development checks contain. */
const CHECK_CODE = /["']x["'],\s*["']y["'],\s*["']z["'],\s*["']w["']/;
/** The message of the destroyed-object check. */
const LIVE_CHECK = 'which was destroyed in frame ${';

async function bundle(mode: 'production' | 'development'): Promise<string> {
	const output = (await build({
		configFile: false,
		logLevel: 'silent',
		mode,
		plugins: [sokko3d()],
		build: {
			write: false,
			minify: true,
			lib: {
				entry: join(import.meta.dirname, '../scene/scene.ts'),
				formats: ['es'],
				fileName: 'scene',
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
		const [release, development] = await Promise.all([bundle('production'), bundle('development')]);
		expect(development).toMatch(CHECK_CODE);
		expect(release).not.toMatch(CHECK_CODE);
		expect(development).toContain(LIVE_CHECK);
		expect(release).not.toContain(LIVE_CHECK);
		expect(release.length).toBeLessThan(development.length);
		console.log(
			`scene API, minified: ${development.length} bytes with checks, ${release.length} without`,
		);
	}, 60_000);
});
