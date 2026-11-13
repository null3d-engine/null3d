// Plants at fixed places, drawn with real shoots near the camera: a review page, a hero tree, a
// garden, a stand. Every batch is composed once at setup. Without a near pool, the first copies hold
// the species' near slots for good and no work runs per frame; with one, the pool hands the copies
// their pieces as the camera moves and writes them into pools of slots (render/pooled-shoots.ts).
//
// Each level of each variant draws as instance batches of its own, one per part, over the band of
// distance in which the level shows: the nearest wood from the copy out to the shoots' switch, the
// first card level from there to the second's start, and the second to the impostor's. The plant
// materials are custom materials, which switch at once, so each band ends where the next begins.
//
// Shoot rows are the nearest level's foliage. Every row of every copy with a near slot becomes one
// instance of its prototype's batch, placed in the world, with the four values the plant shader
// reads: the parent branch's wind record, the flutter phase, the crown's light and the copy's slot
// in the species' near table. Each row draws to the switch distance and a little past it; the same
// copy's first card level draws from the copy out, and gives way to the shoots, pixel by pixel,
// inside the switch distance. So a copy that straddles the switch shows real leaves on its near
// side and cards on its far side, and no pixel drops out of both.
import type { InstanceBatch, Material, MeshGeometry, SketchContext } from '@null3d/engine';
import type { ImpostorBatch } from '@null3d/impostors';
import type { PlantAsset, PlantPart } from '../asset';
import { DETAILS, type Detail, type Season } from '../core/types';
import { SHOOT_REACH, switchScale } from '../lod/drawn';
import { firstCardStart, REFERENCE_VIEW, texelStart } from '../lod/levels';
import { EDGE_BAND, handOverToCards } from './hand-over';
import {
	type PlantMaterials,
	plantBoundingRadius,
	plantGeometry,
	prototypeGeometry,
	setPlacedUniforms,
} from './material';
import { isPoolHost } from './near-pool';
import { nearTable, writeCopyRows, writeSlotPlace } from './near-table';
import type { PlacedPlants, PlaceOptions, PlantCopies } from './place';
import { type CardRow, DITHER_PHASES, pooledShoots } from './pooled-shoots';
import { farCards } from './stand-in';
import { NEAR_SLOTS, type SpeciesKit, writePlantWind } from './textures';

/** The number the shader knows each season by. */
const SEASON_KIND: Readonly<Record<Season, number>> = {
	summer: 0,
	autumn: 1,
	winter: 2,
	blossom: 3,
};

/** The far edge of a band with no end, in metres. */
const FAR = 1e9;

/**
 * The scale from distances measured at the reference view to the page's view: a size covers the
 * same pixels at this many times the distance.
 */
function viewScale(view: PlaceOptions['view']): number {
	const page = view.height / Math.tan((view.fov * Math.PI) / 360);
	const reference = REFERENCE_VIEW.height / Math.tan((REFERENCE_VIEW.fov * Math.PI) / 360);
	return page / reference;
}

/**
 * Whether a variant draws its shoot rows near the camera. A triangle maximum may leave the rows to
 * the nearest level's cards, and the variant then draws like one with no shoots.
 *
 * @param asset The grown variant.
 * @returns Whether its rows draw.
 */
export function drawsShoots(asset: PlantAsset): boolean {
	return asset.shoots.count > 0 && asset.shootDetail !== 'none';
}

/** The copies of one variant, by index into the copies. */
function copiesOf(copies: PlantCopies, variant: number): number[] {
	const rows: number[] = [];
	for (let copy = 0; copy < copies.count; copy++)
		if ((copies.variant[copy] as number) === variant) rows.push(copy);
	return rows;
}

/** Writes a batch's rows from copies: their places, their turns about +Y and their scales. */
function placeCopies(batch: InstanceBatch, copies: PlantCopies, rows: readonly number[]): void {
	const { positions, rotations, scales } = batch;
	rows.forEach((copy, row) => {
		positions.set(copies.position.subarray(copy * 3, copy * 3 + 3), row * 3);
		const half = (copies.turn[copy] as number) / 2;
		rotations.set([0, Math.sin(half), 0, Math.cos(half)], row * 4);
		scales.fill(copies.scale[copy] as number, row * 3, row * 3 + 3);
	});
	batch.markDirty();
}

