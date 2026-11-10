// The measures that the review page posts beside a frame when its query asks for them: the
// plant's silhouette from the view's side, rasterised on the CPU from one level's parts in an
// orthographic projection, its crown box in metres, the share of the silhouette that foliage
// covers, the trunk's diameter at 1.3 m, the crown base and the first fork's height. Every figure
// is in metres or a share, so it compares across renders of any size.
import type { Detail, PlantAsset, PlantPart, SpeciesBox, SpeciesKitData } from '@null3d/vegetation';
import { firstForkHeight, placeOnRow, stemAt, type V3 } from './anatomy';

/** Rows of the silhouette raster. */
const ROWS = 128;

/** A part's positions in plant-space metres. */
export function partPositions(part: PlantPart, box: SpeciesBox): Float32Array {
	const quantised = part.arrays.positions;
	const out = new Float32Array(quantised.length);
	for (let i = 0; i < quantised.length; i++) {
		const k = i % 3;
		const low = box.min[k] as number;
		out[i] = low + ((quantised[i] as number) / 65535) * ((box.max[k] as number) - low);
	}
	return out;
}

/** The tiers a shoot prototype holds its meshes in, in order. */
const TIERS: readonly Detail[] = ['low', 'medium', 'high', 'ultra'];

/**
 * The positions an instanced plant's shoot rows draw, in plant-space metres: every vertex of each
 * row's prototype at the kit's tier, turned, scaled and placed as the row places it. Such a plant
 * draws its nearest foliage as these rows, so its parts alone leave its leaves out.
 */
export function shootPositions(
	asset: PlantAsset,
	kit: Pick<SpeciesKitData, 'detail' | 'prototypes'>,
): Float32Array {
	const rows = asset.shoots;
	const tier = TIERS.indexOf(kit.detail);
	let count = 0;
	for (let r = 0; r < rows.count; r++)
		count += kit.prototypes[rows.prototype[r] as number]?.tiers[tier]?.positions.length ?? 0;
	const out = new Float32Array(count);
	let at = 0;
	for (let r = 0; r < rows.count; r++) {
		const positions = kit.prototypes[rows.prototype[r] as number]?.tiers[tier]?.positions;
		if (!positions) continue;
		for (let i = 0; i < positions.length; i += 3, at += 3)
			placeOnRow(
				rows,
				r,
				positions[i] as number,
				positions[i + 1] as number,
				positions[i + 2] as number,
				out,
				at,
			);
	}
	return out;
}

/** The silhouette's raster: one byte per cell, 1 for wood, 2 for foliage, 3 for both. */
export interface Silhouette {
	readonly columns: number;
	readonly rows: number;
	/** Metres a cell spans. */
	readonly cell: number;
	/** The raster's lower-left corner: metres across the view, and height. */
	readonly origin: readonly [number, number];
	readonly cells: Uint8Array;
}

/** Fills one triangle into the raster with a mark, by the cell centres it covers. */
function fillTriangle(
	out: Uint8Array,
	columns: number,
	rows: number,
	a: readonly [number, number],
	b: readonly [number, number],
	c: readonly [number, number],
	mark: number,
): void {
	const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
	const maxX = Math.min(columns - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
	const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
	const maxY = Math.min(rows - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
	const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
	if (Math.abs(area) < 1e-12) {
		// A sliver still marks the cells its corners fall in, so a thin twig is not lost.
		for (const p of [a, b, c]) {
			const x = Math.floor(p[0]);
			const y = Math.floor(p[1]);
			if (x >= 0 && y >= 0 && x < columns && y < rows)
				out[y * columns + x] = (out[y * columns + x] as number) | mark;
		}
		return;
	}
	for (let y = minY; y <= maxY; y++)
		for (let x = minX; x <= maxX; x++) {
			const px = x + 0.5;
			const py = y + 0.5;
			const w0 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
			const w1 = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]);
			const w2 = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
			if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0))
				out[y * columns + x] = (out[y * columns + x] as number) | mark;
		}
}

/**
 * The silhouette of a level's parts seen from a turn in radians, orthographic, `ROWS` cells tall
 * over the parts' height.
 */
