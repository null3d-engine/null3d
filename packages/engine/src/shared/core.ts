// Loads the engine's WebAssembly core into the current thread. The core is built twice: the
// threaded build imports shared memory, and the single-threaded build defines its own memory.
// The generated wasm-bindgen module is loaded by URL, and `CoreGlue` describes the functions the
// TypeScript side calls, so type checking does not depend on a Rust build.

export type Build = 'threaded' | 'single';

export interface InitOptions {
	module: WebAssembly.Module;
	memory?: WebAssembly.Memory;
	/** Stack size for this thread in bytes, a multiple of 64 KB. */
	thread_stack_size?: number;
}

/** The functions of the generated module that the engine calls. */
export interface CoreGlue {
	initSync(options: InitOptions): unknown;
	engineVersion(): string;
	isThreadedBuild(): boolean;
}

const REQUIRED_FUNCTIONS: readonly (keyof CoreGlue)[] = [
	'initSync',
	'engineVersion',
	'isThreadedBuild',
];

/** Stack size for each engine thread. */
export const THREAD_STACK_BYTES = 1024 * 1024;

export interface MemoryLimits {
	initial: number;
	maximum: number | null;
	shared: boolean;
}

export function coreUrls(build: Build): { glue: URL; wasm: URL; memory: URL } {
	// A computed path, so bundlers leave the URL alone instead of treating it as an asset import.
	const folder = `../../dist/wasm/${build}/`;
	const base = new URL(/* @vite-ignore */ folder, import.meta.url);
	return {
		glue: new URL('sokko3d.js', base),
		wasm: new URL('sokko3d_bg.wasm', base),
		memory: new URL('sokko3d_memory.json', base),
	};
}

/** Imports the generated module for a build and checks that it has every function the engine calls. */
export async function loadGlue(build: Build): Promise<CoreGlue> {
	const glue = (await import(/* @vite-ignore */ coreUrls(build).glue.href)) as Partial<CoreGlue>;
	const missing = REQUIRED_FUNCTIONS.filter((name) => typeof glue[name] !== 'function');
	if (missing.length > 0) {
		throw new Error(
			`the ${build} engine core lacks ${missing.join(', ')}; rebuild it with \`bun run build\``,
		);
	}
	return glue as CoreGlue;
}

/** Instantiates the core in this thread with an already compiled module. */
export async function startCore(
	build: Build,
	module: WebAssembly.Module,
	memory?: WebAssembly.Memory,
): Promise<CoreGlue> {
	const glue = await loadGlue(build);
	glue.initSync(
		build === 'threaded' ? { module, memory, thread_stack_size: THREAD_STACK_BYTES } : { module },
	);
	return glue;
}
