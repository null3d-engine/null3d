// The terrain add-on: a height field drawn as a camera-centered quadtree of blocks, so the ground
// near the camera is fine and the far ground is cheap. Each block is a mesh whose vertices carry
// the height field's heights, with a skirt around its edge that closes the seam where two blocks
// of different levels meet. One splat-mapped material blends up to four tiled layers over all the
// blocks. The terrain has no collision: a game reads `heightAt` and `normalAt` to place what
// stands on it.
import type {
	Material,
	Mesh,
	MeshGeometry,
	SketchContext,
	Texture,
	Vec3Like,
} from '@null3d/engine';
import { type ChunkShape, chunkShape, writeChunkVertices } from './chunk';
import { createHeightfield, type Heightfield } from './heightfield';
import { splatMaterial, type TerrainLayer } from './material';
import { Quadtree } from './quadtree';
import { defaultSplat, type SplatFunction, splatTexture } from './splat';

export type { TerrainLayer } from './material';
export type { SplatFunction } from './splat';

/**
 * What `createTerrain` needs and what the ground may change.
 *
 * @category api/terrain
 */
export interface TerrainOptions {
	/** The width and depth of the ground, in meters, centered on the origin. */
	size: number;
	/**
	 * The height of the ground at a point, in meters. A function is read once per sample of the
	 * height field. A `Float32Array` is a height map of `resolution` samples along each side,
	 * row by row from `z = -size / 2` upward.
	 */
	height: ((x: number, z: number) => number) | Float32Array;
	/** The samples along each side of the height field, from 2 up. The default is 256. */
	resolution?: number;
	/** The layers of the surface, from one to four, which the splat map's channels weight. */
	layers: readonly TerrainLayer[];
	/**
	 * The weight of each layer at a point, written into `out` as red, green, blue and alpha. The
	 * default puts grass on the low, gentle ground, soil on the drier higher ground, rock on the
	 * steep slopes and snow above.
	 */
	splat?: SplatFunction;
	/** The texels along each side of the splat map. The default is 256. */
	splatResolution?: number;
	/** The faces along each side of a block's grid. The default is 16. */
	chunkQuads?: number;
	/** The finest level, from 0 to 15: a block covers `size / 2 ** maxLevel` meters. The default is 6. */
	maxLevel?: number;
	/**
	 * How far from a block's edge the camera may stand and still split it, as a multiple of the
	 * block's size. The default is 2. A larger value keeps detail farther out and draws more.
	 */
	split?: number;
	/**
	 * How far the skirt around each block hangs down, in meters. The default is four of the block's
	 * cells, which closes the seam against a neighbour up to a level or two coarser.
	 */
	skirt?: number;
	/** How much the ground acts like a metal, from 0 to 1. The default is 0. */
	metalness?: number;
	/** True makes the ground cast the sun's shadows. The default is true. */
	castShadows?: boolean;
	/** True makes shadows fall on the ground. The default is true. */
	receiveShadows?: boolean;
	/**
	 * The most blocks the ground keeps, from 16 up: a selection draws up to that many, and a block
	 * that a new selection leaves out gives up its mesh to the next block that needs one, so the
	 * ground stops building meshes once it holds this many. The default is 512.
	 */
	maxBlocks?: number;
}

/** One block of the ground, and the frame that last drew it. */
interface Block {
	readonly object: Mesh;
	readonly mesh: MeshGeometry;
	stamp: number;
}

/** The default faces along each side of a block's grid. */
const DEFAULT_QUADS = 16;
/** The default finest level. */
const DEFAULT_MAX_LEVEL = 6;
/** The default split distance, as a multiple of a block's size. */
const DEFAULT_SPLIT = 2;
/** The default texels along each side of the splat map. */
const DEFAULT_SPLAT = 256;
/** The default blocks a selection may draw. */
const DEFAULT_BLOCKS = 512;

