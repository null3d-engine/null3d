// The add-on's selection task, which the engine imports in each job worker. It holds the
// WebAssembly module for the worker, copies the chunk table into the module's memory once, calls
// the module with the camera and the budget, and writes the counts back into the buffer that the
// sketch reads. The selection and its distance sort run in Rust under hard rule 42, so no loop
// over chunks runs in TypeScript in a frame.
//
// The worker keeps the chunk table and the scratch between calls, so a call copies only the few
// numbers that changed and the counts. The module imports nothing, so a worker loads it alone.
//
// The buffer holds a header of `HEADER` floats, then `STRIDE` floats for each chunk, then one float
// for each chunk's chosen count.

/** The floats before the chunks: the count, the budget, the camera, and the answer's total. */
export const HEADER = 8;

/** The floats of each chunk: its centre, its radius and the counts of its four levels. */
export const STRIDE = 8;

/** The place of the chunk count in the header. */
export const CHUNK_COUNT = 0;
/** The place of the budget, the most splats that draw, in the header. */
export const BUDGET = 1;
/** The place of the camera's first number in the header. */
export const EYE = 2;
/** The place of the cloud's bounding radius in the header. */
export const CLOUD_RADIUS = 5;
/** The place of the total that draws in the header. */
export const TOTAL = 6;

/** The number of detail levels of a chunk: every splat, then half, a quarter and an eighth. */
export const LEVELS = 4;

/** The module's exports, as the build writes them. */
interface SplatWasm {
	readonly memory: WebAssembly.Memory;
	/** Chooses each chunk's count; returns the total that draws. */
	readonly splat_select: (params: number) => number;
}

/**
 * One call's input, which the add-on reuses and refills so a call makes no object. `view` is
 * shared with the worker where the page allows a `SharedArrayBuffer`, so its counts land in the
 * add-on's buffer; without one, the worker answers with a copy.
 */
export interface SelectInput {
	/** The selector's number, which names its table and scratch in this worker. */
	readonly id: number;
	/** Changes when the chunk table changes: a new selector, or a new number of chunks. */
	readonly version: number;
	/** The number of chunks. */
	readonly chunks: number;
	/** The most splats that draw. */
	budget: number;
	/** The camera's world position. */
	eyeX: number;
	eyeY: number;
	eyeZ: number;
	/** The whole buffer: the header, the chunk table and the counts. */
	readonly view: Float32Array;
}

/** A call's answer: the total that draws, and the counts when the page shares no memory. */
export interface SelectAnswer {
	/** The number of splats that draw. */
	readonly total: number;
	/** The chosen count of each chunk, when the worker could not write into `view` itself. */
	readonly counts?: Float32Array;
}

/** The module's memory and the arrays that one selector keeps in it. */
interface SelectState {
	version: number;
	chunks: number;
	params: number;
	table: number;
	counts: number;
	distances: number;
	levels: number;
	order: number;
	scratch: number;
}

/** The module, which the worker instantiates at its first task and keeps. */
let wasm: SplatWasm | undefined;
/**
 * The next free byte of the module's memory. The module's first pages hold its shadow stack, which
 * grows down from the top of them, so the add-on's arrays start above them.
 */
let next = 0;
/** The arrays that each selector keeps in this worker, by the input's `id`. */
const states = new Map<number, SelectState>();

/** The bytes of a 64-bit float, and the alignment of one. */
const FLOAT_BYTES = 8;

/** Rounds `value` up to the next multiple of `unit`. */
function align(value: number, unit: number): number {
	return Math.ceil(value / unit) * unit;
}

/** Makes room for `bytes` in the module's memory and returns where it starts. */
function alloc(bytes: number): number {
	const module = wasm as SplatWasm;
	const at = align(next, FLOAT_BYTES);
	next = at + align(bytes, FLOAT_BYTES);
	const have = module.memory.buffer.byteLength;
	if (next > have) module.memory.grow(Math.ceil((next - have) / 65536));
	return at;
}

