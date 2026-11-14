// The terrain add-on's task module, which the engine imports in each job worker. It holds the
// module's WebAssembly instance for the worker, copies the add-on's arrays into the module's
// memory, calls its exports, and copies the result back. The worker keeps each terrain's static
// arrays between calls, so only the changing numbers and the result cross a call.
//
// The module holds no engine import, so a worker loads the builder alone. An input holds only
// numbers, typed arrays and plain objects, so it crosses to the worker as it is.

/** The module's exports, as the build writes them. */
interface TerrainWasm {
	readonly memory: WebAssembly.Memory;
	/** Picks the leaves to draw; returns the count, or one more than the capacity. */
	readonly terrain_select: (params: number) => number;
	/** Writes the vertices of `count` blocks; returns 0. */
	readonly terrain_build: (params: number) => number;
}

/** What a call asks the worker to do: select leaves, build blocks, or forget a terrain. */
export type TerrainOp = 'select' | 'build' | 'drop';

/**
 * One call's input, which the add-on reuses and refills so a call makes no object.
 *
 * `heights`, `lows`, `highs`, `ring`, `leaves` and the three output arrays are shared with the
 * worker where the page allows a `SharedArrayBuffer`, so the worker's writes land in the add-on's
 * arrays. Without one, the worker answers with copies and the add-on writes them in.
 */
export interface TerrainInput {
	op: TerrainOp;
	/** The terrain's number, which names its static arrays in this worker. */
	id: number;
	/** Changes when the terrain's arrays change: a new terrain, or a grown selection capacity. */
	version: number;
	/** The width and depth of the ground, in meters. */
	size: number;
	/** The samples along each side of the height field. */
	resolution: number;
	/** The faces along each side of a block's grid. */
	quads: number;
	/** The finest level. */
	maxLevel: number;
	/** The deepest level whose height boxes the add-on keeps. */
	boundLevel: number;
	/** The vertices of one block, the skirt's ring included. */
	vertices: number;
	/** The screen error's scale: device pixels per world meter of one cell. */
	scale: number;
	/** The camera's world position. */
	eyeX: number;
	eyeY: number;
	eyeZ: number;
	/** The most leaves a selection may write. */
	capacity: number;
	/** The most blocks one build writes. */
	batch: number;
	/** The blocks that a build writes, from the start of `buildLeaves`. */
	count: number;
	/** The skirt's depth, or -1 for four of a block's cells. */
	skirt: number;
	/** The blocks that a build writes: their level, column and row, then the next block's. */
	buildLeaves: Int32Array;
	/** The height samples, row by row from the ground's low z. */
	heights: Float32Array;
	/** The lowest height of every block's box, packed level by level. */
	lows: Float32Array;
	/** The highest height of every block's box, packed level by level. */
	highs: Float32Array;
	/** The grid vertices that a block's skirt copies, in draw order. */
	ring: Uint32Array;
	/** Where a selection writes its leaves: level, column and row. */
	leaves: Int32Array;
	/** Where a build writes its blocks' positions. */
	outPositions: Float32Array;
	/** Where a build writes its blocks' normals. */
	outNormals: Float32Array;
	/** Where a build writes its blocks' four-number vertex records. */
	outRecord: Float32Array;
}

/** A call's answer: the count it wrote, and the arrays when the page shares no memory. */
export interface TerrainAnswer {
	count: number;
	leaves?: Int32Array;
	positions?: Float32Array;
	normals?: Float32Array;
	record?: Float32Array;
}

/** The module's memory and the arrays that one terrain keeps in it. */
interface TerrainState {
	version: number;
	params: number;
	heights: number;
	lows: number;
	highs: number;
	ring: number;
	leaves: number;
	positions: number;
	normals: number;
	parents: number;
	record: number;
	capacity: number;
	batch: number;
	vertices: number;
}

/** The module, which the worker instantiates at its first task and keeps. */
let wasm: TerrainWasm | undefined;
/**
 * The next free byte of the module's memory. The module's first pages hold its shadow stack, which
 * grows down from the top of them, so the add-on's arrays start above them.
 */
let next = 0;
/** The arrays that each terrain keeps in this worker, by the input's `id`. */
const states = new Map<number, TerrainState>();

/** The bytes of a 64-bit float, and the alignment of one. */
const FLOAT_BYTES = 8;

/** Rounds `value` up to the next multiple of `unit`. */
function align(value: number, unit: number): number {
	return Math.ceil(value / unit) * unit;
}