/**
 * A ground drawn as a quadtree of blocks. `createTerrain` makes one.
 *
 * @category api/terrain
 */
export class Terrain {
	private readonly context: SketchContext;
	private readonly field: Heightfield;
	private readonly tree: Quadtree;
	private readonly material: Material;
	private readonly splatTexture: Texture;
	private readonly white: Texture | undefined;
	private readonly shape: ChunkShape;
	private readonly fixedSkirt: number | undefined;
	private readonly cast: boolean;
	private readonly receive: boolean;
	private readonly maxBlocks: number;
	/** The blocks that the last update drew, by their key. */
	private readonly blocks = new Map<number, Block>();
	/** The blocks that a selection left out, whose meshes the next block that needs one takes. */
	private readonly spares: Block[] = [];
	/**
	 * How many blocks wait in `spares`. The ground holds the array at its longest, because a
	 * selection that parks and takes blocks again would make the browser grow and shrink it, which
	 * allocates a word for every block of every frame.
	 */
	private spareCount = 0;
	/** The vertices of the block being written, which every block writes into in turn. */
	private readonly positions: Float32Array;
	private readonly normals: Float32Array;
	/** The center of a block's own sphere, which holds every block at its own corner. */
	private readonly center: [number, number, number] = [0, 0, 0];
	/** The block and the key that `scanOldest` found, which `evict` takes. */
	private oldest: Block | undefined = undefined;
	private oldestKey = 0;
	/** Hides the blocks that the new selection leaves out, without making an iterator or a closure. */
	private readonly hideLeftOut = (block: Block): void => {
		if (block.stamp !== this.stamp) block.object.setVisible(false);
	};
	/** Notes the oldest block that the new selection leaves out. */
	private readonly scanOldest = (block: Block, key: number): void => {
		if (block.stamp === this.stamp) return;
		const oldest = this.oldest;
		if (!oldest || block.stamp < oldest.stamp) {
			this.oldest = block;
			this.oldestKey = key;
		}
	};
	/** The size of a leaf of the finest level, and half of the ground's width. */
	private readonly cellSize: number;
	private readonly halfSize: number;
	private stamp = 0;
	private lastCellX = Number.NaN;
	private lastCellZ = Number.NaN;
	private drawnBlocks = 0;
	private ended = false;

	/** @internal A terrain is made by `createTerrain`. */
	constructor(context: SketchContext, options: TerrainOptions) {
		const {
			size,
			chunkQuads = DEFAULT_QUADS,
			maxLevel = DEFAULT_MAX_LEVEL,
			split = DEFAULT_SPLIT,
			maxBlocks = DEFAULT_BLOCKS,
		} = options;
		if (!Number.isInteger(chunkQuads) || chunkQuads < 1)
			throw new Error(
				`createTerrain() got the chunkQuads ${chunkQuads}, which is not a whole number of 1 or more.`,
			);
		if (!Number.isInteger(maxBlocks) || maxBlocks < 16)
			throw new Error(
				`createTerrain() got the maxBlocks ${maxBlocks}, which is not a whole number of 16 or more.`,
			);
		this.context = context;
		this.fixedSkirt = options.skirt;
		this.cast = options.castShadows ?? true;
		this.receive = options.receiveShadows ?? true;
		this.maxBlocks = maxBlocks;
		this.field = createHeightfield({
			size,
			resolution: options.resolution,
			height: options.height,
		});
		this.tree = new Quadtree({ size, maxLevel, split });
		this.cellSize = this.tree.blockSize(maxLevel);
		this.halfSize = size / 2;
		this.shape = chunkShape(chunkQuads);
		this.positions = new Float32Array(this.shape.vertices * 3);
		this.normals = new Float32Array(this.shape.vertices * 3);
		const splat = options.splat ?? defaultSplat(this.field);
		this.splatTexture = splatTexture(
			context.textures,
			size,
			options.splatResolution ?? DEFAULT_SPLAT,
			splat,
		);
		const built = splatMaterial(context, {
			layers: options.layers,
			splat: this.splatTexture,
			size,
			metalness: options.metalness,
		});
		this.material = built.material;
		this.white = built.white;
	}

