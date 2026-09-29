// Compiles the engine core once, overlapping the download, and creates the shared memory that every
// thread of the threaded build uses. Workers receive the compiled module, so the browser compiles it
// only once.

import { EngineError } from '../errors/engine-error';
import { type Build, coreUrls, type MemoryLimits } from '../shared/core';

/** The largest shared memory the loader creates by default, until per-preset budgets exist: 1 GiB. */
const DEFAULT_MAXIMUM_MIB = 1024;
/** WebAssembly memory comes in pages of 64 KiB, 16 to a MiB. */
const PAGES_PER_MIB = 16;

export interface LoadedCore {
	build: Build;
	module: WebAssembly.Module;
	memory?: WebAssembly.Memory;
}

/** Downloads one of the core's files whole, or fails with E1406 and the file's path. */
async function download<T>(url: URL, read: (response: Response) => Promise<T>): Promise<T> {
	let response: Response;
	try {
		response = await fetch(url);
	} catch (e) {
		throw new EngineError('E1406', `${url.pathname} did not download: ${(e as Error).message}.`);
	}
	if (!response.ok)
		throw new EngineError('E1406', `${url.pathname} did not download: HTTP ${response.status}.`);
	try {
		return await read(response);
	} catch (e) {
		throw new EngineError(
			'E1406',
			`${url.pathname} did not download whole: ${(e as Error).message}.`,
		);
	}
}

async function compile(url: URL): Promise<WebAssembly.Module> {
	try {
		return await WebAssembly.compileStreaming(fetch(url));
	} catch {
		// Servers that send the wrong content type for .wasm files break streaming compilation.
		return WebAssembly.compile(await download(url, (response) => response.arrayBuffer()));
	}
}

/**
 * The shared memory's declared maximum in pages: `maximumMiB`, within the maximum that the core
 * module declares, and never below the memory's initial size.
 */
export function maximumPages(limits: MemoryLimits, maximumMiB: number): number {
	const wanted = maximumMiB * PAGES_PER_MIB;
	return Math.max(limits.initial, Math.min(limits.maximum ?? wanted, wanted));
}

export async function loadCore(
	build: Build,
	maximumMiB = DEFAULT_MAXIMUM_MIB,
): Promise<LoadedCore> {
	const urls = coreUrls(build);
	if (!urls.memory) return { build, module: await compile(urls.wasm) };
	const [module, limits] = await Promise.all([
		compile(urls.wasm),
		download(urls.memory, (response) => response.json() as Promise<MemoryLimits>),
	]);
	const maximum = maximumPages(limits, maximumMiB);
	return {
		build,
		module,
		memory: new WebAssembly.Memory({ initial: limits.initial, maximum, shared: true }),
	};
}
