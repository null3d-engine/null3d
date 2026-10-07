// Sprites: quads that face the camera, drawn in batches. A sprite batch is an instance batch in
// the engine core whose rows hold a size, a rotation, a color and an atlas frame instead of a
// rotation and a scale. The core packs each row into the row's world matrix, so sprites cull, sort
// and draw as other rows do, and the sprite shaders unpack them. Points are sprites of one size,
// with no rotation and no atlas, so a point batch is a sprite batch with fewer arrays.
//
// `scene.createSprites` and `scene.createPoints` import this module the first time, so a page
// without sprites or points downloads none of it. Like the glTF loader, it imports no engine module but constants and types. The
// bundler would move a module that it shares with its thread's first file into a file of its own,
// which every page would then download at its start. So the scene checks the options, and hands
// this module the engine's geometry and materials.

import * as C from '../generated/core';
import type { CoreMemory } from './memory';
import type {
	ObjectEventHandler,
	ObjectEventType,
	PointerListeners,
	PointerRows,
	PointerTarget,
} from './pointer-events';
import type {
	AlphaMode,
	Geometry,
	Material,
	MaterialFeatures,
	MaterialOptions,
	Materials,
	MeshGeometry,
} from './resources';
import type { Vec3 } from './scene';
import type { Texture } from './textures';

/**
 * A grid of frames in one texture: `columns` across and `rows` down, all the same size. Frame 0 is
 * the top left frame, and frames count along each row, then down.
 *
 * @category api/sprites
 */
export interface SpriteAtlas {
	/** The frames across the texture, from 1 to 2048. */
	columns: number;
	/** The frames down the texture, from 1 to 2048. */
	rows: number;
}

/**
 * The values of a sprite batch's material, which `sprites.material.set` changes at any time.
 *
 * @category api/sprites
 */
export type SpriteValues = MaterialOptions;

/**
 * Options of `scene.createSprites`. The look of the sprites takes the options of an unlit
 * material, but sprites blend by default, as three.js's `SpriteMaterial` does.
 *
 * @category api/sprites
 */
export interface SpriteOptions
	extends SpriteValues,
		Omit<MaterialFeatures, 'doubleSided' | 'vertexColors' | 'forceSinglePass'> {
	/** The number of sprites: the batch's capacity, which never changes. */
	count: number;
	/**
	 * A color map, in sRGB, whose color multiplies `color` and each sprite's color. With `atlas`,
	 * each sprite shows one frame of it. It is fixed when the batch is created.
	 */
	map?: Texture;
	/** Splits `map` into a grid of frames, which each sprite picks from with its `frames` row. */
	atlas?: SpriteAtlas;
	/**
	 * True gives sizes in world units, so far sprites look smaller, as three.js's
	 * `sizeAttenuation` does. False gives sizes in CSS pixels, so every sprite keeps its size on
	 * screen. The default is true.
	 */
	sizeAttenuation?: boolean;
	/**
	 * The point of each sprite that sits at its position, as a fraction of its width and height
	 * from its bottom left corner, like three.js's `Sprite.center`. The sprite turns about it. The
	 * default, `[0.5, 0.5]`, is the middle; `[0.5, 0]` stands a sprite on its position.
	 */
	center?: readonly [number, number];
	/** Every sprite updates and uploads every frame; a static batch updates rows marked dirty only. */
	dynamic?: boolean;
	/** The layers every sprite is on, as a 32-bit mask. The default, 1, is layer 0. */
	layers?: number;
	/**
	 * The point that every sprite's position is relative to, as an instance batch's `origin`. The
	 * default is (0, 0, 0). Sprites near it keep the precision of 32-bit floats at any distance from
	 * the world's origin.
	 */
	origin?: Vec3;
	/** How the sprites use their alpha. The default is `blend`, as three.js's sprites blend. */
	alphaMode?: MaterialFeatures['alphaMode'];
}

/** The options of a sprite batch besides its count: what its quad, material and rows take. */
export type SpriteLook = Omit<SpriteOptions, 'count'>;

/** What a sprite batch's quad and material are made with: the engine's objects. */
export interface SpriteMakers {
	geometry: Geometry;
	materials: Materials;
}

/** The parts of a sprite batch that the scene makes for it. */
export interface SpriteParts {
	/** The quad mesh around the sprites' anchor. */
	mesh: MeshGeometry;
	material: Material<SpriteValues>;
}

