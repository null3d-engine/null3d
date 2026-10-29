// The impostor cards: one quad per card, drawn by the package's own material. Each quad faces the
// screen, and the material blends the three atlas views nearest the direction from the card toward
// the eye and lights the blend with the normal that the bake stored. So a scene whose sun moves
// relights its cards as it relights its meshes, and no card data changes as the camera moves: the
// shader reads the eye from the frame's camera.

import type {
	ColorInput,
	InstanceBatch,
	Materials,
	MeshArrays,
	MeshGeometry,
	Scene,
	Texture,
} from '@null3d/engine';
import cardsShader from './cards.wgsl';
import type { OctahedralAtlas } from './octahedral';

/**
 * What `createImpostors` needs of the sketch: the scene, and the factories it draws with.
 *
 * @category api/impostors
 */
export interface ImpostorContext {
	/** The scene that the cards join, and that the material reads the frame's camera from. */
	readonly scene: Scene;
	/** The sketch's materials factory, which makes the card material. */
	readonly materials: Materials;
	/** The sketch's geometry factory, which makes the quad that every card draws. */
	readonly geometry: { fromArrays(arrays: MeshArrays): MeshGeometry };
}

/**
 * Options of `createImpostors`: the atlases, the cards and their look.
 *
 * @category api/impostors
 */
export interface ImpostorOptions {
	/** The colour of every view, in sRGB: one cell per view, in the cells of `atlas`. */
	readonly color: Texture;
	/**
	 * The surface of every view, in the same cells as `color`: red and green hold the octahedral
	 * code of the normal in the object's frame, blue its depth from the view's front to its back,
	 * and alpha its coverage. `bakeImpostorAtlas` writes one.
	 */
	readonly surface: Texture;
	/** The cells of the atlases: the frames across and down. */
	readonly atlas: OctahedralAtlas;
	/**
	 * The cards: three numbers each, x, y and z, in world units. Each stands on its position, like
	 * a tree on the ground. Their count is the batch's size.
	 */
	readonly positions: ArrayLike<number>;
	/**
	 * The turn of each card about the world's up, in radians, one number a card. A bake draws each
	 * view in the tree's local frame, so a turned copy picks the views its turned mesh would show
	 * and lights from the normal that the turn gives it. The default turns every card by 0.
	 */
	readonly turn?: ArrayLike<number>;
	/**
	 * The width and height of every card, in world units. One number makes a square card. The
	 * default is the atlas's cells, one unit each, which suits a bake at one unit per cell.
	 */
	readonly size?: number | readonly [number, number];
	/** A color that multiplies every card's view. */
	readonly tint?: ColorInput;
	/** The roughness that the cards light with, as the standard material's. */
	readonly roughness?: number;
	/** The metalness that the cards light with, as the standard material's. */
	readonly metalness?: number;
	/** How the cards use their alpha: `mask` by default, since a bake cuts its object out. */
	readonly alphaMode?: 'opaque' | 'blend' | 'mask';
	/** The alpha under which a masked card draws nothing. The default is 0.5. */
	readonly alphaCutoff?: number;
	/** The layers every card is on, as a 32-bit mask. The default, 1, is layer 0. */
	readonly layers?: number;
}

/**
 * A batch of impostor cards, which `createImpostors` makes. The cards need no per-frame work: the
 * material reads the eye from the frame's camera and picks each card's views itself. Write the
 * cards' positions, sizes, turns or colors through `batch`, then call `markDirty` for those cards.
 *
 * @category api/impostors
 */
export class ImpostorBatch {
	/** @internal */
	constructor(
		/** The instance batch whose rows are the cards. */
		readonly batch: InstanceBatch,
	) {}

	/** The number of cards. */
	get count(): number {
		return this.batch.count;
	}

	/**
	 * Marks `count` cards from `start` as changed, after you write their positions, sizes or colors
	 * through `batch`. The default marks every card.
	 */
	markDirty(start = 0, count = this.batch.count - start): void {
		this.batch.markDirty(start, count);
	}

	/** Removes the cards and frees their rows, as an instance batch's `destroy`. */
	destroy(): void {
		this.batch.destroy();
	}
}

/** A card's quad: one unit square standing on its bottom edge, facing +z, with its texture
 * coordinates from (0, 0) at the bottom left to (1, 1) at the top right. */
const QUAD: MeshArrays = {
	positions: new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]),
	normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
	uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
	indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
};

/**
 * Makes a batch of impostor cards: one card per position, drawn from the three atlas views nearest
 * the direction from the card toward the eye, and lit by the scene's lights. The cards need no
 * `update` call: the material reads the eye from the frame's camera. A card's turn, in `turn`,
 * turns its views and its light by the same angle about the world's up, so a turned tree hands
 * over to a card whose crown matches it.
 *
 * @category api/impostors
 */
export function createImpostors(ctx: ImpostorContext, options: ImpostorOptions): ImpostorBatch {
	const { atlas, positions } = options;
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
	if (options.turn !== undefined && options.turn.length !== count)
		throw new RangeError(
			`createImpostors() got ${options.turn.length} turns for ${count} cards. Give one turn a card.`,
		);
	const [width, height] =
		typeof options.size === 'number'
			? [options.size, options.size]
			: (options.size ?? [atlas.columns, atlas.rows]);
	const material = ctx.materials.shader({
		wgsl: cardsShader,
		textures: { impostorColor: options.color, impostorSurface: options.surface },
		uniforms: { cells: [atlas.columns, atlas.rows, 0, 0] },
		alphaMode: options.alphaMode ?? 'mask',
		...(options.alphaCutoff !== undefined && { alphaCutoff: options.alphaCutoff }),
		...(options.tint !== undefined && { color: options.tint }),
		...(options.roughness !== undefined && { roughness: options.roughness }),
		...(options.metalness !== undefined && { metalness: options.metalness }),
		...(options.layers !== undefined && { layers: options.layers }),
	});
	const batch = ctx.scene.createInstances(ctx.geometry.fromArrays(QUAD), count, {
		material,
		values: true,
	});
	batch.positions.set(positions);
	const values = batch.values as Float32Array;
	for (let i = 0; i < count; i++) {
		batch.scales[i * 3] = width;
		batch.scales[i * 3 + 1] = height;
		batch.scales[i * 3 + 2] = 1;
		values[i * 4] = options.turn?.[i] ?? 0;
	}
	batch.markDirty();
	return new ImpostorBatch(batch);
}
