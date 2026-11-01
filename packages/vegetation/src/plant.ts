// The plant drawing template: what the leaf and bark materials read of a grown plant, and the values
// that give each copy its own tint and autumn from where it stands. A plant's branch records live in
// one small data texture, so a vertex offset fetches its branch's pivot and axis on every GPU path,
// and one wind field moves every plant whose material names it.
import type { SketchContext, Texture, Textures } from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import type { PlantAsset } from './asset';
import type { PlantMaterial } from './atlas';
import type { CrownData } from './crown';
import { WIND_STRIDE } from './generate';
import { unitAt } from './hash';

/**
 * What a plant's materials read of the wind: the one field that moves the whole scene, the branch
 * records that a vertex offset fetches, and the plant's crown and height, which shape its sway and
 * its shading.
 *
 * @category api/vegetation
 */
export interface PlantWind {
	/** The one wind field. Its air drives every plant, the grass and the floating leaves. */
	readonly field: WindField;
	/**
	 * The plant's branch records, one row of four texels for each branch: the pivot, the axis, the
	 * parent, the stiffness, the flutter, the branch's level and length, and its sway phase. A
	 * second row holds the wind field's steady settings, three texels of four numbers, which the
	 * vertex offset reads beyond the field's box.
	 */
	readonly pivots: Texture;
	/** The branch records that {@link PlantWind.pivots} holds. */
	readonly branches: number;
	/** The plant's height in meters, which the trunk's bend follows. */
	readonly height: number;
	/** The crown's bounds and center, which bend the leaf normals and darken its inside. */
	readonly crown: CrownData;
	/** The share of a leaf's diffuse light that passes through it, from the species' record. */
	readonly transmission: number;
	/** The distance from the camera out to which the plant sways, in meters: 0 for every distance. */
	readonly swayDistance: number;
}

/**
 * What {@link plantWind} takes besides the plant and the field: how far from the camera the plant
 * sways.
 *
 * @category api/vegetation
 */
export interface PlantWindOptions {
	/**
	 * The distance from the camera out to which the plant sways, in meters. The plant's offset fades
	 * to nothing over the last fifth of it, so a plant past it stands still and its shadow stays in
	 * the far cascade's cached layer. The default, 0, sways at every distance.
	 */
	readonly swayDistance?: number;
}

/**
 * Makes the wind data that a plant's materials read: its branch records in one data texture, and
 * the field and crown values. Call it once for each variant, and give the same result to that
 * variant's leaf and bark materials, so both parts share one table.
 *
 * @param ctx The sketch's context, or its `textures` alone.
 * @param asset The grown plant.
 * @param field The one wind field, which a page makes with `createWind`.
 * @param options How far from the camera the plant sways.
 * @returns The wind data for the plant's materials.
 * @category api/vegetation
 */
export function plantWind(
	ctx: Pick<SketchContext, 'textures'>,
	asset: PlantAsset,
	field: WindField,
	options: PlantWindOptions = {},
): PlantWind {
	const { wind } = asset;
	// A record is 16 floats, four to a texel, so a plant's table is branches times four texels wide.
	const pivots = halfFloatTexture(ctx.textures, wind.pivots, wind.branches * (WIND_STRIDE / 4), [
		...field.air.base,
		...field.air.gust,
		...field.air.swirl,
	]);
	return {
		field,
		pivots,
		branches: wind.branches,
		height: asset.species.height,
		crown: asset.crown,
		transmission: asset.species.color.transmission,
		swayDistance: Math.max(0, options.swayDistance ?? 0),
	};
}

/**
 * Gives the field's newest state to a plant's materials for this frame. The field's pass keeps two
 * states, and the texture names the one that its last run wrote; a material that read the other
 * layer would sway by a frame of stale air. Call it in each frame, before the frame draws.
 *
 * @param materials The leaf and bark materials that read the field, such as the ones a page makes
 * for each variant.
 * @param field The wind field, from `createWind`.
 * @category api/vegetation
 */
export function setWindLayer(materials: readonly PlantMaterial[], field: WindField): void {
	const layer = field.texture.layer;
	for (const material of materials) material.setUniform('windLayer', layer);
}

/**
 * Uploads 32-bit floats as rows of half floats, which an offset reads at their texel. The first row
 * holds the plant's branch records. The second holds the field's steady settings, three texels of
 * four numbers, since a custom material's uniforms and textures have no room for them elsewhere.
 */
function halfFloatTexture(
	textures: Textures,
	data: Float32Array,
	width: number,
	air: readonly number[] = [],
): Texture {
	const columns = Math.max(3, width);
	const records = data.length > 0 ? data : new Float32Array(columns * 4);
	const packed = new Float32Array(columns * 8);
	packed.set(records.subarray(0, columns * 4));
	// The air sits at the start of the second row; the rest of it stays zero.
	for (let i = 0; i < Math.min(air.length, columns * 4); i++)
		packed[columns * 4 + i] = air[i] as number;
	return textures.fromData({ width: columns, height: 2, format: 'rgba16float', data: packed });
}

/**
 * What a copy's four row values hold: its leaf tint and how far into autumn it stands. The tint
 * comes from an integer hash of the copy's whole-meter place, so two trees in different places
 * differ and the same tree draws the same on every device, while each tree's tint stays the same
 * when the scene is built again.
 *
 * @param x The copy's x.
 * @param z The copy's z.
 * @param seed The scene's seed.
 * @param autumn How far into autumn the copy stands, from 0 for green to 1 for turned. The default
 * is 0.
 * @returns The tint's linear red, green and blue, from about 0.85 to about 1.15, then the autumn
 * value.
 * @category api/vegetation
 */
export function treeValues(
	x: number,
	z: number,
	seed: number,
	autumn = 0,
): [number, number, number, number] {
	const cellX = Math.floor(x);
	const cellZ = Math.floor(z);
	// A warm shift and a cool shift spread the copies' hues apart without changing how bright they
	// are, and a small common lift keeps two neighbours from reading as clones.
	const warm = unitAt(seed, cellX, cellZ, 1);
	const lift = unitAt(seed, cellX, cellZ, 2);
	const shade = 0.85 + 0.15 * lift;
	return [
		(0.9 + 0.2 * warm) * shade,
		shade,
		(1.0 - 0.1 * warm) * shade,
		Math.min(1, Math.max(0, autumn)),
	];
}
