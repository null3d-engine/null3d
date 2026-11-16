// The page side's stand-ins: what prepareSpecies, plantMaterials, placePlants and createNearPool do
// for a kit built with `placeholders`, which loads no texture file and grows every stage's stand-in.
// A stand-in kit gets a white texture in each slot and its card atlas; its materials are the engine's
// standard material in the record's bark and leaf colours, with no wind; and its copies draw as
// instance batches of the variants' levels by distance, with far cards from the far bake past the
// impostor's distance. Scenes keep the core's whole structure while their plants are stand-ins.
import type {
	MeshArrays as EngineMeshArrays,
	InstanceBatch,
	MeshGeometry,
	SketchContext,
	Texture,
} from '@null3d/engine';
import { createImpostors, type ImpostorBatch } from '@null3d/impostors';
import type { PlantAsset, PlantPart, QuantisedArrays, SpeciesKitData } from '../asset';
import type { SpeciesBox } from '../core/box';
import type { Species, SpeciesModule } from '../core/record';
import { barkColourOf } from '../core/textures';
import type { Rgb } from '../core/types';
import { TEXTURE_UV_STEPS, WOOD_UV_STEPS } from '../lod/quantise';
import { buildKit } from '../tasks';
import { handOverToCards } from './hand-over';
import type { PlantMaterials } from './material';
import type { NearPool } from './near-pool';
import { type PlacedPlants, type PlaceOptions, type PlantCopies, switchScale } from './place';
import { foliageOptics } from './records';
import type { PrepareOptions, SpeciesKit, SpeciesTextures } from './textures';

/** A texture from bytes, four a texel. */
function texture(
	ctx: SketchContext,
	width: number,
	height: number,
	data: Uint8Array,
	colorSpace: 'srgb' | 'linear',
): Texture {
	return ctx.textures.fromData({ width, height, data, colorSpace, wrap: 'clamp', mipmaps: false });
}

/**
 * Prepares a species with stand-ins: its kit in a job worker, a white texture in every slot but the
 * card atlas's, and nothing loaded from the textures package.
 */
export async function standInPrepare(
	ctx: SketchContext,
	module: SpeciesModule,
	options: PrepareOptions,
): Promise<SpeciesKit> {
	const kit = await buildKit(module, {
		detail: options.detail ?? ctx.quality.preset,
		placeholders: true,
		...(options.form !== undefined && { form: options.form }),
		...(options.cache && { cache: options.cache }),
	});
	const white = texture(ctx, 1, 1, new Uint8Array([255, 255, 255, 255]), 'linear');
	const size = kit.cards.size;
	const cardColor =
		size > 0
			? texture(ctx, size, size, kit.cards.color.subarray(0, size * size * 4), 'linear')
			: white;
	const textures: SpeciesTextures = {
		set: 'full',
		leafColor: white,
		leafNormal: white,
		barkColor: white,
		barkNormal: white,
		youngColor: white,
		youngNormal: white,
		cardColor,
		cardSurface: white,
		records: white,
		near: white,
		bytes: 4 + size * size * 4,
	};
	return {
		...kit,
		textures,
		...(options.cache && { cache: options.cache }),
		...(options.coarseness !== undefined && { coarseness: options.coarseness }),
		...(options.triangles !== undefined && { triangles: options.triangles }),
	};
}

/** The record's leaf colour, from its foliage's optics. */
function leafColour(record: Species): Rgb {
	return foliageOptics(record)?.reflectance ?? [0.1, 0.2, 0.06];
}

/** The stand-in materials: the standard material in the record's bark and leaf colours. */
export function standInMaterials(ctx: SketchContext, kit: SpeciesKit): PlantMaterials {
	const leaf = leafColour(kit.record);
	const bark = barkColourOf(kit.record, kit.manifest);
	const made = {
		wood: ctx.materials.standard({ color: bark, roughness: 0.9 }),
		shoots: ctx.materials.standard({ color: leaf, roughness: 0.6, doubleSided: true }),
		cards: ctx.materials.standard({
			map: kit.textures.cardColor,
			roughness: 0.7,
			doubleSided: true,
			alphaMode: 'mask',
			alphaCutoff: 0.5,
		}),
		foliage: ctx.materials.standard({ color: leaf, roughness: 0.6, doubleSided: true }),
	};
	// Extras draw with the leaves' material, and the far foliage draws as the plain material does.
	return { ...made, foliageFar: made.foliage, extras: made.foliage };
}

/** A part's arrays in floats, in plant-space metres, as the engine's geometry takes them. */
function dequantise(arrays: QuantisedArrays, box: SpeciesBox, uvSteps: number): EngineMeshArrays {
	const count = arrays.positions.length / 3;
	const positions = new Float32Array(count * 3);
	const normals = new Float32Array(count * 3);
	for (let i = 0; i < count; i++)
		for (let k = 0; k < 3; k++) {
			const low = box.min[k] as number;
			const span = (box.max[k] as number) - low;
			positions[i * 3 + k] = low + ((arrays.positions[i * 3 + k] as number) / 65535) * span;
			normals[i * 3 + k] = (arrays.normals[i * 3 + k] as number) / 127;
		}
	const uvs = new Float32Array(count * 2);
	for (let i = 0; i < count * 2; i++) uvs[i] = (arrays.uvs[i] as number) / uvSteps;
	return { positions, normals, uvs, indices: arrays.indices };
}

/** One part of a level, by name. */
const partNamed = (asset: PlantAsset, level: 0 | 1 | 2, name: PlantPart['name']) =>
	asset.levels[level].parts.find((part) => part.name === name);

