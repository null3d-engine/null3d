// The facades add-on's textures, made in code: one page of four wall finishes, and a small page of
// window codes. Nothing ships as a file. Each wall tile holds one cell of a building's wall, a bay
// across and a floor up, with the window's opening cut out of its middle, the frame painted around
// the opening, and the window's share of light kept in the alpha channel for far away. A window
// code holds the look of one room: how warm its light is, how bright, how far its blinds hang and
// what furniture stands in it.
//
// The module imports no engine code, so a unit test checks the output alone.

/** Texels on each side of one wall tile. */
export const TILE = 128;

/** Tiles on each side of the wall atlas: four wall finishes in one texture. */
export const TILES = 2;

/** Texels on each side of the wall atlas. */
export const ATLAS_SIZE = TILE * TILES;

/** Texels on each side of the window code atlas. */
export const CODE_SIZE = 16;

/** The wall finishes, in the order that their tiles lie in the atlas. */
export const FACADE_KINDS = ['brick', 'timber', 'concrete', 'glass'] as const;

/** A wall finish. */
export type FacadeKind = (typeof FACADE_KINDS)[number];

/** The window's opening inside a wall tile, as fractions of the tile: across and up. */
export interface GlassRect {
	/** The opening's left edge, from 0 at the tile's left edge. */
	readonly x0: number;
	/** The opening's bottom edge, from 0 at the tile's bottom edge. */
	readonly y0: number;
	/** The opening's right edge. */
	readonly x1: number;
	/** The opening's top edge. */
	readonly y1: number;
}

/** The wall atlas: a colour page whose alpha holds the window's share of light, and its surface map. */
export interface WallAtlas {
	/** The colour page as RGBA bytes. Its alpha is 255 where the tile's window is glass. */
	readonly color: Uint8Array;
	/** The surface page as RGBA bytes: occlusion, roughness and metalness. */
	readonly orm: Uint8Array;
	/** Texels on each side of the page. */
	readonly size: number;
}

/** The window code page: one texel per room, as RGBA bytes. */
export interface CodeAtlas {
	/** The code page as RGBA bytes. */
	readonly data: Uint8Array;
	/** Texels on each side of the page. */
	readonly size: number;
}

/**
 * A number from 0 up to 1 for a lattice point, from integer arithmetic alone. The same numbers
 * come out on every machine.
 */
export function hashCode(x: number, y: number, seed: number): number {
	let h =
		(Math.imul(x | 0, 0x27d4eb2d) ^
			Math.imul(y | 0, 0x165667b1) ^
			Math.imul(seed | 0, 0x9e3779b9)) >>>
		0;
	h ^= h >>> 15;
	h = Math.imul(h, 0x2c1b3c6d);
	h ^= h >>> 12;
	h = Math.imul(h, 0x297a2d39);
	h ^= h >>> 15;
	return (h >>> 8) / 16777216;
}

/** Value noise from 0 to 1 at a point of the plane, built from `hashCode` at whole lattice points. */
function noise(x: number, y: number, seed: number): number {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const fx = x - xi;
	const fy = y - yi;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const at = (ax: number, ay: number): number => hashCode(xi + ax, yi + ay, seed);
	const top = at(0, 0) + (at(1, 0) - at(0, 0)) * sx;
	const bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * sx;
	return top + (bottom - top) * sy;
}

/** A colour times a brightness, as bytes. */
function shade(color: readonly [number, number, number], amount: number): [number, number, number] {
	return [
		Math.max(0, Math.min(255, Math.round(color[0] * amount))),
		Math.max(0, Math.min(255, Math.round(color[1] * amount))),
		Math.max(0, Math.min(255, Math.round(color[2] * amount))),
	];
}

/** What one texel of a wall tile holds, before the glass and the frame are drawn over it. */
interface WallTexel {
	readonly color: readonly [number, number, number];
	readonly roughness: number;
	readonly metalness: number;
}

/** The wall of a brick building: courses of uneven bricks in light mortar. */
function brickTexel(u: number, v: number): WallTexel {
	const course = 16;
	const brick = 32;
	const mortar = 1.5;
	const row = Math.floor(v * TILE);
	const offset = (Math.floor(row / course) % 2) * brick * 0.5;
	const x = u * TILE + offset;
	const inMortar = row % course < mortar || x % brick < mortar;
	if (inMortar) return { color: [112, 106, 96], roughness: 0.95, metalness: 0 };
	const bx = Math.floor(x / brick);
	const by = Math.floor(row / course);
	const tone = 0.78 + 0.4 * hashCode(bx, by, 3);
	const stain = 0.9 + 0.1 * noise(u * 24, v * 24, 9);
	return {
		color: shade([126, 82, 64], tone * stain),
		roughness: 0.92,
		metalness: 0,
	};
}

/** The wall of a timber building: upright planks with grain, in dark oak. */
function timberTexel(u: number, v: number): WallTexel {
	const plank = 32;
	const x = u * TILE;
	const index = Math.floor(x / plank);
	const edge = x % plank < 1.2;
	const grain = noise(x * 0.08, v * TILE * 0.25 + index * 13, 5);
	if (edge) return { color: [38, 26, 18], roughness: 0.9, metalness: 0 };
	const tone = (0.82 + 0.3 * hashCode(index, 0, 11)) * (0.86 + 0.24 * grain);
	return { color: shade([104, 72, 44], tone), roughness: 0.88, metalness: 0 };
}