/** One band of one level: the parts it draws and the distances between which it draws. */
interface Band {
	readonly parts: readonly PlantPart[];
	readonly from: number;
	readonly to: number;
}

/**
 * The bands of distance in which a variant's levels draw. Each level draws from its own start to
 * the start of the next level that has parts, so a cutting, which has the nearest level alone,
 * draws at every distance; the last draws to the impostor's distance. Where a level hands over to
 * the next, it draws on past the next one's start until the next stands at full coverage and only
 * then thins out: the two are different sources, whose dithered edges do not interlock, so a pixel
 * would drop out of both if they faded over the same distances.
 *
 * @param asset The grown variant.
 * @param near The distance at which its shoots hand over to its first card level, in metres.
 * @param scale The factor from the reference view's distances to the page's.
 * @param impostor The distance at which the far cards take over, in metres.
 * @returns One band per level, in level order.
 */
export function levelBands(
	asset: PlantAsset,
	near: number,
	scale: number,
	impostor: number,
): Band[] {
	const starts = asset.levels.map((level, index) =>
		index === 0 ? 0 : index === 1 && drawsShoots(asset) ? near : level.from * scale,
	);
	return asset.levels.map((level, index) => {
		let to = impostor;
		for (let next = index + 1; next < asset.levels.length; next++)
			if ((asset.levels[next]?.parts.length ?? 0) > 0) {
				// The next level's edge fades in over one edge band from its start; this one keeps
				// full coverage through that band and fades over the band after it.
				to = Math.min(to, (starts[next] as number) * (1 + EDGE_BAND) ** 2);
				break;
			}
		return { parts: level.parts, from: starts[index] as number, to };
	});
}

/**
 * The level of detail that a placed copy draws at a distance, and the distances its levels switch at.
 *
 * @category api/vegetation
 */
export interface DrawnLevel {
	/** 0 for the nearest level, 1 and 2 for the card levels, 3 for the far card. */
	readonly level: 0 | 1 | 2 | 3;
	/** The level in words. */
	readonly name: 'leaf form' | 'first card level' | 'second card level' | 'far card';
	/** The distance each level starts to draw at, in metres, in level order; the far card's last. */
	readonly starts: readonly number[];
}

const LEVEL_NAMES = ['leaf form', 'first card level', 'second card level', 'far card'] as const;

/**
 * The level that `placePlants` draws a copy of a variant at, a distance from the camera: its real
 * shoots and nearest wood, one of its two card levels, or its far card. A page uses it to say
 * which level a picture shows, since a figure read from a picture holds for that level alone.
 *
 * @param kit The species' kit.
 * @param asset The grown variant, as the page places it.
 * @param view The page's render height, field of view and switch bias, as `placePlants` takes them.
 * @param distance Metres from the camera to the copy, at a copy's scale of 1.
 * @param far Whether the page gave `placePlants` the far cards.
 * @returns The level, its name and every level's start.
 * @category api/vegetation
 */
export function drawnLevel(
	kit: SpeciesKit,
	asset: PlantAsset,
	view: PlaceOptions['view'],
	distance: number,
	far = false,
): DrawnLevel {
	const bias = switchScale(view.switchBias);
	const scale = viewScale(view) * bias;
	const impostor = far ? asset.impostor.from * scale : FAR;
	const bands = levelBands(asset, firstCardStart(kit, view) * bias, scale, impostor);
	let level: 0 | 1 | 2 | 3 = 0;
	bands.forEach((band, index) => {
		if (band.parts.length > 0 && distance >= band.from) level = Math.min(index, 2) as 0 | 1 | 2;
	});
	if (distance >= impostor) level = 3;
	return {
		level,
		name: LEVEL_NAMES[level],
		starts: [...bands.map((band) => band.from), impostor],
	};
}

/**
 * Places a species' copies at fixed places: their levels in bands of distance, the far cards past
 * the impostor's distance when the page gives the far bakes, and real shoot rows near the camera
 * for the first copies, up to the near table's slots.
 *
 * @param ctx The sketch's context.
 * @param kit The species' kit.
 * @param assets The grown variants.
 * @param copies Where the copies stand.
 * @param options The materials, the far cards, the view and the shadows.
 * @returns The placement.
 */