/**
 * The quad of the sprites with anchor `center`: one unit wide and high, in the xy plane, with
 * texture coordinates from 0 at its bottom left to 1 at its top right, and the anchor at the
 * origin. `quads` holds the quads made so far, by center, which batches with one center share.
 */
function quadMesh(
	geometry: Geometry,
	quads: Map<string, MeshGeometry>,
	[cx, cy]: readonly [number, number],
): MeshGeometry {
	const key = `${cx},${cy}`;
	const known = quads.get(key);
	if (known) return known;
	const [left, bottom, right, top] = [0 - cx, 0 - cy, 1 - cx, 1 - cy];
	const mesh = geometry.fromArrays({
		positions: new Float32Array([left, bottom, 0, right, bottom, 0, right, top, 0, left, top, 0]),
		// Every mesh has normals. The sprite shaders read none, so the quad's face +z.
		normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
		uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
		indices: [0, 1, 2, 0, 2, 3],
	});
	quads.set(key, mesh);
	return mesh;
}

/**
 * Makes a batch's quad and material from the options of `scene.createSprites` or
 * `scene.createPoints`, which the scene has checked, and the atlas's frames across and down. The
 * material takes `alphaMode` when the options give none. `quads` holds the quads made so far, by
 * center.
 */
export function spriteParts(
	{ geometry, materials }: SpriteMakers,
	quads: Map<string, MeshGeometry>,
	options: SpriteLook,
	[columns, rows]: readonly [number, number],
	alphaMode: AlphaMode,
	call: string,
): SpriteParts {
	const material = materials.create<SpriteValues>(
		C.SHADING_SPRITE,
		{
			...options,
			alphaMode: options.alphaMode ?? alphaMode,
			doubleSided: true,
			vertexColors: false,
			uvTransform: { repeat: [1 / columns, 1 / rows] },
		},
		`${call}.material`,
	);
	return { mesh: quadMesh(geometry, quads, options.center ?? [0.5, 0.5]), material };
}

/** The row arrays of a sprite batch, as views of engine memory. */
interface SpriteRows {
	positions: Float32Array;
	sizes: Float32Array;
	rotations: Float32Array;
	colors: Float32Array;
	frames: Uint32Array;
}

/** What a sprite batch's calls that change rows reach in the core: the instance batch's calls. */
export interface SpriteBatchRows extends PointerRows {
	setActiveCount(count: number): void;
	setLayers(mask: number): void;
	markDirty(start?: number, count?: number): void;
	destroy(): void;
}

/**
 * Many sprites: quads that face the camera, each with its own position, size, rotation, color and
 * atlas frame. Write rows straight into the typed arrays, as for an instance batch. A dynamic batch
 * updates every sprite every frame, and a static batch updates the rows you mark dirty.
 *
 * @category api/sprites
 */
