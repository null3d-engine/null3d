// The terrain add-on: a height field drawn as a camera-centered quadtree of blocks, so the ground
// near the camera is fine and the far ground is cheap. Each block is a mesh whose vertices carry
// the height field's heights, with a skirt around its edge that closes the seam where two blocks
// of different levels meet. One material lights every pixel from normals baked over the whole
// ground, so a coarse block keeps the hills' relief. The material blends up to four tiled layers
// over all the blocks, and each layer's own height shows it through its neighbours at a boundary.
// The terrain has no collision: a game reads `heightAt` and `normalAt` to place what stands on it.
// The selection that picks the blocks and the build that writes their vertices run in the add-on's
// WebAssembly module on the engine's job workers, so a frame only asks for the work.
import type { Mesh, MeshGeometry, SketchContext, Texture, Vec3Like } from '@null3d/engine';
import { Blocks } from './blocks';
import { type ChunkShape, chunkShape } from './chunk';
import { createHeightfield, type Heightfield } from './heightfield';
import { type SplatMaterial, splatMaterial, type TerrainLayer } from './material';
import { defaultSplat, type SplatFunction, splatTexture } from './splat';
import {
	type BuildSlot,
	type TerrainBuilder,
	type TerrainBuilderOptions,
	WasmTerrainBuilder,
} from './terrain-builder';

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
	 * The camera whose field of view sets how far a block keeps its detail, which the ground reads
	 * when it picks blocks. Without one the ground assumes a vertical field of view of 50 degrees.
	 */
	camera?: { readonly fov: number };
	/**
	 * The screen error, in pixels, above which a block splits into four. The default is 35 times
	 * the quality preset's `lodThreshold`, so the ground draws with that preset's detail: Low picks
	 * coarser blocks. 0 keeps the finest level everywhere.
	 */
	error?: number;
	/**
	 * True lights every pixel from a normal map baked over the ground, which shows relief that a
	 * coarse block's vertices cannot. The default is true; false lights from the mesh's own normals.
	 */
	bakedNormals?: boolean;
	/**
	 * True maps the third layer, the rock, from the sides on a steep face, where a map laid from above
	 * stretches into streaks. It costs two more samples of that map. The default is false.
	 */
	steepFaces?: boolean;
	/**
	 * How far the skirt around each block hangs down, in meters. The default is four of the block's
	 * cells, which closes the seam against a neighbour up to a level or two coarser.
	 */
	skirt?: number;
	/**
	 * True moves each block toward its parent block's surface as the camera pulls away, so a block
	 * that hands over to a coarser one does not pop. The default is true. False switches each block
	 * at once and keeps the block's vertices as they are.
	 */
	morph?: boolean;
	/** How much the ground acts like a metal, from 0 to 1. The default is 0. */
	metalness?: number;
	/** True makes the ground cast the sun's shadows. The default is true. */
	castShadows?: boolean;
	/** True makes shadows fall on the ground. The default is true. */
	receiveShadows?: boolean;
	/**
	 * The most meshes the ground holds, from 16 up: a block that a selection leaves out gives up its
	 * mesh to the next block that needs one, so the ground stops building meshes once it holds this
	 * many. Its meshes wait for a block again until the count passes this figure. The default is 512.
	 */
	maxBlocks?: number;
	/**
	 * The most new blocks that one task builds, from 1 up. A camera that crosses into a new cell
	 * may need tens of blocks, and building them all at once would stall the frame. The ground
	 * draws its last complete selection until the new one is built. The first selection builds
	 * every block that it needs, over a few tasks, since there is no ground to draw before it. The
	 * default is 16.
	 */
	blocksPerUpdate?: number;
}

/**
 * One block of the ground: the mesh that holds its vertices, the object that draws it, the selection
 * that last picked it, and whether it draws now.
 */
interface Block {
	key: number;
	readonly object: Mesh;
	readonly mesh: MeshGeometry;
	/** The level whose mesh this block holds, which a block only takes a mesh of. */
	level: number;
	stamp: number;
	shown: boolean;
}

