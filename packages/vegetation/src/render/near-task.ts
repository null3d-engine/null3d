// The near task's module, which the engine imports in each job worker. It holds the near task's
// WebAssembly instance for the worker (crates/null3d-vegetation-wasm), copies the scene's arrays into
// the module's memory, calls its export, and copies the result into the page's output buffer.
//
// The scene's arrays change only when a page places or removes plants, so the worker keeps them by
// the scene's id and version, and a call that finds them in place copies only the camera and the
// caps. Where the page shares its output buffer with the workers, the worker writes into it; without
// shared memory, it answers with a copy that the page writes in.
//
// The module holds no engine import, so a worker loads the task alone. An input holds only numbers,
// typed arrays and plain objects, so it crosses to the worker as it is.

/** The module's exports, as the build writes them. */
interface NearWasm {
	readonly memory: WebAssembly.Memory;
	/** Composes the near rows; returns the rows it wrote. */
	readonly near_compose: (params: number) => number;
}

/** Floats in the parameter block, as the crate's `PARAM_*` lay it out. */
export const PARAM_FLOATS = 20;
/** Floats in one group's block, as the crate's `GROUP_*` lay it out. */
export const GROUP_FLOATS = 24;
/** A group's block: where each scalar goes and where the worker writes each array's address. */
export const GROUP = {
	split: 0,
	tierCount: 1,
	tier: 2,
	bandStart: 5,
	bandEnd: 8,
	copyCount: 11,
	copies: 12,
	cardRows: 13,
	cardBase: 14,
	variantCount: 15,
	variants: 16,
	rowFloats: 17,
	rowWords: 18,
	prototypeCount: 19,
	prototypes: 20,
	batchBase: 21,
	table: 22,
	firstSlot: 23,
} as const;
/** The 32-bit floats of a copy, a variant, a row and a prototype, and the 32-bit words of a row. */
export const COPY_FLOATS = 10;
export const VARIANT_FLOATS = 8;
export const ROW_FLOATS = 8;
export const ROW_WORDS = 2;
export const PROTOTYPE_FLOATS = 5;
/** The 32-bit floats of one species' near table: sixteen slots of two texels. */
export const TABLE_FLOATS = 128;
/** The figures a call writes: triangles drawn, copies chosen, the budget's cut (-1 for none), rows. */
export const SUMMARY_FLOATS = 4;
/** The most copies a call chooses, which a near table's slots hold. */
export const MAX_NEAR = 16;
/** The most tier bands one species takes. */
export const MAX_TIERS = 3;

/**
 * The arrays of one placed species, in the order the worker copies them: its copies, each copy's
 * card row, its variants, its rows' floats and words, and its prototypes.
 */
export type GroupArrays = readonly [
	Float32Array,
	Uint32Array,
	Float32Array,
	Float32Array,
	Uint32Array,
	Float32Array,
];

/** The arrays of every placed species, which change only when the page places or removes plants. */
export interface NearScene {
	/** `GROUP_FLOATS` numbers per species: its scalars, with zero in each address. */
	readonly groups: Float64Array;
	/** Each species' arrays. */
	readonly arrays: readonly GroupArrays[];
	/** Each batch's first row in the output and its capacity. */
	readonly batches: Uint32Array;
	/** Rows across every batch. */
	readonly rows: number;
	/** Near tables, one per species' kit. */
	readonly tables: number;
	/** Card rows across every species. */
	readonly cards: number;
}

/** Where each part of the output lies in its buffer, in bytes. */
export interface NearLayout {
	readonly summary: number;
	readonly counts: number;
	readonly positions: number;
	readonly rotations: number;
	readonly scales: number;
	readonly values: number;
	readonly tables: number;
	readonly cardValues: number;
	readonly bytes: number;
}

/** The output buffer's layout for a scene: the figures, then the counts, then every float array. */
export function nearLayout(
	scene: Pick<NearScene, 'rows' | 'tables' | 'cards' | 'batches'>,
): NearLayout {
	const summary = 0;
	const counts = SUMMARY_FLOATS * 8;
	const batches = scene.batches.length / 2;
	const positions = counts + Math.ceil((batches * 4) / 8) * 8;
	const rotations = positions + scene.rows * 3 * 4;
	const scales = rotations + scene.rows * 4 * 4;
	const values = scales + scene.rows * 3 * 4;
	const tables = values + scene.rows * 4 * 4;
	const cardValues = tables + scene.tables * TABLE_FLOATS * 4;
	const bytes = cardValues + scene.cards * 4 * 4;
	return { summary, counts, positions, rotations, scales, values, tables, cardValues, bytes };
}

/** What one call asks: compose for a camera, or forget a scene. */
export interface NearInput {
	op: 'compose' | 'drop';
	/** The scene's number, which names its arrays in this worker. */
	id: number;
	/** Changes when the scene's arrays change. */
	version: number;
	/** The scene's arrays. */
	scene: NearScene;
	/** The camera's world position. */
	eyeX: number;
	eyeY: number;
	eyeZ: number;
	/** The most copies that draw real shoots now. */
	copies: number;
	/** The most triangles the near shoots may draw together now. */
	triangles: number;
	/** The metres the camera may move before the answer arrives. */
	margin: number;
	/** The page's output buffer, shared with the worker where the page allows it. */
	out: Uint8Array;
}

