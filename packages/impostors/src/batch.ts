// The impostor batch: camera-facing cards that show the stored view nearest the camera. The batch
// is the engine's sprite batch, so it culls, sorts and fades as any sprite does, and draws on
// WebGPU and WebGL2 with the sprite shader. This module only picks each card's frame from the
// camera's direction, once a frame.

import type { ColorInput, Scene, SpriteBatch, Texture, Vec3Like } from '@null3d/engine';
import { impostorFrame, type OctahedralAtlas } from './octahedral';

/**
 * Options of `createImpostors`: the atlas, the cards and their look.
 *
 * @category api/impostors
 */
export interface ImpostorOptions {
	/** The batch's atlas texture, in sRGB: every view of the object, in the cells of `atlas`. */
	readonly texture: Texture;
	/** The cells of the atlas: the frames across and down. */
	readonly atlas: OctahedralAtlas;
	/** The cards: three numbers each, x, y and z, in the world. Their count is the batch's size. */
	readonly positions: ArrayLike<number>;
	/**
	 * The width and height of every card, in world units. One number makes a square card. The
	 * default is the atlas's cells, one unit each, which suits a bake at one unit per cell.
	 */
	readonly size?: number | readonly [number, number];
	/**
	 * The point of each card that sits at its position, as a fraction of its width and height from
	 * its bottom left corner, like three.js's `Sprite.center`. The default, `[0.5, 0]`, stands a
	 * card on its position, as a tree stands on the ground.
	 */
	readonly center?: readonly [number, number];
	/** Linear RGBA colors, four numbers per card, which multiply the atlas's color. Default white. */
	readonly colors?: ArrayLike<number>;
	/** How the cards use their alpha: `blend` by default, as sprites, or `mask` to cut them out. */
	readonly alphaMode?: 'opaque' | 'blend' | 'mask';
	/** A color that multiplies the atlas, which `set` changes at any time. */
	readonly color?: ColorInput;
	/** The point that every card's position is relative to, for precision far from the origin. */
	readonly origin?: readonly [number, number, number];
	/** The layers every card is on, as a 32-bit mask. The default, 1, is layer 0. */
	readonly layers?: number;
}

/**
 * A batch of impostor cards, which `createImpostors` makes. It wraps the engine's sprite batch,
 * which draws the cards, and adds `update`, which picks each card's view from the camera. Change
 * the cards' positions and colors through `sprites`.
 *
 * @category api/impostors
 */
export class ImpostorBatch {
	/** The direction from the last card to the eye, which `update` reuses and allocates nothing. */
	private readonly direction: [number, number, number] = [0, 0, 0];

	/** @internal */
	constructor(
		/** The sprite batch that draws the cards. Its `frames` hold each card's view. */
		readonly sprites: SpriteBatch,
		/** The atlas's cells. */
		readonly atlas: OctahedralAtlas,
	) {}

	/** The number of cards. */
	get count(): number {
		return this.sprites.count;
	}

	/**
	 * Picks the view each card shows, from where the eye is: the card shows the stored view whose
	 * direction is nearest the direction from the card toward the eye. Call it once a frame with
	 * the camera's position, `camera.position`. It allocates nothing.
	 */
	update(eye: Vec3Like): void {
		const { positions, frames } = this.sprites;
		const dir = this.direction;
		for (let i = 0; i < frames.length; i++) {
			const x = (eye[0] as number) - (positions[i * 3] as number);
			const y = (eye[1] as number) - (positions[i * 3 + 1] as number);
			const z = (eye[2] as number) - (positions[i * 3 + 2] as number);
			const length = Math.sqrt(x * x + y * y + z * z) || 1;
			dir[0] = x / length;
			dir[1] = y / length;
			dir[2] = z / length;
			frames[i] = impostorFrame(dir, this.atlas);
		}
	}

	/**
	 * Removes the batch and frees its cards, as a sprite batch's `destroy`.
	 */
	destroy(): void {
		this.sprites.destroy();
	}
}

/**
 * Makes a batch of impostor cards: one card per position, each showing the atlas cell nearest the
 * camera's direction. The cards stand on their positions with `center: [0.5, 0]`, and the batch is
 * dynamic, so `update` uploads the views it picks. Call `update` once a frame.
 *
 * @category api/impostors
 */
export async function createImpostors(
	scene: Scene,
	options: ImpostorOptions,
): Promise<ImpostorBatch> {
	const { texture, atlas, positions } = options;
	if (!(Number.isInteger(atlas.columns) && atlas.columns >= 1))
		throw new RangeError(
			`createImpostors() got ${atlas.columns} columns, not a whole number from 1.`,
		);
	if (!(Number.isInteger(atlas.rows) && atlas.rows >= 1))
		throw new RangeError(`createImpostors() got ${atlas.rows} rows, not a whole number from 1.`);
	if (positions.length % 3 !== 0)
		throw new RangeError(
			`createImpostors() got ${positions.length} positions, not three numbers per card.`,
		);
	const count = positions.length / 3;
	if (count === 0)
		throw new RangeError('createImpostors() got no positions. Give at least one card.');
	const [width, height] =
		typeof options.size === 'number'
			? [options.size, options.size]
			: (options.size ?? [atlas.columns, atlas.rows]);
	const sprites = await scene.createSprites({
		count,
		map: texture,
		atlas: { columns: atlas.columns, rows: atlas.rows },
		center: options.center ?? [0.5, 0],
		alphaMode: options.alphaMode ?? 'blend',
		color: options.color,
		origin: options.origin,
		layers: options.layers,
		dynamic: true,
	});
	sprites.positions.set(positions);
	for (let i = 0; i < count; i++) {
		sprites.sizes[i * 2] = width;
		sprites.sizes[i * 2 + 1] = height;
	}
	if (options.colors) sprites.colors.set(options.colors);
	sprites.markDirty();
	return new ImpostorBatch(sprites, atlas);
}
