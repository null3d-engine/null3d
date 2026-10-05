// Environments from Radiance (.hdr) and OpenEXR (.exr) files: the loader that
// `assets.loadEnvironment` imports with the first such file, so a page without one downloads none
// of it, nor its worker.
//
// The panorama worker (workers/panorama-worker.ts) reads each file off the sketch's frames, into a
// panorama of shared-exponent texels and its diffuse light. The thread that draws then maps the
// panorama onto the cube and filters it for each roughness, with the built-in room's generator, in
// one submit before the first frame that uses it (D-19, D-66).
//
// Like the KTX2 loader, this module imports no engine module but types and the helper workers'
// registry, so the bundler keeps it in a file of its own. The caller hands it the engine's error
// class.

import type { EngineError } from '../errors/engine-error';
import { onEngineStop } from '../shared/helper-workers';
import type { PanoramaAnswer, PanoramaRequest } from '../workers/panorama-worker';
import type { PanoramaFile } from './panorama-files';

/**
 * The environment map of every HDR file: faces of 256 texels down to 8, as the asset tool's
 * default makes them (D-19).
 */
export const PANORAMA_MAP = { size: 256, levels: 6 } as const;

/**
 * The largest side of a panorama on the GPU: eight texels for each texel across a face, twice the
 * texels around the cube's middle, and the least largest texture that WebGL2 allows. A larger
 * image becomes its averages of squares of texels.
 */
const MAX_SIDE = 8 * PANORAMA_MAP.size;

/** Makes one of the engine's coded errors: the caller's `EngineError`. */
export type PanoramaError = (code: 'E1406' | 'E1412' | 'E1420', message: string) => EngineError;

/** A request that waits for the worker. */
interface Waiting {
	resolve(read: PanoramaFile): void;
	reject(error: EngineError): void;
	address: URL;
	call: string;
}

/**
 * The panorama worker and the requests that wait for it. A worker that fails to start fails every
 * request with E1406, and a later load starts it again.
 */
class Reader {
	private readonly worker: Worker;
	private readonly waiting = new Map<number, Waiting>();
	private next = 0;
	private failed = false;

	constructor(
		private readonly error: PanoramaError,
		private readonly stopped: () => void,
	) {
		this.worker = new Worker(new URL('../workers/panorama-worker.ts', import.meta.url), {
			type: 'module',
			name: 'null3d-panorama',
		});
		this.worker.onmessage = (event: MessageEvent<PanoramaAnswer>) => this.answer(event.data);
		this.worker.onerror = (event) => {
			event.preventDefault();
			this.fail(event.message || 'its script did not load');
		};
	}

	/** Reads a file, which moves to the worker, into a panorama at most `maxSide` on each side. */
	read(file: ArrayBuffer, maxSide: number, address: URL, call: string): Promise<PanoramaFile> {
		const id = ++this.next;
		return new Promise((resolve, reject) => {
			this.waiting.set(id, { resolve, reject, address, call });
			this.worker.postMessage({ id, file, maxSide } satisfies PanoramaRequest, [file]);
		});
	}

	private answer(answer: PanoramaAnswer): void {
		const waiting = this.waiting.get(answer.id);
		if (!waiting) return;
		this.waiting.delete(answer.id);
		if ('read' in answer) waiting.resolve(answer.read);
		else
			waiting.reject(
				this.error(
					'E1412',
					`${waiting.call}() could not read ${waiting.address} as an environment map: ${answer.error}.`,
				),
			);
	}

	/** Fails every waiting request with E1406, or with `reason`'s error, and stops the worker, once. */
	fail(reason: string | EngineError): void {
		if (this.failed) return;
		this.failed = true;
		this.worker.terminate();
		this.stopped();
		for (const { reject, call } of this.waiting.values())
			reject(
				typeof reason === 'string'
					? this.error(
							'E1406',
							`the HDR file reader did not load for ${call}(): ${reason.replace(/\.$/, '')}.`,
						)
					: reason,
			);
		this.waiting.clear();
	}
}

/** This thread's reader, which starts with the first panorama file. */
let reader: Reader | undefined;

/**
 * Starts this thread's reader and its worker, if it has none, so that the worker's script loads
 * while an HDR file downloads.
 */
export function startPanoramaReader(error: PanoramaError): void {
	readerOfThisThread(error);
}

/** This thread's reader, which starts now if it has none. */
function readerOfThisThread(error: PanoramaError): Reader {
	if (!reader) {
		const made: Reader = new Reader(error, () => {
			forget();
			if (reader === made) reader = undefined;
		});
		const forget = onEngineStop(() =>
			made.fail(error('E1420', 'an HDR file was still loading when the engine stopped.')),
		);
		reader = made;
	}
	return reader;
}

/**
 * Reads a Radiance or OpenEXR file, which moves to the panorama worker, into a panorama and its
 * diffuse light. Throws E1412 for a file that the readers refuse, E1406 when the worker does not
 * load, and E1420 when the engine stops first, each made by `error`.
 */
export function readPanoramaFile(
	file: ArrayBuffer,
	address: URL,
	call: string,
	error: PanoramaError,
): Promise<PanoramaFile> {
	return readerOfThisThread(error).read(file, MAX_SIDE, address, call);
}