/** Makes room for `bytes` in the module's memory and returns where it starts. */
function alloc(bytes: number): number {
	const module = wasm as TerrainWasm;
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
function start(module: WebAssembly.Module): TerrainWasm {
	try {
		wasm = new WebAssembly.Instance(module).exports as unknown as TerrainWasm;
	} catch (e) {
		throw loadError(`the terrain builder could not start: ${(e as Error).message}`);
	}
	if (typeof wasm.terrain_select !== 'function' || typeof wasm.terrain_build !== 'function')
		throw loadError('the terrain builder holds no selection or build call');
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
	const module = wasm as TerrainWasm;
	const source = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
	new Uint8Array(module.memory.buffer, at, array.byteLength).set(source);
}

/** Reads bytes from the module's memory at `at` into a typed array. */
function readBytes(at: number, array: ArrayBufferView): void {
	const module = wasm as TerrainWasm;
	const target = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
	target.set(new Uint8Array(module.memory.buffer, at, array.byteLength));
}

/** Writes a call's parameter block into the module's memory. */
function writeParams(state: TerrainState, values: readonly number[]): void {
	const module = wasm as TerrainWasm;
	const view = new Float64Array(module.memory.buffer, state.params, values.length);
	for (let i = 0; i < values.length; i++) view[i] = values[i] as number;
}

/** The state that this worker keeps for a terrain, which it makes at the first task that names it. */
function stateFor(input: TerrainInput): TerrainState {
	const kept = states.get(input.id);
	if (
		kept &&
		kept.version === input.version &&
		kept.capacity >= input.capacity &&
		kept.batch >= input.batch &&
		kept.vertices === input.vertices
	)
		return kept;
	const state: TerrainState = {
		version: input.version,
		params: alloc(16 * FLOAT_BYTES),
		heights: alloc(input.heights.byteLength),
		lows: alloc(input.lows.byteLength),
		highs: alloc(input.highs.byteLength),
		ring: alloc(input.ring.byteLength),
		leaves: alloc(input.capacity * 3 * 4),
		positions: alloc(input.batch * input.vertices * 3 * 4),
		normals: alloc(input.batch * input.vertices * 3 * 4),
		parents: alloc(input.batch * input.vertices * 4),
		record: alloc(input.batch * input.vertices * 4 * 4),
		capacity: input.capacity,
		batch: input.batch,
		vertices: input.vertices,
	};
	writeBytes(state.heights, input.heights);
	writeBytes(state.lows, input.lows);
	writeBytes(state.highs, input.highs);
	writeBytes(state.ring, input.ring);
	states.set(input.id, state);
	return state;
}

/** Picks the leaves to draw, writes them into the add-on's array, and answers their count. */
function selectLeaves(
	module: TerrainWasm,
	state: TerrainState,
	input: TerrainInput,
): TerrainAnswer {
	writeParams(state, [
		input.size,
		input.scale,
		input.eyeX,
		input.eyeY,
		input.eyeZ,
		input.maxLevel,
		input.quads,
		input.boundLevel,
		input.capacity,
		state.lows,
		state.highs,
		state.leaves,
	]);
	const count = module.terrain_select(state.params);
	// One more than the capacity says the add-on must grow its arrays and ask again.
	if (count > input.capacity) return { count };
	const elements = count * 3;
	if (shared(input.leaves)) {
		readBytes(state.leaves, new Int32Array(input.leaves.buffer, 0, elements));
		return { count };
	}
	const leaves = new Int32Array(elements);
	readBytes(state.leaves, leaves);
	return { count, leaves };
}

/** Writes the vertices of the blocks that the input names, and answers their count. */
function buildBlocks(module: TerrainWasm, state: TerrainState, input: TerrainInput): TerrainAnswer {
	const count = Math.min(input.count, input.batch);
	const elements = count * 3;
	if (shared(input.buildLeaves)) writeBytes(state.leaves, input.buildLeaves);
	else writeBytes(state.leaves, input.buildLeaves.subarray(0, elements));
	writeParams(state, [
		input.size,
		input.quads,
		input.vertices,
		input.resolution,
		input.skirt,
		input.boundLevel,
		count,
		state.heights,
		state.lows,
		state.highs,
		state.ring,
		state.leaves,
		state.positions,
		state.normals,
		state.parents,
		state.record,
	]);
	module.terrain_build(state.params);
	const vertices = count * input.vertices;
	if (shared(input.outPositions)) {
		readBytes(state.positions, new Float32Array(input.outPositions.buffer, 0, vertices * 3));
		readBytes(state.normals, new Float32Array(input.outNormals.buffer, 0, vertices * 3));
		readBytes(state.record, new Float32Array(input.outRecord.buffer, 0, vertices * 4));
		return { count };
	}
	const positions = new Float32Array(vertices * 3);
	const normals = new Float32Array(vertices * 3);
	const record = new Float32Array(vertices * 4);
	readBytes(state.positions, positions);
	readBytes(state.normals, normals);
	readBytes(state.record, record);
	return { count, positions, normals, record };
}

/**
 * Runs one call. The engine calls this once for each task, with the compiled WebAssembly module
 * that the task names.
 */
export function run(
	input: unknown,
	modules: (name: string) => WebAssembly.Module,
): { output: TerrainAnswer } {
	const request = input as TerrainInput;
	if (request.op === 'drop') {
		states.delete(request.id);
		return { output: { count: 0 } };
	}
	const module = wasm ?? start(modules('terrain'));
	const state = stateFor(request);
	const answer =
		request.op === 'select'
			? selectLeaves(module, state, request)
			: buildBlocks(module, state, request);
	return { output: answer };
}
