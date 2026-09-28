// Compiles the engine core once, overlapping the download, and creates the shared memory that every
// thread of the threaded build uses. Workers receive the compiled module, so the browser compiles it
// only once.

import { type Build, coreUrls, type MemoryLimits } from '../shared/core';

/** The largest shared memory the loader creates, in 64 KB pages, until per-preset budgets exist. */
const DEFAULT_MAXIMUM_PAGES = 16384;

export interface LoadedCore {
	build: Build;
	module: WebAssembly.Module;
	memory?: WebAssembly.Memory;
}

async function compile(url: URL): Promise<WebAssembly.Module> {
	try {
		return await WebAssembly.compileStreaming(fetch(url));
	} catch {
		// Servers that send the wrong content type for .wasm files break streaming compilation.
		return WebAssembly.compile(await (await fetch(url)).arrayBuffer());
	}
}

export async function loadCore(
	build: Build,
	maximumPages = DEFAULT_MAXIMUM_PAGES,
): Promise<LoadedCore> {
	const urls = coreUrls(build);
	if (!urls.memory) return { build, module: await compile(urls.wasm) };
	const [module, limits] = await Promise.all([
		compile(urls.wasm),
		fetch(urls.memory).then((r) => r.json() as Promise<MemoryLimits>),
	]);
	const maximum = Math.max(limits.initial, Math.min(limits.maximum ?? maximumPages, maximumPages));
	return {
		build,
		module,
		memory: new WebAssembly.Memory({ initial: limits.initial, maximum, shared: true }),
	};
}
