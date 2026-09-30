// Release builds drop debug drawing: the Vite plugin defines the development constant as false in
// production builds, so the sketch runner makes no debug drawing and the GPU backends define no
// template for its lines. This builds the files that hold them both ways and compares: the sketch
// runner, and the renderer with the GPU backends, each as the engine's own build bundles it.
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import null3d from '@null3d/vite-plugin';
import { build, type Rollup } from 'vite';

const SOURCE = join(import.meta.dirname, '..');

/** Text that only the debug drawing code holds: the warning past a frame's limit of lines. */
const DRAWING_CODE = 'debug lines. This frame left out';
/** Text that only the lines' shader holds: its color input in WGSL and in GLSL. */
const LINES_SHADER = /srgb: vec4<f32>|vec4 srgb;/;

/** The engine's files that debug drawing reaches, each of which a production build keeps whole. */
const ENTRIES = ['sketch/runner.ts', 'render/draw.ts'];

async function bundleOne(entry: string, mode: 'production' | 'development'): Promise<string> {
	const output = (await build({
		configFile: false,
		logLevel: 'silent',
		mode,
		plugins: [null3d()],
		build: {
			write: false,
			minify: true,
			lib: { entry: join(SOURCE, entry), formats: ['es'], fileName: 'entry' },
		},
	})) as Rollup.RollupOutput[];
	return output
		.flatMap((o) => o.output)
		.map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
		.join('\n');
}

async function bundle(mode: 'production' | 'development'): Promise<string> {
	const files = await Promise.all(ENTRIES.map((entry) => bundleOne(entry, mode)));
	return files.join('\n');
}

describe('release builds', () => {
	it('hold none of the debug drawing code and none of its shader', async () => {
		const [release, development] = await Promise.all([bundle('production'), bundle('development')]);
		expect(development).toContain(DRAWING_CODE);
		expect(development).toMatch(LINES_SHADER);
		expect(release).not.toContain(DRAWING_CODE);
		expect(release).not.toMatch(LINES_SHADER);
		console.log(
			`sketch runner and renderer, minified: ${development.length} bytes with debug drawing, ${release.length} without`,
		);
	}, 120_000);
});
