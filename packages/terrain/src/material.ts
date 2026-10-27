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
	/**
	 * How strongly the layer's own height pushes it through the layers beside it where their
	 * weights meet, from 0 to 1: rocks show through the grass at a boundary instead of fading into
	 * it. The default is 0.5, and 0 blends by the splat map's weights alone.
	 */
	contrast?: number;
	/**
	 * Where the layer's height comes from at each texel: its map's brightness, the default, or the
	 * map's alpha channel for a map that keeps a height there. The maps that `terrainTextures`
	 * makes keep one in alpha.
	 */
	heightFrom?: 'brightness' | 'alpha';
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
	/**
	 * The ground's baked normals, which light every pixel of every block. Without one the surface
	 * lights from the mesh's own vertex normals.
	 */
	normals?: Texture;
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
/** The default strength of a layer's height against its neighbours. */
const DEFAULT_CONTRAST = 0.5;
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
	const contrastAt = (k: number): number => {
		const value = layer(k)?.contrast ?? DEFAULT_CONTRAST;
		if (!(value >= 0 && value <= 1))
			throw new Error(
				`a terrain layer got the contrast ${value}, which is not a number from 0 to 1.`,
			);
		return value;
	};
	const alphaAt = (k: number): number => {
		const from = layer(k)?.heightFrom ?? 'brightness';
		if (from !== 'brightness' && from !== 'alpha')
			throw new Error(
				`a terrain layer got heightFrom ${String(from)}, which is not 'brightness' or 'alpha'.`,
			);
		return from === 'alpha' ? 1 : 0;
	};
	const contrast: [number, number, number, number] = [
		contrastAt(0),
		contrastAt(1),
		contrastAt(2),
		contrastAt(3),
	];
	const alpha: [number, number, number, number] = [alphaAt(0), alphaAt(1), alphaAt(2), alphaAt(3)];
	const ground: [number, number, number, number] = [
		options.size,
		options.size,
		options.metalness ?? 0,
		options.normals ? 1 : 0,
	];
	const textures = {
		splatMap: options.splat,
		layerZero: mapAt(0),
		layerOne: mapAt(1),
		layerTwo: mapAt(2),
		layerThree: mapAt(3),
		...(options.normals ? { normalMap: options.normals } : {}),
	};
	const material = ctx.materials.shader({
		wgsl: terrainShader,
		textures,
		uniforms: {
			tiles,
			layerRoughness: roughness,
			ground,
			layerContrast: contrast,
			layerAlpha: alpha,
		},
		roughness: 1,
		doubleSided: true,
	});
	return { material, white };
}
