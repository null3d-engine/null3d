// The add-on's side of the terrain builder: the arrays that a call hands in, and the call itself.
// The quadtree selection and the block build run in the add-on's WebAssembly module on the
// engine's job workers ([D-279](../../../.dev/decisions/D-279-terrain-rust-home.md)), so the
// thread that runs the sketch never walks the tree or samples the height field in a frame.
//
// Every array lives in one buffer for the terrain's lifetime, shared with the worker where the
// page allows it, so a call copies nothing on this thread and allocates nothing. A selection that
// outgrows the buffer makes it again, once, and asks again.
import { runTask, type Task } from '@null3d/engine';
import type { Blocks } from './blocks';
import type { Heightfield } from './heightfield';
import type { TerrainAnswer, TerrainInput } from './terrain-task';

/** The task that runs the builder: its module, and the WebAssembly module that it calls. */
const BUILD_TASK: Task = {
	name: 'terrain-build',
	script: new URL('./terrain-task.ts', import.meta.url),
	wasm: [
		{
			name: 'terrain',
			url: new URL('../dist/terrain.wasm', import.meta.url),
			what: 'the terrain builder',
		},
	],
};

/** The most bytes that one build's arrays take, which sets how many blocks one call writes. */
const BUILD_BYTES = 2 * 1024 * 1024;

/** The most leaves that the buffer holds at first. */
const FIRST_LEAVES = 1024;

/** One block's arrays in the build buffer: the place where a call writes its vertices. */
export interface BuildSlot {
	/** Three numbers per vertex. */
	positions: Float32Array;
	/** Three numbers per vertex. */
	normals: Float32Array;
	/** Four numbers per vertex: the parent's height, the block's size, its low and high heights. */
	record: Float32Array;
}

/**
 * What the terrain asks of a builder: the arrays that a selection writes, the blocks that a build
 * writes, and the calls themselves. The add-on's wasm module fills it in a job worker; the
 * reference builder in `reference-builder.ts` fills it in the same thread, for the unit tests.
 */
export interface TerrainBuilder {
	/** Where a selection writes its leaves: level, column and row. */
	readonly leaves: Int32Array;
	/** The most leaves a selection may write. */
	readonly capacity: number;
	/** The most blocks one build writes. */
	readonly batch: number;
	/** The blocks that a build writes: level, column and row, then the next block's. */
	readonly buildLeaves: Int32Array;
	/** One block's place in the build buffers, for each block of a build. */
	readonly slots: readonly BuildSlot[];
	/**
	 * Picks the leaves to draw for a camera at `x`, `y` and `z`, which reads `scale` as the device
	 * pixels per world meter of one block cell at which its error fills the split. Writes the
	 * leaves into `leaves`, and answers how many it wrote.
	 */
	select(x: number, y: number, z: number, scale: number): Promise<number>;
	/** Writes the first `count` blocks of `buildLeaves` into `slots`, vertex for vertex. */
	build(count: number): Promise<void>;
	/** Frees what the builder keeps, once the ground is gone. */
	destroy(): void;
}

/** The bytes of one float, and of one 32-bit whole number. */
const FLOAT_BYTES = 4;

/** A buffer that the worker shares where the page allows it, and copies otherwise. */
function bufferOf(bytes: number): ArrayBufferLike {
	return typeof SharedArrayBuffer === 'undefined'
		? new ArrayBuffer(bytes)
		: new SharedArrayBuffer(bytes);
}

/** What the terrain builder keeps of the ground, which names its place in the worker. */
export interface TerrainBuilderOptions {
	/** The width and depth of the ground, in meters. */
	size: number;
	/** The height field, whose samples and boxes a call reads. */
	field: Heightfield;
	/** The blocks, whose height boxes a selection reads. */
	blocks: Blocks;
	/** The grid vertices that a block's skirt copies, in draw order. */
	ring: Uint32Array;
	/** The faces along each side of a block's grid. */
	quads: number;
	/** The finest level. */
	maxLevel: number;
	/** The vertices of one block, the skirt's ring included. */
	vertices: number;
	/** The most meshes the ground holds, which sets the leaves that a selection may pick. */
	maxBlocks: number;
	/** The most blocks one update builds. */
	builds: number;
	/** The skirt's depth, or undefined for four of a block's cells. */
	skirt: number | undefined;
}

/** The builder that runs the add-on's WebAssembly module on the engine's job workers. */
export class WasmTerrainBuilder implements TerrainBuilder {
	leaves: Int32Array;
	buildLeaves: Int32Array;
	capacity: number;
	batch: number;
	slots: BuildSlot[] = [];
	private readonly input: TerrainInput;
	/** Changes when the arrays change, so a worker makes its copies again. */
	private version = 0;
	/** One number for each terrain that this page builds, so a worker keeps their arrays apart. */
	private static lastId = 0;
	private readonly id: number;
	private readonly options: TerrainBuilderOptions;
	private heights: Float32Array;
	private lows: Float32Array;
	private highs: Float32Array;
	private ring: Uint32Array;
	private outPositions: Float32Array;
	private outNormals: Float32Array;
	private outRecord: Float32Array;
	private ended = false;

