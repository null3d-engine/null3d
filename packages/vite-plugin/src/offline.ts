// The list of a production build's files for offline play. A game's own service worker caches the
// files that a page needs to start, and the files of each feature that the game uses, so the game
// runs with no network after its first visit. Each feature's files download only on its first use,
// so a game that leaves a feature out of its cache leaves out its files, such as the twelve device
// variants of each shader feature or the KTX2 transcoder. A file of the shader builds that need
// several features is listed under each of them.
//
// The plugin knows what each file holds from the bundler: the modules of each chunk and the source
// of each copied file. Vite builds each worker in a bundle of its own, and hands the main bundle
// its files without that knowledge, so a small plugin in each worker build records it. A file's
// group then follows from the files that name it. A page's start takes every file that its pages
// and entry scripts name, directly or through other files, except a feature's own files. A feature
// takes the files that its own files name, except the start's files and other features' files.
// A file that nothing names goes to the start, so a list never leaves out a file a page may need.
import { createHash } from 'node:crypto';
import { posix, relative, resolve, sep } from 'node:path';
import type { Plugin, Rollup } from 'vite';
import { ENGINE_SHADERS_ENV, engineShadersRoot } from './engine-shaders.ts';
import type { Null3dPackage } from './package-files.ts';

/** The file that a production build writes beside the page, with the build's files by group. */
export const FILES_LIST = 'null3d-files.json';

/** The list of a build's files, with paths relative to the build's folder. */
export interface OfflineFiles {
	/** Changes whenever any file of the list does, so a service worker can name its cache after it. */
	version: string;
	/** The files that a page may need to start, its pages and scripts among them. */
	start: string[];
	/** The files that each feature downloads on its first use, by the feature's name. */
	features: Record<string, string[]>;
}

/**
 * The engine's modules that make up the features which are not shader features, by feature, as
 * paths in the engine package. A shader feature's files are the shader modules named after it.
 */
export const FEATURE_MODULES: Readonly<Record<string, readonly string[]>> = {
	gltf: [
		'scene/gltf',
		'workers/gltf-worker',
		'scene/gltf-meshopt',
		'vendor/meshopt/meshopt_decoder.wasm',
		'scene/gltf-draco',
		'vendor/draco/draco_wasm_wrapper_gltf',
		'vendor/draco/draco_decoder_gltf.wasm',
	],
	ktx2: [
		'scene/ktx2',
		'scene/ktx2-file',
		'scene/ktx2-transcode',
		'vendor/basis/basis_transcoder.wasm',
	],
	environment: [
		'scene/environment-file',
		'scene/builtin-environments',
		'scene/panorama',
		'workers/panorama-worker',
		'gpu/environment',
	],
	lut: ['scene/lut-files'],
	sprites: ['scene/sprites'],
	lines: ['scene/lines'],
};

/**
 * A shader module of the engine: the main module, a device module of the start, such as
 * `shaders-glsl-draw-index`, or the module of features, such as `shaders-skinning-wgsl-half` or
 * `shaders-hash-and-skinning-wgsl`.
 */
const SHADER_MODULE =
	/^generated\/shaders-(?:([a-z][a-z0-9-]*?)-)?(?:wgsl|glsl)(?:-(?:draw-index|tone-map|half))*$/;

const FEATURE_OF_MODULE = new Map(
	Object.entries(FEATURE_MODULES).flatMap(([feature, modules]) =>
		modules.map((module) => [module, feature] as const),
	),
);

/**
 * The features whose files hold the engine module `module`, none for a module of the start. A
 * shader feature takes the name that `createEngine`'s `preload` gives it, such as `instance_index`
 * for `shaders-instance-index-wgsl`. The module of the shader builds that need several features
 * belongs to each of them.
 */
export function featuresOf(module: string): string[] {
	const feature = FEATURE_OF_MODULE.get(module);
	if (feature) return [feature];
	const shaders = SHADER_MODULE.exec(module)?.[1];
	return shaders ? shaders.split('-and-').map((name) => name.replaceAll('-', '_')) : [];
}

