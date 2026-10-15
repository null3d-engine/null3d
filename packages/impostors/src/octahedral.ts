// Octahedral impostors: an object drawn from many directions into one texture atlas ahead of time,
// then shown far away as a card that faces the camera and shows the stored view nearest the
// camera's direction. The direction is stored with the octahedral map, which folds the sphere of
// directions onto one square, so a grid of cells covers every direction, the poles included. The
// back pole lands on the square's corners, and a back direction with x or y at 0 lands on an edge.
//
// The atlas is drawn as a sprite batch's map: the cells are frames counted from the top left, along
// each row and then down, which is the order the engine's sprites use. `impostorFrame` gives the
// frame a direction shows, and `frameDirection` gives the direction a frame was drawn from, so a
// bake and a draw agree on every cell.

/**
 * A direction, three numbers. It need not have length 1: this module makes it unit length.
 *
 * @category api/impostors
 */
export type Direction = readonly [number, number, number];

/**
 * Two octahedral coordinates, each from -1 to 1.
 *
 * @category api/impostors
 */
export type OctahedralUv = [number, number];

/**
 * The cells of an impostor atlas: `columns` across and `rows` down, as a sprite atlas.
 *
 * @category api/impostors
 */
export interface OctahedralAtlas {
	/** The frames across the atlas, from 1. */
	readonly columns: number;
	/** The frames down the atlas, from 1. */
	readonly rows: number;
}

/**
 * The squarest grid of cells that holds at least `views` views, as `{ columns, rows }`. The grid
 * can hold more cells than `views`, and every cell shows a direction. Give the result to a bake,
 * which draws a view in each cell, and to `createImpostors`, which shows them.
 *
 * @category api/impostors
 */
export function octahedralAtlas(views: number): OctahedralAtlas {
	if (!(Number.isInteger(views) && views >= 1))
		throw new RangeError(
			`octahedralAtlas() got ${views}; it takes a whole number of views from 1.`,
		);
	const columns = Math.ceil(Math.sqrt(views));
	const rows = Math.ceil(views / columns);
	return { columns, rows };
}

/**
 * The number of cells of an octahedral atlas: `columns` times `rows`. A bake draws a view in each
 * of them, because each shows a direction.
 *
 * @category api/impostors
 */
export function octahedralCells(atlas: OctahedralAtlas): number {
	return atlas.columns * atlas.rows;
}

/** The sign of a number, with 0 counted as positive, so the fold sends each back direction home. */
function signOf(n: number): number {
	return n < 0 ? -1 : 1;
}

/**
 * Folds the direction (x, y, z) onto the octahedron's two coordinates in `out`. The direction need
 * not have length 1.
 */
function encodeInto(x: number, y: number, z: number, out: OctahedralUv): OctahedralUv {
	const sum = Math.abs(x) + Math.abs(y) + Math.abs(z);
	if (sum === 0) {
		out[0] = 0;
		out[1] = 0;
		return out;
	}
	const px = x / sum;
	const py = y / sum;
	if (z >= 0) {
		out[0] = px;
		out[1] = py;
		return out;
	}
	out[0] = (1 - Math.abs(py)) * signOf(px);
	out[1] = (1 - Math.abs(px)) * signOf(py);
	return out;
}

/**
 * Folds a direction onto the octahedron's two coordinates, each from -1 to 1. The front half of the
 * sphere, z from 0 up, fills the square's middle diamond, and the back half fills its four corners,
 * so a grid of cells covers the whole sphere. The back pole, (0, 0, -1), lands on the corner (1, 1).
 *
 * @category api/impostors
 */
export function encodeOctahedral(direction: Direction, out: OctahedralUv = [0, 0]): OctahedralUv {
	return encodeInto(direction[0], direction[1], direction[2], out);
}

/**
 * The unit direction that an octahedral coordinate pair names, the inverse of `encodeOctahedral`.
 * Encoding the result gives the pair again, except on the square's outer edges, where the fold
 * makes two points name one direction.
 *
 * @category api/impostors
 */
export function decodeOctahedral(
	uv: OctahedralUv,
	out: [number, number, number] = [0, 0, 0],
): Direction {
	const u = uv[0];
	const v = uv[1];
	const z = 1 - Math.abs(u) - Math.abs(v);
	let x: number;
	let y: number;
	if (z >= 0) {
		x = u;
		y = v;
	} else {
		x = (1 - Math.abs(v)) * signOf(u);
		y = (1 - Math.abs(u)) * signOf(v);
	}
	const length = Math.hypot(x, y, z) || 1;
	out[0] = x / length;
	out[1] = y / length;
	out[2] = z / length;
	return out;
}

/**
 * The cell of an atlas that shows a view from `direction`, as a frame counted from the atlas's top
 * left, along each row and then down. A view was drawn from the direction a cell's center names,
 * so a bake that walks `frameDirection` over every frame and this agree on every cell. A direction
 * of length 0 shows the middle cell.
 *
 * @category api/impostors
 */
export function impostorFrame(direction: Direction, atlas: OctahedralAtlas): number {
	return frameOf(direction[0], direction[1], direction[2], atlas.columns, atlas.rows);
}

/** The coordinates that `frameOf` folds each direction into, kept so that a call allocates nothing. */
const folded: OctahedralUv = [0, 0];

/**
 * @internal The frame of a grid of `columns` by `rows` cells that shows a view from the direction
 * (x, y, z), as `impostorFrame` gives it. The direction need not have length 1.
 */
export function frameOf(x: number, y: number, z: number, columns: number, rows: number): number {
	encodeInto(x, y, z, folded);
	const column = Math.min(columns - 1, Math.max(0, Math.floor((folded[0] * 0.5 + 0.5) * columns)));
	const row = Math.min(rows - 1, Math.max(0, Math.floor((folded[1] * 0.5 + 0.5) * rows)));
	return row * columns + column;
}

/**
 * The direction that the view of a cell was drawn from: the center of the octahedron's cell, as a
 * unit direction. `impostorFrame` of the result gives `frame` again.
 *
 * @category api/impostors
 */
export function frameDirection(
	frame: number,
	atlas: OctahedralAtlas,
	out: [number, number, number] = [0, 0, 0],
): Direction {
	const cells = octahedralCells(atlas);
	if (!(Number.isInteger(frame) && frame >= 0 && frame < cells))
		throw new RangeError(`frameDirection() got ${frame}; it takes a frame from 0 to ${cells - 1}.`);
	const column = frame % atlas.columns;
	const row = Math.floor(frame / atlas.columns);
	const u = ((column + 0.5) / atlas.columns) * 2 - 1;
	const v = ((row + 0.5) / atlas.rows) * 2 - 1;
	return decodeOctahedral([u, v], out);
}

/**
 * The view of a list of directions that faces the camera most: the one whose direction has the
 * largest dot product with `direction`. Use it when a bake holds views that are not an octahedral
 * grid, such as 12 views a tool picked. It returns -1 for an empty list.
 *
 * @category api/impostors
 */
export function nearestFrame(direction: Direction, directions: readonly Direction[]): number {
	const length = Math.hypot(direction[0], direction[1], direction[2]) || 1;
	const x = direction[0] / length;
	const y = direction[1] / length;
	const z = direction[2] / length;
	let best = -1;
	let bestDot = -Infinity;
	for (let k = 0; k < directions.length; k++) {
		const view = directions[k] as Direction;
		const dot = x * view[0] + y * view[1] + z * view[2];
		if (dot > bestDot) {
			bestDot = dot;
			best = k;
		}
	}
	return best;
}
