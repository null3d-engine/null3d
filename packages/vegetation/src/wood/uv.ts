// Bark coordinates in metres, after design §7.2. `v` runs along the axis in metres of bark from the
// parent's `v` where the axis leaves it, so bark runs on into every limb. `u` runs round the ring:
// a whole number of the layer's tiles where a whole number keeps the plates within a quarter of
// their true width, so plates keep their size and aspect and no seam runs down the wood; elsewhere
// the true metres round, with the one seam on the underside. The tile count holds along an axis
// while it stays within that quarter, and changes at a ring that the mesher doubles. The girth scale
// shrinks the figure on young wood: a metre of real wood is 1 / scale metres of bark.
import type { Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { curveAt } from '../core/types';

/** Metres a bark tile covers round the stem when the manifest gives none. */
export const DEFAULT_BARK_TILE = 0.5;

/** Metres a young-bark tile covers round the stem when the manifest gives none. */
export const DEFAULT_YOUNG_TILE = 0.12;

/** The widest error in a ring's plate width that a run of one tile count allows. */
export const TILE_TOLERANCE = 0.25;

/**
 * The bark of a plant: which layer each ring draws with, that layer's tile width, and the figure's
 * scale by radius.
 */
export interface BarkScale {
	/**
	 * The tile width round the stem, in metres of bark, of the layer a ring draws with: the young
	 * layer below the young radius, the zone's layer above it.
	 *
	 * @param r The ring's pipe radius.
	 * @param y The ring's height in plant space.
	 * @returns The width.
	 */
	width(r: number, y: number): number;
	/**
	 * Metres of real wood per metre of bark: the record's girth scale at a radius.
	 *
	 * @param r The pipe radius.
	 * @returns The scale, above zero.
	 */
	scale(r: number): number;
	/** The narrowest tile of any layer, so a whole number of it fits under every ring's start. */
	readonly narrowest: number;
}

/**
 * The bark scale of a plant.
 *
 * @param record The species record.
 * @param manifest The species' texture manifest.
 * @param largest The plant's largest pipe radius, which the girth scale's curve runs to.
 * @returns The scale.
 */
export function barkScale(record: Species, manifest: TextureManifest, largest: number): BarkScale {
	const bark = record.bark;
	const layers = manifest.bark?.layers ?? [];
	const youngWidth = manifest.bark?.young.tile[0] ?? DEFAULT_YOUNG_TILE;
	const layerWidth = (layer: number) => layers[layer]?.tile[0] ?? DEFAULT_BARK_TILE;
	const zones = bark?.zones ?? [];
	let narrowest = youngWidth;
	for (const zone of zones) narrowest = Math.min(narrowest, layerWidth(zone.layer));
	if (zones.length === 0) narrowest = Math.min(narrowest, DEFAULT_BARK_TILE);
	const youngRadius = bark?.youngRadius ?? 0;
	const girth = bark?.girthScale ?? 1;
	const span = largest > 0 ? largest : 1;
	return {
		narrowest,
		width(r: number, y: number): number {
			if (r < youngRadius) return youngWidth;
			for (const zone of zones) {
				const at = zone.by === 'height' ? y : r;
				if (at >= zone.from && at < zone.to) return layerWidth(zone.layer);
			}
			const last = zones[zones.length - 1];
			return last ? layerWidth(last.layer) : DEFAULT_BARK_TILE;
		},
		scale(r: number): number {
			return Math.max(0.05, curveAt(girth, Math.min(1, r / span)));
		},
	};
}

/**
 * The tiles round a ring: the ring before's count while it keeps the plates within the tolerance,
 * else the nearest whole count when that does, else 0, and `u` runs in true metres. Wood thinner than
 * most of one tile, and wood between one and two tiles round, where neither count fits, takes true
 * metres.
 *
 * @param perimeter The ring's perimeter in metres of bark.
 * @param width The layer's tile width in metres of bark.
 * @param previous The ring before's count, 0 for true metres, or −1 at an axis's first ring.
 * @returns The count, or 0.
 */
export function tilesRound(perimeter: number, width: number, previous: number): number {
	const exact = perimeter / width;
	if (previous > 0 && Math.abs(previous / exact - 1) <= TILE_TOLERANCE) return previous;
	const nearest = Math.round(exact);
	if (nearest < 1 || Math.abs(nearest / exact - 1) > TILE_TOLERANCE) return 0;
	return nearest;
}

/**
 * Metres of bark that a ring's `u` spans once round: its whole tiles, or its true perimeter.
 *
 * @param tiles The ring's tile count, or 0.
 * @param width The layer's tile width.
 * @param perimeter The ring's perimeter in metres of bark.
 * @returns The span.
 */
export function uSpan(tiles: number, width: number, perimeter: number): number {
	return tiles > 0 ? tiles * width : perimeter;
}
