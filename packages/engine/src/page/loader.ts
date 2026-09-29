// Compiles the engine core once, overlapping the download, and creates the shared memory that every
// thread of the threaded build uses. Workers receive the compiled module, so the browser compiles it
// only once.

import { EngineError } from '../errors/engine-error';
import { type Build, coreUrls, type MemoryLimits } from '../shared/core';

/** The largest shared memory the loader creates by default, until per-preset budgets exist: 1 GiB. */
const DEFAULT_MAXIMUM_MIB = 1024;
/** WebAssembly memory comes in pages of 64 KiB, 16 to a MiB. */
const PAGES_PER_MIB = 16;
/**
 * How long to wait before each further try to create the shared memory, in ms: about 3 seconds in
 * all, which covers the time a slow machine takes to free a stopped engine's memory.
 */
export const MEMORY_RETRY_MS: readonly number[] = [50, 100, 200, 400, 800, 1600];

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

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Creates the shared memory, trying again while the browser refuses it. A browser refuses a new
 * shared memory when the address space it keeps for them, or its budget of their pages, is full.
 * A stopped engine's memory counts against both until the engine's workers have finished, which
 * Safari does a moment after the engine stops. So after each refusal the loader waits longer and
 * tries again, for about 3 seconds in all, and a refusal after that fails with E1109. `create` and
 * `pause` stand in for the browser in tests.
 */
export async function createSharedMemory(
	descriptor: WebAssembly.MemoryDescriptor,
	create: (descriptor: WebAssembly.MemoryDescriptor) => WebAssembly.Memory = (d) =>
		new WebAssembly.Memory(d),
	pause: (ms: number) => Promise<void> = wait,
): Promise<WebAssembly.Memory> {
	for (let tries = 1; ; tries++) {
		try {
			return create(descriptor);
		} catch (e) {
			const delay = MEMORY_RETRY_MS[tries - 1];
			if (delay === undefined) {
				const mib = Math.ceil((descriptor.maximum ?? descriptor.initial) / PAGES_PER_MIB);
				throw new EngineError(
					'E1109',
					`the browser refused the engine's shared memory of ${mib} MiB ${tries} times: ${(e as Error).message}.`,
				);
			}
			await pause(delay);
		}
	}
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
		memory: await createSharedMemory({ initial: limits.initial, maximum, shared: true }),
	};
}
