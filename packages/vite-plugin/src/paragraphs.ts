// The shared tables of shader paragraphs, one for each GPU path. The shader build writes a
// paragraph that many of a target's device modules hold once, in a module of its own beside them,
// and each device module imports that module by a relative path.
//
// A bundler emits a device module as an asset and copies its bytes without reading them, so the
// import survives exactly as the shader build wrote it. Nothing else names the table, so the
// bundler never emits it, and the load fails only in a browser. This plugin reads each copied
// device module's head for that import and emits the table it names, in the folder the bundler put
// the module in, at the name the import uses. The table then sits beside every module that imports
// it, whatever the project's assets folder and asset naming pattern are.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import type { Plugin, Rollup } from 'vite';

/** The import of a table of shared paragraphs, at the top of a device module of its kind. */
const PARAGRAPH_IMPORT = /from '\.\/(shader-paragraphs-[a-z0-9-]+)\.js';/;

/**
 * How much of a copied file this reads for that import. The shader build writes it among the first
 * lines, and a device module is hundreds of kilobytes, so the rest is never read.
 */
const IMPORT_WINDOW = 4096;

/** A file's first bytes as text, enough to hold the import of a table. */
function headOf(source: string | Uint8Array): string {
	if (typeof source === 'string') return source.slice(0, IMPORT_WINDOW);
	return new TextDecoder().decode(source.subarray(0, IMPORT_WINDOW));
}

/**
 * The file of the table that `file` imports, or undefined when the engine's package does not hold
 * it: a table the build did not write, which would otherwise fail as a load in a browser and never
 * in the build.
 */
function tablePath(file: Rollup.OutputAsset, stem: string): string | undefined {
	for (const name of file.originalFileNames) {
		const path = join(dirname(name), `${stem}.js`);
		if (existsSync(path)) return path;
	}
	return undefined;
}

/**
 * Emits each shared table of shader paragraphs beside the copied device modules that import it,
 * and gives the file of the table of each of those modules. A build's bundle is the same after a
 * second call, because a table is emitted once for each folder it belongs in.
 */
export function emitParagraphTables(
	this: Rollup.PluginContext,
	bundle: Rollup.OutputBundle,
): Map<string, string> {
	const tables = new Map<string, string>();
	const emitted = new Set<string>();
	for (const file of Object.values(bundle)) {
		if (file.type !== 'asset') continue;
		const stem = PARAGRAPH_IMPORT.exec(headOf(file.source))?.[1];
		if (!stem) continue;
		const table = posix.join(posix.dirname(file.fileName), `${stem}.js`);
		if (!emitted.has(table)) {
			emitted.add(table);
			const path = tablePath(file, stem);
			if (!path)
				return this.error(
					`null3D: ${file.fileName} imports ${stem}.js, which the engine's shader modules do not hold. Run \`bun run shaders\` again, and reinstall @null3d/engine if the build still fails.`,
				);
			this.emitFile({ type: 'asset', fileName: table, source: readFileSync(path) });
		}
		tables.set(file.fileName, table);
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
	return {
		name: 'null3d:shader-paragraphs',
		generateBundle(_options, bundle) {
			emitParagraphTables.call(this, bundle);
		},
	};
}
