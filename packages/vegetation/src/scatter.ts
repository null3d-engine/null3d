// The scatter: where each species stands, from the ground maps, the rules and one integer hash.
// Every choice comes from the hash of the seed, the rule and the cell, so a seed places the same
// plants on every device and both GPU paths. A shared occupancy grid stops two plants overlapping,
// and the tiles are placed in a fixed order inside the build, so any order that a page adds them
// in gives the same points.

import { type EcoInput, type EcoLayer, type EcoRule, LAYER_ORDER, ruleScore } from './ecology';
import type { GroundMaps } from './ground';
import { hashAt, pcg, unitAt } from './hash';
import { type VarianceMaps, varianceMaps } from './variance';

/**
 * The floats that one placed point holds.
 *
 * @category api/vegetation
 */
export const SCATTER_STRIDE = 9;

/**
 * The floats that one placed point holds, in order: its x, its y, its z, its rule's index, its
 * variant, its scale, its rotation as a share of a whole turn, its color shift and its lichen.
 *
 * @category api/vegetation
 */
export const SCATTER_LAYOUT = [
	'x',
	'y',
	'z',
	'rule',
	'variant',
	'scale',
	'rotation',
	'tint',
	'lichen',
] as const;

/** The default width and depth of a tile, in meters. */
const DEFAULT_TILE = 32;

/** The default meters between two values of the clump field. */
const DEFAULT_CLUMP_SCALE = 24;

/** The meters over which a change of crown cover saturates the edge input. */
const EDGE_SCALE = 4;

/** The tries that a clustered plant makes to land inside its adult's disc. */
const CLUSTER_TRIES = 8;

/** The hash keys that keep the scatter's choices apart. */
const KEY_POSITION_X = 1;
const KEY_POSITION_Z = 2;
const KEY_ACCEPT = 3;
const KEY_ROTATION = 4;
const KEY_SCALE = 5;
const KEY_CLUSTER_COUNT = 6;
const KEY_CLUSTER_POINT = 7;
const KEY_CLUMP = 0x636c;

/**
 * The options for a scatter.
 *
 * @category api/vegetation
 */
export interface ScatterOptions {
	/** The scene's seed. The same seed and rules place the same plants on every device. */
	readonly seed: number;
	/** The ground that the plants stand on. */
	readonly ground: GroundMaps;
	/** The rules, in the order that the layers meet them. */
	readonly rules: readonly EcoRule[];
	/** The width and depth of a tile, in meters. The default is 32. */
	readonly tileSize?: number;
	/** The meters between two values of the clump field. The default is 24. */
	readonly clumpScale?: number;
	/** The patches that vary the type, the color and the lichen. */
	readonly variance?: VarianceMaps;
}

/**
 * The plants that a scatter placed: flat arrays of {@link SCATTER_STRIDE} floats for each point, so
 * a comparison of two runs is a comparison of two arrays.
 *
 * @category api/vegetation
 */
export interface ScatterPoints {
	/** The points, {@link SCATTER_STRIDE} floats each. */
	readonly data: Float32Array;
	/** The floats that one point holds. */
	readonly stride: number;
	/** The points that the scatter placed. */
	readonly count: number;
	/** The rules, whose index each point carries. */
	readonly rules: readonly EcoRule[];
	/** The square's size, in meters. */
	readonly size: number;
}

/** The floats of the plants that a scatter holds, grown as more arrive. */
class PointStore {
	data = new Float32Array(SCATTER_STRIDE * 1024);
	count = 0;

	push(
		x: number,
		y: number,
		z: number,
		rule: number,
		variant: number,
		scale: number,
		rotation: number,
		tint: number,
		lichen: number,
	): void {
		if ((this.count + 1) * SCATTER_STRIDE > this.data.length) {
			const grown = new Float32Array(this.data.length * 2);
			grown.set(this.data);
			this.data = grown;
		}
		const at = this.count * SCATTER_STRIDE;
		const data = this.data;
		data[at] = x;
		data[at + 1] = y;
		data[at + 2] = z;
		data[at + 3] = rule;
		data[at + 4] = variant;
		data[at + 5] = scale;
		data[at + 6] = rotation;
		data[at + 7] = tint;
		data[at + 8] = lichen;
		this.count++;
	}