/**
 * The path of a module in the engine package, as the list's groups name it: from the package's
 * source or built folder, without the extension of a script. Undefined for a file of another
 * package or of the project.
 */
export function engineModule(
	id: string,
	packageOf: (file: string) => Null3dPackage | undefined,
): string | undefined {
	if (id.startsWith('\0')) return undefined;
	const file = id.split('?')[0] ?? id;
	// The engine's generated shader modules come from the set on this machine, or from the folder
	// that names one, not from the package, and keep the names that the engine's files import.
	for (const root of [engineShadersRoot(), process.env[ENGINE_SHADERS_ENV]]) {
		if (!root || !file.startsWith(root + sep)) continue;
		const name = file.slice(file.lastIndexOf(sep) + 1).replace(/\.[cm]?[jt]s$/, '');
		return `generated/${name}`;
	}
	const found = packageOf(file);
	if (found?.name !== '@null3d/engine') return undefined;
	return relative(found.root, file)
		.split(sep)
		.join('/')
		.replace(/^(?:src|lib)\//, '')
		.replace(/\.[cm]?[jt]s$/, '');
}

/** One file of a build, as the list reads it. */
export interface ListedFile {
	fileName: string;
	/** True for a file that a page loads first: an HTML page or an entry script. */
	entry: boolean;
	/** The engine modules that the file holds, as `engineModule` names them. */
	modules: readonly string[];
	/** The files that the file imports statically, which load with it. */
	imports: readonly string[];
	/** The files that the file imports on demand. */
	loads: readonly string[];
	/**
	 * The file's text, when it may name other files: a script, a page or a style sheet. A script's
	 * text leaves out the list of the files that its imports on demand import, which Vite writes
	 * for the browser to fetch beside them: those files load only with their importers.
	 */
	text?: string;
}

/** Files that no page loads: source maps. */
const UNLISTED = /\.map$/;

/** The list of the files of a build. */
export function offlineFiles(files: readonly ListedFile[]): OfflineFiles {
	const listed = files.filter((file) => !UNLISTED.test(file.fileName));
	const byName = new Map(listed.map((file) => [file.fileName, file]));
	const named = namedFiles(listed);
	const fileFeatures = new Map(
		listed.map((file) => [file.fileName, new Set(file.modules.flatMap(featuresOf))]),
	);
	/**
	 * Every file that `from` reaches: each file that a reached file imports, and each that it names
	 * when `enters` lets the walk into that file.
	 */
	const reach = (from: Iterable<string>, enters: (features: Set<string>) => boolean) => {
		const seen = new Set(from);
		for (const name of seen) {
			const file = byName.get(name);
			if (!file) continue;
			for (const next of file.imports) if (byName.has(next)) seen.add(next);
			for (const next of named.get(name) ?? [])
				if (!seen.has(next) && enters(fileFeatures.get(next) ?? new Set())) seen.add(next);
		}
		return seen;
	};
	const start = reach(
		listed.filter((file) => file.entry).map((file) => file.fileName),
		(features) => features.size === 0,
	);
	const features: Record<string, string[]> = {};
	const grouped = new Set(start);
	const allFeatures = [...new Set([...fileFeatures.values()].flatMap((set) => [...set]))].sort();
	for (const feature of allFeatures) {
		const roots = listed.filter((file) => fileFeatures.get(file.fileName)?.has(feature));
		const own = reach(
			roots.map((file) => file.fileName),
			(others) => others.size === 0 || others.has(feature),
		);
		features[feature] = [...own].filter((name) => !start.has(name)).sort();
		for (const name of own) grouped.add(name);
	}
	for (const file of listed) if (!grouped.has(file.fileName)) start.add(file.fileName);
	const list = { start: [...start].sort(), features };
	const version = createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0, 16);
	return { version, ...list };
}

