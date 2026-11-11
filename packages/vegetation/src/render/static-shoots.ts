// Plants at fixed places, drawn with real shoots near the camera: a review page, a hero tree, a
// garden of a few copies. Everything is composed once at setup, so no work runs per frame.
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
import type { InstanceBatch, Material, MeshGeometry, SketchContext, Texture } from '@null3d/engine';
import type { ImpostorBatch } from '@null3d/impostors';
import type { PlantAsset, PlantPart } from '../asset';
import { DETAILS, type Season, spreadMax } from '../core/types';
import { REFERENCE_VIEW } from '../lod/levels';
import { EDGE_BAND, handOverToCards } from './hand-over';
import {
	type PlantMaterials,
	plantBoundingRadius,
	plantGeometry,
	prototypeGeometry,
	setPlacedUniforms,
} from './material';
import { type PlacedPlants, type PlaceOptions, type PlantCopies, switchScale } from './place';
import { toHalf, writeShootRow } from './records';
import { farCards } from './stand-in';
import { NEAR_SLOT_TEXELS, NEAR_SLOTS, type SpeciesKit, writePlantWind } from './textures';

/** The number the shader knows each season by. */
const SEASON_KIND: Readonly<Record<Season, number>> = {
	summer: 0,
	autumn: 1,
	winter: 2,
	blossom: 3,
};

/** How far past the switch distance a shoot row draws, and how far inside it a card gives way. */
const SHOOT_REACH = 1.04;

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
 * The distance at which a copy hands its shoots to its first card level: where the species'
 * longest shoot, at its largest scale, covers the record's first switch pixels at the page's view.
 *
 * @param kit The species' kit.
 * @param view The page's render height and vertical field of view.
 * @returns Metres, at a copy's scale of 1.
 */
