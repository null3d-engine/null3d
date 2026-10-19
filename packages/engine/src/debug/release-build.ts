// The helpers that the release checks share. A check builds one of the engine's files for
// production and for development, and compares what each build holds. Each check runs in a process
// of its own, because a build holds the whole engine and its shader text until the process ends.
import { join } from 'node:path';
import null3d from '@null3d/vite-plugin';
import { build, type Rollup } from 'vite';

const SOURCE = join(import.meta.dirname, '..');

/** One build's code, and the files that it copies rather than holds in its code. */
export interface Built {
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
export async function bundleOne(entry: string, mode: 'production' | 'development'): Promise<Built> {
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

/** Whether a build's code, or any file it copied, holds `text`. */
export function holds(build: Built, text: string | RegExp): boolean {
	const found = (where: string) =>
		typeof text === 'string' ? where.includes(text) : text.test(where);
	return found(build.code) || build.files.some(found);
}

/** The bytes a build writes, its code and its copied files together. */
export function sizeOf(build: Built): number {
	return build.code.length + build.files.reduce((sum, file) => sum + file.length, 0);
}
