// The leaf form's own covered share at each far view: each shoot's picture, at its own size,
// projected into the far atlas's cell as the bake projects a part, and the share of the cell that
// the pictures cover between them. The far bake corrects a view to this figure, so a far card keeps
// the cover its leaves draw at that angle rather than one share for every view.
import type { OctahedralAtlas } from '@null3d/impostors/bake';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { rowPictureEdges } from './cards';

/** Texels a side the leaf form's cover is measured over. */
const GRID = 48;

/** The place in a grid that a projected point falls in, clamped to the grid's edges. */
function cellOf(value: number, side: number): number {
	return Math.min(side - 1, Math.max(0, Math.floor(value * side)));
}

/**
 * Marks the cells a polygon covers, by the even-odd rule: a cell's middle inside the polygon is
 * covered. The polygon's points are in the cell's own coordinates, from 0 to 1.
 *
 * @param grid The covered cells, a side square.
 * @param side The grid's texels a side.
 * @param xs The polygon's columns.
 * @param ys The polygon's rows.
 * @param from The polygon's first point.
 * @param to The polygon's last point, not included.
 */
function fillPolygon(
	grid: Uint8Array,
	side: number,
	xs: Float64Array,
	ys: Float64Array,
	from: number,
	to: number,
): void {
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	for (let i = from; i < to; i++) {
		low = Math.min(low, ys[i] as number);
		high = Math.max(high, ys[i] as number);
	}
	const crossings: number[] = [];
	for (let row = cellOf(low, side); row <= cellOf(high, side); row++) {
		const y = (row + 0.5) / side;
		crossings.length = 0;
		for (let i = from; i < to; i++) {
			const j = i + 1 < to ? i + 1 : from;
			const yi = ys[i] as number;
			const yj = ys[j] as number;
			if (yi <= y === yj <= y) continue;
			const t = (y - yi) / (yj - yi);
			crossings.push((xs[i] as number) + t * ((xs[j] as number) - (xs[i] as number)));
		}
		crossings.sort((a, b) => a - b);
		for (let k = 0; k + 1 < crossings.length; k += 2) {
			const left = crossings[k] as number;
			const right = crossings[k + 1] as number;
			if (right <= 0 || left >= 1) continue;
			for (let column = cellOf(left, side); column <= cellOf(right, side); column++) {
				const x = (column + 0.5) / side;
				if (x >= left && x <= right) grid[row * side + column] = 1;
			}
		}
	}
}

/**
 * The leaf form's covered share at each far view, in the atlas's frame order: the shoots' pictures,
 * each at its own size, projected into the cell as the far bake projects a part, and the share of
 * the cell they cover. A record stores the result, and the far bake corrects each view to it.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @param grid The texels a side the cover is measured over.
 * @returns A covered share a view, from 0 to 1.
 * @category api/vegetation
 */
export async function leafCoverPerView(
	kit: SpeciesKitData,
	asset: PlantAsset,
	grid = GRID,
): Promise<readonly number[]> {
	const { frameDirection, viewFrame } = await import('@null3d/impostors/bake');
	const rows = asset.shoots;
	const views = asset.impostor.views;
	const atlas: OctahedralAtlas = { columns: views, rows: views };
	const ends: number[] = [];
	// Each picture's points, kept once: the same pictures are projected from every view.
	let points = new Float64Array(3 * 1024);
	let count = 0;
	const starts: number[] = [];
	for (let r = 0; r < rows.count; r++) {
		const picture = rowPictureEdges(kit, rows, r, ends);
		const need = (count + picture.count) * 3;
		if (need > points.length) {
			const more = new Float64Array(Math.max(need, points.length * 2));
			more.set(points.subarray(0, count * 3));
			points = more;
		}
		points.set(picture.points.subarray(0, picture.count * 3), count * 3);
		for (const end of ends) starts.push(count + end);
		count += picture.count;
	}
	if (count === 0) return new Array<number>(views * views).fill(0);
	// The pictures' bounds, which set the cell's middle, its reach across and its height, as the
	// far bake reads the parts it draws.
	const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
	const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
	for (let i = 0; i < count * 3; i += 3)
		for (let k = 0; k < 3; k++) {
			const value = points[i + k] as number;
			min[k] = Math.min(min[k] as number, value);
			max[k] = Math.max(max[k] as number, value);
		}
	if (!((max[1] as number) > (min[1] as number))) return new Array<number>(views * views).fill(0);
	const centre = [
		((min[0] as number) + (max[0] as number)) / 2,
		((min[1] as number) + (max[1] as number)) / 2,
		((min[2] as number) + (max[2] as number)) / 2,
	];
	let reach = 1e-6;
	for (const x of [min[0] as number, max[0] as number])
		for (const z of [min[2] as number, max[2] as number])
			reach = Math.max(reach, Math.hypot(x - (centre[0] as number), z - (centre[2] as number)));
	const pictureHeight = Math.hypot(2 * reach, (max[1] as number) - (min[1] as number));
	const direction: [number, number, number] = [0, 0, 0];
	const right: [number, number, number] = [0, 0, 0];
	const up: [number, number, number] = [0, 0, 0];
	const xs = new Float64Array(count);
	const ys = new Float64Array(count);
	const covers: number[] = [];
	for (let frame = 0; frame < views * views; frame++) {
		frameDirection(frame, atlas, direction);
		viewFrame(direction, right, up);
		for (let p = 0; p < count; p++) {
			const at = p * 3;
			const px = (points[at] as number) - (centre[0] as number);
			const py = (points[at + 1] as number) - (centre[1] as number);
			const pz = (points[at + 2] as number) - (centre[2] as number);
			xs[p] =
				((px * (right[0] as number) + py * (right[1] as number) + pz * (right[2] as number)) /
					reach) *
					0.5 +
				0.5;
			ys[p] =
				(px * (up[0] as number) + py * (up[1] as number) + pz * (up[2] as number)) / pictureHeight +
				0.5;
		}
		const gridCells = new Uint8Array(grid * grid);
		let from = 0;
		for (const end of starts) {
			if (end - from >= 3) fillPolygon(gridCells, grid, xs, ys, from, end);
			from = end;
		}
		let covered = 0;
		for (const cell of gridCells) covered += cell;
		covers.push(covered / (grid * grid));
	}
	return covers;
}