/** A failure of the module's code or its WebAssembly, which the engine reports at load. */
function loadError(message: string): Error {
	const error = new Error(message);
	error.name = 'TaskLoadError';
	return error;
}

/** Starts the module on its first task in this worker, or fails the task at the load stage. */
function start(module: WebAssembly.Module): SplatWasm {
	try {
		wasm = new WebAssembly.Instance(module).exports as unknown as SplatWasm;
	} catch (e) {
		throw loadError(`the splat selector could not start: ${(e as Error).message}`);
	}
	if (typeof wasm.splat_select !== 'function')
		throw loadError('the splat selector holds no selection call');
	// The module's memory starts with its shadow stack, so the first array goes above all of it.
	next = wasm.memory.buffer.byteLength;
	return wasm;
}

/** True when the typed array's bytes are shared with the thread that sent it. */
function shared(array: ArrayBufferView): boolean {
	return typeof SharedArrayBuffer !== 'undefined' && array.buffer instanceof SharedArrayBuffer;
}

/** Writes a typed array's bytes into the module's memory at `at`. */
function writeBytes(at: number, array: ArrayBufferView): void {
	const module = wasm as SplatWasm;
	const source = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
	new Uint8Array(module.memory.buffer, at, array.byteLength).set(source);
}

/** Reads bytes from the module's memory at `at` into a typed array. */
function readBytes(at: number, array: ArrayBufferView): void {
	const module = wasm as SplatWasm;
	const target = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
	target.set(new Uint8Array(module.memory.buffer, at, array.byteLength));
}

/** The number of 64-bit floats in a call's parameter block. */
const PARAMS = 12;

/** The state that this worker keeps for a selector, which it makes at the first task that names it. */
function stateFor(input: SelectInput): SelectState {
	const kept = states.get(input.id);
	if (kept && kept.version === input.version && kept.chunks === input.chunks) return kept;
	// The chunk table starts at the header of the buffer and holds one row for each chunk.
	const table = input.view.subarray(HEADER, HEADER + input.chunks * STRIDE);
	const state: SelectState = {
		version: input.version,
		chunks: input.chunks,
		params: alloc(PARAMS * FLOAT_BYTES),
		table: alloc(input.chunks * STRIDE * 4),
		counts: alloc(input.chunks * 4),
		distances: alloc(input.chunks * 4),
		levels: alloc(input.chunks),
		order: alloc(input.chunks * 4),
		scratch: alloc(input.chunks * 4),
	};
	writeBytes(state.table, table);
	states.set(input.id, state);
	return state;
}

/** Chooses each chunk's count, writes it into the caller's buffer, and answers the total. */
function select(module: SplatWasm, state: SelectState, input: SelectInput): SelectAnswer {
	// The parameter block, written in place so a call makes no array.
	const params = new Float64Array(module.memory.buffer, state.params, PARAMS);
	params[0] = input.chunks;
	params[1] = input.budget;
	params[2] = input.eyeX;
	params[3] = input.eyeY;
	params[4] = input.eyeZ;
	params[5] = input.view[CLOUD_RADIUS] as number;
	params[6] = state.table;
	params[7] = state.counts;
	params[8] = state.distances;
	params[9] = state.levels;
	params[10] = state.order;
	params[11] = state.scratch;
	const total = module.splat_select(state.params);
	// The counts follow the chunk table in the buffer that the sketch reads.
	if (shared(input.view)) {
		const offset = (HEADER + input.chunks * STRIDE) * 4;
		readBytes(state.counts, new Float32Array(input.view.buffer, offset, input.chunks));
		return { total };
	}
	const copy = new Float32Array(input.chunks);
	readBytes(state.counts, copy);
	return { total, counts: copy };
}

/**
 * Runs one call. The engine calls this once for each task, with the compiled WebAssembly module
 * that the task names.
 */
export function run(
	input: unknown,
	modules: (name: string) => WebAssembly.Module,
): { output: SelectAnswer } {
	const request = input as SelectInput;
	const module = wasm ?? start(modules('splats'));
	const state = stateFor(request);
	return { output: select(module, state, request) };
}
