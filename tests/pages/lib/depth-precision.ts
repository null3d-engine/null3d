// The depth precision scene, which the depth precision page draws and the tests read back. Each
// tile of a 4 by 3 grid holds two surfaces 1 cm apart, at one distance from 1 m to 10 km, turned
// so that depth changes across them. The farther surface draws first, in red, and the nearer one
// covers it. Wherever depth cannot tell the two apart, the red one shows: a fighting pixel. The
// last tile holds two surfaces at the same depth, facing the camera, so each of its pixels ties
// and the red one must win every tie. That shows that ties count as fighting.
//
// The sketch places the surfaces from this module, and the page counts the fighting pixels of each
// tile with it. It uses no browser or Node API, so the tests can import it too.

export type Vec3 = [number, number, number];

/** The frame, the camera and the colors of the scene. */
export const PRECISION = {
	/** The canvas size in pixels, [width, height]: the page draws one device pixel per CSS pixel. */
	size: [640, 360] as const,
	/** The camera sits at the origin and looks down -Z. */
	fovDegrees: 60,
	near: 0.1,
	far: 20_000,
	columns: 4,
	rows: 3,
	/** The distance of each tile's nearer surface, in meters, tile by tile from the top left. */
	distances: [1, 2.5, 6.3, 16, 40, 100, 250, 630, 1600, 4000, 10_000],
	/** The gap between the two surfaces of a tile, along their normal, in meters. */
	gap: 0.01,
	/**
	 * How far the surfaces turn about the vertical axis, with their nearer edge toward the middle
	 * of the frame. Each then spans about 12% of its distance either way.
	 */
	tiltDegrees: 30,
	/** The distance of the last tile, whose two surfaces tie. */
	tieDistance: 10,
	/** The share of its tile that a nearer surface covers each way, and of that, the farther one. */
	frontShare: 0.8,
	backShare: 0.75,
	background: '#000c1c',
	/** The nearer surface's color, and the farther one's, whose red channel marks fighting. */
	front: '#00b4d8',
	back: '#ff4040',
} as const;

/** The farthest distance at which every depth mode must tell the two surfaces apart, in meters. */
export const ALWAYS_APART_METERS = 40;

/**
 * The share of the tie tile's pixels that the farther surface must win. Below it, ties do not count
 * as fighting, and the other tiles' counts say too little.
 */
export const TIES_WON = 0.9;

/** The nearer surface's color as the frame holds it, which the fighting pixels are painted. */
const FRONT_RGB = [0x00, 0xb4, 0xd8] as const;
/** A red channel above this means the farther surface showed in at least one sample. */
const FIGHTING_RED = 8;

/** One surface: a flat box of the sketch, and whether it is the farther one of its tile. */
export interface Surface {
	tile: number;
	/** The distance of the tile's nearer surface. */
	distance: number;
	back: boolean;
	position: Vec3;
	/** A quaternion (x, y, z, w). */
	rotation: [number, number, number, number];
	/** The width and height in meters; the box has no depth. */
	scale: Vec3;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const [WIDTH, HEIGHT] = PRECISION.size;
const aspect = WIDTH / HEIGHT;
const halfHeight = Math.tan(radians(PRECISION.fovDegrees) / 2);
const halfWidth = halfHeight * aspect;
/** The tiles: one per distance, then the tie. */
const TILES = PRECISION.distances.length + 1;

/** The middle of a tile, from -1 to 1 each way, with +y up. */
function tileMiddle(tile: number): [number, number] {
	const column = tile % PRECISION.columns;
	const row = Math.floor(tile / PRECISION.columns);
	return [-1 + ((column + 0.5) * 2) / PRECISION.columns, 1 - ((row + 0.5) * 2) / PRECISION.rows];
}

/** The surfaces of the scene: each tile's farther surface, then its nearer one. */
export function precisionSurfaces(): Surface[] {
	const surfaces: Surface[] = [];
	for (let tile = 0; tile < TILES; tile++) {
		const tie = tile === TILES - 1;
		const distance = tie ? PRECISION.tieDistance : (PRECISION.distances[tile] as number);
		const gap = tie ? 0 : PRECISION.gap;
		const [x, y] = tileMiddle(tile);
		const tilt = tie ? 0 : Math.sign(x) * radians(PRECISION.tiltDegrees);
		const middle: Vec3 = [x * distance * halfWidth, y * distance * halfHeight, -distance];
		// The surface's normal after the turn about +Y, which faces the camera.
		const normal: Vec3 = [Math.sin(tilt), 0, Math.cos(tilt)];
		const rotation: Surface['rotation'] = [0, Math.sin(tilt / 2), 0, Math.cos(tilt / 2)];
		// Wider by the turn, so the surface still covers its share of the tile's width.
		const width =
			(PRECISION.frontShare * 2 * distance * halfWidth) / PRECISION.columns / Math.cos(tilt);
		const height = (PRECISION.frontShare * 2 * distance * halfHeight) / PRECISION.rows;
		const share = PRECISION.backShare;
		surfaces.push({
			tile,
			distance,
			back: true,
			position: [middle[0] - gap * normal[0], middle[1], middle[2] - gap * normal[2]],
			rotation,
			scale: [width * share, height * share, 1],
		});
		surfaces.push({
			tile,
			distance,
			back: false,
			position: middle,
			rotation,
			scale: [width, height, 1],
		});
	}
	return surfaces;
}

/** Where a point in front of the camera lands in the frame, in pixels from the top left. */
function project([x, y, z]: Vec3): [number, number] {
	const right = x / (-z * halfWidth);
	const up = y / (-z * halfHeight);
	return [((right + 1) / 2) * WIDTH, ((1 - up) / 2) * HEIGHT];
}

/** The corners of a surface in the frame, in order around it. */
function corners(surface: Surface): [number, number][] {
	const [width, height] = surface.scale;
	const [, sinHalf, , cosHalf] = surface.rotation;
	// The surface's own x axis after the turn about +Y.
	const sin = 2 * sinHalf * cosHalf;
	const cos = cosHalf * cosHalf - sinHalf * sinHalf;
	const [px, py, pz] = surface.position;
	return [
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1],
	].map(([u, v]) => {
		const across = ((u as number) * width) / 2;
		const up = ((v as number) * height) / 2;
		return project([px + across * cos, py + up, pz - across * sin]);
	});
}