export class SpriteBatch {
	private generation = -1;
	private rows!: SpriteRows;
	/** @internal The batch's pointer event handlers, from its first `on`. */
	pointerListeners: PointerListeners | undefined = undefined;

	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		/** @internal */ readonly id: number,
		/** The number of sprites: the batch's capacity. */
		readonly count: number,
		/** The sprites' material: `set` changes the color, opacity and alpha cutoff of every sprite. */
		readonly material: Material<SpriteValues>,
		/** @internal The instance batch's calls, which a point batch's calls reach too. */
		readonly batch: SpriteBatchRows,
	) {}

	/**
	 * The row arrays, made again after the engine's memory grew. Sketches read rows every frame, so
	 * this check creates no closure.
	 */
	private views(): SpriteRows {
		if (this.generation !== this.core.generation) this.makeViews();
		return this.rows;
	}

	private makeViews(): void {
		const { core, count } = this;
		const address = (field: number) =>
			core.check(core.glue.batchArrays(this.id, field), 'sprite arrays', 'a sprite batch');
		this.rows = {
			positions: core.f32(address(C.BATCH_FIELD_POSITIONS), count * 3),
			sizes: core.f32(address(C.BATCH_FIELD_SIZES), count * 2),
			rotations: core.f32(address(C.BATCH_FIELD_ROTATIONS), count),
			colors: core.f32(address(C.BATCH_FIELD_COLORS), count * 4),
			frames: core.u32(address(C.BATCH_FIELD_FRAMES), count),
		};
		this.generation = core.generation;
	}

	/** Positions in the world, 3 floats per sprite. A new sprite is at the origin. */
	get positions(): Float32Array {
		return this.views().positions;
	}

	/**
	 * Width and height, 2 floats per sprite: world units, or CSS pixels without size attenuation.
	 * A new sprite is 1 by 1. A negative size mirrors the sprite.
	 */
	get sizes(): Float32Array {
		return this.views().sizes;
	}

	/**
	 * The turn of each sprite on the screen, in radians, counterclockwise, 1 float per sprite, like
	 * three.js's `SpriteMaterial.rotation`. A new sprite has 0.
	 */
	get rotations(): Float32Array {
		return this.views().rotations;
	}

	/**
	 * Linear RGBA colors, 4 floats per sprite, which multiply the material's color and map. A new
	 * sprite is white. Components from 0 to 1024 draw, and alpha from 0 to 1.
	 */
	get colors(): Float32Array {
		return this.views().colors;
	}

	/**
	 * The frame of the atlas that each sprite shows, 1 per sprite. Frame 0 is the top left. A frame
	 * past the last one counts again from the first.
	 */
	get frames(): Uint32Array {
		return this.views().frames;
	}

	/** Draws only the first `count` sprites. */
	setActiveCount(count: number): void {
		this.batch.setActiveCount(count);
	}

	/** Puts every sprite on the layers of a 32-bit mask. A new mask needs no rebuild. */
	setLayers(mask: number): void {
		this.batch.setLayers(mask);
	}

	/** Marks sprites of a static batch to update and upload. */
	markDirty(start = 0, count = this.count - start): void {
		this.batch.markDirty(start, count);
	}

	/**
	 * Calls `handler` for each pointer event of `type` on a sprite of the batch, as `Object3D.on`
	 * does. A ray hits a sprite where its quad draws. The event's `instance` names the sprite.
	 */
	on(type: ObjectEventType, handler: ObjectEventHandler): void {
		this.batch.listen(this, type, handler);
	}

	/** Removes a handler that `on` added for events of `type`. */
	off(type: ObjectEventType, handler: ObjectEventHandler): void {
		this.batch.unlisten(this, type, handler);
	}

	/** @internal The frame in which the batch was destroyed, or -1. */
	get destroyedFrame(): number {
		return this.batch.destroyedFrame;
	}

	/** @internal A batch has no parent for its pointer events to go on to. */
	pointerParent(): PointerTarget | null {
		return null;
	}

	/**
	 * Removes the batch and frees its rows. Its typed arrays are not valid after this: another
	 * batch can take their memory.
	 */
	destroy(): void {
		this.batch.destroy();
		this.material.destroy();
		this.generation = -1;
	}
}

/**
 * The values of a point batch's material, which `points.material.set` changes at any time.
 *
 * @category api/points
 */
export type PointValues = MaterialOptions;

/**
 * Options of `scene.createPoints`. The look of the points takes the options of an unlit material.
 * Points are opaque by default, as three.js's `PointsMaterial` is.
 *
 * @category api/points
 */
export interface PointOptions
	extends PointValues,
		Omit<MaterialFeatures, 'doubleSided' | 'vertexColors'> {
	/**
	 * The points: 3 numbers each. Their number is the batch's capacity, which never changes, and
	 * `points.positions` holds them after the call.
	 */
	positions: ArrayLike<number>;
	/**
	 * Linear colors that multiply `color`: 3 numbers per point (RGB), or 4 (RGBA). The default is
	 * white.
	 */
	colors?: ArrayLike<number>;
	/**
	 * The width and height of every point: world units, or CSS pixels without size attenuation. The
	 * default is 1.
	 */
	size?: number;
	/**
	 * True gives the size in world units, so far points look smaller. False gives it in CSS pixels,
	 * so every point keeps its size on screen, as three.js's `sizeAttenuation: false` does. The
	 * default is true.
	 */
	sizeAttenuation?: boolean;
	/**
	 * A color map, in sRGB, that each point shows whole and upright, and whose color multiplies the
	 * point's. It is fixed when the batch is created.
	 */
	map?: Texture;
	/** Every point updates and uploads every frame; a static batch updates points marked dirty only. */
	dynamic?: boolean;
	/** The layers every point is on, as a 32-bit mask. The default, 1, is layer 0. */
	layers?: number;
	/**
	 * The point that every point's position is relative to, as an instance batch's `origin`. The
	 * default is (0, 0, 0). Points near it keep the precision of 32-bit floats at any distance from
	 * the world's origin.
	 */
	origin?: Vec3;
	/** How the points use their alpha. The default is `opaque`, as three.js's points are. */
	alphaMode?: MaterialFeatures['alphaMode'];
}

