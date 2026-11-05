// Placing plants: per variant, instance batches of its wood, its cards, its merged foliage and its
// extras, each with its levels by distance; far cards past the impostor's distance, handed over
// with the engine's dithered draw ranges; and, with a near pool, the species' shoot batches.
//
// Every switch is a distance at which a size covers the record's switch pixels at the page's view,
// times the page's switch bias. The near split `d` is where the longest shoot covers the first
// switch's pixels: inside it a copy in the near pool draws real shoot rows, beyond it its own cards.
// Shoot rows draw in bands of falling leaf mesh tier inside `d`, each band handing over to the next
// through the engine's dither, the last fading out just past `d`. A copy's cards draw at every
// distance and give way, pixel by pixel, inside its split (§5.6 of the plant core's design), which
// the near task writes in the card row's value: so a tree that straddles `d` shows real leaves on
// its near side and cards on its far side, and a copy that the caps leave out stays all cards.
//
// A stand-in kit's copies draw as render/stand-in.ts places them.
import type { InstanceBatch, MeshGeometry, SketchContext } from '@null3d/engine';
import type { ImpostorBatch } from '@null3d/impostors';
import type { PlantAsset, PlantPart } from '../asset';
import { pow } from '../core/math';
import { DETAILS, type Detail } from '../core/types';
import type { FarPlant } from '../lod/impostor';
import { viewScale } from '../lod/levels';
import { FAR, handOverToCards } from './hand-over';
import { type PlantMaterials, plantGeometry, prototypeGeometry } from './material';
import { crownSphere, EDGE, mostRows, nearArrays, tierBands } from './near-arrays';
import { type NearPool, type NearSpecies, nearPoolHost } from './near-pool';
import { farCards, standInPlace } from './stand-in';
import type { SpeciesKit } from './textures';

/**
 * Where copies stand: plain arrays, one entry per copy.
 *
 * @category api/vegetation
 */
export interface PlantCopies {
	/** Copies. */
	readonly count: number;
	/** 3 per copy, world metres. */
	readonly position: Float32Array;
	/** Radians about +Y. */
	readonly turn: Float32Array;
	/** One per copy. */
	readonly scale: Float32Array;
	/** Index into the `assets` given to `placePlants`. */
	readonly variant: Uint8Array;
}

/**
 * The page's view, which turns every species' switch pixels into metres. A page gives one view to
 * every `placePlants` call, so its switch bias moves the level switches of all its species at once.
 *
 * @category api/vegetation
 */
export interface PlantView {
	/** The page's render height in pixels. */
	readonly height: number;
	/** The camera's vertical field of view in degrees. */
	readonly fov: number;
	/**
	 * Stops by which every level switch moves nearer: each switch distance is multiplied by two to the
	 * power of minus the bias. 1 switches at half the distance, -1 at twice it, 0 as the species
	 * gives. 0 by default.
	 */
	readonly switchBias?: number;
}

/**
 * How `placePlants` draws copies.
 *
 * @category api/vegetation
 */
export interface PlaceOptions {
	/** The species' materials. */
	readonly materials: PlantMaterials;
	/** The scene's near pool; without one, no copy draws real shoots. */
	readonly near?: NearPool;
	/** The far cards, one per variant; without them, the second card level draws to the horizon. */
	readonly far?: readonly FarPlant[];
	/** The page's view: its render height, its field of view and its switch bias. */
	readonly view: PlantView;
	/** Whether the plants cast shadows. */
	readonly castShadows?: boolean;
}

/**
 * The factor that a page's distance-switch bias gives every switch distance: two to the power of
 * minus the bias, so a bias of 1 switches each level at half the distance and -1 at twice it.
 *
 * @param bias The bias in stops; 0 leaves every distance as it is.
 * @returns The factor.
 * @category api/vegetation
 */
export function switchScale(bias = 0): number {
	if (!Number.isFinite(bias))
		throw new Error(`@null3d/vegetation: a switch bias of ${bias} is not a number of stops.`);
	return bias === 0 ? 1 : pow(2, -bias);
}

/**
 * The plants that `placePlants` drew.
 *
 * @category api/vegetation
 */
export interface PlacedPlants {
	/** Copies drawn. */
	readonly copies: number;
	/**
	 * The distance inside which a copy in the near pool draws real shoots, in metres: 0 for a
	 * stand-in kit, whose copies draw no real shoots.
	 */
	readonly split: number;
	/** Removes every mesh, batch and card of the placement. */
	destroy(): void;
}

/**
 * Writes a batch's rows from the copies of one variant, each standing at its crown's centre, turned
 * and scaled with its copy, and carrying the centre in its values, which the plant shader takes back
 * off every point. The card rows' first value, the split, starts at zero: every copy draws its cards
 * whole until the near pool answers.
 */