export function silhouette(
	parts: readonly PlantPart[],
	box: SpeciesBox,
	turn: number,
): Silhouette | undefined {
	const right: V3 = [Math.cos(turn), 0, -Math.sin(turn)];
	const projected = parts.map((part) => {
		const p = partPositions(part, box);
		const flat = new Float32Array((p.length / 3) * 2);
		for (let v = 0; v < p.length / 3; v++) {
			flat[v * 2] = (p[v * 3] as number) * right[0] + (p[v * 3 + 2] as number) * right[2];
			flat[v * 2 + 1] = p[v * 3 + 1] as number;
		}
		return { part, flat };
	});
	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const { flat } of projected)
		for (let i = 0; i < flat.length; i += 2) {
			minX = Math.min(minX, flat[i] as number);
			maxX = Math.max(maxX, flat[i] as number);
			minY = Math.min(minY, flat[i + 1] as number);
			maxY = Math.max(maxY, flat[i + 1] as number);
		}
	if (!Number.isFinite(minX) || maxY <= minY) return undefined;
	const cell = (maxY - minY) / ROWS;
	const columns = Math.max(1, Math.ceil((maxX - minX) / cell));
	const cells = new Uint8Array(columns * ROWS);
	for (const { part, flat } of projected) {
		const mark = part.name === 'wood' ? 1 : 2;
		const toCell = (v: number): [number, number] => [
			((flat[v * 2] as number) - minX) / cell,
			((flat[v * 2 + 1] as number) - minY) / cell,
		];
		const indices = part.arrays.indices;
		for (let t = 0; t + 2 < indices.length; t += 3)
			fillTriangle(
				cells,
				columns,
				ROWS,
				toCell(indices[t] as number),
				toCell(indices[t + 1] as number),
				toCell(indices[t + 2] as number),
				mark,
			);
	}
	return { columns, rows: ROWS, cell, origin: [minX, minY], cells };
}

/** The measures the page posts with `measure=1`. */
export interface PlantMeasures {
	/** The level the silhouette was drawn from. */
	readonly level: number;
	/** The foliage's widest run across the view and its height from the crown base, in metres. */
	readonly crownBox: { readonly width: number; readonly height: number } | null;
	/** The share of the silhouette's cells that foliage covers. */
	readonly foliageShare: number;
	/**
	 * The plant's filled cells, in metres: the drawn width, the drawn height and the top above the
	 * ground. Unlike the asset's part bounds, this holds only what the level draws, so a vertex or a
	 * part outside the drawn silhouette cannot inflate it.
	 */
	readonly plantBox: {
		readonly width: number;
		readonly height: number;
		readonly top: number;
	} | null;
	/** The silhouette, its rows bottom first, as base64 of one byte a cell (1 wood, 2 foliage). */
	readonly silhouette: {
		readonly columns: number;
		readonly rows: number;
		readonly cell: number;
		readonly origin: readonly [number, number];
		readonly cells: string;
	} | null;
	/** The main stem's diameter at 1.3 m, or null for a plant whose stem is shorter. */
	readonly trunkDiameter: number | null;
	/** The height of the lowest foliage. */
	readonly crownBase: number;
	/** The height at which the main stem first divides. */
	readonly firstFork: number | null;
	/** The plant's height. */
	readonly height: number;
}

/** Base64 of bytes, in a page or a worker. */
function base64(bytes: Uint8Array): string {
	let text = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(text);
}

/**
 * The measures of a grown plant seen from a turn in radians: from its first card level when it has
 * one (the level the all-round rule reads), or from its nearest level for a cut piece.
 */
export function measurePlant(asset: PlantAsset, box: SpeciesBox, turn: number): PlantMeasures {
	const level = asset.levels[1].parts.length > 0 ? 1 : 0;
	const parts = asset.levels[level].parts;
	const shape = silhouette(parts, box, turn);
	let crownBox: PlantMeasures['crownBox'] = null;
	let plantBox: PlantMeasures['plantBox'] = null;
	let foliage = 0;
	let filled = 0;
	if (shape) {
		let widest = 0;
		let low = -1;
		let high = -1;
		let leftmost = shape.columns;
		let rightmost = -1;
		let bottom = shape.rows;
		let top = -1;
		for (let y = 0; y < shape.rows; y++) {
			let left = -1;
			let right = -1;
			for (let x = 0; x < shape.columns; x++) {
				const c = shape.cells[y * shape.columns + x] as number;
				if (c !== 0) {
					filled++;
					if (x < leftmost) leftmost = x;
					if (x > rightmost) rightmost = x;
					if (y < bottom) bottom = y;
					if (y > top) top = y;
				}
				if ((c & 2) === 0) continue;
				foliage++;
				if (left < 0) left = x;
				right = x;
			}
			if (left < 0) continue;
			widest = Math.max(widest, right - left + 1);
			if (low < 0) low = y;
			high = y;
		}
		if (low >= 0) crownBox = { width: widest * shape.cell, height: (high - low + 1) * shape.cell };
		if (rightmost >= 0)
			plantBox = {
				width: (rightmost - leftmost + 1) * shape.cell,
				height: (top - bottom + 1) * shape.cell,
				top: (shape.origin[1] as number) + (top + 1) * shape.cell,
			};
	}
	const stem = stemAt(asset.skeleton, 1.3);
	return {
		level,
		crownBox,
		plantBox,
		foliageShare: filled > 0 ? foliage / filled : 0,
		silhouette: shape
			? {
					columns: shape.columns,
					rows: shape.rows,
					cell: shape.cell,
					origin: shape.origin,
					cells: base64(shape.cells),
				}
			: null,
		trunkDiameter: stem ? stem.radius * 2 : null,
		crownBase: asset.crown.base,
		firstFork: firstForkHeight(asset.skeleton) ?? null,
		height: asset.skeleton.height,
	};
}