	constructor(options: TerrainBuilderOptions) {
		this.options = options;
		this.id = ++WasmTerrainBuilder.lastId;
		this.capacity = Math.max(FIRST_LEAVES, options.maxBlocks * 4);
		const perBlock = options.vertices * 10 * FLOAT_BYTES;
		this.batch = Math.min(
			this.capacity,
			Math.max(options.builds, Math.floor(BUILD_BYTES / Math.max(perBlock, 1))),
		);
		this.leaves = new Int32Array(bufferOf(this.capacity * 3 * 4));
		this.buildLeaves = new Int32Array(bufferOf(this.batch * 3 * 4));
		this.heights = new Float32Array(bufferOf(options.field.heights.byteLength));
		this.heights.set(options.field.heights);
		const boxes = options.blocks.boundsLength;
		this.lows = new Float32Array(bufferOf(boxes * FLOAT_BYTES));
		this.highs = new Float32Array(bufferOf(boxes * FLOAT_BYTES));
		options.blocks.packBounds(this.lows, this.highs);
		this.ring = options.ring;
		this.outPositions = new Float32Array(bufferOf(this.batch * options.vertices * 3 * FLOAT_BYTES));
		this.outNormals = new Float32Array(bufferOf(this.batch * options.vertices * 3 * FLOAT_BYTES));
		this.outRecord = new Float32Array(bufferOf(this.batch * options.vertices * 4 * FLOAT_BYTES));
		this.makeSlots();
		this.input = {
			op: 'select',
			id: this.id,
			version: this.version,
			size: options.size,
			resolution: options.field.resolution,
			quads: options.quads,
			maxLevel: options.maxLevel,
			boundLevel: options.blocks.boundLevel,
			vertices: options.vertices,
			scale: 0,
			eyeX: 0,
			eyeY: 0,
			eyeZ: 0,
			capacity: this.capacity,
			batch: this.batch,
			count: 0,
			skirt: options.skirt ?? -1,
			buildLeaves: this.buildLeaves,
			heights: this.heights,
			lows: this.lows,
			highs: this.highs,
			ring: this.ring,
			leaves: this.leaves,
			outPositions: this.outPositions,
			outNormals: this.outNormals,
			outRecord: this.outRecord,
		};
	}

	/** One view of each block's place in the build buffers, made once and reused by every call. */
	private makeSlots(): void {
		const { vertices } = this.options;
		this.slots = [];
		for (let i = 0; i < this.batch; i++) {
			this.slots.push({
				positions: this.outPositions.subarray(i * vertices * 3, (i + 1) * vertices * 3),
				normals: this.outNormals.subarray(i * vertices * 3, (i + 1) * vertices * 3),
				record: this.outRecord.subarray(i * vertices * 4, (i + 1) * vertices * 4),
			});
		}
	}

	async select(x: number, y: number, z: number, scale: number): Promise<number> {
		if (this.ended) return 0;
		const input = this.input;
		input.op = 'select';
		input.scale = scale;
		input.eyeX = x;
		input.eyeY = y;
		input.eyeZ = z;
		const answer = await runTask<TerrainAnswer>(BUILD_TASK, input);
		if (this.ended) return 0;
		// One more than the capacity says the selection outgrew the buffer: make it again, once.
		if (answer.count > this.capacity) {
			this.grow(answer.count);
			return this.select(x, y, z, scale);
		}
		if (answer.leaves) this.leaves.set(answer.leaves);
		return answer.count;
	}

	async build(count: number): Promise<void> {
		if (this.ended || count === 0) return;
		const input = this.input;
		input.op = 'build';
		input.count = count;
		const answer = await runTask<TerrainAnswer>(BUILD_TASK, input);
		if (this.ended) return;
		// A page that shares no memory gets the arrays back, and writes them in itself.
		if (answer.positions) {
			this.outPositions.set(answer.positions);
			this.outNormals.set(answer.normals as Float32Array);
			this.outRecord.set(answer.record as Float32Array);
		}
	}

	/** Makes the leaves' buffer big enough for `count` leaves, and tells the workers so. */
	private grow(count: number): void {
		let capacity = this.capacity;
		while (capacity < count) capacity *= 2;
		this.capacity = capacity;
		this.leaves = new Int32Array(bufferOf(capacity * 3 * 4));
		this.input.leaves = this.leaves;
		this.input.capacity = capacity;
		this.input.version = ++this.version;
	}

	destroy(): void {
		if (this.ended) return;
		this.ended = true;
		const input = this.input;
		input.op = 'drop';
		// The worker frees the terrain's arrays. A page that stops the engine first has already
		// freed every worker's memory, so a rejection here needs no report.
		void runTask<TerrainAnswer>(BUILD_TASK, input).catch(() => {});
	}
}