	/** The point's field, by its place in {@link SCATTER_LAYOUT}. */
	at(index: number, field: number): number {
		return this.data[index * SCATTER_STRIDE + field] as number;
	}

	clear(): void {
		this.count = 0;
	}

	/** The used part of the array, copied so a later build never writes over it. */
	points(rules: readonly EcoRule[], size: number): ScatterPoints {
		return {
			data: this.data.slice(0, this.count * SCATTER_STRIDE),
			stride: SCATTER_STRIDE,
			count: this.count,
			rules,
			size,
		};
	}
}

/** The grid that stops two plants standing in the same place. */
class Occupancy {
	private readonly size: number;
	private readonly cell: number;
	private readonly columns: number;
	private readonly rows: number;
	private readonly buckets: (number[] | undefined)[];
	private readonly xs: number[] = [];
	private readonly zs: number[] = [];
	private readonly rs: number[] = [];
	private readonly layers: number[] = [];
	private widest = 0;

	constructor(size: number, widestRadius: number) {
		this.size = size;
		this.cell = Math.max(1, widestRadius);
		this.columns = Math.ceil(size / this.cell) + 1;
		this.rows = this.columns;
		this.buckets = new Array(this.columns * this.rows);
	}

	/** The bucket that a point falls in, clamped to the grid. */
	private key(x: number, z: number): number {
		const { size, cell, columns, rows } = this;
		const half = size / 2;
		const cx = Math.min(Math.max(Math.floor((x + half) / cell), 0), columns - 1);
		const cz = Math.min(Math.max(Math.floor((z + half) / cell), 0), rows - 1);
		return cz * columns + cx;
	}

	/**
	 * Takes a place for a plant of a radius, if no plant holds it. The first plant to claim a
	 * place keeps it, and the build places plants in a fixed order, so every run keeps the same.
	 * Plants of a layer outside `avoid` stand inside this one, as saplings stand under a crown.
	 */
	tryOccupy(x: number, z: number, radius: number, layer: number, avoid: number): boolean {
		const { size, cell, columns, rows, xs, zs, rs, layers } = this;
		const reach = radius + this.widest;
		const half = size / 2;
		const lowX = Math.min(Math.max(Math.floor((x - reach + half) / cell), 0), columns - 1);
		const highX = Math.min(Math.max(Math.floor((x + reach + half) / cell), 0), columns - 1);
		const lowZ = Math.min(Math.max(Math.floor((z - reach + half) / cell), 0), rows - 1);
		const highZ = Math.min(Math.max(Math.floor((z + reach + half) / cell), 0), rows - 1);
		for (let cz = lowZ; cz <= highZ; cz++)
			for (let cx = lowX; cx <= highX; cx++) {
				const bucket = this.buckets[cz * columns + cx];
				if (!bucket) continue;
				for (const other of bucket) {
					if ((avoid & (1 << (layers[other] as number))) === 0) continue;
					const dx = x - (xs[other] as number);
					const dz = z - (zs[other] as number);
					const room = radius + (rs[other] as number);
					if (dx * dx + dz * dz < room * room) return false;
				}
			}
		const index = xs.length;
		xs.push(x);
		zs.push(z);
		rs.push(radius);
		layers.push(layer);
		if (radius > this.widest) this.widest = radius;
		const key = this.key(x, z);
		const bucket = this.buckets[key];
		if (bucket) bucket.push(index);
		else this.buckets[key] = [index];
		return true;
	}
}

/** The smooth step that blends the clump field's lattice. */
const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** A set of layers, as one bit for each. */
function layerMask(layers: readonly EcoLayer[]): number {
	let mask = 0;
	for (const layer of layers) mask |= 1 << LAYER_ORDER.indexOf(layer);
	return mask;
}

