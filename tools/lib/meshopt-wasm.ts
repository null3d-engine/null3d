// meshoptimizer's WebAssembly modules as files of their own. The npm package holds each module
// packed into a string inside its JavaScript, which the browser could only compile from bytes. The
// engine compiles each module from a file as it downloads, once per page, so the repository keeps
// the modules that the engine runs as files in packages/engine/vendor/meshopt: the SIMD build of
// the decoder, which the glTF loader runs, and the simplifier and the encoder, whose simplify and
// vertex cache calls the level planner runs on the job workers. The engine needs SIMD, so it ships
// no decoder without it; the simplifier and the encoder come in one build. `bun
// tools/vendor-meshopt.ts` writes the files again from the installed package, and a unit test
// checks that they still agree.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** The repository's copy of the modules. */
export const MESHOPT_VENDOR = join(import.meta.dirname, '../../packages/engine/vendor/meshopt');
/** The decoder's file in the copy. */
export const MESHOPT_WASM = 'meshopt_decoder.wasm';

/**
 * Each module that the engine keeps: its file in the copy, the package's script that packs it, and
 * the name that the script gives the packed module.
 */
export const MESHOPT_MODULES = [
	{ file: MESHOPT_WASM, script: 'meshopt_decoder.mjs', packed: 'wasm_simd' },
	{ file: 'meshopt_simplifier.wasm', script: 'meshopt_simplifier.js', packed: 'wasm' },
	{ file: 'meshopt_encoder.wasm', script: 'meshopt_encoder.js', packed: 'wasm' },
	{ file: 'meshopt_clusterizer.wasm', script: 'meshopt_clusterizer.js', packed: 'wasm' },
] as const;

/** The text of a string literal or an array literal that a module's script assigns to `name`. */
function assigned(source: string, name: string): string {
	const match = new RegExp(
		`var ${name} =\\s*(?:'([^']*)'|new Uint8Array\\(\\[([^\\]]*)\\]\\))`,
	).exec(source);
	if (!match) throw new Error(`meshoptimizer's script no longer assigns ${name}`);
	return match[1] ?? match[2] ?? '';
}

/**
 * Unpacks the module that a meshoptimizer script packs under `packed`, as the script's own
 * `unpack` function does: the decoder's SIMD module by default.
 */
export function unpackMeshoptWasm(source: string, packed = 'wasm_simd'): Uint8Array {
	const data = assigned(source, packed);
	const pack = assigned(source, 'wasmpack')
		.split(',')
		.map((value) => Number(value.trim()));
	const result = new Uint8Array(data.length);
	for (let i = 0; i < data.length; i++) {
		const ch = data.charCodeAt(i);
		result[i] = ch > 96 ? ch - 97 : ch > 64 ? ch - 39 : ch + 4;
	}
	let write = 0;
	for (let i = 0; i < data.length; i++) {
		const value = result[i] as number;
		result[write++] =
			value < 60 ? (pack[value] as number) : (value - 60) * 64 + (result[++i] as number);
	}
	return result.slice(0, write);
}

/** The installed package's folder, as the engine resolves it. */
export function meshoptPackage(): string {
	const require = createRequire(join(import.meta.dirname, '../../packages/engine/package.json'));
	// The package's entry sits at its root. Node refuses its package.json, which its exports leave
	// out.
	return dirname(require.resolve('meshoptimizer'));
}

/** The module kept as `file`, from the installed package: the decoder's SIMD module by default. */
export function installedMeshoptWasm(file: string = MESHOPT_WASM): Uint8Array {
	const module = MESHOPT_MODULES.find((entry) => entry.file === file);
	if (!module) throw new Error(`the engine keeps no meshoptimizer module ${file}`);
	return unpackMeshoptWasm(
		readFileSync(join(meshoptPackage(), module.script), 'utf8'),
		module.packed,
	);
}
