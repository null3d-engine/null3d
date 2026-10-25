// The engine's generated shader builds reach a page as the files that the shared shader build
// wrote, linked into the page's build, instead of passing through the page's own build. A build
// otherwise reads every shader module and writes a copy of it: the set is about six thousand files
// and 2.8 GB, which is most of the memory and time of a page build and none of its code. The
// addresses in the engine's generated modules name each file by the set's stamp and stay relative
// to the script that names them. The files take their place beside that script after the build, so
// a page fetches the same shader it would have fetched from the bundle.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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
 * The stamp of the shader set in `folder`: a hash of each of its files' names, sizes and times of
 * change. It changes whenever any file of the set changes, and it costs a listing and a stat of
 * each file, never a read of their bytes. A name that carries it is a name a CDN or a browser may
 * keep: the same set always gives the same name, and another set gives another one.
 *
 * @param {string} folder
 * @returns {string}
 */
export function setStamp(folder) {
	const hash = createHash('sha256');
	for (const name of readdirSync(folder)
		.filter((file) => SHADER_FILE.test(file))
		.sort()) {
		const stat = statSync(join(folder, name));
		hash.update(`${name}\t${stat.size}\t${stat.mtimeMs}\n`);
	}
	return hash.digest('hex').slice(0, 8);
}

/**
 * The name that the file `name` of the shader set carries in a build: its own name with the
 * set's stamp before the extension, as a bundler names a file that a page may keep.
 *
 * @param {string} name
 * @param {string} stamp
 * @returns {string}
 */
export function shaderFileName(name, stamp) {
	return name.replace(/\.js$/, `-${stamp}.js`);
}

/**
 * The code of `code` with each shader address that `folder` holds marked so that the bundler leaves
 * it alone, and the files it marked. The address names the file by the set's stamp, so a page that
 * keeps it keeps the set it came from. An address whose file the folder does not hold belongs to
 * another module of the same name, so it stays as it is.
 *
 * @param {string} code
 * @param {string} folder
 * @param {string} stamp
 * @returns {{ code: string, files: string[] } | undefined}
 */
export function markShaderAddresses(code, folder, stamp) {
	/** @type {string[]} */
	const files = [];
	const marked = code.replace(SHADER_URL, (whole, quote, name) => {
		if (!existsSync(join(folder, name))) return whole;
		files.push(name);
		const named = shaderFileName(name, stamp);
		return `new URL(/* @vite-ignore */ ${quote}./${named}${quote}, import.meta.url)`;
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
 * holds a script naming one of them. A file that a script names takes the set's stamp in its name,
 * and every other file keeps the name its own module imports it by, such as a table of shared
 * paragraphs. A file that is already in place stays as it is, so a set that several script folders
 * name is written once in each of them.
 *
 * @param {Iterable<string>} folders The shader set's folders.
 * @param {Iterable<string>} places The folders of the scripts that name a shader file.
 * @param {string} out The build's root.
 * @param {ReadonlySet<string>} named The paths of the files that a script names.
 * @param {ReadonlyMap<string, string>} stamps The set's stamp, by folder.
 */
export function linkShaderFiles(folders, places, out, named, stamps) {
	for (const folder of folders) {
		const stamp = stamps.get(folder) ?? '';
		for (const name of readdirSync(folder)) {
			if (!SHADER_FILE.test(name)) continue;
			const path = join(folder, name);
			const target = named.has(path) ? shaderFileName(name, stamp) : name;
			for (const place of places) {
				const file = join(out, place, target);
				if (existsSync(file)) continue;
				mkdirSync(dirname(file), { recursive: true });
				linkOrCopy(path, file);
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
	/** The paths of the shader files that a script names, which take the set's stamp in their names. */
	const named = new Set();
	/** The set's stamp, by folder, so a folder is read once per build. */
	const stamps = new Map();
	/** The output folders, from the build's root, that hold a script naming a shader file. */
	const scriptFolders = new Set();

	/**
	 * The stamp of the set in `folder`, read once for this build.
	 *
	 * @param {string} folder
	 * @returns {string}
	 */
	const stampOf = (folder) => {
		let stamp = stamps.get(folder);
		if (stamp === undefined) {
			stamp = setStamp(folder);
			stamps.set(folder, stamp);
		}
		return stamp;
	};

	/**
	 * The hooks that both the page's build and each worker build run. A worker build keeps its own
	 * plugin list, so it takes this plugin again and both builds share the sets and stamps above.
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
				const marked = markShaderAddresses(code, folder, stampOf(folder));
				if (marked === undefined) return undefined;
				folders.add(folder);
				for (const name of marked.files) named.add(join(folder, name));
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
			linkShaderFiles(folders, scriptFolders, options.dir, named, stamps);
		},
	});

	return hooks();
}