/** The clump field: a smooth share from 0 to 1, from the integer hash, at a scale of tens of meters. */
function clumpNoise(seed: number, scale: number, x: number, z: number): number {
	const fx = x / scale;
	const fz = z / scale;
	const cx = Math.floor(fx);
	const cz = Math.floor(fz);
	const tx = smooth(fx - cx);
	const tz = smooth(fz - cz);
	const at = (dx: number, dz: number) => hashAt(seed, KEY_CLUMP, cx + dx, cz + dz) / 4294967296;
	const top = at(0, 0) + (at(1, 0) - at(0, 0)) * tx;
	const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * tx;
	return top + (bottom - top) * tz;
}

/**
 * The scatter that places plants by the rules. Add the tiles, then read `points` or call `build`:
 * the plants are placed in a fixed layer and cell order over the tiles added, so any order that the
 * tiles arrive in gives the same points.
 *
 * @category api/vegetation
 */
export class EcoScatter {
	/** The scene's seed. */
	readonly seed: number;
	/** The ground that the plants stand on. */
	readonly ground: GroundMaps;
	/** The rules, in the order that the layers meet them. */
	readonly rules: readonly EcoRule[];
	/** The width and depth of a tile, in meters. */
	readonly tileSize: number;
	/** The patches that vary the type, the color and the lichen. */
	readonly variance: VarianceMaps;

	private readonly clumpScale: number;
	private readonly tiles = new Set<number>();
	private readonly columns: number;
	private readonly store = new PointStore();
	/** The layer of each rule, as its place in the layer order. */
	private readonly layerOf: readonly number[];
	/** The layers that each rule's plants stay out of, as a set of bits. */
	private readonly avoidOf: readonly number[];
	private claimed?: ScatterPoints;
	/** The crown cover that the layers below the trees read, from 0 to 1. */
	private cover?: Float32Array;
	/** How sharply the crown cover changes, from 0 to 1. */
	private edge?: Float32Array;

	constructor(options: ScatterOptions) {
		const { ground, rules } = options;
		this.seed = options.seed >>> 0;
		this.ground = ground;
		this.rules = rules;
		this.tileSize = Math.max(1, options.tileSize ?? DEFAULT_TILE);
		this.clumpScale = Math.max(1, options.clumpScale ?? DEFAULT_CLUMP_SCALE);
		this.columns = Math.max(1, Math.ceil(ground.size / this.tileSize));
		this.variance = options.variance ?? varianceMaps({ seed: this.seed, size: ground.size });
		this.layerOf = rules.map((rule) => LAYER_ORDER.indexOf(rule.layer));
		this.avoidOf = rules.map((rule) => layerMask(rule.overlaps ?? LAYER_ORDER));
	}

	/** The tile count along each side. */
	get tilesPerSide(): number {
		return this.columns;
	}

	/**
	 * Adds a tile, which the next build places. A tile added twice counts once, and the order that
	 * the tiles arrive in changes nothing.
	 *
	 * @param tileX The tile's column.
	 * @param tileZ The tile's row.
	 * @returns True when the tile is new.
	 * @category api/vegetation
	 */
	addTile(tileX: number, tileZ: number): boolean {
		if (!Number.isInteger(tileX) || !Number.isInteger(tileZ)) return false;
		if (tileX < 0 || tileX >= this.columns || tileZ < 0 || tileZ >= this.columns) return false;
		const key = tileZ * this.columns + tileX;
		if (this.tiles.has(key)) return false;
		this.tiles.add(key);
		this.claimed = undefined;
		return true;
	}

	/** Adds every tile, which places the whole square. */
	addAllTiles(): void {
		for (let row = 0; row < this.columns; row++)
			for (let column = 0; column < this.columns; column++) this.addTile(column, row);
	}