	/** The width and depth of the ground, in meters. */
	get size(): number {
		return this.field.size;
	}

	/** The height field, for a caller that wants to read it directly. */
	get heightfield(): Heightfield {
		return this.field;
	}

	/** How many blocks the last update drew. */
	get drawn(): number {
		return this.drawnBlocks;
	}

	/** How many triangles the last update drew, with each block's skirt. */
	get triangles(): number {
		const grid = this.shape.quads * this.shape.quads * 2;
		const skirt = this.shape.quads * 4 * 2;
		return this.drawnBlocks * (grid + skirt);
	}

	/**
	 * The height of the ground at a point, in meters, with bilinear interpolation between the
	 * samples of the height field. Allocates nothing.
	 */
	heightAt(x: number, z: number): number {
		return this.field.heightAt(x, z);
	}

	/**
	 * The unit normal of the ground at a point, written into `out` as x, y and z, for placing an
	 * object that stands on the ground. Allocates nothing.
	 */
	normalAt(x: number, z: number, out: number[] | Float32Array): void {
		this.field.normalAt(x, z, out);
	}

	/**
	 * Picks the blocks to draw for a camera whose world position `eye` holds, as x, y and z: the
	 * ground reads the x and the z. It does nothing until the camera moves into a new cell of the
	 * finest level, so a still camera costs no work, and a block that the new selection needs takes
	 * the mesh of one that it left out. Call it in `onUpdate` with the camera's own position, in an
	 * array you keep: an array crosses the call as it is, where two fractions make the browser box
	 * each of them into an object.
	 */
	update(eye: Vec3Like): void {
		const x = eye[0] as number;
		const z = eye[2] as number;
		if (this.ended) return;
		const column = Math.floor((x + this.halfSize) / this.cellSize);
		const row = Math.floor((z + this.halfSize) / this.cellSize);
		if (column === this.lastCellX && row === this.lastCellZ) return;
		this.lastCellX = column;
		this.lastCellZ = row;
		const { tree } = this;
		const count = tree.select(x, z);
		this.stamp++;
		const stamp = this.stamp;
		for (let i = 0; i < count; i++) {
			const level = tree.levels[i] as number;
			const blockColumn = tree.columns[i] as number;
			const blockRow = tree.rows[i] as number;
			const at = tree.key(level, blockColumn, blockRow);
			let block = this.blocks.get(at);
			if (!block) block = this.placeBlock(level, blockColumn, blockRow, at);
			if (block.stamp !== stamp) {
				block.stamp = stamp;
				block.object.setVisible(true);
			}
		}
		this.drawnBlocks = count;
		this.blocks.forEach(this.hideLeftOut);
		while (this.blocks.size > this.maxBlocks && this.evict()) {
			// Park the blocks that the new selection left out, oldest first.
		}
	}

	/** Shows or hides the whole ground, for a camera high above it. */
	setVisible(visible: boolean): void {
		for (const block of this.blocks.values()) block.object.setVisible(visible);
		for (let i = 0; i < this.spareCount; i++) (this.spares[i] as Block).object.setVisible(visible);
	}

	/** Destroys the ground: every block's object and mesh, and the material's own textures. */
	destroy(): void {
		for (const block of this.blocks.values()) this.endBlock(block);
		this.blocks.clear();
		for (let i = 0; i < this.spareCount; i++) this.endBlock(this.spares[i] as Block);
		this.spares.length = 0;
		this.spareCount = 0;
		this.material.destroy();
		this.splatTexture.destroy();
		this.white?.destroy();
		this.ended = true;
	}