export function placeStaticPlants(
	ctx: SketchContext,
	kit: SpeciesKit,
	assets: readonly PlantAsset[],
	copies: PlantCopies,
	options: PlaceOptions,
): PlacedPlants {
	const materials = options.materials;
	// The page's switch bias moves every switch distance by one factor.
	const bias = switchScale(options.view.switchBias);
	const scale = viewScale(options.view) * bias;
	// The shoots hand over to the first card level by the rule that sets the asset's own start.
	const near = firstCardStart(kit, options.view) * bias;
	writePlantWind(kit, assets);
	// The season the copies stand in, which a stem whose colour turns reads for its bark, and the
	// autumn share the leaves take.
	const season = assets[0]?.season ?? 'summer';
	setPlacedUniforms(
		[materials.wood, materials.shoots, materials.cards, materials.foliage, materials.foliageFar],
		{
			season: assets.some((asset) => asset.season === 'autumn') ? 1 : 0,
			seasonKind: SEASON_KIND[season],
		},
	);
	const batches: InstanceBatch[] = [];
	const cards: ImpostorBatch[] = [];
	const meshes: MeshGeometry[] = [];
	const widest = copies.scale.reduce((most, s) => Math.max(most, s), 0);
	const castShadows = options.castShadows ?? true;
	// A near pool hands the copies their pieces as the camera moves; without one, the first copies
	// hold the species' near slots for good.
	const pool = isPoolHost(options.near) ? options.near : undefined;
	const slots = pool ? new Map<number, number>() : takeNearSlots(kit, copies);
	const cardRows = new Map<number, CardRow>();

	assets.forEach((asset, variant) => {
		const rows = copiesOf(copies, variant);
		if (rows.length === 0) return;
		const impostor = options.far ? asset.impostor.from * scale : FAR;
		// Each variant's parts share one sphere of its own reach, so its levels switch together.
		const bound = plantBoundingRadius(kit, asset) * widest;
		const bands = levelBands(asset, near, scale, impostor);
		const placed: InstanceBatch[] = [];
		// The batches of the band that reaches the impostor's distance, with the distance they start at.
		const last: { readonly batch: InstanceBatch; readonly from: number }[] = [];
		for (const band of bands) {
			if (!(band.to > band.from)) continue;
			for (const part of band.parts) {
				const material = materialOf(
					materials,
					part.name,
					asset.cutting !== undefined || band !== bands[0],
				);
				const mesh = plantGeometry(ctx, part.arrays);
				meshes.push(mesh);
				// The first card level of a copy with real shoots draws from the copy out: its shader
				// leaves the pixels inside the switch distance to the shoots.
				const nearCards = part.name === 'cards' && band === bands[1] && drawsShoots(asset);
				const batch = ctx.scene.createInstances(mesh, rows.length, {
					material,
					castShadows,
					receiveShadows: true,
					...(nearCards && { values: true }),
				});
				placeCopies(batch, copies, rows);
				batch.setBoundingRadius(bound);
				if (nearCards) {
					const values = batch.values as Float32Array;
					// Value x is the copy's near edge in metres, the distance its pieces draw to, and 0
					// for a copy with none; y the edge it fades from, z how far the fade has come, and w
					// the phase of its dither. The near pool writes them as it hands the pieces out.
					rows.forEach((copy, row) => {
						const edge = slots.has(copy) ? near : 0;
						values.set([edge, edge, 1, copy % DITHER_PHASES], row * 4);
						cardRows.set(copy, { batch, row });
					});
					batch.setDrawRange(0, band.to);
				} else batch.setDrawRange(band.from, band.to);
				placed.push(batch);
				if (band.to >= impostor) last.push({ batch, from: nearCards ? 0 : band.from });
			}
		}
		batches.push(...placed);
		if (!pool)
			batches.push(...shootBatches(ctx, kit, asset, copies, rows, slots, near, materials.shoots));
		const far = options.far?.find((plant) => plant.variant === asset.variant);
		if (far) {
			const batch = farCards(ctx, asset, far.bake, copies, rows);
			// Only the last band hands over to the cards, from where it starts: a nearer band keeps
			// the range that ends at its own hand-over.
			for (const { batch: mesh, from } of last) handOverToCards(mesh, batch.batch, impostor, from);
			cards.push(batch);
		}
	});
	const member = pool
		? pooledShoots(
				ctx,
				kit,
				assets,
				copies,
				cardRows,
				{ switch: near, texel: texelStart(kit, options.view) * bias },
				options.view,
				pool.budget,
				materials.shoots,
			)
		: undefined;
	const leave = member && pool ? pool.join(member) : undefined;
	return {
		copies: copies.count,
		destroy() {
			leave?.();
			member?.destroy();
			for (const batch of batches) batch.destroy();
			for (const batch of cards) batch.destroy();
			for (const mesh of meshes) mesh.destroy();
		},
	};
}