	/**
	 * Places the plants of every tile added, and gives the points. A second call after more tiles
	 * arrive places the whole set again, so the points never depend on the order of the calls.
	 */
	build(): ScatterPoints {
		this.store.clear();
		this.cover = undefined;
		this.edge = undefined;
		const widest = this.rules.reduce((most, rule) => Math.max(most, rule.radius), 0);
		const occupancy = new Occupancy(this.ground.size, widest);
		for (const layer of LAYER_ORDER) {
			if (layer === 'understory') this.readCover();
			for (const [index, rule] of this.rules.entries())
				if (rule.layer === layer) this.place(index, rule, occupancy);
		}
		this.claimed = this.store.points(this.rules, this.ground.size);
		return this.claimed;
	}

	/** The points that the last build placed. */
	get points(): ScatterPoints {
		return this.claimed ?? this.build();
	}

	/** Places one rule's plants, over the cells of the tiles or around the adults it gathers under. */
	private place(index: number, rule: EcoRule, occupancy: Occupancy): void {
		if (rule.cluster) this.placeCluster(index, rule, occupancy);
		else this.placeCells(index, rule, occupancy);
	}

	/**
	 * Places one rule's plants over the cells of the tiles added. The cells run in one row-by-row
	 * order over the whole square and each belongs to one tile, so neither the order nor the size
	 * of the tiles changes where a plant stands or which plant wins a shared place.
	 */
	private placeCells(index: number, rule: EcoRule, occupancy: Occupancy): void {
		if (this.tiles.size === 0) return;
		const half = this.ground.size / 2;
		const spacing = rule.spacing;
		const cells = Math.ceil(this.ground.size / spacing);
		const tileSize = this.tileSize;
		const columns = this.columns;
		let minX = columns;
		let maxX = -1;
		let minZ = columns;
		let maxZ = -1;
		for (const key of this.tiles) {
			const tileX = key % columns;
			const tileZ = (key - tileX) / columns;
			if (tileX < minX) minX = tileX;
			if (tileX > maxX) maxX = tileX;
			if (tileZ < minZ) minZ = tileZ;
			if (tileZ > maxZ) maxZ = tileZ;
		}
		const firstColumn = Math.min(Math.max(Math.ceil((minX * tileSize) / spacing), 0), cells);
		const lastColumn = Math.min(Math.max(Math.ceil(((maxX + 1) * tileSize) / spacing), 0), cells);
		const firstRow = Math.min(Math.max(Math.ceil((minZ * tileSize) / spacing), 0), cells);
		const lastRow = Math.min(Math.max(Math.ceil(((maxZ + 1) * tileSize) / spacing), 0), cells);
		for (let row = firstRow; row < lastRow; row++) {
			const tileZ = Math.min(columns - 1, Math.floor((row * spacing) / tileSize));
			for (let column = firstColumn; column < lastColumn; column++) {
				const tileX = Math.min(columns - 1, Math.floor((column * spacing) / tileSize));
				if (!this.tiles.has(tileZ * columns + tileX)) continue;
				const x =
					-half + (column + unitAt(this.seed, index, column, row, KEY_POSITION_X)) * spacing;
				const z = -half + (row + unitAt(this.seed, index, column, row, KEY_POSITION_Z)) * spacing;
				this.consider(index, rule, occupancy, column, row, x, z);
			}
		}
	}

	/** Takes a candidate place if the rule scores it, no plant holds it and the clump allows it. */
	private consider(
		index: number,
		rule: EcoRule,
		occupancy: Occupancy,
		keyA: number,
		keyB: number,
		x: number,
		z: number,
	): void {
		if (unitAt(this.seed, index, keyA, keyB, KEY_ACCEPT) >= this.scoreAt(rule, x, z)) return;
		const clump = rule.clump;
		if (clump) {
			const value = clumpNoise(this.seed, this.clumpScale, x, z);
			if (value < clump[0] || value > clump[1]) return;
		}
		if (
			!occupancy.tryOccupy(
				x,
				z,
				rule.radius,
				this.layerOf[index] as number,
				this.avoidOf[index] as number,
			)
		)
			return;
		this.emit(index, rule, keyA, keyB, x, z);
	}

