// The impostor batch: camera-facing cards that show the stored view nearest the camera. The batch
// is the engine's sprite batch, so it culls, sorts and fades as any sprite does, and draws on
// WebGPU and WebGL2 with the sprite shader. This module only picks each card's frame from the
// camera's direction, once a frame. The batch is static: a frame that changes marks its row dirty,
// so a still camera uploads nothing and a moving one uploads only the cards whose view changed.

import type { ColorInput, Scene, SpriteBatch, Texture, Vec3Like } from '@null3d/engine';
import { frameOf, type OctahedralAtlas } from './octahedral';

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
	/**
	 * The cards: three numbers each, x, y and z, relative to `origin`, which is the world's origin
	 * by default. Their count is the batch's size.
	 */
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
 * which draws the cards, and adds `update`, which picks each card's view from the camera. The
 * sprite batch is static: after you change cards' positions, sizes or colors through `sprites`,
 * call `markDirty` on this batch for those cards.
 *
 * @category api/impostors
 */
export class ImpostorBatch {
	/** The eye that the last `update` picked views for, relative to the origin. */
	private eyeX = 0;
	private eyeY = 0;
	private eyeZ = 0;
	/** True until an `update` picks every card's view again. */
	private stale = true;

	/** @internal */
	constructor(
		/** The sprite batch that draws the cards. Its `frames` hold each card's view. */
		readonly sprites: SpriteBatch,
		/** The atlas's cells. */
		readonly atlas: OctahedralAtlas,
		/** The point that the cards' positions are relative to. */
		readonly origin: readonly [number, number, number] = [0, 0, 0],
	) {}

	/** The number of cards. */
	get count(): number {
		return this.sprites.count;
	}

	/**
	 * Picks the view each card shows, from where the eye is: the card shows the stored view whose
	 * direction is nearest the direction from the card toward the eye. Call it once a frame with the
	 * camera's position in the world, written into an array you keep. A camera with no parent
	 * reports that at once with `camera.getPosition(eye)`; `camera.getWorldPosition(eye)` reports
	 * the frame that last ran, which is the world's origin on a sketch's first frame, and every
	 * card then shows the view from there. It marks dirty only the cards whose view changed, does
	 * nothing while the eye stays where it was, and allocates nothing.
	 */
	update(eye: Vec3Like): void {
		const origin = this.origin;
		const ex = (eye[0] as number) - origin[0];
		const ey = (eye[1] as number) - origin[1];
		const ez = (eye[2] as number) - origin[2];
		if (!this.stale && ex === this.eyeX && ey === this.eyeY && ez === this.eyeZ) return;
		this.stale = false;
		this.eyeX = ex;
		this.eyeY = ey;
		this.eyeZ = ez;
		const { sprites } = this;
		const { positions, frames } = sprites;
		const { columns, rows } = this.atlas;
		const count = frames.length;
		// Changed cards close together share one dirty range, so a moving camera marks a few ranges
		// rather than one per card.
		let start = -1;
		let last = -1;
		for (let i = 0; i < count; i++) {
			const frame = frameOf(
				ex - (positions[i * 3] as number),
				ey - (positions[i * 3 + 1] as number),
				ez - (positions[i * 3 + 2] as number),
				columns,
				rows,
			);
			if (frame === frames[i]) continue;
			frames[i] = frame;
			if (start >= 0 && i - last > DIRTY_GAP) {
				sprites.markDirty(start, last + 1 - start);
				start = -1;
			}
			if (start < 0) start = i;
			last = i;
		}
		if (start >= 0) sprites.markDirty(start, last + 1 - start);
	}

	/**
	 * Marks `count` cards from `start` as changed, after you write their positions, sizes, rotations
	 * or colors through `sprites`. The sprite batch uploads them, and the next `update` picks every
	 * card's view again. The default marks every card.
	 */
	markDirty(start = 0, count = this.sprites.count - start): void {
		this.sprites.markDirty(start, count);
		this.stale = true;
	}

	/**
	 * Removes the batch and frees its cards, as a sprite batch's `destroy`.
	 */
	destroy(): void {
		this.sprites.destroy();
	}
}

/**
 * The unchanged cards that may sit between two changed cards in one dirty range. Uploading a few
 * unchanged rows costs less than one more range.
 */
const DIRTY_GAP = 16;

/**
 * Makes a batch of impostor cards: one card per position, each showing the atlas cell nearest the
 * camera's direction. The cards stand on their positions with `center: [0.5, 0]`. The batch is
 * static, so it uploads a card only when `update` changes its view or `markDirty` names it. Call
 * `update` once a frame.
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
	});
	sprites.positions.set(positions);
	for (let i = 0; i < count; i++) {
		sprites.sizes[i * 2] = width;
		sprites.sizes[i * 2 + 1] = height;
	}
	if (options.colors) sprites.colors.set(options.colors);
	sprites.markDirty();
	return new ImpostorBatch(sprites, atlas, options.origin);
}