/** The checks of a point batch's later calls, which the scene gives, as this module has no errors. */
export interface PointChecks {
	/** Throws for a size that is not a positive finite number. */
	size(size: number, call: string): void;
}

/**
 * Many points: squares that face the camera, all of one size, each with its own position and color,
 * like three.js's `Points` with a `PointsMaterial`. Write points straight into the typed arrays, as
 * for an instance batch. A dynamic batch updates every point every frame, and a static batch
 * updates the points you mark dirty.
 *
 * @category api/points
 */
export class PointBatch {
	/** @internal The batch's pointer event handlers, from its first `on`. */
	pointerListeners: PointerListeners | undefined = undefined;

	/** @internal */
	constructor(
		private readonly sprites: SpriteBatch,
		private readonly checks: PointChecks,
	) {}

	/** The number of points: the batch's capacity. */
	get count(): number {
		return this.sprites.count;
	}

	/** The points' material: `set` changes the color, opacity and alpha cutoff of every point. */
	get material(): Material<PointValues> {
		return this.sprites.material;
	}

	/** Positions in the world, 3 floats per point. */
	get positions(): Float32Array {
		return this.sprites.positions;
	}

	/**
	 * Linear RGBA colors, 4 floats per point, which multiply the material's color and map.
	 * Components from 0 to 1024 draw, and alpha from 0 to 1.
	 */
	get colors(): Float32Array {
		return this.sprites.colors;
	}

	/**
	 * Sets the size of every point: world units, or CSS pixels for points made with
	 * `sizeAttenuation: false`. Every point updates and uploads once.
	 */
	setSize(size: number): void {
		this.checks.size(size, 'points.setSize');
		this.sprites.sizes.fill(size);
		this.sprites.markDirty();
	}

	/** Draws only the first `count` points. */
	setActiveCount(count: number): void {
		this.sprites.setActiveCount(count);
	}

	/** Puts every point on the layers of a 32-bit mask. A new mask needs no rebuild. */
	setLayers(mask: number): void {
		this.sprites.setLayers(mask);
	}

	/** Marks points of a static batch to update and upload. */
	markDirty(start = 0, count = this.count - start): void {
		this.sprites.markDirty(start, count);
	}

	/**
	 * Calls `handler` for each pointer event of `type` on a point of the batch, as `Object3D.on`
	 * does. A ray hits a point where its square draws. The event's `instance` names the point.
	 */
	on(type: ObjectEventType, handler: ObjectEventHandler): void {
		this.sprites.batch.listen(this, type, handler);
	}

	/** Removes a handler that `on` added for events of `type`. */
	off(type: ObjectEventType, handler: ObjectEventHandler): void {
		this.sprites.batch.unlisten(this, type, handler);
	}

	/** @internal The frame in which the batch was destroyed, or -1. */
	get destroyedFrame(): number {
		return this.sprites.batch.destroyedFrame;
	}

	/** @internal A batch has no parent for its pointer events to go on to. */
	pointerParent(): PointerTarget | null {
		return null;
	}

	/**
	 * Removes the batch and frees its points. Its typed arrays are not valid after this: another
	 * batch can take their memory.
	 */
	destroy(): void {
		this.sprites.destroy();
	}
}

/**
 * Makes the point batch of a new sprite batch, and writes the points of `scene.createPoints`, which
 * the scene has checked: their positions, their colors of 3 or 4 numbers each, and their size.
 */
export function pointBatch(
	sprites: SpriteBatch,
	checks: PointChecks,
	positions: ArrayLike<number>,
	colors: ArrayLike<number> | undefined,
	size: number,
): PointBatch {
	sprites.positions.set(positions);
	sprites.sizes.fill(size);
	if (colors?.length === sprites.count * 4) sprites.colors.set(colors);
	else if (colors) {
		const target = sprites.colors;
		for (let i = 0; i < sprites.count; i++)
			for (let c = 0; c < 3; c++) target[i * 4 + c] = colors[i * 3 + c] as number;
	}
	return new PointBatch(sprites, checks);
}