	/**
	 * Puts a block at the leaf of `level`, `column` and `row`: a mesh whose vertices hold that
	 * leaf's ground, taken from the blocks that earlier selections left out, and a new mesh only
	 * when none waits.
	 */
	private placeBlock(level: number, column: number, row: number, key: number): Block {
		const { tree, shape } = this;
		const blockSize = tree.blockSize(level);
		const originX = tree.blockX(level, column);
		const originZ = tree.blockZ(level, row);
		const skirt = this.fixedSkirt ?? (blockSize / shape.quads) * 4;
		writeChunkVertices(
			this.field,
			shape,
			blockSize,
			originX,
			originZ,
			skirt,
			this.positions,
			this.normals,
		);
		const spare = this.takeBlock();
		if (spare) {
			spare.mesh.updateVertices('positions', this.positions);
			spare.mesh.updateVertices('normals', this.normals);
			spare.object.setPosition(originX, 0, originZ);
			spare.object.setBounds(this.center, this.blockRadius());
			this.blocks.set(key, spare);
			return spare;
		}
		const mesh = this.context.geometry.fromArrays({
			positions: this.positions,
			normals: this.normals,
			uvs: shape.uvs,
			indices: shape.indices,
		});
		const object = this.context.scene.createMesh({
			mesh,
			material: this.material,
			position: [originX, 0, originZ],
			castShadows: this.cast,
			receiveShadows: this.receive,
		});
		const entry: Block = { object, mesh, stamp: this.stamp };
		this.blocks.set(key, entry);
		return entry;
	}

	/**
	 * The block whose mesh a new block takes: one that waited, or the one that the longest has gone
	 * unused among the blocks this selection left out. Undefined while the ground holds fewer than
	 * `maxBlocks` meshes, where a new block builds one.
	 */
	private takeBlock(): Block | undefined {
		const waiting = this.unpark();
		if (waiting) return waiting;
		if (this.blocks.size >= this.maxBlocks && this.evict()) return this.unpark();
		return undefined;
	}

	/** Parks a block's mesh for a later block to take, at a place the array already holds. */
	private park(block: Block): void {
		this.spares[this.spareCount++] = block;
	}

	/** Takes the last parked block, or undefined when none waits. */
	private unpark(): Block | undefined {
		if (this.spareCount === 0) return undefined;
		const taken = this.spares[--this.spareCount] as Block;
		this.spares[this.spareCount] = undefined as unknown as Block;
		return taken;
	}

	/**
	 * The distance from a block's low corner to the farthest vertex that was just written into it.
	 * A mesh keeps the sphere it was made with, so a block that takes another's mesh gives the object
	 * the sphere of the ground that it now holds.
	 */
	private blockRadius(): number {
		const { positions } = this;
		let radius = 0;
		for (let at = 0; at < positions.length; at += 3) {
			const x = positions[at] as number;
			const y = positions[at + 1] as number;
			const z = positions[at + 2] as number;
			const distance = Math.sqrt(x * x + y * y + z * z);
			if (distance > radius) radius = distance;
		}
		return radius;
	}

	/** Parks the oldest block that the selection left out, for the next block to take. False when every block draws. */
	private evict(): boolean {
		this.oldest = undefined;
		this.oldestKey = 0;
		this.blocks.forEach(this.scanOldest);
		const oldest = this.oldest;
		if (!oldest) return false;
		this.blocks.delete(this.oldestKey);
		this.park(oldest);
		return true;
	}

	/** Destroys a block's object first, then its mesh, as the engine asks. */
	private endBlock(block: Block): void {
		block.object.destroy();
		block.mesh.destroy();
	}
}

/**
 * Makes a terrain: a height field drawn as a quadtree of blocks with a splat-mapped surface. Call
 * `terrain.update(eye)` with the camera's world position when it moves, and read `heightAt` and
 * `normalAt` to place what stands on the ground. `terrain.destroy()` frees it.
 *
 * @category api/terrain
 */
export function createTerrain(context: SketchContext, options: TerrainOptions): Terrain {
	return new Terrain(context, options);
}