export function shootSwitchDistance(kit: SpeciesKit, view: PlaceOptions['view']): number {
	let longest = 0;
	for (const prototype of kit.prototypes) longest = Math.max(longest, prototype.length);
	const scale = kit.record.shoots ? spreadMax(kit.record.shoots.placement.scale) : 1;
	longest *= scale;
	const pixels = kit.record.lod.switchPixels[0];
	return (longest * view.height) / (2 * Math.tan((view.fov * Math.PI) / 360) * pixels);
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
		index === 0 ? 0 : index === 1 && asset.shoots.count > 0 ? near : level.from * scale,
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
	const near = shootSwitchDistance(kit, options.view) * bias;
	writePlantWind(kit, assets);
	setPlacedUniforms([materials.cards], { nearDistance: near });
	// The season the copies stand in, which a stem whose colour turns reads for its bark, and the
	// autumn share the leaves take.
	const season = assets[0]?.season ?? 'summer';
	setPlacedUniforms([materials.wood, materials.shoots, materials.cards, materials.foliage], {
		season: assets.some((asset) => asset.season === 'autumn') ? 1 : 0,
		seasonKind: SEASON_KIND[season],
	});
	const batches: InstanceBatch[] = [];
	const cards: ImpostorBatch[] = [];
	const meshes: MeshGeometry[] = [];
	const widest = copies.scale.reduce((most, s) => Math.max(most, s), 0);
	const bound = plantBoundingRadius(kit.box) * widest;
	const castShadows = options.castShadows ?? true;
	const slots = takeNearSlots(kit, copies);

	assets.forEach((asset, variant) => {
		const rows = copiesOf(copies, variant);
		if (rows.length === 0) return;
		const impostor = options.far ? asset.impostor.from * scale : FAR;
		const bands = levelBands(asset, near, scale, impostor);
		const placed: InstanceBatch[] = [];
		// The batches of the band that reaches the impostor's distance, with the distance they start at.
		const last: { readonly batch: InstanceBatch; readonly from: number }[] = [];
		for (const band of bands) {
			if (!(band.to > band.from)) continue;
			for (const part of band.parts) {
				const material = materialOf(materials, part.name);
				const mesh = plantGeometry(ctx, part.arrays);
				meshes.push(mesh);
				// The first card level of a copy with real shoots draws from the copy out: its shader
				// leaves the pixels inside the switch distance to the shoots.
				const nearCards = part.name === 'cards' && band === bands[1] && asset.shoots.count > 0;
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
					// Value x is the split distance in metres, the distance the shoot rows draw to, and
					// 0 for a copy with no shoots.
					rows.forEach((copy, row) => {
						values[row * 4] = slots.has(copy) ? near : 0;
					});
					batch.setDrawRange(0, band.to);
				} else batch.setDrawRange(band.from, band.to);
				placed.push(batch);
				if (band.to >= impostor) last.push({ batch, from: nearCards ? 0 : band.from });
			}
		}
		batches.push(...placed);
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
	return {
		copies: copies.count,
		destroy() {
			for (const batch of batches) batch.destroy();
			for (const batch of cards) batch.destroy();
			for (const mesh of meshes) mesh.destroy();
		},
	};
}

/** The material a part draws with. */
function materialOf(materials: PlantMaterials, name: PlantPart['name']): Material {
	switch (name) {
		case 'wood':
			return materials.wood;
		case 'cards':
			return materials.cards;
		case 'foliage':
			return materials.foliage;
		case 'extras':
			return materials.extras;
	}
}

/** Each species' near table on the CPU, and the next slot that no placement holds. */
const NEAR_TABLES = new WeakMap<Texture, { readonly data: Float32Array; next: number }>();

/**
 * The near slots of a species that fixed placements hold, which the scene's near pool leaves to
 * them: slots 0 up to this count.
 *
 * @param kit The species' kit.
 * @returns The slots held.
 */
export function staticNearSlots(kit: SpeciesKit): number {
	return NEAR_TABLES.get(kit.textures.near)?.next ?? 0;
}

/**
 * Gives the first copies of a placement the species' free near slots, in order, and writes each
 * one's place into the near table: the place's high halves and the copy's turn, then the place's
 * remainders and its scale, so the shader finds a shoot's base in the copy's own space. Placements
 * of one species share the table, so the copies past its last slot draw no real shoots.
 *
 * @returns Each copy with a slot, and its slot.
 */
function takeNearSlots(kit: SpeciesKit, copies: PlantCopies): Map<number, number> {
	const texture = kit.textures.near;
	let table = NEAR_TABLES.get(texture);
	if (!table) {
		table = { data: new Float32Array(NEAR_SLOTS * NEAR_SLOT_TEXELS * 4), next: 0 };
		NEAR_TABLES.set(texture, table);
	}
	const slots = new Map<number, number>();
	for (let copy = 0; copy < copies.count && table.next < NEAR_SLOTS; copy++) {
		const slot = table.next++;
		slots.set(copy, slot);
		const at = slot * NEAR_SLOT_TEXELS * 4;
		for (let k = 0; k < 3; k++) {
			const p = copies.position[copy * 3 + k] as number;
			const high = toHalf(p);
			table.data[at + k] = high;
			table.data[at + 4 + k] = p - high;
		}
		table.data[at + 3] = copies.turn[copy] as number;
		table.data[at + 7] = copies.scale[copy] as number;
	}
	if (slots.size > 0) texture.update(table.data);
	return slots;
}

/**
 * The shoot rows of one variant's copies with slots: one batch per prototype at the kit's tier,
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
	if (shoots.count === 0 || nearCopies.length === 0) return [];
	const tier = DETAILS.indexOf(kit.detail);
	// Rows per prototype, so each batch is sized once.
	const counts = new Array<number>(kit.prototypes.length).fill(0);
	for (let r = 0; r < shoots.count; r++) {
		const p = shoots.prototype[r] as number;
		counts[p] = (counts[p] as number) + 1;
	}
	const batches: InstanceBatch[] = [];
	const q = [0, 0, 0, 1];
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
		const { positions, rotations, scales } = batch;
		const values = batch.values as Float32Array;
		let row = 0;
		for (const copy of nearCopies) {
			const slot = slots.get(copy) as number;
			const cx = copies.position[copy * 3] as number;
			const cy = copies.position[copy * 3 + 1] as number;
			const cz = copies.position[copy * 3 + 2] as number;
			const turn = copies.turn[copy] as number;
			const size = copies.scale[copy] as number;
			const c = Math.cos(turn);
			const s = Math.sin(turn);
			const half = turn / 2;
			q[1] = Math.sin(half);
			q[3] = Math.cos(half);
			for (let r = 0; r < shoots.count; r++) {
				if ((shoots.prototype[r] as number) !== p) continue;
				const x = (shoots.position[r * 3] as number) * size;
				const y = (shoots.position[r * 3 + 1] as number) * size;
				const z = (shoots.position[r * 3 + 2] as number) * size;
				positions[row * 3] = cx + x * c + z * s;
				positions[row * 3 + 1] = cy + y;
				positions[row * 3 + 2] = cz - x * s + z * c;
				turnQuaternion(q, shoots.rotation, r * 4, rotations, row * 4);
				scales.fill((shoots.scale[r] as number) * size, row * 3, row * 3 + 3);
				writeShootRow(
					values,
					row,
					asset.wind.base + (shoots.record[r] as number),
					shoots.phase[r] as number,
					shoots.sky[r] as number,
					shoots.bent[r] as number,
					slot,
				);
				row++;
			}
		}
		batch.markDirty();
		batch.setDrawRange(0, near * SHOOT_REACH);
		batches.push(batch);
	});
	return batches;
}

/** Writes the turn `a` (about +Y only) times the quaternion at `b[bo]` into `out[oo]`. */
function turnQuaternion(
	a: readonly number[],
	b: Float32Array,
	bo: number,
	out: Float32Array,
	oo: number,
): void {
	const ay = a[1] as number;
	const aw = a[3] as number;
	const bx = b[bo] as number;
	const by = b[bo + 1] as number;
	const bz = b[bo + 2] as number;
	const bw = b[bo + 3] as number;
	out[oo] = aw * bx + ay * bz;
	out[oo + 1] = aw * by + ay * bw;
	out[oo + 2] = aw * bz - ay * bx;
	out[oo + 3] = aw * bw - ay * by;
}
