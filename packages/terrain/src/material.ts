// The ground's material: the engine's standard material with a surface function that blends up to
// four tiled color maps by a splat map. The layer maps are fixed when the material is made, and a
// layer that the caller leaves out reads white with no weight, so a ground may use one to four.
import type { Material, SketchContext, Texture } from '@null3d/engine';
import terrainShader from './terrain.wgsl';

/**
 * One layer of the ground's surface: a tiled color map, and how rough it is.
 *
 * @category api/terrain
 */
export interface TerrainLayer {
	/** The layer's color map, in sRGB, which repeats across the ground. */
	map: Texture;
	/** The meters that one repeat of the map covers. The default is 8. */
	tile?: number;
	/** The layer's roughness, from 0 to 1. The default is 1. */
	roughness?: number;
}

/** What `splatMaterial` needs: the layers, the splat map, and the ground's size. */
export interface SplatMaterialOptions {
	/** The layers, from one to four. The first is the splat map's red channel. */
	layers: readonly TerrainLayer[];
	/** The weights of the layers, one to four per texel, as the ground's own coordinates. */
	splat: Texture;
	/** The ground's width and depth in meters, which place the splat map. */
	size: number;
	/** How much the ground acts like a metal, from 0 to 1. The default is 0. */
	metalness?: number;
}

/** A ground material, with the texture that the function made for a missing layer. */
export interface SplatMaterial {
	/** The material to give every block of the ground. */
	material: Material;
	/** The white texel for a layer that the caller left out, which the caller destroys with the ground. */
	white: Texture | undefined;
}

/** The default meters that one repeat of a layer's map covers. */
const DEFAULT_TILE = 8;
/** A white texel, for a layer that the caller leaves out. */
const WHITE = new Uint8Array([255, 255, 255, 255]);

/**
 * Makes the ground's material: the engine's standard material with a surface function that blends
 * the layers by the splat map. Every block of the terrain shares one material, so the ground draws
 * with one pipeline.
 */
export function splatMaterial(
	ctx: Pick<SketchContext, 'materials' | 'textures'>,
	options: SplatMaterialOptions,
): SplatMaterial {
	const { layers } = options;
	if (layers.length < 1 || layers.length > 4)
		throw new Error(
			`a terrain got ${layers.length} layers, but it takes one to four. The splat map has four channels.`,
		);
	let white: Texture | undefined;
	const mapAt = (k: number): Texture => {
		const layer = layers[k];
		if (layer) return layer.map;
		white ??= ctx.textures.fromData({
			width: 1,
			height: 1,
			data: WHITE,
			colorSpace: 'srgb',
			mipmaps: false,
		});
		return white;
	};
	const layer = (k: number): TerrainLayer | undefined => layers[k];
	const tiles: [number, number, number, number] = [
		layer(0)?.tile ?? DEFAULT_TILE,
		layer(1)?.tile ?? DEFAULT_TILE,
		layer(2)?.tile ?? DEFAULT_TILE,
		layer(3)?.tile ?? DEFAULT_TILE,
	];
	const roughness: [number, number, number, number] = [
		layer(0)?.roughness ?? 1,
		layer(1)?.roughness ?? 1,
		layer(2)?.roughness ?? 1,
		layer(3)?.roughness ?? 1,
	];
	const ground: [number, number, number, number] = [
		options.size,
		options.size,
		options.metalness ?? 0,
		0,
	];
	const material = ctx.materials.shader({
		wgsl: terrainShader,
		textures: {
			splatMap: options.splat,
			layerZero: mapAt(0),
			layerOne: mapAt(1),
			layerTwo: mapAt(2),
			layerThree: mapAt(3),
		},
		uniforms: {
			tiles,
			layerRoughness: roughness,
			ground,
		},
		roughness: 1,
		doubleSided: true,
	});
	return { material, white };
}
