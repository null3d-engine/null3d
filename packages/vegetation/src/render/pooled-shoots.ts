// A placement's real pieces in the scene's near pool. The species' shoot rows stand in two pools of
// slots, one whose row batches draw to the switch and one that draws on to the texel range; each slot
// holds room for one copy of the species' largest variant, prototype by prototype, placed in the
// world, so the engine culls and fades each row by its own distance. When the pool grants a copy a
// range, the copy takes a slot of that range's pool, and its rows' places, turns, scales and values
// and its near-table texels are written into the slot; a slot nobody holds parks its rows far below
// the ground. Each copy's first card level reads its own near edge from its card row: none, the
// switch or the texel range.
import type { InstanceBatch, Material, SketchContext } from '@null3d/engine';
import type { PlantAsset } from '../asset';
import { DETAILS, type Detail } from '../core/types';
import { SHOOT_REACH } from '../lod/drawn';
import { prototypeGeometry } from './material';
import { POOL_SLOTS, poolSizes, SlotPool } from './near-slots';
import { nearTable, writeCopyRows, writeSlotPlace } from './near-table';
import type { PlantCopies } from './place';
import { GRANT_SWITCH, GRANT_TEXEL, pieceCosts } from './plant-budget';
import type { SpeciesKit } from './textures';

/** Where a parked row stands: far below any ground, past every range. */
const PARKED = -1e7;

/** A placement as the near pool sees it. */
export interface PoolMember {
	/** Where the copies stand. */
	readonly copies: PlantCopies;
	/** A copy's costs in the budget, by its variant. */
	costOf(copy: number): { readonly toSwitch: number; readonly toTexel: number };
	/**
	 * Gives the copies their grants: each granted copy takes a slot of its range's pool, a copy the
	 * texel pool has no slot for draws to its switch, and one the switch pool has none for keeps its
	 * cards.
	 *
	 * @param grants One grant per copy, as the pool hands them out.
	 * @param order The copies nearest first.
	 * @returns The grants the copies hold now.
	 */
	apply(grants: Uint8Array, order: readonly number[]): Uint8Array;
	/** Removes the pools' batches. */
	destroy(): void;
}

/** A copy's first card level row: its batch and its row in it. */
export interface CardRow {
	readonly batch: InstanceBatch;
	readonly row: number;
}

/** One pool of slots and its row batches, one per prototype. */
interface Pool {
	readonly slots: SlotPool;
	/** The first slot of the species' near table this pool's slots stand at. */
	readonly first: number;
	readonly batches: (InstanceBatch | undefined)[];
}

/**
 * Builds a placement's pools of real pieces, all slots free, and the member the near pool hands its
 * grants to.
 *
 * @param ctx The sketch's context.
 * @param kit The species' kit.
 * @param assets The grown variants.
 * @param copies Where the copies stand.
 * @param cards Each copy's first card level row, for the copies of a variant whose shoots draw.
 * @param ranges The switch and texel distances at the page's view, in metres.
 * @param view The page's render height, lens and switch bias, for the costs.
 * @param budget The pool's triangles, which size the pools.
 * @param material The shoots' material.
 * @returns The member.
 */
