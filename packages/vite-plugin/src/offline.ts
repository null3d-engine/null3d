// The list of a production build's files for offline play. A game's own service worker caches the
// files that a page needs to start, and the files of each feature that the game uses, so the game
// runs with no network after its first visit. Each feature's files download only on its first use,
// so a game that leaves a feature out of its cache leaves out its files, such as the twelve device
// variants of each shader feature or the KTX2 transcoder.
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
	],
	ktx2: ['scene/ktx2', 'scene/ktx2-transcode', 'vendor/basis/basis_transcoder.wasm'],
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
 * `shaders-glsl-draw-index`, or the module of a feature, such as `shaders-skinning-wgsl-half`.
 */
const SHADER_MODULE =
	/^generated\/shaders-(?:([a-z][a-z0-9-]*?)-)?(?:wgsl|glsl)(?:-(?:draw-index|tone-map|half))*$/;

const FEATURE_OF_MODULE = new Map(
	Object.entries(FEATURE_MODULES).flatMap(([feature, modules]) =>
		modules.map((module) => [module, feature] as const),
	),
);

/**
 * The feature whose files hold the engine module `module`, or undefined for a module of the start.
 * A shader feature takes the name that `createEngine`'s `preload` gives it, such as
 * `instance_index` for `shaders-instance-index-wgsl`.
 */
export function featureOf(module: string): string | undefined {
	return FEATURE_OF_MODULE.get(module) ?? SHADER_MODULE.exec(module)?.[1]?.replaceAll('-', '_');
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
	const featuresOf = new Map(
		listed.map((file) => [
			file.fileName,
			new Set(file.modules.flatMap((module) => featureOf(module) ?? [])),
		]),
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
				if (!seen.has(next) && enters(featuresOf.get(next) ?? new Set())) seen.add(next);
		}
		return seen;
	};
	const start = reach(
		listed.filter((file) => file.entry).map((file) => file.fileName),
		(features) => features.size === 0,
	);
	const features: Record<string, string[]> = {};
	const grouped = new Set(start);
	const allFeatures = [...new Set([...featuresOf.values()].flatMap((set) => [...set]))].sort();
	for (const feature of allFeatures) {
		const roots = listed.filter((file) => featuresOf.get(file.fileName)?.has(feature));
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
	const pattern = new RegExp(
		[...byBase.keys()]
			.sort((a, b) => b.length - a.length)
			.map((base) => base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			.join('|'),
		'g',
	);
	const named = new Map<string, Set<string>>();
	for (const file of files) {
		if (file.text === undefined) {
			named.set(file.fileName, new Set(file.loads));
			continue;
		}
		const found = new Set(file.loads);
		for (const [base] of file.text.matchAll(pattern))
			for (const name of byBase.get(base) ?? []) if (name !== file.fileName) found.add(name);
		named.set(file.fileName, found);
	}
	return named;
}

/** What a worker build's file holds, which the main bundle's copy of the file lacks. */
export interface WorkerFile {
	moduleIds: readonly string[];
	imports: readonly string[];
	loads: readonly string[];
	/** True for a script that the worker bundle made, whose text can name other files. */
	chunk: boolean;
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
 * module, names no other file, so its text is left out.
 */
export function listedFiles(
	bundle: Rollup.OutputBundle,
	workerFiles: ReadonlyMap<string, WorkerFile>,
	packageOf: (file: string) => Null3dPackage | undefined,
	root: string,
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
			loads: worker?.loads ?? [],
			text: copied ? undefined : textOf(file.fileName, file.source),
		};
	});
}
