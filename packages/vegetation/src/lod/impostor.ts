// The far bake: the first card level, its wood and its cards, baked on the CPU into the octahedral
// impostor atlases, from the card atlas's pixels and a mean bark colour. The first card level holds
// the same silhouette as the nearest one at a hundredth of its triangles. The card's alpha is the
// card atlas's coverage, so the far card keeps the crown's own holes.
import type { PlantAsset, SpeciesKitData } from '../asset';
import type { FarBake, MeshInput } from '../stages';
import { cardMesh } from './cards';
import { dequantisePosition } from './quantise';

/** The bake's inputs and outputs, as this add-on gives and takes them. The bake itself is imported
 * when a far bake runs, so a page that never bakes loads neither the add-on nor the engine's page
 * code through it. */
interface BakeMap {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8Array;
}
interface BakePart {
	readonly positions: ArrayLike<number>;
	readonly normals?: ArrayLike<number>;
	readonly uvs?: ArrayLike<number>;
	readonly colors?: ArrayLike<number>;
	readonly indices: ArrayLike<number>;
	readonly color?: BakeMap;
	readonly coverage?: BakeMap;
	readonly doubleSided?: boolean;
	readonly alphaCutoff?: number;
}
interface BakeOutput {
	readonly color: { readonly data: Uint8Array };
	readonly surface: { readonly data: Uint8Array };
	readonly size: readonly [number, number];
	readonly room: number;
	readonly depth: number;
}
type BakeAtlas = (options: {
	readonly atlas: { readonly columns: number; readonly rows: number };
	readonly texels: number;
	readonly parts: readonly BakePart[];
	readonly min: readonly [number, number, number];
	readonly max: readonly [number, number, number];
}) => BakeOutput;

/**
 * A variant's far cards on a page: its impostor bake, which the impostors add-on's cards draw.
 *
 * @category api/vegetation
 */
export interface FarPlant {
	/** The variant it was baked from. */
	readonly variant: number;
	/** The baked atlases. */
	readonly bake: FarBake;
}

/** The box a bake draws the plant in, and the extent of its drawn wood and cards. */
function drawnBounds(positions: readonly Float32Array[]): {
	min: [number, number, number];
	max: [number, number, number];
} {
	const min: [number, number, number] = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const max: [number, number, number] = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	for (const array of positions)
		for (let i = 0; i < array.length; i += 3)
			for (let k = 0; k < 3; k++) {
				min[k] = Math.min(min[k] as number, array[i + k] as number);
				max[k] = Math.max(max[k] as number, array[i + k] as number);
			}
	return { min, max };
}

/**
 * Bakes a variant's impostor atlases, in a job worker or in Bun.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @returns The atlases.
 * @category api/vegetation
 */
export async function bakeFar(kit: SpeciesKitData, asset: PlantAsset): Promise<FarBake> {
	const record = kit.record;
	// The first card level's cards, rebuilt from the rows and the kit: their atlas is the bake's map.
	const input = {
		record,
		seed: asset.seed,
		variant: asset.variant,
		season: asset.season,
		kit,
		skeleton: asset.skeleton,
		coarseness: asset.coarseness,
		rows: asset.shoots,
		crown: {
			cells: [1, 1, 1] as const,
			min: [0, 0, 0] as const,
			cell: 1,
			sky: new Float32Array([1]),
		},
		detail: kit.detail,
	} satisfies MeshInput;
	const cards = cardMesh(input, 1);
	const cell = kit.cards.size || 1;
	const front = kit.cards.color.subarray(0, cell * cell * 4);
	const coverage = new Uint8Array(cell * cell * 4);
	for (let i = 0; i < cell * cell; i++) coverage[i * 4 + 2] = front[i * 4 + 3] as number;
	const parts: BakePart[] = [
		{
			positions: cards.positions,
			normals: cards.normals,
			uvs: cards.uvs,
			indices: cards.indices,
			color: { width: cell, height: cell, data: front },
			coverage: { width: cell, height: cell, data: coverage },
			doubleSided: true,
			alphaCutoff: 0.5,
		},
	];
	// The first card level's wood, thinned of its twigs, in the bark's mean colour. The far card is
	// small on screen, so the wood shows as a dark stem under the crown rather than a texture.
	const box = kit.box;
	const out: [number, number, number] = [0, 0, 0];
	const drawn: Float32Array[] = [cards.positions];
	for (const part of asset.levels[1].parts) {
		if (part.name !== 'wood') continue;
		const arrays = part.arrays;
		const count = arrays.positions.length / 3;
		const positions = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			dequantisePosition(arrays.positions, i, box, out);
			positions[i * 3] = out[0];
			positions[i * 3 + 1] = out[1];
			positions[i * 3 + 2] = out[2];
		}
		const normals = new Float32Array(count * 3);
		for (let i = 0; i < count * 3; i++) normals[i] = (arrays.normals[i] as number) / 127;
		const colours = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			colours[i * 3] = 0.24;
			colours[i * 3 + 1] = 0.2;
			colours[i * 3 + 2] = 0.15;
		}
		parts.push({ positions, normals, indices: arrays.indices, colors: colours });
		drawn.push(positions);
	}
	const { min, max } = drawnBounds(drawn);
	const views = asset.impostor.views;
	const texels = asset.impostor.texels;
	// The far cards read a square atlas of `views` by `views` cells, each `texels` a side.
	const moduleName = '@null3d/impostors';
	const { bakeImpostorAtlas } = (await import(moduleName)) as { bakeImpostorAtlas: BakeAtlas };
	const bake = bakeImpostorAtlas({
		atlas: { columns: views, rows: views },
		texels,
		parts,
		min,
		max,
	});
	return {
		views,
		texels,
		color: bake.color.data,
		surface: bake.surface.data,
		size: bake.size,
		room: bake.room,
		depth: bake.depth,
	};
}