export function pooledShoots(
	ctx: SketchContext,
	kit: SpeciesKit,
	assets: readonly PlantAsset[],
	copies: PlantCopies,
	cards: ReadonlyMap<number, CardRow>,
	ranges: { readonly switch: number; readonly texel: number },
	view: { readonly height: number; readonly fov: number; readonly switchBias?: number },
	budget: number,
	material: Material,
): PoolMember {
	const drawing = assets.map((asset) => asset.shoots.count > 0 && asset.shootDetail !== 'none');
	const costs = assets.map((asset, v) =>
		drawing[v] ? pieceCosts(kit, asset, view) : { toSwitch: 0, toTexel: 0 },
	);
	const table = nearTable(kit);
	const sizes = poolSizes(
		costs.filter((_, v) => drawing[v]),
		budget,
	);
	// The pools take what the species' table has left, the switch pool first.
	const room = Math.max(0, POOL_SLOTS - table.next);
	const switchSize = Math.min(sizes.switch, room);
	const texelSize = Math.min(sizes.texel, room - switchSize);
	// The rows of each prototype in the largest variant, which each slot reserves.
	const most = new Array<number>(kit.prototypes.length).fill(0);
	assets.forEach((asset, v) => {
		if (!drawing[v]) return;
		const counts = new Array<number>(kit.prototypes.length).fill(0);
		for (let r = 0; r < asset.shoots.count; r++) {
			const p = asset.shoots.prototype[r] as number;
			counts[p] = (counts[p] as number) + 1;
		}
		counts.forEach((n, p) => {
			most[p] = Math.max(most[p] as number, n);
		});
	});
	// Every variant draws its rows at one tier: the kit's, or the one a triangle maximum gave them.
	const tier = DETAILS.indexOf(
		(assets.find((a) => a.shootDetail)?.shootDetail as Detail) ?? kit.detail,
	);
	const pool = (size: number, first: number, reach: number): Pool => ({
		slots: new SlotPool(size),
		first,
		batches: kit.prototypes.map((prototype, p) => {
			const count = (most[p] as number) * size;
			const arrays = prototype.tiers[tier];
			if (count === 0 || !arrays || arrays.indices.length === 0) return undefined;
			const batch = ctx.scene.createInstances(prototypeGeometry(ctx, arrays), count, {
				material,
				castShadows: true,
				receiveShadows: true,
				values: true,
			});
			batch.positions.fill(0);
			for (let row = 0; row < count; row++) batch.positions[row * 3 + 1] = PARKED;
			batch.scales.fill(0);
			batch.markDirty();
			batch.setDrawRange(0, reach * SHOOT_REACH);
			return batch;
		}),
	});
	const pools = {
		switch: pool(switchSize, table.next, ranges.switch),
		texel: pool(texelSize, table.next + switchSize, ranges.texel),
	};
	table.next += switchSize + texelSize;
	const held = new Uint8Array(copies.count);

	/** Writes a slot's rows for a copy, or parks them for none, and the copy's place in the table. */
	const writeSlot = (target: Pool, slot: number, copy: number) => {
		const global = target.first + slot;
		const asset = copy >= 0 ? assets[copies.variant[copy] as number] : undefined;
		target.batches.forEach((batch, p) => {
			if (!batch) return;
			const start = slot * (most[p] as number);
			const end = start + (most[p] as number);
			let row = asset ? writeCopyRows(batch, start, asset, copies, copy, p, global) : start;
			for (; row < end; row++) {
				batch.positions.set([0, PARKED, 0], row * 3);
				batch.scales.fill(0, row * 3, row * 3 + 3);
			}
			batch.markDirty(start, end - start);
		});
		if (copy >= 0)
			writeSlotPlace(
				table,
				global,
				[
					copies.position[copy * 3] as number,
					copies.position[copy * 3 + 1] as number,
					copies.position[copy * 3 + 2] as number,
				],
				copies.turn[copy] as number,
				copies.scale[copy] as number,
			);
	};

	return {
		copies,
		costOf: (copy) => costs[copies.variant[copy] as number] ?? { toSwitch: 0, toTexel: 0 },
		apply(grants, order) {
			const wantTexel = order.filter((copy) => grants[copy] === GRANT_TEXEL);
			const texelMoves = pools.texel.slots.assign(wantTexel);
			const demoted = new Set(pools.texel.slots.refused);
			const wantSwitch = order.filter((copy) => grants[copy] === GRANT_SWITCH || demoted.has(copy));
			const switchMoves = pools.switch.slots.assign(wantSwitch);
			for (const move of texelMoves) writeSlot(pools.texel, move.slot, move.copy);
			for (const move of switchMoves) writeSlot(pools.switch, move.slot, move.copy);
			if (texelMoves.length + switchMoves.length > 0) kit.textures.near.update(table.data);
			const now = new Uint8Array(copies.count);
			for (const copy of pools.texel.slots.holders) if (copy >= 0) now[copy] = GRANT_TEXEL;
			for (const copy of pools.switch.slots.holders) if (copy >= 0) now[copy] = GRANT_SWITCH;
			// Each copy's first card level gives way to its own pieces inside its own edge.
			const dirty = new Set<InstanceBatch>();
			for (let copy = 0; copy < copies.count; copy++) {
				if (now[copy] === held[copy]) continue;
				const card = cards.get(copy);
				if (card) {
					const edge =
						now[copy] === GRANT_TEXEL
							? ranges.texel
							: now[copy] === GRANT_SWITCH
								? ranges.switch
								: 0;
					(card.batch.values as Float32Array)[card.row * 4] = edge;
					dirty.add(card.batch);
				}
			}
			for (const batch of dirty) batch.markDirty();
			held.set(now);
			return now;
		},
		destroy() {
			for (const target of [pools.switch, pools.texel])
				for (const batch of target.batches) batch?.destroy();
		},
	};
}