/**
 * A mesh of one part with its coarser levels by distance: the nearest level that has the part, then
 * each later one from the distance at which its level starts, times the page's switch scale.
 */
function partMesh(
	ctx: SketchContext,
	kit: SpeciesKitData,
	asset: PlantAsset,
	name: PlantPart['name'],
	scale: number,
): MeshGeometry | undefined {
	const steps = name === 'wood' ? WOOD_UV_STEPS : TEXTURE_UV_STEPS;
	const levels = ([0, 1, 2] as const)
		.map((level) => ({ level, part: partNamed(asset, level, name) }))
		.filter((entry): entry is { level: 0 | 1 | 2; part: PlantPart } => entry.part !== undefined);
	const [first, ...rest] = levels;
	if (!first) return undefined;
	const base = ctx.geometry.fromArrays(dequantise(first.part.arrays, kit.box, steps));
	// The part's coarser levels are the plant core's, which grows every level from one skeleton, so
	// they are set by hand and the engine plans none on top of them.
	if (rest.length > 0)
		base.setLevels(
			rest.map(({ level, part }) => ({
				mesh: ctx.geometry.fromArrays(dequantise(part.arrays, kit.box, steps)),
				distance: asset.levels[level].from * scale,
			})),
		);
	return base;
}

/** Writes the rows of a batch from the copies of one variant. */
function fillRows(batch: InstanceBatch, copies: PlantCopies, rows: readonly number[]): void {
	rows.forEach((copy, row) => {
		batch.positions.set(copies.position.subarray(copy * 3, copy * 3 + 3), row * 3);
		const half = (copies.turn[copy] as number) / 2;
		batch.rotations.set([0, Math.sin(half), 0, Math.cos(half)], row * 4);
		batch.scales.fill(copies.scale[copy] as number, row * 3, row * 3 + 3);
	});
	batch.markDirty();
}

/** The far cards of one variant's copies, from its far bake, standing where the copies stand. */
export function farCards(
	ctx: SketchContext,
	asset: PlantAsset,
	bake: NonNullable<PlaceOptions['far']>[number]['bake'],
	copies: PlantCopies,
	rows: readonly number[],
): ImpostorBatch {
	const side = bake.views * bake.texels;
	const positions: number[] = [];
	const turn: number[] = [];
	const base = asset.skeleton.bounds.min[1];
	for (const copy of rows) {
		const scale = copies.scale[copy] as number;
		positions.push(
			copies.position[copy * 3] as number,
			(copies.position[copy * 3 + 1] as number) + base * scale,
			copies.position[copy * 3 + 2] as number,
		);
		turn.push(copies.turn[copy] as number);
	}
	const cards = createImpostors(
		{ scene: ctx.scene, materials: ctx.materials, geometry: ctx.geometry },
		{
			color: texture(ctx, side, side, bake.color, 'srgb'),
			surface: texture(ctx, side, side, bake.surface, 'linear'),
			atlas: { columns: bake.views, rows: bake.views },
			positions,
			turn,
			size: bake.size,
			depth: bake.depth,
			room: bake.room,
			alphaMode: 'mask',
			receiveShadows: true,
		},
	);
	// A card's row holds its width and height at scale 1, which the copy's own scale multiplies.
	rows.forEach((copy, row) => {
		const scale = copies.scale[copy] as number;
		cards.batch.scales.set([bake.size[0] * scale, bake.size[1] * scale, 1], row * 3);
	});
	cards.markDirty();
	return cards;
}

/**
 * Places a stand-in kit's copies: per variant, an instance batch of each part it has (wood, cards,
 * merged foliage, extras), each mesh with its levels by distance, and far cards past the impostor's
 * distance when the page gives the far bakes. The view's switch bias moves every distance.
 */
export function standInPlace(
	ctx: SketchContext,
	kit: SpeciesKit,
	assets: readonly PlantAsset[],
	copies: PlantCopies,
	options: PlaceOptions,
): PlacedPlants {
	const batches: InstanceBatch[] = [];
	const cards: ImpostorBatch[] = [];
	const scale = switchScale(options.view.switchBias);
	assets.forEach((asset, variant) => {
		const rows: number[] = [];
		for (let copy = 0; copy < copies.count; copy++)
			if ((copies.variant[copy] as number) === variant) rows.push(copy);
		if (rows.length === 0) return;
		const far = options.far?.find((plant) => plant.variant === asset.variant);
		const near: InstanceBatch[] = [];
		for (const [name, material] of [
			['wood', options.materials.wood],
			['cards', options.materials.cards],
			['foliage', options.materials.foliage],
			['extras', options.materials.foliage],
		] as const) {
			const mesh = partMesh(ctx, kit, asset, name, scale);
			if (!mesh) continue;
			const batch = ctx.scene.createInstances(mesh, rows.length, {
				material,
				castShadows: options.castShadows ?? true,
				receiveShadows: true,
				ranges: far !== undefined,
			});
			fillRows(batch, copies, rows);
			near.push(batch);
		}
		batches.push(...near);
		if (far) {
			const batch = farCards(ctx, asset, far.bake, copies, rows);
			for (const mesh of near) handOverToCards(mesh, batch.batch, asset.impostor.from * scale);
			cards.push(batch);
		}
	});
	return {
		copies: copies.count,
		destroy() {
			for (const batch of batches) batch.destroy();
			for (const batch of cards) batch.destroy();
		},
	};
}

/** The stand-in near pool, which draws no real shoots: every copy stays on its cards. */
export function standInNearPool(): NearPool {
	return { copies: 0, triangles: 0, update() {}, destroy() {} };
}