	/** The score of a rule at a place, from the ground and the crown cover, less what a mask covers. */
	private scoreAt(rule: EcoRule, x: number, z: number): number {
		const ground = this.ground;
		const score = ruleScore(rule, (input) => this.inputAt(input, x, z));
		if (score <= 0) return 0;
		const free = 1 - ground.sampleAt(ground.blocked, x, z);
		return score * free;
	}

	/** Reads one input of a rule at a place. */
	private inputAt(input: EcoInput, x: number, z: number): number {
		const ground = this.ground;
		switch (input) {
			case 'heightAboveWater':
				return ground.sampleAt(ground.aboveWater, x, z);
			case 'distanceToWater':
				return ground.sampleAt(ground.distanceToWater, x, z);
			case 'slope':
				return ground.sampleAt(ground.slope, x, z);
			case 'northness':
				return ground.sampleAt(ground.northness, x, z);
			case 'eastness':
				return ground.sampleAt(ground.eastness, x, z);
			case 'wetness':
				return ground.sampleAt(ground.wetness, x, z);
			case 'curvature':
				return ground.sampleAt(ground.curvature, x, z);
			case 'canopy':
				return this.cover ? this.ground.sampleAt(this.cover, x, z) : 0;
			case 'openness':
				return this.cover ? 1 - this.ground.sampleAt(this.cover, x, z) : 1;
			case 'edge':
				return this.edge ? this.ground.sampleAt(this.edge, x, z) : 0;
		}
	}

	/** Places a rule's young plants around the adults that the layers above it placed. */
	private placeCluster(index: number, rule: EcoRule, occupancy: Occupancy): void {
		const cluster = rule.cluster;
		if (!cluster) return;
		const adults: number[] = [];
		for (let point = 0; point < this.store.count; point++) {
			const at = point * SCATTER_STRIDE;
			const adultRule = this.rules[this.store.data[at + 3] as number];
			if (adultRule?.layer !== 'canopy') continue;
			if (
				cluster.species &&
				cluster.species.length > 0 &&
				!cluster.species.includes(adultRule.species)
			)
				continue;
			adults.push(point);
		}
		for (const [order, point] of adults.entries()) {
			const at = point * SCATTER_STRIDE;
			const ax = this.store.data[at] as number;
			const az = this.store.data[at + 2] as number;
			const spread = cluster.max - cluster.min + 1;
			const count =
				cluster.min + Math.floor(unitAt(this.seed, index, order, 0, KEY_CLUSTER_COUNT) * spread);
			for (let k = 0; k < count; k++) {
				const [dx, dz] = this.clusterOffset(index, order, k);
				const x = ax + dx * cluster.radius;
				const z = az + dz * cluster.radius;
				this.consider(index, rule, occupancy, order, k, x, z);
			}
		}
	}

	/** A point's offset inside an adult's disc, from the integer hash, as a share of its radius. */
	private clusterOffset(index: number, adult: number, child: number): readonly [number, number] {
		const seed = this.seed;
		const key = adult * 64 + child;
		for (let attempt = 0; attempt < CLUSTER_TRIES; attempt++) {
			const u = unitAt(seed, index, key, KEY_CLUSTER_POINT + attempt * 2) * 2 - 1;
			const v = unitAt(seed, index, key, KEY_CLUSTER_POINT + attempt * 2 + 1) * 2 - 1;
			const length = u * u + v * v;
			if (length <= 1) return [u, v];
		}
		// A place that never landed inside the disc still gathers close to its adult.
		return [0, 0];
	}

	/** Writes one placed plant into the store, with the variance maps' type, color and lichen. */
	private emit(
		index: number,
		rule: EcoRule,
		keyA: number,
		keyB: number,
		x: number,
		z: number,
	): void {
		const y = this.ground.heightAt(x, z);
		const variants = Math.max(1, rule.variants ?? 6);
		const variant = Math.min(variants - 1, Math.floor(this.variance.typeAt(x, z) * variants));
		const smallest = rule.scale?.[0] ?? 1;
		const largest = rule.scale?.[1] ?? 1;
		const scale = smallest + unitAt(this.seed, index, keyA, keyB, KEY_SCALE) * (largest - smallest);
		const rotation = unitAt(this.seed, index, keyA, keyB, KEY_ROTATION);
		const tint = this.variance.colorAt(x, z);
		const lichen = this.variance.lichenAt(x, z);
		this.store.push(x, y, z, index, variant, scale, rotation, tint, lichen);
	}

