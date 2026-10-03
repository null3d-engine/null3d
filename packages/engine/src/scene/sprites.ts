// Sprites: quads that face the camera, drawn in batches. A sprite batch is an instance batch in
// the engine core whose rows hold a size, a rotation, a color and an atlas frame instead of a
// rotation and a scale. The core packs each row into the row's world matrix, so sprites cull, sort
// and draw as other rows do, and the sprite shaders unpack them. The quad and the material of a
// new batch come from `sprite-parts.ts`, which the sketch runner hands to the scene, so the scene's
// module imports no value from the material and mesh modules.

import * as C from '../generated/core';
import type { CoreMemory } from './memory';
import type { Material, MaterialFeatures, MaterialOptions } from './resources';
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
		Omit<MaterialFeatures, 'doubleSided' | 'vertexColors'> {
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
	/** How the sprites use their alpha. The default is `blend`, as three.js's sprites blend. */
	alphaMode?: MaterialFeatures['alphaMode'];
}

/** The parts of a sprite batch that the scene makes for it. */
export interface SpriteParts {
	/** The quad mesh around the sprites' anchor. */
	mesh: number;
	material: Material<SpriteValues>;
	columns: number;
	rows: number;
}

/**
 * Checks the options of `scene.createSprites` and makes a batch's quad and material. `quads` holds
 * the quads made so far, by center, which batches with one center share.
 */
export type SpritePartsMaker = (
	quads: Map<string, number>,
	options: SpriteOptions,
	call: string,
) => SpriteParts;

/** The row arrays of a sprite batch, as views of engine memory. */
interface SpriteRows {
	positions: Float32Array;
	sizes: Float32Array;
	rotations: Float32Array;
	colors: Float32Array;
	frames: Uint32Array;
}

/** What a sprite batch's calls that change rows reach in the core: the instance batch's calls. */
export interface SpriteBatchRows {
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

	/** @internal */
	constructor(
		private readonly core: CoreMemory,
		/** @internal */ readonly id: number,
		/** The number of sprites: the batch's capacity. */
		readonly count: number,
		/** The sprites' material: `set` changes the color, opacity and alpha cutoff of every sprite. */
		readonly material: Material<SpriteValues>,
		private readonly batch: SpriteBatchRows,
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
	 * Removes the batch and frees its rows. Its typed arrays are not valid after this: another
	 * batch can take their memory.
	 */
	destroy(): void {
		this.batch.destroy();
		this.generation = -1;
	}
}