/** The files that each file's text names by their file names, which hold the bundler's hashes. */
function namedFiles(files: readonly ListedFile[]): Map<string, Set<string>> {
	const byBase = new Map<string, string[]>();
	for (const { fileName } of files) {
		const base = posix.basename(fileName);
		byBase.set(base, [...(byBase.get(base) ?? []), fileName]);
	}
	const find = baseNamesIn([...byBase.keys()]);
	const named = new Map<string, Set<string>>();
	for (const file of files) {
		if (file.text === undefined) {
			named.set(file.fileName, new Set(file.loads));
			continue;
		}
		const found = new Set(file.loads);
		for (const base of find(file.text))
			for (const name of byBase.get(base) ?? []) if (name !== file.fileName) found.add(name);
		named.set(file.fileName, found);
	}
	return named;
}

/** A pattern that matches `text` as it stands. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A base name with an extension, from its last dot on. */
const WITH_EXTENSION = /\.[^.]+$/;

/** How many of a base name's last characters index it. */
const TAIL = 16;

/**
 * Finds in a text each of `bases`, the base names of a build's files, wherever it stands: inside a
 * longer name too, as one pattern of every base name finds it. Such a pattern grows with the
 * build's files, and a build holds thousands of shader modules, so in Node it took a quarter of a
 * build of the demos. So, when every name has an extension, the search looks only for the names'
 * extensions. At each, it reads the characters that end there, finds the names with that ending,
 * and checks each of them in place. That finds each name the pattern finds, and a name that
 * overlaps another as well.
 */
export function baseNamesIn(bases: readonly string[]): (text: string) => string[] {
	if (bases.length === 0) return () => [];
	if (!bases.every((base) => WITH_EXTENSION.test(base))) {
		const longestFirst = [...bases].sort((a, b) => b.length - a.length);
		const pattern = new RegExp(longestFirst.map(literal).join('|'), 'g');
		return (text) => [...text.matchAll(pattern)].map(([base]) => base);
	}
	const byTail = new Map<string, string[]>();
	const tails = new Set<number>();
	for (const base of new Set(bases)) {
		const length = Math.min(base.length, TAIL);
		const tail = base.slice(-length);
		tails.add(length);
		byTail.set(tail, [...(byTail.get(tail) ?? []), base]);
	}
	const extensions = [...new Set(bases.map((base) => base.slice(base.lastIndexOf('.'))))].sort(
		(a, b) => b.length - a.length,
	);
	const ends = new RegExp(extensions.map(literal).join('|'), 'g');
	return (text) => {
		const found: string[] = [];
		// An extension may begin another, as .js begins .json, so each one that the match begins
		// ends a name of its own.
		for (const match of text.matchAll(ends))
			for (const extension of extensions) {
				if (!match[0].startsWith(extension)) continue;
				const end = match.index + extension.length;
				for (const length of tails) {
					if (length > end) continue;
					for (const base of byTail.get(text.slice(end - length, end)) ?? [])
						if (base.length <= end && text.startsWith(base, end - base.length)) found.push(base);
				}
			}
		return found;
	};
}

/** What a worker build's file holds, which the main bundle's copy of the file lacks. */
export interface WorkerFile {
	moduleIds: readonly string[];
	imports: readonly string[];
	loads: readonly string[];
	/** True for a script that the worker bundle made, whose text can name other files. */
	chunk: boolean;
}

/**
 * The files that a worker build made and that a file in the bundle still names, but that the
 * bundle lacks, each with the source that the worker copied. Vite drops a worker's files when it
 * reads the worker as dead, even when another file names one of them: a page then fails to
 * download an engine shader module at run time, although the build succeeded. The caller emits
 * these back, so a build's files always hold every file that its files name.
 */
