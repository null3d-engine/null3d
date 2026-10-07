// Transcodes the repository's KTX2 test files with a build of the Basis Universal transcoder, into
// every format that the engine asks for, so two builds can be compared byte for byte: the official
// build and the engine's own (tools/build-basis-transcoder.ts, packages/engine/vendor/basis).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The KTX2 test files: ETC1S and UASTC data, written by basisu 2.50. */
export const KTX2_TEST_FILES = join(import.meta.dirname, '../../tests/pages/assets/textures');

/** Every format that the engine's KTX2 loader asks the transcoder for (scene/ktx2.ts). */
export const ENGINE_TARGETS = [
	'cTFASTC_4x4_RGBA',
	'cTFBC7_RGBA',
	'cTFETC1_RGB',
	'cTFETC2_RGBA',
	'cTFRGBA32',
] as const;

/** The parts of the transcoder's module that the comparison calls. */
interface Basis {
	initializeBasis(): void;
	transcoder_texture_format: Record<string, { value: number }>;
	KTX2File: new (
		bytes: Uint8Array,
	) => {
		startTranscoding(): boolean;
		getLevels(): number;
		getImageTranscodedSizeInBytes(
			level: number,
			layer: number,
			face: number,
			format: number,
		): number;
		transcodeImage(
			target: Uint8Array,
			level: number,
			layer: number,
			face: number,
			format: number,
			alpha: number,
			channel0: number,
			channel1: number,
		): boolean;
		close(): void;
		delete(): void;
	};
}

/** Starts a build: an ES module (`.mjs`) or the official build's classic script. */
async function startBuild(script: string, wasm: string): Promise<Basis> {
	const start = (
		script.endsWith('.mjs')
			? (await import(pathToFileURL(script).href)).default
			: createRequire(import.meta.url)(script)
	) as (options: { wasmBinary: Buffer }) => Promise<Basis>;
	const basis = await start({ wasmBinary: readFileSync(wasm) });
	basis.initializeBasis();
	return basis;
}

/**
 * The SHA-256 of what a build writes for each test file and engine format, every mip level in
 * turn, by `<file>/<format>`.
 */
export async function transcodeTestFiles(
	script: string,
	wasm: string,
): Promise<Map<string, string>> {
	const basis = await startBuild(script, wasm);
	const hashes = new Map<string, string>();
	for (const name of readdirSync(KTX2_TEST_FILES)
		.filter((file) => file.endsWith('.ktx2'))
		.sort()) {
		const bytes = new Uint8Array(readFileSync(join(KTX2_TEST_FILES, name)));
		for (const target of ENGINE_TARGETS) {
			const format = (basis.transcoder_texture_format[target] as { value: number }).value;
			const ktx2 = new basis.KTX2File(bytes);
			const hash = createHash('sha256');
			try {
				if (!ktx2.startTranscoding()) throw new Error(`${name}: the transcoder could not start`);
				for (let level = 0; level < ktx2.getLevels(); level++) {
					const out = new Uint8Array(ktx2.getImageTranscodedSizeInBytes(level, 0, 0, format));
					if (!ktx2.transcodeImage(out, level, 0, 0, format, 0, -1, -1))
						throw new Error(`${name}: level ${level} did not transcode to ${target}`);
					hash.update(out);
				}
			} finally {
				ktx2.close();
				ktx2.delete();
			}
			hashes.set(`${name}/${target}`, hash.digest('hex'));
		}
	}
	return hashes;
}
