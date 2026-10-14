// The terrain add-on: a height field drawn as a camera-centred quadtree of blocks, so the ground
// near the camera is fine and the far ground is cheap. Each block is a mesh whose vertices carry
// the height field's heights, with a skirt around its edge that closes the seam where two blocks
// of different levels meet. One splat-mapped material blends up to four tiled layers over all the
// blocks. The terrain has no collision: a game reads `heightAt` and `normalAt` to place what
// stands on it.
import type { Material, Mesh, MeshGeometry, SketchContext, Texture } from '@null3d/engine';
import { chunkArrays } from './chunk';
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
	 * How far the skirt around each block hangs down, in meters. The default is four of the
	 * block's cells, which closes the seam against a neighbour up to a level or two coarser.
	 */
	skirt?: number;
	/** How much the ground acts like a metal, from 0 to 1. The default is 0. */
	metalness?: number;
	/** True makes the ground cast the sun's shadows. The default is true. */
	castShadows?: boolean;
	/** True makes shadows fall on the ground. The default is true. */
	receiveShadows?: boolean;
	/** The most blocks kept ready, from 16 up. A block left out of the view is reused first. The default is 512. */
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
/** The default blocks kept ready. */
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
	private readonly quads: number;
	private readonly fixedSkirt: number | undefined;
	private readonly cast: boolean;
	private readonly receive: boolean;
	private readonly maxBlocks: number;
	private readonly blocks = new Map<number, Block>();
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
		this.quads = chunkQuads;
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
		const grid = this.quads * this.quads * 2;
		const skirt = this.quads * 4 * 2;
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
	 * Picks the blocks to draw for a camera at `x` and `z` on the ground. It does nothing until the
	 * camera moves into a new cell of the finest level, so a still camera costs no work. Call it in
	 * `onUpdate` with the camera's own x and z.
	 */
	update(x: number, z: number): void {
		if (this.ended) return;
		const cell = this.tree.blockSize(this.tree.maxLevel);
		const column = Math.floor((x + this.tree.size / 2) / cell);
		const row = Math.floor((z + this.tree.size / 2) / cell);
		if (column === this.lastCellX && row === this.lastCellZ) return;
		this.lastCellX = column;
		this.lastCellZ = row;
		const { tree } = this;
		const count = tree.select(x, z);
		this.stamp++;
		for (let i = 0; i < count; i++) {
			const level = tree.levels[i] as number;
			const at = tree.key(level, tree.columns[i] as number, tree.rows[i] as number);
			let block = this.blocks.get(at);
			if (!block)
				block = this.makeBlock(level, tree.columns[i] as number, tree.rows[i] as number, at);
			if (block.stamp !== this.stamp) {
				block.stamp = this.stamp;
				block.object.setVisible(true);
			}
		}
		this.drawnBlocks = count;
		for (const block of this.blocks.values())
			if (block.stamp !== this.stamp) block.object.setVisible(false);
		while (this.blocks.size > this.maxBlocks && this.evict()) {
			// Drop the blocks that the new selection left out, oldest first.
		}
	}

	/** Shows or hides the whole ground, for a camera high above it. */
	setVisible(visible: boolean): void {
		for (const block of this.blocks.values()) block.object.setVisible(visible);
	}

	/** Destroys the ground: every block's object and mesh, and the material's own textures. */
	destroy(): void {
		for (const block of this.blocks.values()) this.endBlock(block);
		this.blocks.clear();
		this.material.destroy();
		this.splatTexture.destroy();
		this.white?.destroy();
		this.ended = true;
	}

	/** Makes one block's mesh and object, and remembers them. */
	private makeBlock(level: number, column: number, row: number, key: number): Block {
		const { tree, quads } = this;
		const block = tree.blockSize(level);
		const originX = tree.blockX(level, column);
		const originZ = tree.blockZ(level, row);
		const cell = block / quads;
		const skirt = this.fixedSkirt ?? cell * 4;
		const mesh = this.context.geometry.fromArrays(
			chunkArrays(this.field, block, originX, originZ, quads, skirt),
		);
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

	/** Destroys the oldest block that this selection left out, and forgets it. False when every block is drawn. */
	private evict(): boolean {
		let oldest: Block | undefined;
		let key = 0;
		for (const [at, block] of this.blocks) {
			if (block.stamp === this.stamp) continue;
			if (!oldest || block.stamp < oldest.stamp) {
				oldest = block;
				key = at;
			}
		}
		if (!oldest) return false;
		this.endBlock(oldest);
		this.blocks.delete(key);
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
 * `terrain.update(x, z)` with the camera's ground position when it moves, and read `heightAt` and
 * `normalAt` to place what stands on the ground. `terrain.destroy()` frees it.
 *
 * @category api/terrain
 */
export function createTerrain(context: SketchContext, options: TerrainOptions): Terrain {
	return new Terrain(context, options);
}