/** True when a point lies inside a convex polygon whose corners go around it in either order. */
function inside(polygon: [number, number][], x: number, y: number): boolean {
	let sign = 0;
	for (let k = 0; k < polygon.length; k++) {
		const [ax, ay] = polygon[k] as [number, number];
		const [bx, by] = polygon[(k + 1) % polygon.length] as [number, number];
		const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
		if (cross === 0) continue;
		if (sign === 0) sign = Math.sign(cross);
		else if (Math.sign(cross) !== sign) return false;
	}
	return true;
}

/** What one tile of a frame shows. */
export interface TileCount {
	/** The nearer surface's distance in meters. */
	distance: number;
	/** The pixels the farther surface covers, where fighting can show. */
	pixels: number;
	/** The pixels where the farther surface shows, in at least one sample. */
	fighting: number;
}

/** What a frame of the scene shows: each distance's tile, the tie tile, and the fighting in all. */
export interface PrecisionCount {
	tiles: TileCount[];
	tie: TileCount;
	/** The fighting pixels of every tile but the tie. */
	fighting: number;
}

/** True when the farther surface shows at the pixel that starts at byte `at`. */
const fights = (rgba: Uint8Array, at: number) => (rgba[at] as number) > FIGHTING_RED;

/**
 * Counts the fighting pixels of each tile in a frame of the scene, given as RGBA8 rows from the
 * top. The frame must have the scene's size.
 */
export function countFighting(rgba: Uint8Array, width: number, height: number): PrecisionCount {
	if (width !== WIDTH || height !== HEIGHT)
		throw new Error(
			`the frame is ${width} x ${height} pixels, not the scene's ${WIDTH} x ${HEIGHT}`,
		);
	const tileWidth = width / PRECISION.columns;
	const tileHeight = height / PRECISION.rows;
	const counts: TileCount[] = [];
	for (const surface of precisionSurfaces()) {
		if (!surface.back) continue;
		const outline = corners(surface);
		const count = { distance: surface.distance, pixels: 0, fighting: 0 };
		const left = (surface.tile % PRECISION.columns) * tileWidth;
		const top = Math.floor(surface.tile / PRECISION.columns) * tileHeight;
		for (let y = top; y < top + tileHeight; y++)
			for (let x = left; x < left + tileWidth; x++) {
				if (inside(outline, x + 0.5, y + 0.5)) count.pixels++;
				if (fights(rgba, (y * width + x) * 4)) count.fighting++;
			}
		counts.push(count);
	}
	const tie = counts.pop() as TileCount;
	return { tiles: counts, tie, fighting: counts.reduce((sum, tile) => sum + tile.fighting, 0) };
}

/**
 * A copy of a frame with each fighting pixel painted as the nearer surface: the frame that depth
 * with no limit on its precision would give.
 */
export function withoutFighting(rgba: Uint8Array): Uint8Array {
	const out = rgba.slice();
	for (let at = 0; at < out.length; at += 4) {
		if (!fights(out, at)) continue;
		out.set(FRONT_RGB, at);
		out[at + 3] = 255;
	}
	return out;
}

/** A distance as a label: meters below 1 km, kilometers from there. */
export function distanceLabel(meters: number): string {
	return meters < 1000 ? `${meters} m` : `${meters / 1000} km`;
}

/** What a frame of the scene shows, as the depth precision page publishes it besides the frame. */
export interface PrecisionFacts {
	/** The fighting pixels of every tile but the tie. */
	fighting: number;
	tiles: TileCount[];
	/** True when the farther surface won the tie tile's ties, so ties count as fighting. */
	tiesWon: boolean;
	/** True when no tile up to `ALWAYS_APART_METERS` fights. */
	apartNear: boolean;
	/** True when some tile fights. */
	fights: boolean;
}

/** The facts that a frame's fighting pixels give. */
export function precisionFacts({ tiles, tie, fighting }: PrecisionCount): PrecisionFacts {
	return {
		fighting,
		tiles,
		tiesWon: tie.fighting >= TIES_WON * tie.pixels,
		apartNear: tiles.every((tile) => tile.distance > ALWAYS_APART_METERS || tile.fighting === 0),
		fights: fighting > 0,
	};
}