/** The default faces along each side of a block's grid. */
const DEFAULT_QUADS = 16;
/** The default finest level. */
const DEFAULT_MAX_LEVEL = 6;
/** The screen error, in pixels, that a block's cell may show. */
const DEFAULT_ERROR = 35;
/** The vertical field of view, in degrees, that the ground assumes without a camera. */
const DEFAULT_FOV = 50;
/** The default texels along each side of the splat map. */
const DEFAULT_SPLAT = 256;
/** The default meshes the ground holds. */
const DEFAULT_BLOCKS = 512;
/** The default new blocks that one update builds. */
const DEFAULT_BUILDS = 16;

/**
 * A ground drawn as a quadtree of blocks. `createTerrain` makes one.
 *
 * @category api/terrain
 */
export class Terrain {
	private readonly context: SketchContext;
	private readonly field: Heightfield;
	private readonly tree: Blocks;
	private readonly material: SplatMaterial['material'];
	private readonly splatTexture: Texture;
	private readonly normalTexture: Texture | undefined;
	private readonly white: Texture | undefined;
	private readonly shape: ChunkShape;
	private readonly fixedSkirt: number | undefined;
	/** The camera whose field of view sets the split, or undefined for the default. */
	private readonly camera: { readonly fov: number } | undefined;
	/** The screen error, in pixels, that a block's cell may show, or undefined for the preset's. */
	private readonly fixedError: number | undefined;
	private readonly cast: boolean;
	private readonly receive: boolean;
	private readonly maxBlocks: number;
	private readonly builds: number;
	/** The blocks of the newest selection built so far, and of the selection before it. */
	private readonly blocks = new Map<number, Block>();
	/** The blocks that a selection left out: hidden, and their meshes wait for the next block. */
	private readonly spares: Block[] = [];
	/**
	 * How many blocks wait in `spares`. The ground holds the array at its longest, because a
	 * selection that parks and takes blocks again would make the browser grow and shrink it, which
	 * allocates a word for every block of every frame.
	 */
	private spareCount = 0;
	/** The builder that picks the blocks and writes their vertices. */
	private readonly builder: TerrainBuilder;
	/** How many leaves the newest selection picked, and the first that waits to be built. */
	private selectionCount = 0;
	private cursor = 0;
	/** True while a task, or the placement after it, runs. */
	private busy = false;
	/** The newest view, which waits while an older selection builds. */
	private hasQueued = false;
	private queuedX = 0;
	private queuedY = 0;
	private queuedZ = 0;
	private queuedScale = 0;
	private queuedStamp = 0;
	/** The view's scale that the newest selection used, which the morph reads. */
	private lastSelectionScale = 0;
	/** The stamp of the selection being built, which the blocks that it keeps carry. */
	private buildingStamp = 0;
	/** True while the first selection builds, which builds every block that it needs. */
	private firstSelection = false;
	/** The promise that settles when no selection or build waits. */
	private settledResolve: (() => void) | undefined;
	/** The first failure of the builder, which the ground reports once. */
	private reportedFailure: Error | undefined;
	/** True moves each block toward its parent's surface. */
	private morph: boolean;
	/** The selection's scale that the material's morph reads, and the one it last got. */
	private readonly selection: { selection: [number, number] } = { selection: [0, 0] };
	private lastScale = Number.NaN;
	/**
	 * The sphere of each level's blocks: centred on the block's middle and reaching its farthest
	 * vertex, so one level's bounds hold every block of that level and a reused block keeps them.
	 */
	private readonly spheres = new Map<
		number,
		{ center: [number, number, number]; radius: number }
	>();
	/** The level that `scanOldest` looks for while `evict` frees a block. */
	private scanLevel = 0;
	/** The block and the key that `scanOldest` found, which `evict` takes. */
	private oldest: Block | undefined = undefined;
	private oldestKey = 0;
	/** The stamp of the selection that the closures below judge a block by. */
	private currentStamp = 0;
	/** Draws every block of the newest selection, without making an iterator or a closure. */
	private readonly showCurrent = (block: Block): void => {
		if (block.stamp === this.currentStamp) this.show(block);
	};
	/** Parks a block that the newest selection leaves out, without making an iterator or a closure. */
	private readonly parkLeftOut = (block: Block): void => {
		if (block.stamp === this.currentStamp) return;
		this.blocks.delete(block.key);
		this.hide(block);
		this.park(block);
	};
	/** Writes the whole ground's visibility into one block, without making an iterator. */
	private readonly setBlockVisible = (block: Block): void => {
		block.object.setVisible(this.visible && block.shown);
	};
	/** Notes the oldest block that the newest selection leaves out and that no longer draws. */
	private readonly scanOldest = (block: Block, key: number): void => {
		if (block.stamp === this.currentStamp || block.level !== this.scanLevel) return;
		// A block that draws holds the last complete selection, which stays whole until the newest
		// one is built, so its mesh is not free yet.
		if (block.shown) return;
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
	/** The eye's height and the view that the newest selection used. */
	private lastY = Number.NaN;
	private lastFov = Number.NaN;
	private lastScreen = Number.NaN;
	private lastError = Number.NaN;
	/** How many blocks draw, which `drawn` reports as none while the ground is hidden. */
	private drawnBlocks = 0;
	/** True while the newest selection has blocks still to build. */
	private pending = false;
	private visible = true;
	private ended = false;

	/**
	 * @internal A terrain is made by `createTerrain`. The builder is the add-on's own; a test
	 * passes one that runs the same selection in its own thread.
	 */
	constructor(
		context: SketchContext,
		options: TerrainOptions,
		builder?: (options: TerrainBuilderOptions) => TerrainBuilder,
	) {
		const {
			size,
			chunkQuads = DEFAULT_QUADS,
			maxLevel = DEFAULT_MAX_LEVEL,
			maxBlocks = DEFAULT_BLOCKS,
			blocksPerUpdate = DEFAULT_BUILDS,
		} = options;
		if (!Number.isInteger(chunkQuads) || chunkQuads < 1)
			throw new Error(
				`createTerrain() got the chunkQuads ${chunkQuads}, which is not a whole number of 1 or more.`,
			);
		if (!Number.isInteger(maxBlocks) || maxBlocks < 16)
			throw new Error(
				`createTerrain() got the maxBlocks ${maxBlocks}, which is not a whole number of 16 or more.`,
			);
		if (!Number.isInteger(blocksPerUpdate) || blocksPerUpdate < 1)
			throw new Error(
				`createTerrain() got the blocksPerUpdate ${blocksPerUpdate}, which is not a whole number of 1 or more.`,
			);
		this.context = context;
		this.fixedSkirt = options.skirt;
		this.morph = options.morph ?? true;
		this.cast = options.castShadows ?? true;
		this.receive = options.receiveShadows ?? true;
		if (options.error !== undefined && !(options.error >= 0 && Number.isFinite(options.error)))
			throw new Error(
				`createTerrain() got the error ${options.error}, which is not a number of 0 or more.`,
			);
		this.maxBlocks = maxBlocks;
		this.builds = blocksPerUpdate;
		this.camera = options.camera;
		this.fixedError = options.error;
		this.field = createHeightfield({
			size,
			resolution: options.resolution,
			height: options.height,
		});
		this.tree = new Blocks({ size, maxLevel, quads: chunkQuads, field: this.field });
		this.cellSize = this.tree.blockSize(maxLevel);
		this.halfSize = size / 2;
		this.shape = chunkShape(chunkQuads);
		const builderOptions: TerrainBuilderOptions = {
			size,
			field: this.field,
			blocks: this.tree,
			ring: this.shape.ring,
			quads: chunkQuads,
			maxLevel,
			vertices: this.shape.vertices,
			maxBlocks,
			builds: blocksPerUpdate,
			skirt: this.fixedSkirt,
		};
		this.builder = builder ? builder(builderOptions) : new WasmTerrainBuilder(builderOptions);
		this.selection.selection[1] = chunkQuads;
		const splat = options.splat ?? defaultSplat(this.field);
		this.splatTexture = splatTexture(
			context.textures,
			size,
			options.splatResolution ?? DEFAULT_SPLAT,
			splat,
		);
		// The ground's normals, one texel for each height sample, which every block's surface reads.
		this.normalTexture =
			options.bakedNormals === false ? undefined : this.bakeNormals(context.textures);
		const built = splatMaterial(context, {
			layers: options.layers,
			splat: this.splatTexture,
			size,
			metalness: options.metalness,
			normals: this.normalTexture,
			steepFaces: options.steepFaces,
			scale: 0,
			quads: chunkQuads,
		});
		this.material = built.material;
		this.white = built.white;
	}

	/**
	 * The ground's normals as a texture: the field's slope at one texel for each height sample,
	 * built here in the sketch worker. A block's surface reads it, so a coarse block keeps the
	 * relief that its vertices cannot show.
	 */
	private bakeNormals(textures: SketchContext['textures']): Texture {
		const texels = this.field.resolution;
		const data = new Uint8Array(texels * texels * 4);
		this.field.writeNormalMap(texels, data);
		return textures.fromData({
			width: texels,
			height: texels,
			data,
			colorSpace: 'linear',
			wrap: 'clamp',
			mipmaps: true,
			anisotropy: 8,
		});
	}

	/** The width and depth of the ground, in meters. */
	get size(): number {
		return this.field.size;
	}

	/** The height field, for a caller that wants to read it directly. */
	get heightfield(): Heightfield {
		return this.field;
	}

	/** How many blocks the ground draws: none while it is hidden. */
	get drawn(): number {
		return this.visible ? this.drawnBlocks : 0;
	}

	/** How many triangles the ground draws, with each block's skirt. */
	get triangles(): number {
		const grid = this.shape.quads * this.shape.quads * 2;
		const skirt = this.shape.quads * 4 * 2;
		return this.drawn * (grid + skirt);
	}

	/** True while the camera's newest selection is still being built, over the next frames. */
	get building(): boolean {
		return this.pending;
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
	 * Picks the blocks to draw for a camera whose world position `eye` holds, as x, y and z. The
	 * ground picks again when the camera crosses a cell of the finest level, rises by one such
	 * cell, or draws through a different field of view or buffer height, so a still camera costs
	 * no work. The selection and the block build run in the add-on's WebAssembly module on the
	 * engine's job workers, so this call only asks for them. A new selection builds at most
	 * `blocksPerUpdate` blocks in one task, the first selection builds every block it needs, and
	 * the ground draws the selection it had until the new one is built. A block that the new
	 * selection needs takes the mesh of one that it left out. Call it in `onUpdate` with the
	 * camera's own position, in an array you keep: an array crosses the call as it is, where two
	 * fractions make the browser box each of them into an object.
	 */
	update(eye: Vec3Like): void {
		const x = eye[0] as number;
		const z = eye[2] as number;
		if (this.ended) return;
		const y = eye[1] as number;
		const fov = this.camera?.fov ?? DEFAULT_FOV;
		const viewport = this.context.engine.viewport;
		const quality = this.context.quality.settings;
		const screen = Math.max(viewport.height * viewport.pixelRatio * quality.maxRenderScale, 1);
		// The preset's level-of-detail threshold counts in the pixels that the buffer draws.
		const error = this.fixedError ?? DEFAULT_ERROR * quality.lodThreshold;
		const cellX = Math.floor((x + this.halfSize) / this.cellSize);
		const cellZ = Math.floor((z + this.halfSize) / this.cellSize);
		if (
			cellX !== this.lastCellX ||
			cellZ !== this.lastCellZ ||
			Math.abs(y - this.lastY) >= this.cellSize ||
			fov !== this.lastFov ||
			screen !== this.lastScreen ||
			error !== this.lastError
		) {
			this.lastCellX = cellX;
			this.lastCellZ = cellZ;
			this.lastY = y;
			this.lastFov = fov;
			this.lastScreen = screen;
			this.lastError = error;
			// How far one cell of a block reaches before its error fills the buffer: half the buffer
			// over the tangent of half the field of view, over the error allowed.
			const half = Math.tan((Math.min(Math.max(fov, 0.01), 179.99) * Math.PI) / 360);
			const scale = error > 0 ? screen / (2 * half * error) : Number.POSITIVE_INFINITY;
			this.lastSelectionScale = scale;
			this.applyMorphScale(scale);
			this.stamp++;
			this.pending = true;
			this.queuedX = x;
			this.queuedY = y;
			this.queuedZ = z;
			this.queuedScale = scale;
			this.queuedStamp = this.stamp;
			this.hasQueued = true;
			this.pump();
		}
	}

	/**
	 * Turns the block morph on or off, from the next frame. The ground reads the selection's scale
	 * again with the last view, so a page that compares the look or measures the cost needs no new
	 * selection.
	 */
	setMorph(enabled: boolean): void {
		if (enabled === this.morph) return;
		this.morph = enabled;
		if (!Number.isNaN(this.lastFov)) this.applyMorphScale(this.lastSelectionScale);
	}

	/**
	 * Applies the selection's scale to the material's morph, so a block hands over where the
	 * selection switches it. 0 keeps every block where it is.
	 */
	private applyMorphScale(scale: number): void {
		const value = this.morph && Number.isFinite(scale) ? scale : 0;
		if (value === this.lastScale) return;
		this.lastScale = value;
		this.selection.selection[0] = value;
		this.material.set(this.selection);
	}

	/**
	 * Starts the newest view's selection, unless a task or a placement runs. A view that arrives
	 * meanwhile waits, and replaces the one that has not started.
	 */
	private pump(): void {
		if (this.ended) return;
		if (this.busy || !this.hasQueued) {
			if (!this.busy && !this.hasQueued) this.settle();
			return;
		}
		this.hasQueued = false;
		this.busy = true;
		this.buildingStamp = this.queuedStamp;
		this.currentStamp = this.buildingStamp;
		this.builder.select(this.queuedX, this.queuedY, this.queuedZ, this.queuedScale).then(
			(count) => this.selected(count),
			(error: unknown) => this.failed(error),
		);
	}

	/** Keeps the leaves that the builder picked, then builds the blocks of the first batch. */
	private selected(count: number): void {
		if (this.ended) return;
		// A newer view waits, so this selection would only be replaced: let it go.
		if (this.hasQueued) {
			this.busy = false;
			this.pump();
			return;
		}
		this.selectionCount = count;
		this.cursor = 0;
		this.firstSelection = this.blocks.size === 0;
		this.buildNext();
	}

	/**
	 * Collects the leaves of the newest selection that the ground does not hold yet, up to the
	 * batch that one call builds, and asks the builder for their vertices. The first selection
	 * builds every block it needs, since before it there is no ground to draw.
	 */
	private buildNext(): void {
		if (this.ended) return;
		if (this.hasQueued) {
			this.busy = false;
			this.pump();
			return;
		}
		const { tree, blocks, builder } = this;
		const stamp = this.buildingStamp;
		const limit = this.firstSelection ? builder.batch : Math.min(this.builds, builder.batch);
		let count = 0;
		while (this.cursor < this.selectionCount && count < limit) {
			const at = this.cursor * 3;
			const level = builder.leaves[at] as number;
			const column = builder.leaves[at + 1] as number;
			const row = builder.leaves[at + 2] as number;
			this.cursor++;
			const key = tree.key(level, column, row);
			const held = blocks.get(key);
			if (held) {
				held.stamp = stamp;
				continue;
			}
			builder.buildLeaves[count * 3] = level;
			builder.buildLeaves[count * 3 + 1] = column;
			builder.buildLeaves[count * 3 + 2] = row;
			count++;
		}
		if (count > 0) {
			builder.build(count).then(
				() => this.built(count),
				(error: unknown) => this.failed(error),
			);
			return;
		}
		this.finished();
	}

	/** Places the blocks that the builder wrote, then builds the next batch of the selection. */
	private built(count: number): void {
		if (this.ended) return;
		if (this.hasQueued) {
			this.busy = false;
			this.pump();
			return;
		}
		const { tree, builder } = this;
		const stamp = this.buildingStamp;
		for (let i = 0; i < count; i++) {
			const level = builder.buildLeaves[i * 3] as number;
			const column = builder.buildLeaves[i * 3 + 1] as number;
			const row = builder.buildLeaves[i * 3 + 2] as number;
			this.placeBlock(
				level,
				column,
				row,
				tree.key(level, column, row),
				stamp,
				builder.slots[i] as BuildSlot,
			);
		}
		if (this.cursor < this.selectionCount) this.buildNext();
		else this.finished();
	}

	/** Ends a selection: its blocks draw, the rest wait for the next block that needs a mesh. */
	private finished(): void {
		if (this.ended) return;
		this.retire(this.buildingStamp);
		this.selectionCount = 0;
		this.cursor = 0;
		this.busy = false;
		this.pending = this.hasQueued;
		if (this.hasQueued) this.pump();
		else this.settle();
	}

	/** Reports a failed selection once, and lets the last complete ground stand. */
	private failed(error: unknown): void {
		this.busy = false;
		this.selectionCount = 0;
		this.cursor = 0;
		// The engine stopped before the answer came: its workers are gone, so a new view asks for
		// nothing, and the ground keeps the last selection it built.
		if ((error as { stage?: string } | null)?.stage === 'stopped') {
			this.hasQueued = false;
			this.pending = false;
			this.settle();
			return;
		}
		this.pending = this.hasQueued;
		if (!this.reportedFailure) {
			const failure = error instanceof Error ? error : new Error(String(error));
			this.reportedFailure = failure;
			console.error(`terrain: the ground could not build. ${failure.message}`);
		}
		if (this.hasQueued) this.pump();
		else this.settle();
	}

	/** Resolves the callers that wait for the ground to finish building. */
	private settle(): void {
		const resolve = this.settledResolve;
		this.settledResolve = undefined;
		if (resolve) resolve();
	}

	/**
	 * @internal Resolves once no selection or build waits. The unit tests use it to drive the
	 * builder without a frame loop.
	 */
	settled(): Promise<void> {
		if (!this.busy && !this.hasQueued) return Promise.resolve();
		return new Promise((resolve) => {
			this.settledResolve = resolve;
		});
	}

	/** Shows or hides the whole ground, for a camera high above it. */
	setVisible(visible: boolean): void {
		this.visible = visible;
		this.blocks.forEach(this.setBlockVisible);
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
		this.normalTexture?.destroy();
		this.white?.destroy();
		this.builder.destroy();
		this.drawnBlocks = 0;
		this.pending = false;
		this.busy = false;
		this.hasQueued = false;
		this.selectionCount = 0;
		this.cursor = 0;
		this.ended = true;
		this.settle();
	}

	/**
	 * Ends a build: the newest selection draws, the blocks it leaves out park for the next block
	 * that needs a mesh, and the meshes that waited longest past the ground's limit are destroyed.
	 */
	private retire(stamp: number): void {
		this.currentStamp = stamp;
		this.blocks.forEach(this.showCurrent);
		this.blocks.forEach(this.parkLeftOut);
		this.trimSpares();
	}

	/** Draws a block, unless the whole ground is hidden. */
	private show(block: Block): void {
		if (block.shown) return;
		block.shown = true;
		block.object.setVisible(this.visible);
		this.drawnBlocks++;
	}

	/** Takes a block out of the ground's picture. */
	private hide(block: Block): void {
		if (!block.shown) return;
		block.shown = false;
		block.object.setVisible(false);
		this.drawnBlocks--;
	}

	/**
	 * Puts a block at the leaf of `level`, `column` and `row`: a mesh whose vertices hold that
	 * leaf's ground, taken from the blocks that earlier selections left out, and a new mesh only
	 * when none waits. The block draws once its whole selection is built, so it starts hidden.
	 */
	private placeBlock(
		level: number,
		column: number,
		row: number,
		key: number,
		stamp: number,
		slot: BuildSlot,
	): Block {
		const { tree, shape, blocks } = this;
		const blockSize = tree.blockSize(level);
		const originX = tree.blockX(level, column);
		const originZ = tree.blockZ(level, row);
		const skirt = this.fixedSkirt ?? (blockSize / shape.quads) * 4;
		let block = this.takeBlock(level);
		if (block) {
			// The mesh is the level's own, so it already carries that level's sphere: a crossing
			// gives the object a new place and leaves the bounds, and the draw table, alone.
			block.mesh.updateVertices('positions', slot.positions);
			block.mesh.updateVertices('normals', slot.normals);
			block.mesh.updateVertices('targets', slot.record);
			block.object.setPosition(originX, 0, originZ);
		} else {
			const mesh = this.context.geometry.fromArrays({
				positions: slot.positions,
				normals: slot.normals,
				uvs: shape.uvs,
				targets: slot.record,
				indices: shape.indices,
				// The blocks are the terrain's levels: each morphs toward its parent block.
				levels: false,
			});
			const object = this.context.scene.createMesh({
				mesh,
				material: this.material,
				position: [originX, 0, originZ],
				castShadows: this.cast,
				receiveShadows: this.receive,
			});
			const { center, radius } = this.blockSphere(level, blockSize, skirt);
			object.setBounds(center, radius);
			block = { key, object, mesh, level, stamp, shown: false };
		}
		block.key = key;
		block.level = level;
		block.stamp = stamp;
		block.object.setVisible(false);
		blocks.set(key, block);
		return block;
	}

	/**
	 * The block whose mesh a new block takes: one that waited, or the one that the longest has gone
	 * unused among the blocks the newest selection leaves out. Undefined while the ground holds fewer
	 * meshes than `maxBlocks`, or while every mesh it holds draws, where the new block builds one.
	 */
	private takeBlock(level: number): Block | undefined {
		const waiting = this.unpark(level);
		if (waiting) return waiting;
		if (this.blocks.size + this.spareCount >= this.maxBlocks && this.evict(level)) {
			return this.unpark(level);
		}
		return undefined;
	}

	/** Parks a block's mesh for a later block to take, at a place the array already holds. */
	private park(block: Block): void {
		this.spares[this.spareCount++] = block;
	}

	/** Takes the last parked block of `level`, or undefined when none of that level waits. */
	private unpark(level: number): Block | undefined {
		for (let i = this.spareCount - 1; i >= 0; i--) {
			const block = this.spares[i] as Block;
			if (block.level !== level) continue;
			for (let k = i; k < this.spareCount - 1; k++) this.spares[k] = this.spares[k + 1] as Block;
			this.spares[--this.spareCount] = undefined as unknown as Block;
			return block;
		}
		return undefined;
	}

	/**
	 * The sphere a block of this level reports: centred on the block's middle, with the radius to the
	 * farthest corner of the level's ground. One sphere serves every block of a level, so a block that
	 * takes another's mesh keeps it, and a cell crossing writes no new bounds.
	 */
	private blockSphere(
		level: number,
		blockSize: number,
		skirt: number,
	): { center: [number, number, number]; radius: number } {
		const cached = this.spheres.get(level);
		if (cached) return cached;
		const { min, max } = this.field;
		const low = min - skirt;
		const center: [number, number, number] = [blockSize / 2, (low + max) / 2, blockSize / 2];
		// The block's box: its middle across the two sides, its middle in height, and the distance
		// from there to a corner at the top or the bottom of the ground.
		const radius = Math.hypot(blockSize / Math.SQRT2, (max - low) / 2);
		const sphere = { center, radius };
		this.spheres.set(level, sphere);
		return sphere;
	}

	/**
	 * Parks the oldest block that the newest selection leaves out and that no longer draws, for the
	 * next block to take. False when every block either belongs to the newest selection or draws.
	 */
	private evict(level: number): boolean {
		this.oldest = undefined;
		this.oldestKey = 0;
		this.scanLevel = level;
		this.blocks.forEach(this.scanOldest);
		const oldest = this.oldest;
		if (!oldest) return false;
		this.blocks.delete(this.oldestKey);
		this.park(oldest);
		return true;
	}

	/**
	 * Ends the meshes that waited longest past the ground's limit: it holds up to `maxBlocks` of
	 * them, or the whole of one selection where that needs more.
	 */
	private trimSpares(): void {
		const limit = Math.max(this.maxBlocks, this.blocks.size);
		while (this.blocks.size + this.spareCount > limit) {
			if (this.spareCount === 0) return;
			const spare = this.spares[0] as Block;
			for (let i = 1; i < this.spareCount; i++) this.spares[i - 1] = this.spares[i] as Block;
			this.spares[--this.spareCount] = undefined as unknown as Block;
			this.endBlock(spare);
		}
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
