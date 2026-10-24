// The engine's generated shader builds reach a page as the files that the shared shader build
// wrote, linked into the page's build, instead of passing through the page's own build. A build
// otherwise reads every shader module and writes a copy of it: the set is about six thousand files
// and 2.8 GB, which is most of the memory and time of a page build and none of its code. The
// addresses in the engine's generated modules stay as run-time addresses relative to the script
// that names them, and the files take their place beside that script after the build, so a page
// fetches the same shader it would have fetched from the bundle.
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

/** A shader address as the engine's generated modules write it: `new URL('./shaders-x.js', ...)`. */
const SHADER_URL =
	/new URL\(\s*(['"])\.\/(shaders-[A-Za-z0-9_.-]+\.js)\1\s*,\s*import\.meta\.url\s*\)/g;

/**
 * A file of the shader set that a page loads by address: a device module of a GPU path, a table of
 * builds that need several features, or a table of shared paragraphs. The main module and the
 * feature modules are TypeScript, and a build bundles those as code.
 */
const SHADER_FILE = /^(?:shaders-|shader-paragraphs-)[A-Za-z0-9_.-]*\.js$/;

/**
 * The code of `code` with each shader address that `folder` holds marked so that the bundler leaves
 * it alone, and the files it marked. An address whose file the folder does not hold belongs to
 * another module of the same name, so it stays as it is.
 *
 * @param {string} code
 * @param {string} folder
 * @returns {{ code: string, files: string[] } | undefined}
 */
export function markShaderAddresses(code, folder) {
	/** @type {string[]} */
	const files = [];
	const marked = code.replace(SHADER_URL, (whole, quote, name) => {
		if (!existsSync(join(folder, name))) return whole;
		files.push(name);
		return `new URL(/* @vite-ignore */ ${quote}./${name}${quote}, import.meta.url)`;
	});
	return files.length === 0 ? undefined : { code: marked, files };
}

/**
 * A source map for a module that a transform changed without moving a line: the start of each line
 * names the same line of the same source, and the marker sits inside a line. A shader module holds
 * data, and a reader names its lines, never a column of them.
 *
 * @param {string} id
 * @param {string} code
 * @returns {{ version: 3, sources: string[], names: string[], mappings: string }}
 */
export function lineMap(id, code) {
	const lines = code.split('\n').length;
	// Each line's first column maps to the same column of the same source, and its own line.
	const mappings = lines === 0 ? '' : `AAAA${';AACA'.repeat(lines - 1)}`;
	return { version: 3, sources: [id], names: [], mappings };
}

/**
 * Links `source` at `target`, or copies it when a link cannot be made, such as across two volumes.
 *
 * @param {string} source
 * @param {string} target
 */
function linkOrCopy(source, target) {
	try {
		linkSync(source, target);
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') return;
		copyFileSync(source, target);
	}
}

/**
 * Links the shader files of `folders` into each of `places`, a path from the build's root that
 * holds a script naming one of them. A file that is already in place stays as it is, so a set that
 * several script folders name is written once in each of them.
 *
 * @param {Iterable<string>} folders The shader set's folders.
 * @param {Iterable<string>} places The folders of the scripts that name a shader file.
 * @param {string} out The build's root.
 */
export function linkShaderFiles(folders, places, out) {
	for (const folder of folders) {
		for (const name of readdirSync(folder)) {
			if (!SHADER_FILE.test(name)) continue;
			for (const place of places) {
				const target = join(out, place, name);
				if (existsSync(target)) continue;
				mkdirSync(dirname(target), { recursive: true });
				linkOrCopy(join(folder, name), target);
			}
		}
	}
}

/**
 * A Vite plugin for a page's build that keeps the engine's shader builds out of the bundler. Each
 * shader address that an engine module names gains Vite's ignore marker, so Vite leaves it as it
 * is rather than reading the file and emitting a copy. After the build, the files of the shader set
 * take their place beside each script that names one, which is where the address now finds them.
 * The plugin joins the worker builds too, because each of the engine's workers loads the same files.
 *
 * @returns {import('vite').Plugin}
 */
export function shaderFiles() {
	/** The shader set folders that this build resolved its modules from. */
	const folders = new Set();
	/** The output folders, from the build's root, that hold a script naming a shader file. */
	const scriptFolders = new Set();

	/**
	 * The hooks that both the page's build and each worker build run. A worker build keeps its own
	 * plugin list, so it takes this plugin again and both builds share the two sets above.
	 *
	 * @returns {import('vite').Plugin}
	 */
	const hooks = () => ({
		name: 'null3d:shader-files',
		enforce: 'pre',
		config() {
			return { worker: { plugins: () => [hooks()] } };
		},
		transform: {
			filter: { code: /new URL\(\s*['"]\.\/shaders-/ },
			handler(code, id) {
				const file = id.split('?')[0] ?? id;
				const folder = dirname(file);
				const marked = markShaderAddresses(code, folder);
				if (marked === undefined) return undefined;
				folders.add(folder);
				return { code: marked.code, map: lineMap(file, marked.code) };
			},
		},
		generateBundle(_options, bundle) {
			for (const file of Object.values(bundle)) {
				// A worker's script reaches the page's build as an asset of its own, and it names the
				// same shader files as the page's scripts do.
				const script = file.type === 'chunk' || /\.[cm]?js$/.test(file.fileName);
				if (!script) continue;
				const code = file.type === 'chunk' ? file.code : String(file.source ?? '');
				if (!code.includes('./shaders-')) continue;
				scriptFolders.add(posix.dirname(file.fileName));
			}
		},
		writeBundle(options) {
			if (options.dir === undefined) return;
			linkShaderFiles(folders, scriptFolders, options.dir);
		},
	});

	return hooks();
}
