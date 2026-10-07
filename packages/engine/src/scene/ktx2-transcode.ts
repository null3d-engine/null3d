// The KTX2 transcoder's task, which runs in a job worker, or in the task worker where the engine has
// no job workers (workers/tasks.ts). The on-demand loader sends the transcoder's compiled module
// with the first file, and this module starts the transcoder with it once per worker. Each file is
// ETC1S or UASTC data, and the task writes its mip levels in the format that the request names,
// level after level, each level's layers in turn, into one buffer that it hands back. The sketch
// thread reads the file's header and picks the format (scene/ktx2.ts), so the task decides nothing.
//
// The transcoder is the engine's build of Basis Universal v2.50 (packages/engine/vendor/basis,
// tools/build-basis-transcoder.ts), which makes no code from strings, so a strict
// Content-Security-Policy lets it run.

import BASIS, { type BasisModule } from '../../vendor/basis/basis_transcoder.mjs';
import { TaskLoadError, type TaskResult } from '../workers/tasks';

/** The name of the transcoder's WebAssembly module, as the loader sends it. */
export const TRANSCODER_MODULE = 'basis';

/** What the KTX2 loader asks of the task. */
export interface TranscodeRequest {
	file: ArrayBuffer;
	/** The transcoder's name of the format to write. */
	format: string;
	levels: number;
	layers: number;
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
	const { file, format, levels, layers } = input as TranscodeRequest;
	const basis = await start(wasm(TRANSCODER_MODULE));
	const ktx2 = new basis.KTX2File(new Uint8Array(file));
	try {
		if (!ktx2.isValid()) throw new Error('the transcoder could not read the file');
		if (!ktx2.startTranscoding()) throw new Error('the transcoder could not start on the file');
		const target = (basis.transcoder_texture_format[format] as { value: number }).value;
		let total = 0;
		for (let level = 0; level < levels; level++)
			for (let layer = 0; layer < layers; layer++)
				total += ktx2.getImageTranscodedSizeInBytes(level, layer, 0, target);
		const texels = new Uint8Array(total);
		let offset = 0;
		for (let level = 0; level < levels; level++)
			for (let layer = 0; layer < layers; layer++) {
				const size = ktx2.getImageTranscodedSizeInBytes(level, layer, 0, target);
				const image = texels.subarray(offset, offset + size);
				if (!ktx2.transcodeImage(image, level, layer, 0, target, 0, -1, -1))
					throw new Error(`the transcoder failed on mip level ${level}, layer ${layer}`);
				offset += size;
			}
		return { output: texels.buffer, transfer: [texels.buffer] };
	} finally {
		ktx2.close();
		ktx2.delete();
	}
}
