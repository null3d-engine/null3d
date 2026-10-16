// Release builds drop debug drawing and the debug views: the Vite plugin defines the development
// constant as false in production builds, so the sketch runner makes no debug drawing and the GPU
// backends define no template for its lines or its views. This builds the files that hold them both ways and compares: the sketch
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
/** Text that only the debug views' shader holds: the function of the depth view's gray. */
const VIEWS_SHADER = 'depth_gray';

/** The engine's files that debug drawing reaches, each of which a production build keeps whole. */
const ENTRIES = ['sketch/runner.ts', 'render/draw.ts'];

/** One build's code, and the files that it copies rather than holds in its code. */
interface Built {
	/** The code of every chunk the build wrote. */
	code: string;
	/** The text of every file the build copied beside its code, such as the device's shaders. */
	files: string[];
}

/**
 * Builds one of the engine's files for production or development.
 *
 * The build is the page's, not a library's, and it keeps the entry's exports as a library build
 * does. A library build copies nothing as a file: it inlines every one as a data URL, and the
 * development build's shaders alone are about 850 MB of them, which no machine running this suite
 * should hold at once.
 */
async function bundleOne(entry: string, mode: 'production' | 'development'): Promise<Built> {
	const built = await build({
		configFile: false,
		logLevel: 'silent',
		mode,
		plugins: [null3d()],
		build: {
			write: false,
			minify: true,
			rollupOptions: {
				input: join(SOURCE, entry),
				output: { format: 'es' },
				preserveEntrySignatures: 'strict',
			},
		},
	});
	const output = (Array.isArray(built) ? built : [built]) as Rollup.RollupOutput[];
	const parts = output.flatMap((o) => o.output);
	return {
		code: parts.map((part) => (part.type === 'chunk' ? part.code : '')).join('\n'),
		files: parts
			.filter((part): part is Rollup.OutputAsset => part.type === 'asset')
			.map((part) => String(part.source)),
	};
}

async function bundle(mode: 'production' | 'development'): Promise<Built[]> {
	const builds: Built[] = [];
	for (const entry of ENTRIES) builds.push(await bundleOne(entry, mode));
	return builds;
}

/** Whether a build's code, or any file it copied, holds `text`. */
function holds(builds: Built[], text: string | RegExp): boolean {
	const found = (where: string) =>
		typeof text === 'string' ? where.includes(text) : text.test(where);
	return builds.some((build) => found(build.code) || build.files.some(found));
}

/** The bytes a build writes, its code and its copied files together. */
function sizeOf(builds: Built[]): number {
	return builds.reduce(
		(total, build) =>
			total + build.code.length + build.files.reduce((sum, file) => sum + file.length, 0),
		0,
	);
}

describe('release builds', () => {
	it('hold none of the debug drawing code and none of its shaders', async () => {
		const release = await bundle('production');
		const development = await bundle('development');
		expect(holds(development, DRAWING_CODE)).toBe(true);
		expect(holds(development, LINES_SHADER)).toBe(true);
		expect(holds(development, VIEWS_SHADER)).toBe(true);
		expect(holds(release, DRAWING_CODE)).toBe(false);
		expect(holds(release, LINES_SHADER)).toBe(false);
		expect(holds(release, VIEWS_SHADER)).toBe(false);
		console.log(
			`sketch runner and renderer, minified: ${sizeOf(development)} bytes with debug drawing, ${sizeOf(release)} without`,
		);
	}, 120_000);
});
