// The bark and leaf atlases, painted in the browser the first time a page asks for them and kept for
// the visit. No image file ships, and no atlas differs between devices: the pixels come from the
// integer hashes in `atlas-pixels.ts`. The engine makes each texture's mip levels, whose average
// alpha keeps a leaf's coverage as it shrinks, and a masked material fades its cut edges with alpha
// to coverage.
import type {
	ColorInput,
	Material,
	Materials,
	SketchContext,
	Texture,
	Textures,
} from '@null3d/engine';
import { type AtlasPixels, paintBark, paintLeaf } from './atlas-pixels';
import plantShader from './plant.wgsl';
import type { LeafKind, Species } from './species';

/**
 * One map of an atlas: its texture, and its size in texels.
 * @category api/vegetation
 */
export interface AtlasMap {
	/** The texture that a material samples. */
	readonly texture: Texture;
	/** Texels across. */
	readonly width: number;
	/** Rows down. */
	readonly height: number;
}

/**
 * A baked atlas: the colour and surface maps that a plant's material samples, and the pixels
 * behind them, which an impostor bake reads.
 * @category api/vegetation
 */
export interface PlantAtlas {
	/**
	 * The colour map, in sRGB. Its values multiply the species' own colour, so they hold the veins,
	 * the shade of each leaf and the lift of each ridge.
	 */
	readonly color: AtlasMap;
	/**
	 * The surface map, linear. Its red and green hold the normal's x and y, from -1 to 1 remapped to
	 * 0 to 1, its blue the leaf's coverage or the bark's roughness, and its alpha the leaf's
	 * thickness.
	 */
	readonly surface: AtlasMap;
	/** The cells across and down that the map holds. */
	readonly cells: readonly [number, number];
	/** The painted pixels behind the two textures. */
	readonly pixels: { readonly color: AtlasPixels; readonly surface: AtlasPixels };
}

/**
 * The bark and leaf atlases of a page.
 * @category api/vegetation
 */
export interface PlantAtlases {
	/** The bark: one tiling cell, stretched up the trunk. */
	readonly bark: PlantAtlas;
	/**
	 * The leaves: four cluster shapes, a needle spray, a frond, a blade and a broad leaf, each cell a
	 * spray of leaves that differ in outline, colour and veins.
	 */
	readonly leaf: PlantAtlas;
}

/**
 * Paints the bark and leaf atlases: four textures, made from integer hashes the first time a page
 * asks for them. Call it once in the sketch's setup, and give the result to {@link plantMaterial}. A
 * page that draws no plant pays nothing for them, and none ships as a file.
 *
 * The bark is stretched Voronoi plates warped by noise, with cracks between them and fibres up the
 * trunk. A leaf comes from an outline with veins written into a height field, whose gradient gives
 * the normal map.
 *
 * @param ctx The sketch's context, or its `textures` alone.
 * @returns The atlases, ready for a material.
 * @category api/vegetation
 */
export function bakePlantAtlases(ctx: Pick<SketchContext, 'textures'>): PlantAtlases {
	const bark = paintBark();
	const leaf = paintLeaf();
	return {
		bark: {
			color: asTexture(ctx.textures, bark.color, 'srgb', true),
			surface: asTexture(ctx.textures, bark.surface, 'linear', true),
			cells: [1, 1],
			pixels: { color: bark.color, surface: bark.surface },
		},
		leaf: {
			color: asTexture(ctx.textures, leaf.color, 'srgb', false),
			surface: asTexture(ctx.textures, leaf.surface, 'linear', false),
			cells: [4, 2],
			pixels: { color: leaf.color, surface: leaf.surface },
		},
	};
}

/** Uploads one painted map, with the mip levels that keep it sharp and keep a leaf's coverage. */
function asTexture(
	textures: Textures,
	pixels: AtlasPixels,
	colorSpace: 'srgb' | 'linear',
	tiles: boolean,
): AtlasMap {
	const texture = textures.fromData({
		width: pixels.width,
		height: pixels.height,
		// The painter counts rows up a card, from its base, and a texture's first row is at v = 0.
		data: pixels.data,
		format: 'rgba8unorm',
		colorSpace,
		mipmaps: true,
		wrap: tiles ? 'repeat' : 'clamp',
	});
	return { texture, width: pixels.width, height: pixels.height };
}

/**
 * What a leaf cell of the atlas draws.
 * @category api/vegetation
 */
export type LeafCell =
	| 'cluster-a'
	| 'cluster-b'
	| 'cluster-c'
	| 'cluster-d'
	| 'needle'
	| 'frond'
	| 'blade'
	| 'broad';