/** The wall of a concrete building: poured panels with joints and rain stains. */
function concreteTexel(u: number, v: number): WallTexel {
	const x = u * TILE;
	const y = v * TILE;
	const joint = x % 64 < 1.5 || y % 64 < 1.5;
	const grit = noise(x * 0.45, y * 0.45, 17);
	const stain = noise(x * 0.05, y * 0.09, 23);
	if (joint) return { color: [48, 50, 54], roughness: 0.95, metalness: 0 };
	const tone = (0.7 + 0.2 * grit) * (0.86 + 0.2 * stain);
	return { color: shade([104, 106, 110], tone), roughness: 0.9, metalness: 0.02 };
}

/** The wall of a glass tower: dark panes between thin metal mullions. */
function glassTexel(u: number, v: number): WallTexel {
	const x = u * TILE;
	const mullion = x % 42 < 2 || (v * TILE) % 48 < 2;
	if (mullion) return { color: [44, 50, 58], roughness: 0.45, metalness: 0.85 };
	const glare = 0.9 + 0.18 * noise(u * 8, v * 5, 29);
	return { color: shade([26, 34, 46], glare), roughness: 0.18, metalness: 0.7 };
}

/** The wall finishes, each drawing one texel of a tile. */
const WALLS: Readonly<Record<FacadeKind, (u: number, v: number) => WallTexel>> = {
	brick: brickTexel,
	timber: timberTexel,
	concrete: concreteTexel,
	glass: glassTexel,
};

/** How a tile paints the frame around a window, and the sill under it, in its wall's colours. */
function frameColor(kind: FacadeKind): readonly [number, number, number] {
	if (kind === 'timber') return [52, 36, 24];
	if (kind === 'brick') return [74, 66, 58];
	if (kind === 'concrete') return [70, 72, 78];
	return [52, 58, 66];
}

/**
 * Builds the wall atlas. Each of the four tiles draws one wall finish, with a window cut from its
 * middle at `glass`, a frame painted around the window, a sill under it and a shadow below the
 * sill. The colour page's alpha is 255 where the window is glass, so a far view reads the window's
 * share of the wall from the page's own mip levels.
 */
export function buildWallAtlas(glass: GlassRect): WallAtlas {
	const color = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
	const orm = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
	// The frame band's width, as a fraction of the tile, is a little wider than a bay's pier.
	const band = 0.035;
	for (let tileY = 0; tileY < TILES; tileY++)
		for (let tileX = 0; tileX < TILES; tileX++) {
			const kind = FACADE_KINDS[tileY * TILES + tileX] as FacadeKind;
			const wallTexel = WALLS[kind];
			const frame = frameColor(kind);
			for (let y = 0; y < TILE; y++)
				for (let x = 0; x < TILE; x++) {
					const u = (x + 0.5) / TILE;
					const v = (y + 0.5) / TILE;
					const wall = wallTexel(u, v);
					const inGlass = u > glass.x0 && u < glass.x1 && v > glass.y0 && v < glass.y1;
					const inFrame =
						!inGlass &&
						u > glass.x0 - band &&
						u < glass.x1 + band &&
						v > glass.y0 - band &&
						v < glass.y1 + band;
					// The sill is the band under the opening; a shadow falls from it down the wall.
					const sill = inFrame && v < glass.y0;
					const below = v < glass.y0 - band ? Math.exp(-(glass.y0 - band - v) * 22) : 0;
					let rgb = wall.color;
					let roughness = wall.roughness;
					let metalness = wall.metalness;
					if (inFrame) {
						rgb = sill ? shade(frame, 1.35) : frame;
						roughness = 0.82;
						metalness = kind === 'glass' ? 0.5 : 0;
					}
					if (below > 0) rgb = shade(rgb, 1 - 0.41 * below);
					const texel = ((tileY * TILE + y) * ATLAS_SIZE + tileX * TILE + x) * 4;
					color[texel] = rgb[0];
					color[texel + 1] = rgb[1];
					color[texel + 2] = rgb[2];
					color[texel + 3] = inGlass ? 255 : 0;
					orm[texel] = 255;
					orm[texel + 1] = Math.round(roughness * 255);
					orm[texel + 2] = Math.round(metalness * 255);
					orm[texel + 3] = 255;
				}
		}
	return { color, orm, size: ATLAS_SIZE };
}

/**
 * Builds the window code page: one texel for each of 256 rooms. The red channel gives the room's
 * warmth, the green its lamp's level, the blue the share of the glass that blinds cover (0 for
 * none) and the alpha the furniture, where a high value also marks a room lit by a television.
 */
export function buildCodeAtlas(): CodeAtlas {
	const data = new Uint8Array(CODE_SIZE * CODE_SIZE * 4);
	for (let y = 0; y < CODE_SIZE; y++)
		for (let x = 0; x < CODE_SIZE; x++) {
			const texel = (y * CODE_SIZE + x) * 4;
			const warmth = hashCode(x, y, 41);
			const level = hashCode(x, y, 43);
			const blind = hashCode(x, y, 47);
			const furniture = hashCode(x, y, 53);
			data[texel] = Math.round(warmth * 255);
			data[texel + 1] = Math.round((0.35 + 0.65 * level) * 255);
			data[texel + 2] = blind < 0.45 ? 0 : Math.round((0.3 + 0.7 * blind) * 255);
			data[texel + 3] = Math.round(furniture * 255);
		}
	return { data, size: CODE_SIZE };
}