function fillCrownRows(
	batch: InstanceBatch,
	copies: PlantCopies,
	rows: readonly number[],
	centre: readonly [number, number, number],
): void {
	const values = batch.values as Float32Array;
	rows.forEach((copy, row) => {
		const turn = copies.turn[copy] as number;
		const s = copies.scale[copy] as number;
		const [x, y, z] = centre;
		batch.positions.set(
			[
				(copies.position[copy * 3] as number) + (Math.cos(turn) * x + Math.sin(turn) * z) * s,
				(copies.position[copy * 3 + 1] as number) + y * s,
				(copies.position[copy * 3 + 2] as number) + (Math.cos(turn) * z - Math.sin(turn) * x) * s,
			],
			row * 3,
		);
		batch.rotations.set([0, Math.sin(turn / 2), 0, Math.cos(turn / 2)], row * 4);
		batch.scales.fill(s, row * 3, row * 3 + 3);
		values.set([0, x, y, z], row * 4);
	});
	batch.markDirty();
}

/** One batch of a part's level, with the distances between which it draws. */
interface Ranged {
	readonly batch: InstanceBatch;
	readonly start: number;
}

/**
 * The batches of one part at its levels, for one variant's copies. Where each level holds one
 * piece, one batch draws them all as a mesh with levels, which the engine fades between. A level
 * of several pieces takes a batch per piece, each drawing over its level's own band of distance,
 * overlapping the next level's band by the dither's width.
 */
function partBatches(
	ctx: SketchContext,
	asset: PlantAsset,
	name: PlantPart['name'],
	starts: readonly [number, number, number],
	make: (mesh: MeshGeometry) => InstanceBatch,
): Ranged[] {
	const levels = ([0, 1, 2] as const)
		.map((level) => ({
			level,
			parts: asset.levels[level].parts.filter((part) => part.name === name),
		}))
		.filter((entry) => entry.parts.length > 0);
	if (levels.length === 0) return [];
	const geometry = (part: PlantPart) => plantGeometry(ctx, part.arrays);
	if (levels.every((entry) => entry.parts.length === 1)) {
		const [first, ...rest] = levels;
		const mesh = geometry((first as (typeof levels)[number]).parts[0] as PlantPart);
		if (rest.length > 0)
			mesh.setLevels(
				rest.map((entry) => ({
					mesh: geometry(entry.parts[0] as PlantPart),
					distance: starts[entry.level],
				})),
			);
		return [{ batch: make(mesh), start: 0 }];
	}
	const out: Ranged[] = [];
	levels.forEach((entry, k) => {
		const next = levels[k + 1];
		const start = k === 0 ? 0 : starts[entry.level] / (EDGE * EDGE);
		for (const part of entry.parts) {
			const batch = make(geometry(part));
			if (next) batch.setDrawRange(start, starts[next.level]);
			else if (start > 0) batch.setDrawRange(start, FAR);
			out.push({ batch, start });
		}
	});
	return out;
}

/**
 * Draws copies of a species' variants: meshes with their levels, copy rows, shoot batches in the
 * near pool, impostor cards and their hand-over.
 *
 * @param ctx The sketch's context.
 * @param kit The species' kit.
 * @param assets The grown variants.
 * @param copies Where the copies stand.
 * @param options The materials, the near pool, the far cards and the view.
 * @returns The placement.
 * @category api/vegetation
 */