export function missingWorkerAssets(
	bundle: Rollup.OutputBundle,
	workerFiles: ReadonlyMap<string, WorkerFile>,
): { fileName: string; source: string }[] {
	const names = [...workerFiles].flatMap(([fileName, file]) =>
		bundle[fileName] === undefined && !file.chunk ? [fileName] : [],
	);
	if (names.length === 0) return [];
	// Only the files that the bundle lacks are searched for, which costs nothing in a whole build.
	const pattern = new RegExp(
		`${names
			.sort((a, b) => b.length - a.length)
			.map(literal)
			.join('|')}`,
		'g',
	);
	const named = new Set<string>();
	for (const file of Object.values(bundle)) {
		const text =
			file.type === 'chunk' ? file.code : typeof file.source === 'string' ? file.source : '';
		for (const [name] of text.matchAll(pattern)) named.add(name);
	}
	return [...named].flatMap((fileName) => {
		const source = workerFiles.get(fileName)?.moduleIds[0];
		return source === undefined ? [] : [{ fileName, source }];
	});
}

/** A plugin for each worker build that records what each of its files holds, by file name. */
export function workerFilesPlugin(record: Map<string, WorkerFile>): Plugin {
	return {
		name: 'null3d:worker-files',
		generateBundle(_options, bundle) {
			for (const file of Object.values(bundle))
				record.set(
					file.fileName,
					file.type === 'chunk'
						? {
								moduleIds: file.moduleIds,
								imports: file.imports,
								loads: file.dynamicImports,
								chunk: true,
							}
						: { moduleIds: file.originalFileNames, imports: [], loads: [], chunk: false },
				);
		},
	};
}

/** The list of the files that a script's imports on demand import, as Vite writes it. */
const PRELOAD_LIST = /^const __vite__mapDeps=.*?=>i\.map\(i=>d\[i\]\);/;

/** A file's text as UTF-8, when the file is a script, a page or a style sheet. */
function textOf(fileName: string, source: string | Uint8Array): string | undefined {
	if (!/\.(?:[cm]?js|html|css)$/.test(fileName)) return undefined;
	const text = typeof source === 'string' ? source : new TextDecoder().decode(source);
	return text.replace(PRELOAD_LIST, '');
}

/**
 * The files of a client build's bundle as the list reads them, with what the worker builds
 * recorded for the files that they made. A file copied from the engine's source, such as a shader
 * module, holds no script that names another file, so its text is left out; `tables` names the
 * files such a module does load, its kind's shared table of shader paragraphs and one for each
 * feature family whose paragraphs it holds. A module of a feature that loads on first use names
 * them, so the tables join that feature's files and never the start's, which is what keeps a
 * page's first download free of them.
 */
export function listedFiles(
	bundle: Rollup.OutputBundle,
	workerFiles: ReadonlyMap<string, WorkerFile>,
	packageOf: (file: string) => Null3dPackage | undefined,
	root: string,
	tables: ReadonlyMap<string, readonly string[]> = new Map(),
): ListedFile[] {
	const modulesOf = (ids: readonly string[]) =>
		ids.flatMap(
			(id) => engineModule(id.startsWith('\0') ? id : resolve(root, id), packageOf) ?? [],
		);
	return Object.values(bundle).map((file): ListedFile => {
		if (file.type === 'chunk')
			return {
				fileName: file.fileName,
				entry: file.isEntry,
				modules: modulesOf(file.moduleIds),
				imports: file.imports,
				loads: file.dynamicImports,
				text: textOf(file.fileName, file.code),
			};
		const worker = workerFiles.get(file.fileName);
		const modules = modulesOf(worker?.moduleIds ?? file.originalFileNames);
		const copied = !worker?.chunk && modules.length > 0;
		return {
			fileName: file.fileName,
			entry: file.fileName.endsWith('.html'),
			modules,
			imports: worker?.imports ?? [],
			loads: [...(worker?.loads ?? []), ...(tables.get(file.fileName) ?? [])],
			text: copied ? undefined : textOf(file.fileName, file.source),
		};
	});
}