	/** Reads the crown cover of the trees placed so far, and how sharply it changes. */
	private readCover(): void {
		const { resolution, cell, originX, originZ } = this.ground;
		const samples = resolution * resolution;
		const cover = new Float32Array(samples);
		for (let point = 0; point < this.store.count; point++) {
			const at = point * SCATTER_STRIDE;
			const rule = this.rules[this.store.data[at + 3] as number];
			if (rule?.layer !== 'canopy' && rule?.layer !== 'young') continue;
			const x = this.store.data[at] as number;
			const z = this.store.data[at + 2] as number;
			const radius = Math.max(rule.radius, cell);
			const cx = Math.floor((x - originX) / cell);
			const cz = Math.floor((z - originZ) / cell);
			const reach = Math.ceil(radius / cell);
			for (let dr = -reach; dr <= reach; dr++) {
				const row = cz + dr;
				if (row < 0 || row >= resolution) continue;
				for (let dc = -reach; dc <= reach; dc++) {
					const column = cx + dc;
					if (column < 0 || column >= resolution) continue;
					const dx = originX + column * cell - x;
					const dz = originZ + row * cell - z;
					const share = 1 - (dx * dx + dz * dz) / (radius * radius);
					if (share <= 0) continue;
					const index = row * resolution + column;
					const total = (cover[index] as number) + share * 0.5;
					cover[index] = total > 1 ? 1 : total;
				}
			}
		}
		const edge = new Float32Array(samples);
		const last = resolution - 1;
		for (let row = 0; row < resolution; row++)
			for (let column = 0; column < resolution; column++) {
				const index = row * resolution + column;
				const left = cover[row * resolution + (column > 0 ? column - 1 : column)] as number;
				const right = cover[row * resolution + (column < last ? column + 1 : column)] as number;
				const back = cover[(row > 0 ? row - 1 : row) * resolution + column] as number;
				const front = cover[(row < last ? row + 1 : row) * resolution + column] as number;
				const dx = (right - left) / (column > 0 && column < last ? 2 * cell : cell);
				const dz = (front - back) / (row > 0 && row < last ? 2 * cell : cell);
				const change = Math.sqrt(dx * dx + dz * dz) * EDGE_SCALE;
				edge[index] = change > 1 ? 1 : change;
			}
		this.cover = cover;
		this.edge = edge;
	}
}

/**
 * Scatters plants over a whole square of ground by the rules.
 *
 * @param options The seed, the ground and the rules.
 * @returns The placed points.
 * @category api/vegetation
 */
export function scatterVegetation(options: ScatterOptions): ScatterPoints {
	const scatter = new EcoScatter(options);
	scatter.addAllTiles();
	return scatter.build();
}

/** The smallest step that the checksum reads a point's floats at, as a share of a meter. */
const CHECKSUM_STEP = 8192;

/**
 * A hash of a scatter's points, so two runs compare in one number: a page checks its own placement
 * against the reference that another device recorded, whichever GPU path it draws on. It reads each
 * float at a tenth of a millimeter, which no two devices' arithmetic differs by.
 *
 * @param points The points.
 * @returns A 32-bit hash of the points and their count.
 * @category api/vegetation
 */
export function scatterChecksum(points: ScatterPoints): number {
	let hash = pcg(points.count);
	for (let i = 0; i < points.data.length; i++) {
		const value = Math.round((points.data[i] as number) * CHECKSUM_STEP) | 0;
		hash = pcg((hash ^ (value >>> 0)) >>> 0);
	}
	return hash >>> 0;
}