export function placePlants(
	ctx: SketchContext,
	kit: SpeciesKit,
	assets: readonly PlantAsset[],
	copies: PlantCopies,
	options: PlaceOptions,
): PlacedPlants {
	const scale = switchScale(options.view.switchBias);
	if (kit.placeholders) return standInPlace(ctx, kit, assets, copies, options);
	for (let c = 0; c < copies.count; c++)
		if ((copies.variant[c] as number) >= assets.length)
			throw new RangeError(
				`@null3d/vegetation: placePlants() got copy ${c} of variant ${copies.variant[c]}, past the ${assets.length} assets given.`,
			);
	const { materials } = options;
	const castShadows = options.castShadows ?? true;
	const host = options.near ? nearPoolHost(options.near) : undefined;
	const view = { height: options.view.height, fov: options.view.fov };
	// The asset's switches are measured at the reference view; the page's view and bias move them.
	const factor = viewScale(view) * scale;
	const split = (assets[0]?.levels[1].from ?? 0) * factor;
	const batches: InstanceBatch[] = [];
	const impostors: ImpostorBatch[] = [];
	const cardBatches: NearSpecies['cards'][number][] = [];
	const cardRows = new Uint32Array(copies.count);
	let cardFirst = 0;

	assets.forEach((asset, variant) => {
		const rows: number[] = [];
		for (let c = 0; c < copies.count; c++)
			if ((copies.variant[c] as number) === variant) rows.push(c);
		if (rows.length === 0) return;
		rows.forEach((copy, row) => {
			cardRows[copy] = cardFirst + row;
		});
		const distances = [
			asset.levels[1].from * factor,
			asset.levels[2].from * factor,
			asset.impostor.from * factor,
		] as const;
		const far = options.far?.find((plant) => plant.variant === asset.variant);
		if (far && !(distances[2] > 0)) {
			// An impostor that starts at once, as a review asks for, draws its far cards alone.
			const farBatch = farCards(ctx, asset, far.bake, copies, rows);
			farBatch.batch.setDrawRange(0, FAR);
			impostors.push(farBatch);
			cardFirst += rows.length;
			return;
		}
		let largest = 0;
		for (const copy of rows) largest = Math.max(largest, copies.scale[copy] as number);
		const sphere = crownSphere(kit, asset);
		const radius = sphere.radius * Math.max(largest, 1e-3);
		const make =
			(material: PlantMaterials[keyof PlantMaterials]) =>
			(mesh: MeshGeometry): InstanceBatch => {
				const batch = ctx.scene.createInstances(mesh, rows.length, {
					material,
					castShadows,
					receiveShadows: true,
					values: true,
				});
				fillCrownRows(batch, copies, rows, sphere.centre);
				batch.setBoundingRadius(radius);
				return batch;
			};
		const ranged = [
			...partBatches(ctx, asset, 'wood', distances, make(materials.wood)),
			...partBatches(ctx, asset, 'foliage', distances, make(materials.foliage)),
			...partBatches(ctx, asset, 'extras', distances, make(materials.extras)),
		];
		// The cards draw from the camera out, since a near copy's cards draw beyond its split: their
		// first level starts at once, and their second at its own switch.
		const cards = partBatches(ctx, asset, 'cards', [0, 0, distances[1]], make(materials.cards));
		for (const card of cards) {
			cardBatches.push({
				batch: card.batch,
				first: cardFirst,
				count: rows.length,
				centre: sphere.centre,
			});
			ranged.push(card);
		}
		cardFirst += rows.length;
		if (far && ranged.length > 0) {
			const farBatch = farCards(ctx, asset, far.bake, copies, rows);
			const handOver = distances[2];
			handOverToCards((ranged[0] as Ranged).batch, farBatch.batch, handOver);
			for (const entry of ranged) entry.batch.setDrawRange(entry.start, handOver);
			impostors.push(farBatch);
		}
		for (const entry of ranged) batches.push(entry.batch);
	});

	let species: NearSpecies | undefined;
	if (host && kit.record.lod.nearFoliage === 'instanced' && kit.prototypes.length > 0) {
		species = nearSpecies(ctx, kit, assets, copies, options, {
			split,
			cardRows,
			cards: cardBatches,
			cardTotal: cardFirst,
			// A kit holds its own tier and those below it, so the nearest band draws no finer.
			detail: DETAILS.indexOf(kit.detail) < DETAILS.indexOf(host.detail) ? kit.detail : host.detail,
			maxCopies: host.maxCopies,
			maxTriangles: host.maxTriangles,
		});
		host.add(species);
		for (const shoot of species.shoots) if (shoot) batches.push(shoot.batch);
	}

	return {
		copies: copies.count,
		split,
		destroy() {
			if (species) host?.remove(species);
			for (const batch of batches) batch.destroy();
			for (const batch of impostors) batch.destroy();
		},
	};
}

/** What the shoot batches and the near task's arrays are made from. */
interface NearSetup {
	readonly split: number;
	readonly cardRows: Uint32Array;
	readonly cards: NearSpecies['cards'];
	readonly cardTotal: number;
	readonly detail: Detail;
	readonly maxCopies: number;
	readonly maxTriangles: number;
}

/**
 * The species as the near pool takes it: its shoot batches, one per prototype that a row uses and
 * per tier band, each sized for the most rows the caps could put in it, and the near task's arrays.
 */
function nearSpecies(
	ctx: SketchContext,
	kit: SpeciesKit,
	assets: readonly PlantAsset[],
	copies: PlantCopies,
	options: PlaceOptions,
	setup: NearSetup,
): NearSpecies {
	const prototypes = kit.prototypes.length;
	const bands = tierBands(setup.detail, setup.split);
	const most = mostRows(prototypes, assets);
	const shoots: (NearSpecies['shoots'][number] | undefined)[] = [];
	for (let p = 0; p < prototypes; p++)
		for (const band of bands) {
			const arrays = kit.prototypes[p]?.tiers[band.tier];
			if ((most[p] as number) === 0 || !arrays || arrays.indices.length === 0) {
				shoots.push(undefined);
				continue;
			}
			const capacity = Math.max(
				1,
				Math.min(
					setup.maxCopies * (most[p] as number),
					Math.ceil(setup.maxTriangles / (arrays.indices.length / 3)) + 1,
				),
			);
			const batch = ctx.scene.createInstances(prototypeGeometry(ctx, arrays), capacity, {
				material: options.materials.shoots,
				values: true,
				castShadows: options.castShadows ?? true,
				receiveShadows: true,
			});
			batch.setDrawRange(band.start, band.end);
			batch.setActiveCount(0);
			shoots.push({ batch, capacity });
		}
	return {
		table: kit.textures.near,
		split: setup.split,
		bands,
		arrays: nearArrays(kit, assets, copies, setup.cardRows),
		copies: copies.count,
		variants: assets.length,
		prototypes,
		shoots,
		cards: setup.cards,
		cardRows: setup.cardTotal,
	};
}