/** The material a part draws with. */
/**
 * The material that a part draws with. A foliage part beyond the nearest band, or one of a cut
 * piece, draws with the far foliage material, whose shader pays no blade keel.
 */
function materialOf(materials: PlantMaterials, name: PlantPart['name'], far = false): Material {
	switch (name) {
		case 'wood':
			return materials.wood;
		case 'cards':
			return materials.cards;
		case 'foliage':
			return far ? materials.foliageFar : materials.foliage;
		case 'extras':
			return materials.extras;
	}
}

/**
 * Gives the first copies of a placement the species' free near slots, in order, and writes each
 * one's place into the near table, so the shader finds a shoot's base in the copy's own space.
 * Placements of one species share the table, so the copies past its last slot draw no real shoots.
 *
 * @returns Each copy with a slot, and its slot.
 */
function takeNearSlots(kit: SpeciesKit, copies: PlantCopies): Map<number, number> {
	const table = nearTable(kit);
	const slots = new Map<number, number>();
	for (let copy = 0; copy < copies.count && table.next < NEAR_SLOTS; copy++) {
		const slot = table.next++;
		slots.set(copy, slot);
		writeSlotPlace(
			table,
			slot,
			[
				copies.position[copy * 3] as number,
				copies.position[copy * 3 + 1] as number,
				copies.position[copy * 3 + 2] as number,
			],
			copies.turn[copy] as number,
			copies.scale[copy] as number,
		);
	}
	if (slots.size > 0) kit.textures.near.update(table.data);
	return slots;
}

/**
 * The shoot rows of one variant's copies with slots: one batch per prototype at the rows' tier,
 * each row one shoot of one copy, placed in the world, drawing to the switch distance.
 */
function shootBatches(
	ctx: SketchContext,
	kit: SpeciesKit,
	asset: PlantAsset,
	copies: PlantCopies,
	rows: readonly number[],
	slots: ReadonlyMap<number, number>,
	near: number,
	material: Material,
): InstanceBatch[] {
	const shoots = asset.shoots;
	const nearCopies = rows.filter((copy) => slots.has(copy));
	if (!drawsShoots(asset) || nearCopies.length === 0) return [];
	// The kit's tier, or the tier below it that a triangle maximum gave the rows.
	const tier = DETAILS.indexOf((asset.shootDetail as Detail | undefined) ?? kit.detail);
	// Rows per prototype, so each batch is sized once.
	const counts = new Array<number>(kit.prototypes.length).fill(0);
	for (let r = 0; r < shoots.count; r++) {
		const p = shoots.prototype[r] as number;
		counts[p] = (counts[p] as number) + 1;
	}
	const batches: InstanceBatch[] = [];
	kit.prototypes.forEach((prototype, p) => {
		const count = (counts[p] as number) * nearCopies.length;
		const arrays = prototype.tiers[tier];
		if (count === 0 || !arrays || arrays.indices.length === 0) return;
		const batch = ctx.scene.createInstances(prototypeGeometry(ctx, arrays), count, {
			material,
			castShadows: true,
			receiveShadows: true,
			values: true,
		});
		let row = 0;
		for (const copy of nearCopies)
			row = writeCopyRows(batch, row, asset, copies, copy, p, slots.get(copy) as number);
		batch.markDirty();
		batch.setDrawRange(0, near * SHOOT_REACH);
		batches.push(batch);
	});
	return batches;
}
