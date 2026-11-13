// Bark coordinates in metres, after design §7.2. `v` runs along the axis in metres of bark from the
// parent's `v` where the axis leaves it, so bark runs on into every limb. `u` runs round the ring:
// a whole number of the layer's tiles where a whole number keeps the plates within a quarter of
// their true width, so plates keep their size and aspect and no seam runs down the wood; elsewhere
// the true metres round, with the one seam on the underside. The tile count holds along an axis
// while it stays within that quarter, and changes at a ring that the mesher doubles. The girth scale
// shrinks the figure on young wood: a metre of real wood is 1 / scale metres of bark.
import type { BarkZone, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import { curveAt } from '../core/types';

/** Metres a bark tile covers round the stem when the manifest gives none. */
export const DEFAULT_BARK_TILE = 0.5;

/** Metres a young-bark tile covers round the stem when the manifest gives none. */
export const DEFAULT_YOUNG_TILE = 0.12;

/** Below this many tiles round a ring, `u` runs in true meters. */
export const FEWEST_TILES = 2.25;

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
	/**
	 * Meters of bark along which every layer repeats a whole number of times, near enough: a child
	 * may start its `v` a whole number of these lower than its parent's, so `v` stays within the
	 * 16 bits that hold it and the bark looks the same.
	 */
	readonly period: number;
}

/** The shortest repeat of `v` worth taking, and the longest searched. */
const PERIOD_RANGE = [8, 48] as const;

/**
 * The shortest length past the range's start that holds a whole number of every tile, or of the
 * first tile, the others within the least part of a tile.
 */
function repeatOf(tiles: readonly number[]): number {
	const main = tiles[0] as number;
	let best = Math.ceil(PERIOD_RANGE[0] / main) * main;
	let bestError = Number.POSITIVE_INFINITY;
	for (let k = Math.ceil(PERIOD_RANGE[0] / main); k * main <= PERIOD_RANGE[1]; k++) {
		const length = k * main;
		let error = 0;
		for (const tile of tiles) {
			const count = length / tile;
			error = Math.max(error, Math.abs(count - Math.round(count)));
		}
		if (error < bestError - 1e-9) {
			best = length;
			bestError = error;
		}
		if (error < 0.005) break;
	}
	return best;
}

/**
 * Whether a bark zone holds at a point of the wood: inside its range on its own axis, and inside
 * its band on the other axis where it names one.
 *
 * @param zone The zone.
 * @param radius The wood's pipe radius at the point, in metres.
 * @param height The point's height in the plant's space, in metres.
 * @returns Whether it holds.
 */
export function zoneHolds(zone: BarkZone, radius: number, height: number): boolean {
	const [own, other] = zone.by === 'height' ? [height, radius] : [radius, height];
	if (own < zone.from || own >= zone.to) return false;
	return !zone.second || (other >= zone.second.from && other < zone.second.to);
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
		period: repeatOf([
			...zones.map((zone) => layers[zone.layer]?.tile[1] ?? DEFAULT_BARK_TILE),
			manifest.bark?.young.tile[1] ?? DEFAULT_YOUNG_TILE,
		]),
		width(r: number, y: number): number {
			if (r < youngRadius) return youngWidth;
			// A zone that holds on both its axes wins over one that holds on its own axis alone, as
			// the shader weighs them.
			const both = zones.find((zone) => zone.second && zoneHolds(zone, r, y));
			const one = both ?? zones.find((zone) => !zone.second && zoneHolds(zone, r, y));
			const zone = one ?? zones[zones.length - 1];
			return zone ? layerWidth(zone.layer) : DEFAULT_BARK_TILE;
		},
		scale(r: number): number {
			return Math.max(0.05, curveAt(girth, Math.min(1, r / span)));
		},
	};
}

/**
 * The tiles round a ring: the ring before's count while it keeps the plates within the tolerance,
 * else the nearest whole count when that does, else 0, and `u` runs in true meters. Wood of fewer
 * than a few tiles round takes true meters, as does wood where no whole count fits.
 *
 * @param perimeter The ring's perimeter in metres of bark.
 * @param width The layer's tile width in metres of bark.
 * @param previous The ring before's count, 0 for true metres, or −1 at an axis's first ring.
 * @returns The count, or 0.
 */
export function tilesRound(perimeter: number, width: number, previous: number): number {
	const exact = perimeter / width;
	// Wood of a couple of tiles round takes true meters: its seam is small, and a count that flips
	// between one and two tiles along a twig would write ring after ring twice.
	if (exact < FEWEST_TILES || (previous === 0 && exact < FEWEST_TILES + 0.5)) return 0;
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