/** A call's answer: the rows it wrote, and a copy of the output when the page shares no memory. */
export interface NearAnswer {
	rows: number;
	bytes?: ArrayBuffer;
}

/** The module's memory and the arrays one scene keeps in it. */
interface NearState {
	version: number;
	params: number;
	groups: number;
	batches: number;
	out: number;
	layout: NearLayout;
}

/** The module, which the worker instantiates at its first task and keeps. */
let wasm: NearWasm | undefined;
/** Where the scenes' arrays start: above the module's own pages, which hold its shadow stack. */
let base = 0;
/** The next free byte of the module's memory. */
let next = 0;
/** The arrays each scene keeps in this worker, by the input's `id`. */
const states = new Map<number, NearState>();

/** Rounds `value` up to the next multiple of `unit`. */
function align(value: number, unit: number): number {
	return Math.ceil(value / unit) * unit;
}

/** Makes room for `bytes` in the module's memory and returns where it starts. */
function alloc(bytes: number): number {
	const module = wasm as NearWasm;
	const at = align(next, 8);
	next = at + align(bytes, 8);
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
function start(module: WebAssembly.Module): NearWasm {
	try {
		wasm = new WebAssembly.Instance(module).exports as unknown as NearWasm;
	} catch (e) {
		throw loadError(`the plant near task could not start: ${(e as Error).message}`);
	}
	if (typeof wasm.near_compose !== 'function')
		throw loadError('the plant near task holds no compose call');
	base = wasm.memory.buffer.byteLength;
	next = base;
	return wasm;
}

/** True when the typed array's bytes are shared with the thread that sent it. */
function shared(array: ArrayBufferView): boolean {
	return typeof SharedArrayBuffer !== 'undefined' && array.buffer instanceof SharedArrayBuffer;
}

/** Writes a typed array's bytes into the module's memory and returns where they start. */
function place(array: ArrayBufferView): number {
	const at = alloc(array.byteLength);
	const source = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
	new Uint8Array((wasm as NearWasm).memory.buffer, at, array.byteLength).set(source);
	return at;
}

/** The address fields of a group's block, in the order of `GroupArrays`. */
const ARRAY_FIELDS = [
	GROUP.copies,
	GROUP.cardRows,
	GROUP.variants,
	GROUP.rowFloats,
	GROUP.rowWords,
	GROUP.prototypes,
] as const;

/** The scene's arrays in this worker, copied in at the first call of its version. */
function stateFor(input: NearInput): NearState {
	const kept = states.get(input.id);
	if (kept && kept.version === input.version) return kept;
	states.delete(input.id);
	// The arrays of a scene's older version go with it; with no scene left, the memory is reused.
	if (states.size === 0) next = base;
	const { scene } = input;
	const groups = new Float64Array(scene.groups);
	scene.arrays.forEach((arrays, g) => {
		arrays.forEach((array, k) => {
			groups[g * GROUP_FLOATS + (ARRAY_FIELDS[k] as number)] = place(array);
		});
	});
	const layout = nearLayout(scene);
	const state: NearState = {
		version: input.version,
		params: alloc(PARAM_FLOATS * 8),
		groups: place(groups),
		batches: place(scene.batches),
		out: alloc(layout.bytes),
		layout,
	};
	states.set(input.id, state);
	return state;
}

/** Composes the near rows for the input's camera and writes them into the page's output. */
function compose(module: NearWasm, state: NearState, input: NearInput): NearAnswer {
	const { layout, out } = state;
	const scene = input.scene;
	const p = new Float64Array(module.memory.buffer, state.params, PARAM_FLOATS);
	p[0] = input.eyeX;
	p[1] = input.eyeY;
	p[2] = input.eyeZ;
	p[3] = input.copies;
	p[4] = input.triangles;
	p[5] = input.margin;
	p[6] = scene.arrays.length;
	p[7] = state.groups;
	p[8] = scene.batches.length / 2;
	p[9] = state.batches;
	p[10] = out + layout.positions;
	p[11] = out + layout.rotations;
	p[12] = out + layout.scales;
	p[13] = out + layout.values;
	p[14] = out + layout.counts;
	p[15] = scene.tables;
	p[16] = out + layout.tables;
	p[17] = out + layout.cardValues;
	p[18] = scene.cards;
	p[19] = out + layout.summary;
	const rows = module.near_compose(state.params);
	const written = new Uint8Array(module.memory.buffer, out, layout.bytes);
	if (shared(input.out)) {
		input.out.set(written);
		return { rows };
	}
	const bytes = written.slice().buffer;
	return { rows, bytes };
}

/**
 * Runs one call. The engine calls this once for each task, with the compiled WebAssembly module
 * that the task names.
 */
export function run(
	input: unknown,
	modules: (name: string) => WebAssembly.Module,
): { output: NearAnswer; transfer?: Transferable[] } {
	const request = input as NearInput;
	if (request.op === 'drop') {
		states.delete(request.id);
		if (states.size === 0) next = base;
		return { output: { rows: 0 } };
	}
	const module = wasm ?? start(modules('vegetation'));
	const answer = compose(module, stateFor(request), request);
	return answer.bytes ? { output: answer, transfer: [answer.bytes] } : { output: answer };
}
