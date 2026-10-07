// The shader compiler module's calling convention: a call writes its JSON request into the
// module's memory, runs an export, and reads the JSON response. The file is plain JavaScript, so
// a worker thread loads it under every Node version that Vite supports, with no TypeScript step.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Runs the shader compiler's exports, on one instance of its module at a time. */
export class CompilerCalls {
	/** @param {WebAssembly.Module} module The compiled shader compiler. */
	constructor(module) {
		/** @readonly */
		this.module = module;
		/** @type {any} */
		this.instance = undefined;
	}

	/**
	 * Runs one export on a request in JSON, and returns the response in JSON. The first call makes
	 * the instance, and later calls reuse it with the library modules that it composed.
	 *
	 * @param {'compile' | 'compile_material' | 'compile_effect' | 'build'} name
	 * @param {string} request
	 * @returns {string}
	 */
	call(name, request) {
		this.instance ??= new WebAssembly.Instance(this.module).exports;
		const wasm = this.instance;
		const bytes = encoder.encode(request);
		// Making room can grow the memory, which replaces its buffer, so the view comes after.
		const at = wasm.request(bytes.length);
		new Uint8Array(wasm.memory.buffer, at, bytes.length).set(bytes);
		let stopped;
		try {
			wasm[name]();
		} catch (error) {
			// A call that stops part way can leave the instance in any state, so the next call makes
			// a new instance. A panic has written its own response first.
			this.instance = undefined;
			stopped = error;
		}
		const length = wasm.response_length();
		if (length === 0) {
			return JSON.stringify({
				ok: false,
				problems: [
					{
						file: null,
						line: null,
						column: null,
						feature: null,
						message: `the shader compiler stopped on an internal error, which is a bug in null3D: ${String(stopped)}. Report it with the shader that caused it.`,
						variants: [],
					},
				],
			});
		}
		return decoder.decode(new Uint8Array(wasm.memory.buffer, wasm.response(), length));
	}
}
