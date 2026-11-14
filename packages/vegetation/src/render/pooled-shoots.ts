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
import { FADE_SECONDS, POOL_SLOTS, poolSizes, SlotPool } from './near-slots';
import { nearTable, writeCopyRows, writeSlotPlace, writeSlotShare } from './near-table';
import type { PlantCopies } from './place';
import { GRANT_SWITCH, GRANT_TEXEL, pieceCosts } from './plant-budget';
import type { SpeciesKit } from './textures';

/** The phases of the dither a copy's crossfade is drawn with, one per copy in turn. */
export const DITHER_PHASES = 16;

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
	 * @param now The time in seconds.
	 * @returns The grants the copies hold now.
	 */
	apply(grants: Uint8Array, order: readonly number[], now: number): Uint8Array;
	/**
	 * Moves every fade on: each changed copy's card edge and each slot's rows, over a quarter second.
	 *
	 * @param now The time in seconds.
	 * @returns Whether a slot's rows finished fading out, so the pool may hand it on.
	 */
	advance(now: number): boolean;
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
	// Each copy's card fade: the edge it moves to and from, and when it began (NaN when settled).
	const edgeTo = new Float32Array(copies.count);
	const edgeFrom = new Float32Array(copies.count);
	const cardBegan = new Float64Array(copies.count).fill(Number.NaN);
	// Each slot's rows fade: the share drawn when the fade began, the share it moves to, and when.
	const fades = [pools.switch, pools.texel].map((target) => ({
		target,
		from: new Float32Array(target.slots.holders.length),
		to: new Float32Array(target.slots.holders.length),
		began: new Float64Array(target.slots.holders.length).fill(Number.NaN),
	}));

	/**
	 * The share of a slot's rows drawn at a time, from its fade: rows coming in reach their share in
	 * the fade's first half, while the copy's cards still draw whole, and rows going out thin only in
	 * its second half, once the cards are whole again, so no pixel drops out of both.
	 */
	const shareAt = (fade: (typeof fades)[number], slot: number, now: number) => {
		const began = fade.began[slot] as number;
		const to = fade.to[slot] as number;
		if (Number.isNaN(began)) return to;
		const from = fade.from[slot] as number;
		const progress = Math.min(1, (now - began) / FADE_SECONDS);
		const step = to > from ? Math.min(1, 2 * progress) : Math.max(0, 2 * progress - 1);
		return from + (to - from) * step;
	};

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

	/** Starts a slot's rows fading towards a share from the share they draw now. */
	const fadeSlot = (fade: (typeof fades)[number], slot: number, to: number, now: number) => {
		fade.from[slot] = shareAt(fade, slot, now);
		fade.to[slot] = to;
		fade.began[slot] = now;
		writeSlotShare(table, fade.target.first + slot, fade.from[slot] as number);
	};

	/** Writes a copy's card row: its edge, the edge it fades from, how far, and its dither's phase. */
	const writeCard = (copy: number, progress: number) => {
		const card = cards.get(copy);
		if (!card) return undefined;
		const values = card.batch.values as Float32Array;
		values[card.row * 4] = edgeTo[copy] as number;
		values[card.row * 4 + 1] = edgeFrom[copy] as number;
		values[card.row * 4 + 2] = progress;
		values[card.row * 4 + 3] = copy % DITHER_PHASES;
		return card.batch;
	};

	return {
		copies,
		costOf: (copy) => costs[copies.variant[copy] as number] ?? { toSwitch: 0, toTexel: 0 },
		apply(grants, order, now) {
			const wantTexel = order.filter((copy) => grants[copy] === GRANT_TEXEL);
			const texelMoves = pools.texel.slots.assign(wantTexel, now);
			const demoted = new Set(pools.texel.slots.refused);
			const wantSwitch = order.filter((copy) => grants[copy] === GRANT_SWITCH || demoted.has(copy));
			const switchMoves = pools.switch.slots.assign(wantSwitch, now);
			const [switchFade, texelFade] = fades as [(typeof fades)[number], (typeof fades)[number]];
			for (const [fade, moves] of [
				[texelFade, texelMoves],
				[switchFade, switchMoves],
			] as const)
				for (const move of moves) {
					// A taken slot's rows fade in from nothing; a slot given back fades in from what it draws;
					// a left slot's rows fade out where they stand; a freed slot parks them.
					if (move.kind === 'take') {
						writeSlot(fade.target, move.slot, move.copy);
						fade.to[move.slot] = 0;
						fade.began[move.slot] = Number.NaN;
						fadeSlot(fade, move.slot, 1, now);
					} else if (move.kind === 'return') fadeSlot(fade, move.slot, 1, now);
					else if (move.kind === 'leave') fadeSlot(fade, move.slot, 0, now);
					else writeSlot(fade.target, move.slot, -1);
				}
			if (texelMoves.length + switchMoves.length > 0) kit.textures.near.update(table.data);
			const grantsNow = new Uint8Array(copies.count);
			for (const copy of pools.texel.slots.holders) if (copy >= 0) grantsNow[copy] = GRANT_TEXEL;
			for (const copy of pools.switch.slots.holders) if (copy >= 0) grantsNow[copy] = GRANT_SWITCH;
			// A copy whose grant changes crosses its first card level's edge from the old to the new.
			const dirty = new Set<InstanceBatch>();
			for (let copy = 0; copy < copies.count; copy++) {
				if (grantsNow[copy] === held[copy]) continue;
				edgeFrom[copy] = edgeTo[copy] as number;
				edgeTo[copy] =
					grantsNow[copy] === GRANT_TEXEL
						? ranges.texel
						: grantsNow[copy] === GRANT_SWITCH
							? ranges.switch
							: 0;
				cardBegan[copy] = now;
				const batch = writeCard(copy, 0);
				if (batch) dirty.add(batch);
			}
			for (const batch of dirty) batch.markDirty();
			held.set(grantsNow);
			return grantsNow;
		},
		advance(now) {
			const dirty = new Set<InstanceBatch>();
			for (let copy = 0; copy < copies.count; copy++) {
				const began = cardBegan[copy] as number;
				if (Number.isNaN(began)) continue;
				const progress = Math.min(1, (now - began) / FADE_SECONDS);
				if (progress >= 1) {
					edgeFrom[copy] = edgeTo[copy] as number;
					cardBegan[copy] = Number.NaN;
				}
				const batch = writeCard(copy, progress);
				if (batch) dirty.add(batch);
			}
			for (const batch of dirty) batch.markDirty();
			let rows = false;
			let freed = false;
			for (const fade of fades)
				for (let slot = 0; slot < fade.began.length; slot++) {
					if (Number.isNaN(fade.began[slot] as number)) continue;
					const share = shareAt(fade, slot, now);
					writeSlotShare(table, fade.target.first + slot, share);
					rows = true;
					if (now - (fade.began[slot] as number) >= FADE_SECONDS) {
						fade.began[slot] = Number.NaN;
						if ((fade.to[slot] as number) === 0) freed = true;
					}
				}
			if (rows) kit.textures.near.update(table.data);
			return freed;
		},
		destroy() {
			for (const target of [pools.switch, pools.texel])
				for (const batch of target.batches) batch?.destroy();
		},
	};
}
