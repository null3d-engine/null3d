// The shared tables of shader paragraphs, one for each GPU path. The shader build writes a
// paragraph that many of a target's device modules hold once, in a module of its own beside them,
// and each device module imports that module by a relative path.
//
// A bundler emits a device module as an asset and copies its bytes without reading them, so the
// imports survive exactly as the shader build wrote them. Nothing else names the tables, so the
// bundler never emits them, and the load fails only in a browser. This plugin reads each copied
// device module's imports and emits the tables they name, in the folder the bundler put the module
// in, at the names the imports use. The tables then sit beside every module that imports them,
// whatever the project's assets folder and asset naming pattern are.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';
import type { Plugin, Rollup } from 'vite';

/** An import of a table of shared paragraphs, at the top of a device module of its kind. */
const PARAGRAPH_IMPORT = /from '\.\/(shader-paragraphs-[a-z0-9-]+)\.js';/g;

/**
 * How much of a copied file this reads at first. The shader build writes the imports among the
 * first lines, and a device module is hundreds of kilobytes, so the rest is never read. A device
 * module names a table for each family of paragraphs that it holds, so its imports can run past
 * this much: the reader then takes a larger part of the file, up to the end of its imports.
 */
const IMPORT_WINDOW = 4096;

/** A file's first `bytes` bytes as text. */
function headOf(source: string | Uint8Array, bytes: number): string {
	if (typeof source === 'string') return source.slice(0, bytes);
	return new TextDecoder().decode(source.subarray(0, bytes));
}

/**
 * The names of the paragraph tables that a copied device module imports. A module imports its
 * kind's table and one for each feature family whose paragraphs it holds, so the module of a
 * relief feature imports several. The imports end at the first blank line after them.
 */
function tableStems(source: string | Uint8Array): string[] {
	const length = source.length;
	let window = Math.min(IMPORT_WINDOW, length);
	for (;;) {
		const head = headOf(source, window);
		// A device module's imports follow its short header, so a file with none in the first
		// window is no device module and holds no table.
		const first = head.indexOf('import ');
		if (first < 0) return [];
		const complete = window >= length || head.indexOf('\n\n', first) >= 0;
		if (complete) return [...head.matchAll(PARAGRAPH_IMPORT)].map((match) => match[1] as string);
		window = Math.min(window * 2, length);
	}
}

/**
 * The file of the table that `file` imports, or undefined when the engine's package does not hold
 * it: a table the build did not write, which would otherwise fail as a load in a browser and never
 * in the build.
 */
function tablePath(file: Rollup.OutputAsset, stem: string, root: string): string | undefined {
	for (const name of file.originalFileNames) {
		// A build names a copied file as the page's root sees it, relative or absolute; the table
		// sits beside the file it came from.
		const folder = isAbsolute(name) ? dirname(name) : resolve(root, dirname(name));
		const path = join(folder, `${stem}.js`);
		if (existsSync(path)) return path;
	}
	return undefined;
}

/**
 * Emits each shared table of shader paragraphs beside the copied device modules that import it,
 * and gives the files of the tables of each of those modules. A build's bundle is the same after a
 * second call, because a table is emitted once for each folder it belongs in.
 */
export function emitParagraphTables(
	this: Rollup.PluginContext,
	bundle: Rollup.OutputBundle,
	root = process.cwd(),
): Map<string, string[]> {
	const tables = new Map<string, string[]>();
	const emitted = new Set<string>();
	for (const file of Object.values(bundle)) {
		if (file.type !== 'asset') continue;
		const stems = [...new Set(tableStems(file.source))];
		if (stems.length === 0) continue;
		const own = stems.map((stem) => posix.join(posix.dirname(file.fileName), `${stem}.js`));
		for (const table of own) {
			if (emitted.has(table)) continue;
			emitted.add(table);
			const stem = posix.basename(table, '.js');
			const path = tablePath(file, stem, root);
			if (!path)
				return this.error(
					`null3D: ${file.fileName} imports ${stem}.js, which the engine's shader modules do not hold. Run \`bun run shaders\` again, and reinstall @null3d/engine if the build still fails.`,
				);
			this.emitFile({ type: 'asset', fileName: table, source: readFileSync(path) });
		}
		tables.set(file.fileName, own);
	}
	return tables;
}

/**
 * A plugin for each worker build, which emits the shared tables of shader paragraphs beside the
 * device modules that import them. A worker build copies the engine's device modules as the
 * client build does, so each build emits its own file of the table. The client build does the same
 * through `emitParagraphTables`, and no build emits a table twice.
 */
export function shaderParagraphsPlugin(): Plugin {
	let root = process.cwd();
	return {
		name: 'null3d:shader-paragraphs',
		configResolved(config) {
			root = config.root;
		},
		generateBundle(_options, bundle) {
			emitParagraphTables.call(this, bundle, root);
		},
	};
}
