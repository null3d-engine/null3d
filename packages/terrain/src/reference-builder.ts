// The builder that the terrain's unit tests run: the same selection and block build as the
// add-on's WebAssembly module, written in TypeScript so a test can drive them with no worker.
// The module's crate holds the shipped port, and its tests read the same figures; this file is the
// reference that port is checked against, and the unit tests' stand-in for a job worker.
import { type ChunkShape, chunkShape } from './chunk';
import { writeChunkVertices, writeParentHeights } from './chunk-vertices';
import { Quadtree } from './quadtree';
import type { BuildSlot, TerrainBuilder, TerrainBuilderOptions } from './terrain-builder';

/** The builder that runs in the thread that runs the sketch, for the unit tests. */
export class ReferenceTerrainBuilder implements TerrainBuilder {
	leaves: Int32Array;
	buildLeaves: Int32Array;
	capacity: number;
	batch: number;
	slots: BuildSlot[] = [];
	private readonly options: TerrainBuilderOptions;
	private readonly tree: Quadtree;
	private readonly shape: ChunkShape;
	private readonly outPositions: Float32Array;
	private readonly outNormals: Float32Array;
	private readonly outRecord: Float32Array;
	/** The parent heights of the block being written, which no caller reads. */
	private readonly parents: Float32Array;

	constructor(options: TerrainBuilderOptions) {
		this.options = options;
		// The tree reads the field itself: a tree made from another's settings alone would bound
		// every block at zero height, and its selection would differ from the module's.
		this.tree = new Quadtree({
			size: options.size,
			maxLevel: options.maxLevel,
			quads: options.quads,
			field: options.field,
		});
		this.shape = chunkShape(options.quads);
		this.capacity = Math.max(1024, options.maxBlocks * 4);
		this.batch = Math.min(this.capacity, Math.max(options.builds, 128));
		this.leaves = new Int32Array(this.capacity * 3);
		this.buildLeaves = new Int32Array(this.batch * 3);
		this.outPositions = new Float32Array(this.batch * options.vertices * 3);
		this.outNormals = new Float32Array(this.batch * options.vertices * 3);
		this.outRecord = new Float32Array(this.batch * options.vertices * 4);
		this.parents = new Float32Array(options.vertices);
		for (let i = 0; i < this.batch; i++)
			this.slots.push({
				positions: this.outPositions.subarray(
					i * options.vertices * 3,
					(i + 1) * options.vertices * 3,
				),
				normals: this.outNormals.subarray(i * options.vertices * 3, (i + 1) * options.vertices * 3),
				record: this.outRecord.subarray(i * options.vertices * 4, (i + 1) * options.vertices * 4),
			});
	}

	async select(x: number, y: number, z: number, scale: number): Promise<number> {
		const count = this.tree.selectWithScale([x, y, z], scale);
		if (count > this.capacity) this.grow(count);
		for (let i = 0; i < count; i++) {
			this.leaves[i * 3] = this.tree.levels[i] as number;
			this.leaves[i * 3 + 1] = this.tree.columns[i] as number;
			this.leaves[i * 3 + 2] = this.tree.rows[i] as number;
		}
		return count;
	}

	async build(count: number): Promise<void> {
		const { tree, shape, options } = this;
		const { field, quads, skirt } = options;
		for (let i = 0; i < count; i++) {
			const level = this.buildLeaves[i * 3] as number;
			const column = this.buildLeaves[i * 3 + 1] as number;
			const row = this.buildLeaves[i * 3 + 2] as number;
			const blockSize = tree.blockSize(level);
			const originX = tree.blockX(level, column);
			const originZ = tree.blockZ(level, row);
			const depth = skirt ?? (blockSize / quads) * 4;
			const slot = this.slots[i] as BuildSlot;
			writeChunkVertices(
				field,
				shape,
				blockSize,
				originX,
				originZ,
				depth,
				slot.positions,
				slot.normals,
			);
			const parentLevel = level > 0 ? level - 1 : 0;
			writeParentHeights(
				field,
				shape,
				blockSize,
				originX,
				originZ,
				depth,
				tree.blockSize(parentLevel),
				tree.blockX(parentLevel, level > 0 ? column >> 1 : 0),
				tree.blockZ(parentLevel, level > 0 ? row >> 1 : 0),
				this.parents,
			);
			const low = tree.lowAt(level, column, row);
			const high = tree.highAt(level, column, row);
			for (let v = 0; v < shape.vertices; v++) {
				slot.record[v * 4] = this.parents[v] as number;
				slot.record[v * 4 + 1] = blockSize;
				slot.record[v * 4 + 2] = low;
				slot.record[v * 4 + 3] = high;
			}
		}
	}

	/** Makes the leaves' array big enough for `count` leaves. */
	private grow(count: number): void {
		let capacity = this.capacity;
		while (capacity < count) capacity *= 2;
		this.capacity = capacity;
		this.leaves = new Int32Array(capacity * 3);
	}

	destroy(): void {}
}
