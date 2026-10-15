// Octahedral impostors: an object drawn from many directions into one texture atlas ahead of time,
// then shown far away as a card that faces the camera and shows the stored view nearest the
// camera's direction. The direction is stored with the octahedral map, which folds the sphere of
// directions onto one square, so a grid of cells covers every direction, the poles included.
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
 * The squarest grid of cells that holds at least `views` views: the columns, the rows, and the
 * cells. Give the result to a bake, which draws a view in each cell, and to
 * `scene.createImpostors`, which shows them.
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
 * The cells of an octahedral atlas: the count, which need not fill the last row.
 *
 * @category api/impostors
 */
export function octahedralCells(atlas: OctahedralAtlas): number {
	return atlas.columns * atlas.rows;
}

/**
 * Folds a direction onto the octahedron's two coordinates, each from -1 to 1. Opposite directions
 * land in opposite halves of the square, so a grid of cells covers the whole sphere.
 *
 * @category api/impostors
 */
export function encodeOctahedral(direction: Direction, out: OctahedralUv = [0, 0]): OctahedralUv {
	const x = direction[0];
	const y = direction[1];
	const z = direction[2];
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
	out[0] = (1 - Math.abs(py)) * Math.sign(px);
	out[1] = (1 - Math.abs(px)) * Math.sign(py);
	return out;
}

/**
 * The unit direction that an octahedral coordinate pair names: the exact inverse of
 * `encodeOctahedral`.
 *
 * @category api/impostors
 */
export function decodeOctahedral(
	uv: OctahedralUv,
	out: [number, number, number] = [0, 0, 0],
): Direction {
	const [u, v] = uv;
	const z = 1 - Math.abs(u) - Math.abs(v);
	let x: number;
	let y: number;
	if (z >= 0) {
		x = u;
		y = v;
	} else {
		x = (1 - Math.abs(v)) * Math.sign(u);
		y = (1 - Math.abs(u)) * Math.sign(v);
	}
	const length = Math.hypot(x, y, z) || 1;
	out[0] = x / length;
	out[1] = y / length;
	out[2] = z / length;
	return out;
}

/** The pair that `impostorFrame` folds each direction into, made once so a call allocates nothing. */
const FRAME_UV: OctahedralUv = [0, 0];

/**
 * The cell of an atlas that shows a view from `direction`, as a frame counted from the atlas's top
 * left, along each row and then down. A view was drawn from the direction a cell's centre names,
 * so a bake that walks `frameDirection` over every frame and this agree on every cell. A direction
 * of length 0 shows the middle cell. It allocates nothing.
 *
 * @category api/impostors
 */
export function impostorFrame(direction: Direction, atlas: OctahedralAtlas): number {
	encodeOctahedral(direction, FRAME_UV);
	const u = FRAME_UV[0];
	const v = FRAME_UV[1];
	const column = Math.min(
		atlas.columns - 1,
		Math.max(0, Math.floor((u * 0.5 + 0.5) * atlas.columns)),
	);
	const row = Math.min(atlas.rows - 1, Math.max(0, Math.floor((v * 0.5 + 0.5) * atlas.rows)));
	return row * atlas.columns + column;
}

/**
 * The direction that the view of a cell was drawn from: the centre of the octahedron's cell, as a
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
