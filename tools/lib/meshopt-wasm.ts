// meshoptimizer's decoder as a WebAssembly file of its own. The npm package holds its decoder's
// WebAssembly packed into a string inside its JavaScript, which the browser could only compile from
// bytes. The engine compiles each module from a file as it downloads, once per page, so the
// repository keeps the SIMD build of that module as a file in packages/engine/vendor/meshopt. The
// engine needs SIMD, so it ships no build without it. `bun tools/vendor-meshopt.ts` writes the
// file again from the installed package, and a unit test checks that the two still agree.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** The repository's copy of the decoder. */
export const MESHOPT_VENDOR = join(import.meta.dirname, '../../packages/engine/vendor/meshopt');
/** The decoder's file in the copy. */
export const MESHOPT_WASM = 'meshopt_decoder.wasm';

/** The text of a string literal or an array literal that the decoder's source assigns to `name`. */
function assigned(source: string, name: string): string {
	const match = new RegExp(
		`var ${name} =\\s*(?:'([^']*)'|new Uint8Array\\(\\[([^\\]]*)\\]\\))`,
	).exec(source);
	if (!match) throw new Error(`meshopt_decoder.mjs no longer assigns ${name}`);
	return match[1] ?? match[2] ?? '';
}

/**
 * Unpacks the decoder's SIMD module from the source of meshoptimizer's `meshopt_decoder.mjs`, as
 * that file's own `unpack` function does.
 */
export function unpackMeshoptWasm(source: string): Uint8Array {
	const data = assigned(source, 'wasm_simd');
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
	return dirname(require.resolve('meshoptimizer/package.json'));
}

/** The decoder's SIMD module, from the installed package. */
export function installedMeshoptWasm(): Uint8Array {
	return unpackMeshoptWasm(readFileSync(join(meshoptPackage(), 'meshopt_decoder.mjs'), 'utf8'));
}
