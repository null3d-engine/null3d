// The terrain add-on: a height field drawn as a camera-centered quadtree of blocks, so the ground
// near the camera is fine and the far ground is cheap. Every block of one level shares one grid,
// and draws as a row of that level's instance batch, so the whole ground costs a draw per level in
// each pass. The grid's vertex shader takes each vertex's height and normal from the height field,
// which a texture holds, with a skirt around the block's edge that closes the seam where two blocks
// of different levels meet. One material lights every pixel from the vertex normals or from normals
// baked over the whole ground, so a coarse block can keep the hills' relief. The material blends
// up to four tiled layers over all the blocks, and each layer's own height shows it through its
// neighbours at a boundary. The terrain has no collision: a game reads `heightAt` and `normalAt` to
// place what stands on it. The selection that picks the blocks runs in the add-on's WebAssembly
// module on the engine's job workers, so a frame only asks for the work.
import type { InstanceBatch, MeshGeometry, SketchContext, Texture, Vec3Like } from '@null3d/engine';
import { Blocks, leavesPerSide } from './blocks';
import { type ChunkShape, chunkShape } from './chunk';
import { createHeightfield, type Heightfield } from './heightfield';
import { type SplatMaterial, splatMaterial, type TerrainLayer } from './material';
import { defaultSplat, type SplatFunction, splatTexture } from './splat';
import {
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
 * Where a ray met the ground, which `terrain.raycast` writes.
 *
 * @category api/terrain
 */
export interface TerrainHit {
	/** The point where the ray met the ground, as x, y and z. */
	point: number[] | Float32Array;
	/** The unit normal of the ground at that point, as `normalAt` gives it. */
	normal: number[] | Float32Array;
	/** The distance along the ray, in meters. */
	distance: number;
}

/**
 * The blocks of one level: the grid that they share, and the instance batch whose rows draw them,
 * one row for each block of the newest selection at that level.
 */
interface LevelBatch {
	readonly level: number;
	readonly mesh: MeshGeometry;
	batch: InstanceBatch;
	/** The rows the batch holds. */
	capacity: number;
	/** The rows that the newest selection fills, from the first. */
	count: number;
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
/** The rows that a level's batch holds at first, at most: a level holds fewer blocks than that. */
const FIRST_ROWS = 256;

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
	/** The height field, and the baked normals where the ground bakes them, as layers. */
	private readonly mapsTexture: Texture;
	private readonly white: Texture | undefined;
	private readonly shape: ChunkShape;
	private readonly fixedSkirt: number | undefined;
	/** The camera whose field of view sets the split, or undefined for the default. */
	private readonly camera: { readonly fov: number } | undefined;
	/** The screen error, in pixels, that a block's cell may show, or undefined for the preset's. */
	private readonly fixedError: number | undefined;
	private readonly cast: boolean;
	private readonly receive: boolean;
	/** The batch of each level, from the root down. */
	private readonly levels: LevelBatch[] = [];
	/** The builder that picks the blocks. */
	private readonly builder: TerrainBuilder;
	/** True while a selection runs. */
	private busy = false;
	/** The newest view, which waits while an older selection runs. */
	private hasQueued = false;
	private queuedX = 0;
	private queuedY = 0;
	private queuedZ = 0;
	private queuedScale = 0;
	/** The view's scale that the newest selection used, which the morph reads. */
	private lastSelectionScale = 0;
	/** The promise that settles when no selection waits. */
	private settledResolve: (() => void) | undefined;
	/** The first failure of the builder, which the ground reports once. */
	private reportedFailure: Error | undefined;
	/** True moves each block toward its parent's surface. */
	private morph: boolean;
	/** The selection's scale that the material's morph reads, and the one it last got. */
	private readonly selection: { selection: [number, number] } = { selection: [0, 0] };
	private lastScale = Number.NaN;
	/** The size of a leaf of the finest level, and half of the ground's width. */
	private readonly cellSize: number;
	private readonly halfSize: number;
	private lastCellX = Number.NaN;
	private lastCellZ = Number.NaN;
	/** The eye's height and the view that the newest selection used. */
	private lastY = Number.NaN;
	private lastFov = Number.NaN;
	private lastScreen = Number.NaN;
	private lastError = Number.NaN;
	/** How many blocks draw, which `drawn` reports as none while the ground is hidden. */
	private drawnBlocks = 0;
	/** True while the camera's newest selection is still being picked. */
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
		const baked = options.bakedNormals !== false;
		this.mapsTexture = this.groundMaps(context.textures, baked);
		const built = splatMaterial(context, {
			layers: options.layers,
			splat: this.splatTexture,
			size,
			metalness: options.metalness,
			normals: baked,
			maps: this.mapsTexture,
			steepFaces: options.steepFaces,
			scale: 0,
			quads: chunkQuads,
		});
		this.material = built.material;
		this.white = built.white;
		for (let level = 0; level <= maxLevel; level++) this.levels.push(this.levelBatch(level));
	}

	/**
	 * The ground's maps, one texel for each height sample. Layer 0 holds the height field, each
	 * texel's four bytes holding one sample's 32-bit float, which the blocks' shared grids read for
	 * their heights, so a block needs no vertices of its own. Layer 1, where the ground bakes its
	 * normals, and zero elsewhere, holds the field's slope, which a coarse block's surface reads to keep the relief that
	 * its vertices cannot show. Both are built here in the sketch worker.
	 */
	private groundMaps(textures: SketchContext['textures'], baked: boolean): Texture {
		const { resolution, heights } = this.field;
		if (resolution > textures.maxSize)
			throw new Error(
				`createTerrain() got the resolution ${resolution}, but this device's textures hold at most ${textures.maxSize} texels a side. Pass a resolution of ${textures.maxSize} or less.`,
			);
		const layer = resolution * resolution * 4;
		// The array always holds two layers, since the shader reads it as a texture array.
		const data = new Uint8Array(layer * 2);
		if (baked) this.field.writeNormalMap(resolution, data.subarray(0, layer));
		data.set(new Uint8Array(heights.buffer, heights.byteOffset, heights.byteLength), layer);
		return textures.fromData({
			width: resolution,
			height: resolution,
			depth: 2,
			data,
			colorSpace: 'linear',
			wrap: 'clamp',
			mipmaps: true,
			anisotropy: 8,
		});
	}

	/**
	 * The shared grid and the batch of one level. The grid's vertices stand at the ground's highest
	 * height, and its skirt at the lowest less the skirt's depth, so the grid's own bounds hold every
	 * block of the level and the batch culls each block by them. The vertex shader moves each vertex
	 * onto the ground. The record gives each vertex its skirt's depth, the block's size and the
	 * parent block's size.
	 */
	private levelBatch(level: number): LevelBatch {
		const { shape, tree, field } = this;
		const blockSize = tree.blockSize(level);
		const parentSize = level > 0 ? tree.blockSize(level - 1) : blockSize;
		const skirt = this.fixedSkirt ?? (blockSize / shape.quads) * 4;
		const { quads, vertices, ring } = shape;
		const side = quads + 1;
		const grid = side * side;
		const cell = blockSize / quads;
		const positions = new Float32Array(vertices * 3);
		const normals = new Float32Array(vertices * 3);
		const record = new Float32Array(vertices * 4);
		for (let i = 0; i < vertices; i++) {
			const source = i < grid ? i : (ring[i - grid] as number);
			positions[i * 3] = (source % side) * cell;
			positions[i * 3 + 1] = i < grid ? field.max : field.min - skirt;
			positions[i * 3 + 2] = Math.floor(source / side) * cell;
			normals[i * 3 + 1] = 1;
			record[i * 4] = i < grid ? 0 : skirt;
			record[i * 4 + 1] = blockSize;
			record[i * 4 + 2] = parentSize;
		}
		const mesh = this.context.geometry.fromArrays({
			positions,
			normals,
			uvs: shape.uvs,
			targets: record,
			indices: shape.indices,
			// The blocks are the terrain's levels: each morphs toward its parent block.
			levels: false,
		});
		const capacity = Math.min(leavesPerSide(level) ** 2, FIRST_ROWS);
		return { level, mesh, batch: this.makeBatch(mesh, capacity), capacity, count: 0 };
	}

	/** An instance batch of `capacity` rows of a level's grid, which draws none at first. */
	private makeBatch(mesh: MeshGeometry, capacity: number): InstanceBatch {
		const batch = this.context.scene.createInstances(mesh, capacity, {
			material: this.material,
			values: true,
			castShadows: this.cast,
			receiveShadows: this.receive,
			// The grid's own triangles stand at the ground's highest height until the vertex shader
			// moves them, so a scene query would hit a roof over the field: `raycast` finds the ground.
			queries: false,
		});
		batch.setActiveCount(0);
		return batch;
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

	/** True while the camera's newest selection is still being picked, over the next frames. */
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
	 * Casts a ray at the ground from `origin` along `direction`, which need not be one unit long,
	 * and writes where it first meets the ground into `hit`. True on a hit within `maxDistance`
	 * meters. The ground is the surface that `heightAt` gives, over the terrain's square, so the
	 * answer does not depend on the blocks that draw. The scene's own raycasts pass over the
	 * terrain. A ray that starts under the ground meets it where it starts. Allocates nothing.
	 */
	raycast(
		origin: Vec3Like,
		direction: Vec3Like,
		hit: TerrainHit,
		maxDistance = Number.POSITIVE_INFINITY,
	): boolean {
		const ox = origin[0] as number;
		const oy = origin[1] as number;
		const oz = origin[2] as number;
		const length = Math.sqrt(
			(direction[0] as number) ** 2 + (direction[1] as number) ** 2 + (direction[2] as number) ** 2,
		);
		if (!(length > 0)) return false;
		const dx = (direction[0] as number) / length;
		const dy = (direction[1] as number) / length;
		const dz = (direction[2] as number) / length;
		const distance = this.field.raycast(ox, oy, oz, dx, dy, dz, maxDistance);
		if (distance < 0) return false;
		const x = ox + dx * distance;
		const z = oz + dz * distance;
		hit.point[0] = x;
		hit.point[1] = oy + dy * distance;
		hit.point[2] = z;
		this.field.normalAt(x, z, hit.normal);
		hit.distance = distance;
		return true;
	}

	/**
	 * Picks the blocks to draw for a camera whose world position `eye` holds, as x, y and z. The
	 * ground picks again when the camera crosses a cell of the finest level, rises by one such
	 * cell, or draws through a different field of view or buffer height, so a still camera costs
	 * no work. The selection runs in the add-on's WebAssembly module on the engine's job workers,
	 * so this call only asks for it, and the ground draws the selection it had until the new one
	 * arrives. Call it in `onUpdate` with the camera's own position, in an array you keep: an array
	 * crosses the call as it is, where two fractions make the browser box each of them into an
	 * object.
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
			this.pending = true;
			this.queuedX = x;
			this.queuedY = y;
			this.queuedZ = z;
			this.queuedScale = scale;
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
	 * Starts the newest view's selection, unless one runs. A view that arrives meanwhile waits, and
	 * replaces the one that has not started.
	 */
	private pump(): void {
		if (this.ended) return;
		if (this.busy || !this.hasQueued) {
			if (!this.busy && !this.hasQueued) this.settle();
			return;
		}
		this.hasQueued = false;
		this.busy = true;
		this.builder.select(this.queuedX, this.queuedY, this.queuedZ, this.queuedScale).then(
			(count) => this.selected(count),
			(error: unknown) => this.failed(error),
		);
	}

	/** Draws the leaves that the builder picked: one row of its level's batch for each. */
	private selected(count: number): void {
		if (this.ended) return;
		this.busy = false;
		// A newer view waits, so this selection would only be replaced: let it go.
		if (this.hasQueued) {
			this.pump();
			return;
		}
		this.place(count);
		this.pending = false;
		this.settle();
	}

	/**
	 * Writes the selection's leaves into the rows of their levels' batches: each row stands at its
	 * block's low corner, with the lowest and highest height of the block's ground in its values.
	 */
	private place(count: number): void {
		const { tree, builder, levels } = this;
		for (const level of levels) level.count = 0;
		for (let i = 0; i < count; i++) {
			const level = levels[builder.leaves[i * 3] as number] as LevelBatch;
			if (level.count === level.capacity) this.grow(level);
			level.count++;
		}
		for (const level of levels) level.count = 0;
		for (let i = 0; i < count; i++) {
			const at = i * 3;
			const depth = builder.leaves[at] as number;
			const column = builder.leaves[at + 1] as number;
			const row = builder.leaves[at + 2] as number;
			const level = levels[depth] as LevelBatch;
			const slot = level.count++;
			const positions = level.batch.positions;
			positions[slot * 3] = tree.blockX(depth, column);
			positions[slot * 3 + 1] = 0;
			positions[slot * 3 + 2] = tree.blockZ(depth, row);
			const values = level.batch.values as Float32Array;
			values[slot * 4] = tree.lowAt(depth, column, row);
			values[slot * 4 + 1] = tree.highAt(depth, column, row);
		}
		for (const level of levels) {
			if (level.count > 0) level.batch.markDirty(0, level.count);
			level.batch.setActiveCount(this.visible ? level.count : 0);
		}
		this.drawnBlocks = count;
	}

	/** Gives a level's batch twice the rows, for a selection that holds more of its blocks. */
	private grow(level: LevelBatch): void {
		level.batch.destroy();
		level.capacity = Math.min(level.capacity * 2, leavesPerSide(level.level) ** 2);
		level.batch = this.makeBatch(level.mesh, level.capacity);
	}

	/** Reports a failed selection once, and lets the last complete ground stand. */
	private failed(error: unknown): void {
		this.busy = false;
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
	 * @internal Resolves once no selection waits. The unit tests use it to drive the builder
	 * without a frame loop.
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
		for (const level of this.levels) level.batch.setActiveCount(visible ? level.count : 0);
	}

	/** Destroys the ground: every level's batch and grid, and the material's own textures. */
	destroy(): void {
		for (const level of this.levels) {
			level.batch.destroy();
			level.mesh.destroy();
		}
		this.levels.length = 0;
		this.material.destroy();
		this.splatTexture.destroy();
		this.mapsTexture.destroy();
		this.white?.destroy();
		this.builder.destroy();
		this.drawnBlocks = 0;
		this.pending = false;
		this.busy = false;
		this.hasQueued = false;
		this.ended = true;
		this.settle();
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