/**
 * The cell of each leaf kind, in the atlas's cells: the column and row.
 * @category api/vegetation
 */
export const LEAF_CELLS_BY_KIND: Readonly<Record<LeafCell, readonly [number, number]>> = {
	'cluster-a': [0, 0],
	'cluster-b': [1, 0],
	'cluster-c': [2, 0],
	'cluster-d': [3, 0],
	needle: [0, 1],
	frond: [1, 1],
	blade: [2, 1],
	broad: [3, 1],
};

/**
 * The leaf cell that a species draws: its kind's cell, and for a cluster, one of four shapes chosen
 * by the species' name, so that two broadleaves never show the same leaves.
 *
 * @param species The species record.
 * @returns The cell of the atlas that the species' leaf cards sample.
 * @category api/vegetation
 */
export function leafCellFor(species: Species): LeafCell {
	const kind: LeafKind | undefined = species.leaf?.kind;
	if (kind === 'needle') return 'needle';
	if (kind === 'frond') return 'frond';
	if (kind === 'blade') return 'blade';
	// A plant with no branch system draws its leaves as rosette blades.
	if (!kind) {
		const shape = species.rosette?.shape;
		if (shape === 'frond') return 'frond';
		if (shape === 'blade') return 'blade';
		if (shape === 'broad') return 'broad';
	}
	// A stable choice from the name alone, so every device and every run picks the same cell.
	let hash = 2166136261;
	for (let i = 0; i < species.id.length; i++) {
		hash ^= species.id.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (
		(['cluster-a', 'cluster-b', 'cluster-c', 'cluster-d'] as const)[hash >>> 30] ?? 'cluster-a'
	);
}

/**
 * What `plantMaterial` draws: the bark of a trunk or the leaves of a crown.
 * @category api/vegetation
 */
export type PlantMaterialPart = 'wood' | 'leaves';

/**
 * What `plantMaterial` takes: the atlases, which part the material draws, and how it looks.
 * @category api/vegetation
 */
export interface PlantMaterialOptions {
	/** The atlases that `bakePlantAtlases` made. */
	readonly atlases: PlantAtlases;
	/** Which part of a plant the material draws. */
	readonly part: PlantMaterialPart;
	/** The leaf cell to draw. The default is the first cluster shape. */
	readonly cell?: LeafCell;
	/** The linear colour that multiplies the atlas's own, such as the species' leaf or bark colour. */
	readonly color?: ColorInput;
	/** How the leaf cuts its outline: below this coverage nothing draws. The default is 0.35. */
	readonly alphaCutoff?: number;
	/** How many times the bark tiles across the mesh's texture coordinates. The default is 3. */
	readonly barkTiles?: number;
}

/**
 * A material that draws a plant part from the generated atlases: the base colour from the colour
 * map, the normal that bends it from the surface map, and the leaf's outline from its coverage. The
 * leaf's thickness reaches the light that passes through it where the engine lights a thin surface.
 *
 * The engine's mip levels blur the atlas as a card shrinks, and a masked material's alpha to
 * coverage keeps the share of the picture that its leaves cover, so a crown far away stays as dense
 * as it is up close.
 *
 * @param ctx The sketch's context, or its `materials` alone.
 * @param options The atlases, the part and the look.
 * @returns The material.
 * @category api/vegetation
 */
export function plantMaterial(
	ctx: Pick<SketchContext, 'materials'>,
	options: PlantMaterialOptions,
): Material {
	const { atlases, part } = options;
	const cell = LEAF_CELLS_BY_KIND[options.cell ?? 'cluster-a'];
	return ctx.materials.shader({
		wgsl: plantShader,
		textures: {
			barkColor: atlases.bark.color.texture,
			barkSurface: atlases.bark.surface.texture,
			leafColor: atlases.leaf.color.texture,
			leafSurface: atlases.leaf.surface.texture,
		},
		uniforms: {
			cells: [atlases.leaf.cells[0], atlases.leaf.cells[1]],
			cell: [cell[0], cell[1]],
			part: part === 'leaves' ? 1 : 0,
			tiles: options.barkTiles ?? 3,
			tint: options.color ?? [1, 1, 1],
		},
		alphaMode: part === 'leaves' ? 'mask' : 'opaque',
		alphaCutoff: options.alphaCutoff ?? 0.35,
		doubleSided: part === 'leaves',
		roughness: 1,
		metalness: 0,
	});
}
