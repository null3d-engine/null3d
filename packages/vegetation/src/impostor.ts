// The far trees: a plant's most detailed level baked into the two impostor atlases at first use,
// so a copy beyond the hand-over distance draws as one card. The bake draws the same leaf and bark
// atlases that the near material draws, with the same tint, so a card matches its mesh in colour at
// the switch. The pixels come from the CPU bake, so every device gets the same atlases.

import type { InstanceBatch, SketchContext, Texture, Textures } from '@null3d/engine';
import {
	bakeImpostorAtlas,
	type ImpostorBake,
	type OctahedralAtlas,
	octahedralAtlas,
} from '@null3d/impostors';
import type { PlantAsset } from './asset';
import { LEAF_CELLS_BY_KIND, leafCellFor, type PlantAtlases } from './atlas';
import { VERSION } from './version';

/**
 * What `bakeFarTree` takes: the plant, the atlases that colour it, and the grid.
 *
 * @category api/vegetation
 */
export interface FarTreeOptions {
	/** The plant, as `generatePlant` gave it. The bake draws its `impostorSource` level. */
	readonly asset: PlantAsset;
	/** The bark and leaf atlases that the plant's material draws from. */
	readonly atlases: PlantAtlases;
	/** The views that the bake draws, which `octahedralAtlas` turns into a grid. The default is 25. */
	readonly views?: number;
	/** The texels on each side of a cell. The default is 64. */
	readonly texels?: number;
}

/**
 * A baked far tree: the two atlases as textures, the grid and the card's size.
 *
 * @category api/vegetation
 */
export interface FarTree {
	/** The grid that the bake drew. */
	readonly atlas: OctahedralAtlas;
	/** The colour atlas, in sRGB, with the coverage in alpha. */
	readonly color: Texture;
	/** The surface atlas, linear: the normal in the object's frame, the depth and the coverage. */
	readonly surface: Texture;
	/** The width and height of a card at scale 1, in meters. */
	readonly size: readonly [number, number];
	/** The plant's lowest height in its own frame, where the card stands. */
	readonly base: number;
}

/** Bakes already made in this page, by the plant, the grid and the cells' size. */
const baked = new Map<string, ImpostorBake>();

/**
 * Bakes a plant's `impostorSource` level into the colour and surface atlases that a card draws.
 * The bake reads the leaf and bark atlases' pixels and the plant's tint, so the card's colour
 * matches its mesh at the hand-over. A second call for the same plant, grid and cell size reuses
 * the pixels, and only the textures are made again.
 *
 * @param ctx The sketch's context, or its `textures` alone.
 * @param options The plant, the atlases and the grid.
 * @returns The two textures, the grid and the card's size.
 * @category api/vegetation
 */
export function bakeFarTree(
	ctx: Pick<SketchContext, 'textures'>,
	options: FarTreeOptions,
): FarTree {
	const { asset, atlases } = options;
	const views = options.views ?? 25;
	const texels = options.texels ?? 64;
	const atlas = octahedralAtlas(views);
	const key = `${asset.species.id}|${asset.variant}|${atlas.columns}x${atlas.rows}|${texels}|${VERSION}`;
	let bake = baked.get(key);
	if (bake === undefined) {
		bake = bakePlant(asset, atlases, atlas, texels);
		baked.set(key, bake);
	}
	return {
		atlas,
		color: upload(ctx.textures, bake.color, 'srgb'),
		surface: upload(ctx.textures, bake.surface, 'linear'),
		size: bake.size,
		base: asset.impostorSource.bounds.min[1],
	};
}

/** Draws the plant's parts from every cell of the grid. */
function bakePlant(
	asset: PlantAsset,
	atlases: PlantAtlases,
	atlas: OctahedralAtlas,
	texels: number,
): ImpostorBake {
	const source = asset.impostorSource;
	const level = asset.levels[source.level];
	if (level === undefined)
		throw new RangeError(
			`bakeFarTree() got a level of ${source.level} for ${asset.species.id}, which has ${asset.levels.length}.`,
		);
	const bark = atlases.bark.pixels;
	const leaf = atlases.leaf.pixels;
	const cell = LEAF_CELLS_BY_KIND[leafCellFor(asset.species)];
	const tint = source.tint;
	const parts = level.parts.map((part) => {
		const wood = part.name === 'wood';
		return {
			positions: part.arrays.positions,
			normals: part.arrays.normals,
			uvs: part.arrays.uvs,
			indices: part.arrays.indices,
			tint,
			// The foliage material draws both sides, and a solid trunk's back face is behind its
			// front, so both sides keep the nearest surface right.
			doubleSided: true,
			...(wood
				? {
						color: {
							width: bark.color.width,
							height: bark.color.height,
							data: bark.color.data,
							tiles: 3,
							wrap: 'repeat' as const,
						},
					}
				: {
						color: {
							width: leaf.color.width,
							height: leaf.color.height,
							data: leaf.color.data,
							cell,
							cells: [4, 2] as const,
						},
						coverage: {
							width: leaf.surface.width,
							height: leaf.surface.height,
							data: leaf.surface.data,
							cell,
							cells: [4, 2] as const,
						},
						alphaCutoff: 0.35,
					}),
		};
	});
	return bakeImpostorAtlas({
		atlas,
		texels,
		parts,
		min: source.bounds.min,
		max: source.bounds.max,
	});
}

/** Uploads one baked atlas, with no mip levels, as the cards draw it. */
function upload(
	textures: Textures,
	map: { width: number; height: number; data: Uint8Array },
	colorSpace: 'srgb' | 'linear',
): Texture {
	return textures.fromData({
		width: map.width,
		height: map.height,
		data: map.data,
		colorSpace,
		wrap: 'clamp',
		mipmaps: false,
	});
}

/** The share of the switch distance over which a mesh and its cards fade into each other. */
const HAND_OVER_FADE = 0.08;

/** The far edge that a card batch draws to, in meters: farther than any camera's far plane. */
const FAR = 1e9;

/**
 * Hands a band of trees from their meshes to their cards. The meshes draw up to
 * `switchDistance`, and the cards draw from just before it, so both draw through the band in
 * which the dithered fade of each edge fades one out as the other fades in. The share of the
 * switch distance that the two share is the engine's fade band, so no second mechanism is needed.
 * Write the cards' turns and sizes before this call, and call it at setup.
 *
 * @param meshes The batch of near meshes, whose rows stand at the same trees.
 * @param cards The card batch, such as `ImpostorBatch.batch`.
 * @param switchDistance The distance from the camera at which a tree hands over, in meters.
 * @category api/vegetation
 */
export function handOverToCards(
	meshes: InstanceBatch,
	cards: InstanceBatch,
	switchDistance: number,
): void {
	if (!(switchDistance > 0))
		throw new RangeError(
			`handOverToCards() got ${switchDistance} as the switch distance, not a number above 0.`,
		);
	meshes.setDrawRange(0, switchDistance);
	cards.setDrawRange(switchDistance * (1 - HAND_OVER_FADE), FAR);
}
