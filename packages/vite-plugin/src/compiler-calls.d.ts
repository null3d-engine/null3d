// Types of `compiler-calls.js`, which stays plain JavaScript so that a worker thread loads it
// with no TypeScript step.

/** Runs the shader compiler's exports, on one instance of its module at a time. */
export declare class CompilerCalls {
	constructor(module: WebAssembly.Module);
	/** The compiled shader compiler. */
	readonly module: WebAssembly.Module;
	/**
	 * Runs one export on a request in JSON, and returns the response in JSON. The first call makes
	 * the instance, and later calls reuse it with the library modules that it composed.
	 */
	call(name: 'compile' | 'compile_material' | 'build', request: string): string;
}
