// The KTX2 transcoder's task, which runs in a job worker, or in the task worker where the engine has
// no job workers (workers/tasks.ts). The on-demand loader sends the transcoder's compiled module
// with the first file, and this module starts the transcoder with it once per worker. Each file is
// ETC1S, UASTC or UASTC HDR data, and the task writes its mip levels in the format that the request
// names, level after level, each level's layers in turn, into one buffer that it hands back. The
// sketch thread chooses that format (scene/ktx2.ts), so the task decides nothing.
//
// The file comes from another thread, so the task reads it itself before the transcoder sees it
// (scene/ktx2-file.ts, the reader that the loader uses too). The transcoder allocates the sizes
// that a file's level index declares, and holds the WebAssembly heap it grew for the rest of the
// worker's life, so a corrupt file must be refused here rather than after that allocation.
//
// The transcoder is the engine's build of Basis Universal v2.50 (packages/engine/vendor/basis,
// tools/build-basis-transcoder.ts), which makes no code from strings, so a strict
// Content-Security-Policy lets it run.

import BASIS, { type BasisModule } from '../../vendor/basis/basis_transcoder.mjs';
import { TaskLoadError, type TaskResult } from '../workers/tasks';
import { ktx2TooLarge, readKtx2Header, targetOfTranscoder, transcodedBytes } from './ktx2-file';

/** The name of the transcoder's WebAssembly module, as the loader sends it. */
export const TRANSCODER_MODULE = 'basis';

/** What the KTX2 loader asks of the task. */
export interface TranscodeRequest {
	file: ArrayBuffer;
	/** The transcoder's name of the format to write. */
	format: string;
	levels: number;
	layers: number;
	/** The widest and tallest texture the device takes, which the loader read the file against. */
	maxSize: number;
}

/** The transcoder of this worker, once it has started. */
let started: Promise<BasisModule> | undefined;

/** Starts the transcoder with its compiled module. A failed start lets the next file try again. */
function start(module: WebAssembly.Module): Promise<BasisModule> {
	started ??= (async () => {
		// The module waits for its instance through a callback alone, so a failure ends the wait here.
		let fail: (error: unknown) => void = () => {};
		const failed = new Promise<never>((_, reject) => {
			fail = reject;
		});
		const basis = await Promise.race([
			BASIS({
				instantiateWasm(imports, receive) {
					WebAssembly.instantiate(module, imports).then(
						(instance) => receive(instance, module),
						fail,
					);
					return {};
				},
			}),
			failed,
		]);
		basis.initializeBasis();
		return basis;
	})().catch((error: unknown): never => {
		started = undefined;
		throw new TaskLoadError(error instanceof Error ? error.message : String(error));
	});
	return started;
}

/** Writes every level and layer that the request asks for into one buffer. */
export async function run(
	input: unknown,
	wasm: (name: string) => WebAssembly.Module,
): Promise<TaskResult> {
	const { file, format, levels, layers, maxSize } = input as TranscodeRequest;
	const bytes = new Uint8Array(file);
	// The file's own counts are read and bounded here, so a corrupt file fails before the transcoder
	// allocates anything from them.
	const header = readKtx2Header(bytes);
	const engineTarget = targetOfTranscoder(format);
	if (!engineTarget) throw new Error(`the engine has no KTX2 format ${format}`);
	const refused = ktx2TooLarge({ ...header, levels, layers }, engineTarget.format, maxSize);
	if (refused) throw new Error(refused);
	const expected = transcodedBytes(
		engineTarget.format,
		header.width,
		header.height,
		levels,
		layers,
	);
	const basis = await start(wasm(TRANSCODER_MODULE));
	const ktx2 = new basis.KTX2File(bytes);
	try {
		if (!ktx2.isValid()) throw new Error('the transcoder could not read the file');
		if (!ktx2.startTranscoding()) throw new Error('the transcoder could not start on the file');
		const code = (basis.transcoder_texture_format[format] as { value: number }).value;
		let total = 0;
		for (let level = 0; level < levels; level++)
			for (let layer = 0; layer < layers; layer++)
				total += ktx2.getImageTranscodedSizeInBytes(level, layer, 0, code);
		// The engine's own count of the texels decides the buffer, so a transcoder that counts
		// differently fails here instead of making the engine allocate what it reports.
		if (total !== expected)
			throw new Error(
				`the transcoder counts ${total} bytes for the file, and its texels take ${expected}`,
			);
		const texels = new Uint8Array(expected);
		let offset = 0;
		for (let level = 0; level < levels; level++)
			for (let layer = 0; layer < layers; layer++) {
				const size = ktx2.getImageTranscodedSizeInBytes(level, layer, 0, code);
				const image = texels.subarray(offset, offset + size);
				if (!ktx2.transcodeImage(image, level, layer, 0, code, 0, -1, -1))
					throw new Error(`the transcoder failed on mip level ${level}, layer ${layer}`);
				offset += size;
			}
		return { output: texels.buffer, transfer: [texels.buffer] };
	} finally {
		ktx2.close();
		ktx2.delete();
	}
}
