// The size of the shared memory that the threaded core imports. The core declares it, and the build
// raises it when the core's data and stack outgrow a page, so a page that makes the memory reads the
// declared size rather than holding a copy that goes stale.
import { coreUrls, readMemoryLimits } from '@null3d/engine/internal';

let declared: Promise<number> | undefined;

/** The initial size, in 64 KiB pages, that the threaded core declares for its shared memory. */
export function coreInitialPages(): Promise<number> {
	declared ??= read();
	return declared;
}

async function read(): Promise<number> {
	const response = await fetch(coreUrls('threaded').wasm);
	const limits = response.body ? await readMemoryLimits(response.body) : null;
	if (!limits) throw new Error('the threaded core imports no shared memory');
	return limits.initial;
}
