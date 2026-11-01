// The shader compiler module's calling convention: a call writes its JSON request into the
// module's memory, runs an export, and reads the JSON response. The file is plain JavaScript, so
// a worker thread loads it under every Node version that Vite supports, with no TypeScript step.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * A pointer the module returned, as the offset a typed array takes. A WebAssembly function that
 * returns a 32-bit value gives JavaScript a signed number, so a pointer at or above 2 GB arrives
 * negative and a typed array built from it throws `byteOffset cannot be negative`. The module's own
 * memory passes 2 GB while it builds the engine's manifest, so every pointer it returns is brought
 * back to unsigned here rather than trusted to stay small.
 *
 * @param {number} value
 * @returns {number}
 */
function pointer(value) {
	return value >>> 0;
}

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
	 * A manifest build answers in pieces, because the module keeps no copy of an answer that grows
	 * with the engine: `build` writes the first piece and `build_next` each piece after it, until a
	 * piece comes back empty. This joins them, so a caller of `call` sees one response either way.
	 *
	 * @param {'compile' | 'compile_material' | 'compile_effect' | 'compile_sky_layer' | 'build'} name
	 * @param {string} request
	 * @returns {string}
	 */
	call(name, request) {
		this.instance ??= new WebAssembly.Instance(this.module).exports;
		const wasm = this.instance;
		const bytes = encoder.encode(request);
		// Making room can grow the memory, which replaces its buffer, so the view comes after.
		const at = pointer(wasm.request(bytes.length));
		new Uint8Array(wasm.memory.buffer, at, bytes.length).set(bytes);
		// The memory may grow between pieces, which replaces its buffer, so each view is made from
		// the buffer as it is then.
		const piece = () =>
			decoder.decode(
				new Uint8Array(wasm.memory.buffer, pointer(wasm.response()), wasm.response_length()),
			);
		let response = '';
		let stopped;
		try {
			wasm[name]();
			if (wasm.response_length() !== 0) response = piece();
			// A manifest build's answer arrives in pieces, because the module keeps no copy of an
			// answer that grows with the engine. An empty piece says the answer is complete.
			while (name === 'build' && wasm.response_length() !== 0) {
				wasm.build_next();
				if (wasm.response_length() !== 0) response += piece();
			}
		} catch (error) {
			// A call that stops part way can leave the instance in any state, so the next call makes
			// a new instance. A panic has written its own response first, and a memory request the
			// module could not be given has left its own account of the stop.
			this.instance = undefined;
			stopped = error;
			response = '';
			const notice = wasm.stopped_length();
			if (notice !== 0) {
				response = decoder.decode(
					new Uint8Array(wasm.memory.buffer, pointer(wasm.stopped()), notice),
				);
			}
		}
		if (response !== '') return response;
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
}
