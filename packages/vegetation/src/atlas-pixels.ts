// The pixels of the bark and leaf atlases, made in the browser the first time a page asks for them.
// A page ships no image file: these functions paint the same atlas on every device, from integer
// hashes alone, so no texture is downloaded and none differs between machines.
//
// Bark is stretched Voronoi plates warped by fractal noise, with cracks between them and fibres up
// the trunk. A leaf comes from an outline with veins written into a height field, and the gradient
// of that field gives the normal map. Each atlas has a colour map, whose values multiply the
// species' own colour, and a surface map that holds the normal, the bark's roughness or the leaf's
// coverage, and the leaf's thickness.

/** A painted map: its size in texels and four bytes per texel, rows from the top. */
export interface AtlasPixels {
	/** Texels across. */
	readonly width: number;
	/** Rows down. */
	readonly height: number;
	/** Four bytes per texel, the first row first. */
	readonly data: Uint8Array;
}

/** How many texels the bark block is across and down. It tiles, so it holds one cell. */
export const BARK_SIZE = 256;
/** How many cells the leaf block holds across and down. */
export const LEAF_CELLS_X = 4;
export const LEAF_CELLS_Y = 2;
/** How many texels one leaf cell is across and down. */
export const LEAF_CELL = 128;
/** The leaf block's size in texels. */
export const LEAF_WIDTH = LEAF_CELLS_X * LEAF_CELL;
export const LEAF_HEIGHT = LEAF_CELLS_Y * LEAF_CELL;

/** The most leaves that one cluster cell draws. */
const MAX_LEAVES = 9;
/** The most needles or pinnae that one card draws. */
const MAX_STRANDS = 34;
/** How far the bark's and the leaf's height fields bend their normals, per texel. */
const BUMP_BARK = 0.024;
const BUMP_LEAF = 0.024;

/** The PCG hash of a whole number, as the shaders' `pcg` computes it. */
function pcg(value: number): number {
	const state = (Math.imul(value, 747796405) + 2891336453) >>> 0;
	const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
	return ((word >>> 22) ^ word) >>> 0;
}

/** A number from 0 up to 1 for a whole-number seed, the same on every device. */
function random(seed: number): number {
	return (pcg(seed) >>> 8) / 16777216;
}

/** A number from 0 up to 1 for a pair of whole numbers. */
function random2(x: number, y: number): number {
	return random((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0);
}

/** The lattice hash of a cell. */
function lattice(x: number, y: number): number {
	return Math.imul(Math.imul(x, 374761393) + Math.imul(y, 668265263), 1274126177) >>> 0;
}

/** A value-noise sample at a point, from 0 to 1, smooth between the lattice's points. */
function value2(x: number, y: number): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const fx = x - ix;
	const fy = y - iy;
	const ux = fx * fx * (3 - 2 * fx);
	const uy = fy * fy * (3 - 2 * fy);
	const at = (dx: number, dy: number) => random(lattice(ix + dx, iy + dy));
	const a = at(0, 0) + (at(1, 0) - at(0, 0)) * ux;
	const b = at(0, 1) + (at(1, 1) - at(0, 1)) * ux;
	return a + (b - a) * uy;
}

/** Fractal value noise at a point, from 0 to 1, with `octaves` layers at twice the frequency. */
function fbm2(x: number, y: number, octaves: number): number {
	let sum = 0;
	let total = 0;
	let frequency = 1;
	let amplitude = 1;
	for (let i = 0; i < octaves; i++) {
		sum += amplitude * value2(x * frequency, y * frequency);
		total += amplitude;
		frequency *= 2;
		amplitude *= 0.5;
	}
	return total > 0 ? sum / total : 0;
}

/** A band that is 1 on the line where `value` is 0, and falls to 0 by `width`. */
function line(value: number, width: number): number {
	return 1 - smoothstep(0, Math.max(width, 1e-5), Math.abs(value));
}

/** A signed distance turned into coverage: 1 inside, 0 outside. */
function cover(distance: number, width: number): number {
	return 1 - smoothstep(-width, width, distance);
}

/** Hermite interpolation from 0 to 1 between two edges. */
function smoothstep(edge0: number, edge1: number, value: number): number {
	const t = clamp((value - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
	return t * t * (3 - 2 * t);
}

/** A number kept between two limits. */
function clamp(value: number, low: number, high: number): number {
	return value < low ? low : value > high ? high : value;
}

/** How far a point of one leaf's own space lies outside its outline. */
function leafOutline(px: number, py: number, lobes: number, lobeFrequency: number): number {
	const t = clamp(py, 0, 1);
	const taper = Math.sin(t ** 0.62 * Math.PI);
	const wave = 1 + lobes * Math.sin(t * lobeFrequency * Math.PI);
	const half = 0.36 * Math.max(taper, 0) ** 0.8 * wave;
	return Math.abs(px) - half;
}

/** The height of one leaf at a point of its own space, with its midrib and side veins. */
function leafHeight(px: number, py: number): number {
	const t = clamp(py, 0, 1);
	let height = 0.45 + 0.9 * px * px;
	height += 0.55 * line(px, 0.012);
	const veins = Math.abs(((t * 6 - Math.abs(px) * 1.7) % 1) - 0.5) * 2;
	height += 0.3 * line(veins, 0.09) * (1 - smoothstep(0.15, 0.5, Math.abs(px)));
	return height;
}

/** A point of a card, in the space of one leaf of it. */
function leafSpace(
	cardX: number,
	cardY: number,
	atX: number,
	atY: number,
	angle: number,
	length: number,
	half: number,
): [number, number] {
	const dx = (cardX - atX) / half;
	const dy = (cardY - atY) / length;
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return [dx * c - dy * s, dx * s + dy * c];
}

/** One leaf cell's point: its colour as a factor around white, its coverage and its height. */
interface LeafPoint {
	color: readonly [number, number, number];
	alpha: number;
	height: number;
}

/** A leaf's colour factor, jittered by its index so that the leaves of one card differ. */
function leafColor(
	seed: number,
	bias: readonly [number, number, number],
	height: number,
): [number, number, number] {
	const jitter = [
		0.9 + 0.2 * random2(seed * 61, 11),
		0.9 + 0.2 * random2(seed * 61, 23),
		0.88 + 0.22 * random2(seed * 61, 37),
	] as const;
	const lift = 0.78 + 0.34 * height;
	return [bias[0] * jitter[0] * lift, bias[1] * jitter[1] * lift, bias[2] * jitter[2] * lift];
}

/** Keeps the leaf that covers more of the point. */
function keep(given: LeafPoint, found: LeafPoint): LeafPoint {
	return found.alpha > given.alpha ? found : given;
}

/** A cluster of leaves along a twig. */
function clusterCell(
	cardX: number,
	cardY: number,
	leaves: number,
	lobes: number,
	frequency: number,
): LeafPoint {
	let out: LeafPoint = {
		color: [0.55, 0.5, 0.42],
		alpha: cover(Math.abs(cardX - 0.5) - 0.012, 0.004),
		height: 0.4,
	};
	for (let i = 0; i < Math.min(leaves, MAX_LEAVES); i++) {
		const f = i / Math.max(leaves - 1, 1);
		const side = (i & 1) === 0 ? 1 : -1;
		const angle = side * (0.55 + 0.35 * random2(i, 5));
		const length = 0.42 - 0.12 * f + 0.06 * random2(i, 7);
		const [px, py] = leafSpace(cardX, cardY, 0.5, 0.12 + 0.66 * f, angle, length, 0.32);
		const inside = cover(leafOutline(px, py, lobes, frequency), 0.004);
		if (inside <= 0) continue;
		const height = leafHeight(px, py);
		out = keep(out, {
			color: leafColor(i + f * 3, [1, 1, 0.95], height),
			alpha: inside,
			height,
		});
	}
	return out;
}

/** A conifer's needle spray. */
function needleCell(cardX: number, cardY: number): LeafPoint {
	let out: LeafPoint = {
		color: [0.45, 0.42, 0.36],
		alpha: cover(Math.abs(cardX - 0.5) - 0.01, 0.004),
		height: 0.5,
	};
	for (let i = 0; i < MAX_STRANDS; i++) {
		const f = i / (MAX_STRANDS - 1);
		const side = (i & 1) === 0 ? 1 : -1;
		const angle = side * (0.95 - 0.35 * f);
		const length = 0.2 * (1 - 0.6 * f) + 0.03;
		const [px, py] = leafSpace(cardX, cardY, 0.5, 0.06 + 0.9 * f, angle, length, 0.022);
		const inside = cover(leafOutline(px, py, 0, 1), 0.004);
		if (inside <= 0) continue;
		const height = leafHeight(px, py);
		out = keep(out, {
			color: leafColor(f * 17, [0.78, 0.86, 0.78], height),
			alpha: inside,
			height,
		});
	}
	return out;
}

/** A fern's frond: a rachis with pinnae in pairs. */
function frondCell(cardX: number, cardY: number): LeafPoint {
	let out: LeafPoint = {
		color: [0.7, 0.75, 0.6],
		alpha: cover(Math.abs(cardX - 0.5) - 0.008, 0.004),
		height: 0.55,
	};
	for (let i = 0; i < 22; i++) {
		const f = i / 21;
		const side = (i & 1) === 0 ? 1 : -1;
		const length = 0.2 * (1 - 0.55 * f) + 0.04;
		const [px, py] = leafSpace(cardX, cardY, 0.5, 0.05 + 0.9 * f, side * 1.32, length, 0.075);
		const inside = cover(leafOutline(px, py, 0.18, 3), 0.004);
		if (inside <= 0) continue;
		const height = leafHeight(px, py);
		out = keep(out, { color: leafColor(f * 9, [0.92, 1, 0.86], height), alpha: inside, height });
	}
	return out;
}

/** A blade: a sedge's or a grass clump's, long and tapered with veins along it. */
function bladeCell(cardX: number, cardY: number): LeafPoint {
	const t = clamp((cardY - 0.04) / 0.9, 0, 1);
	const lean = 0.06 * Math.sin(t * Math.PI);
	const half = 0.26 * Math.max(Math.sin(t ** 0.45 * Math.PI), 0) ** 0.7 + 0.01;
	const across = (cardX - 0.5 - lean) / half;
	const alpha = cover(Math.abs(across) - 1, 0.06 / Math.max(half, 1e-4));
	const veins = Math.abs(((across * 3.5) % 1) - 0.5) * 2;
	let height = 0.5 + 0.5 * (1 - Math.min(across * across, 1));
	height += 0.12 * line(veins, 0.4);
	return {
		color: leafColor(t * 5, [0.95, 1, 0.9], height).map((c) => c * (0.9 + 0.2 * t)) as [
			number,
			number,
			number,
		],
		alpha,
		height,
	};
}

/** A single broad leaf that fills its cell, as a hosta's leaf does. */
function broadCell(cardX: number, cardY: number): LeafPoint {
	const [px, py] = leafSpace(cardX, cardY, 0.5, 0.03, 0, 0.95, 0.46);
	const inside = cover(leafOutline(px, py, 0.1, 2), 0.004);
	const height = leafHeight(px, py);
	return { color: leafColor(1, [1, 1, 0.92], height), alpha: inside, height };
}

/** One leaf cell of the atlas at a point of that cell. */
function leafCellAt(kind: number, cardX: number, cardY: number): LeafPoint {
	switch (kind) {
		case 0:
			return clusterCell(cardX, cardY, 7, 0.34, 4);
		case 1:
			return clusterCell(cardX, cardY, 6, 0.06, 2);
		case 2:
			return clusterCell(cardX, cardY, 9, 0.14, 5);
		case 3:
			return clusterCell(cardX, cardY, 5, 0.42, 3);
		case 4:
			return needleCell(cardX, cardY);
		case 5:
			return frondCell(cardX, cardY);
		case 6:
			return bladeCell(cardX, cardY);
		default:
			return broadCell(cardX, cardY);
	}
}

/** The nearest bark plate's distance, the next one's, and a number of the nearest plate. */
function plates(x: number, y: number): [number, number, number] {
	const wholeX = Math.floor(x);
	const wholeY = Math.floor(y);
	const partX = x - wholeX;
	const partY = y - wholeY;
	let first = 8;
	let second = 8;
	let near = 0;
	for (let oy = -1; oy <= 1; oy++)
		for (let ox = -1; ox <= 1; ox++) {
			const cellX = wholeX + ox;
			const cellY = wholeY + oy;
			const atX = random2(cellX, cellY);
			const atY = random2(cellX + 31, cellY + 17);
			const dx = ox + atX - partX;
			const dy = oy + atY - partY;
			const d = Math.hypot(dx, dy);
			if (d < first) {
				second = first;
				first = d;
				near = random2(cellX + 7, cellY + 3);
			} else if (d < second) second = d;
		}
	return [first, second, near];
}

/** The bark's plate coordinates at a point, warped by noise, and the nearest plate's number. */
function barkPlates(u: number, v: number): [number, number, number] {
	const warp = fbm2(u * 1.7 + 3.1, v * 0.7 + 8.4, 3) * 0.9;
	const [first, second, near] = plates(u * 7 + warp, v * 1.6);
	return [first, second, near];
}

/** The bark's height at a point of its own tiling coordinates. */
function barkHeight(u: number, v: number): number {
	const [first, second, near] = barkPlates(u, v);
	const crack = smoothstep(0, 0.08, second - first);
	let height = (0.25 + 0.65 * crack) * (0.75 + 0.5 * near);
	height += fbm2(u * 90, v * 18, 3) * 0.07 * crack;
	height += fbm2(u * 23, v * 4, 2) * 0.06;
	return height;
}

/** How much light a bark point reflects, as a factor around white. */
function barkColorAt(
	u: number,
	v: number,
	height: number,
	plate: number,
): [number, number, number] {
	const mix = clamp(height, 0, 1);
	const dark = [0.34, 0.31, 0.29] as const;
	const light = [1.15, 1.06, 0.98] as const;
	const shade = 0.86 + 0.28 * plate;
	const moss = smoothstep(0.55, 0.85, fbm2(u * 5 + 11, v * 2 + 4, 3)) * 0.4;
	return [0, 1, 2].map((channel) => {
		const base =
			(dark[channel] as number) + ((light[channel] as number) - (dark[channel] as number)) * mix;
		const withMoss = base * shade * (1 - moss) + [0.62, 0.85, 0.42][channel]! * moss;
		return withMoss;
	}) as [number, number, number];
}

/** The sRGB code of a linear value, from 0 to 1, as a colour map's texel holds it. */
function encode(value: number): number {
	const v = clamp(value, 0, 1);
	return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
}

/** A texel's four bytes, from three numbers that a linear map holds as they are. */
function encodeLinear(r: number, g: number, b: number): [number, number, number, number] {
	return [
		Math.round(clamp(r, 0, 1) * 255),
		Math.round(clamp(g, 0, 1) * 255),
		Math.round(clamp(b, 0, 1) * 255),
		255,
	];
}

/** The two maps of one atlas: its colour map and its surface map. */
export interface PaintedAtlas {
	/** The colour map, in sRGB. */
	readonly color: AtlasPixels;
	/** The surface map, linear: the normal, the coverage or roughness, and the thickness. */
	readonly surface: AtlasPixels;
}

/** The height field of one block, one number per texel, rows from the bottom. */
function heightField(
	width: number,
	height: number,
	at: (x: number, y: number) => number,
): Float32Array {
	const heights = new Float32Array(width * height);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) heights[y * width + x] = at(x, y);
	return heights;
}

/**
 * The slope of a height field at a texel, from the texels beside it, with the field wrapping at the
 * block's rim where `wrap` says so.
 */
function slope(
	heights: Float32Array,
	width: number,
	height: number,
	x: number,
	y: number,
	bump: number,
	wrap: boolean,
): [number, number] {
	const left = wrap ? (x + width - 1) % width : Math.max(0, x - 1);
	const right = wrap ? (x + 1) % width : Math.min(width - 1, x + 1);
	const down = wrap ? (y + height - 1) % height : Math.max(0, y - 1);
	const up = wrap ? (y + 1) % height : Math.min(height - 1, y + 1);
	const dx = (heights[y * width + right] ?? 0) - (heights[y * width + left] ?? 0);
	const dy = (heights[up * width + x] ?? 0) - (heights[down * width + x] ?? 0);
	const across = right - left || 1;
	const along = up - down || 1;
	return [(-dx * bump) / across, (-dy * bump) / along];
}

/**
 * Paints the bark's two maps: its colour as a factor around white, and a surface of the normal and
 * the roughness that lies under it.
 *
 * @returns The colour and the surface map.
 */
export function paintBark(): PaintedAtlas {
	const size = BARK_SIZE;
	const color = new Uint8Array(size * size * 4);
	const surface = new Uint8Array(size * size * 4);
	const heights = heightField(size, size, (x, y) => barkHeight(x / size, y / size));
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const u = x / size;
			const v = y / size;
			const [, , near] = barkPlates(u, v);
			const tint = barkColorAt(u, v, heights[y * size + x] ?? 0, near);
			const at = (y * size + x) * 4;
			color[at] = encode(tint[0]);
			color[at + 1] = encode(tint[1]);
			color[at + 2] = encode(tint[2]);
			color[at + 3] = 255;
			const [nx, ny] = slope(heights, size, size, x, y, BUMP_BARK * size, true);
			const length = Math.hypot(nx, ny, 1);
			const roughness = 0.72 + 0.25 * fbm2(u * 40, v * 5, 2);
			surface[at] = Math.round(clamp((nx / length) * 0.5 + 0.5, 0, 1) * 255);
			surface[at + 1] = Math.round(clamp((ny / length) * 0.5 + 0.5, 0, 1) * 255);
			surface[at + 2] = Math.round(clamp(roughness, 0, 1) * 255);
			surface[at + 3] = 255;
		}
	return {
		color: { width: size, height: size, data: color },
		surface: { width: size, height: size, data: surface },
	};
}

/** Where a leaf texel lands in its own cell: which cell, and the place within it. */
function leafCellOf(x: number, y: number): [number, number, number] {
	const kind = Math.floor(y / LEAF_CELL) * LEAF_CELLS_X + Math.floor(x / LEAF_CELL);
	return [kind, (x % LEAF_CELL) / LEAF_CELL, (y % LEAF_CELL) / LEAF_CELL];
}

/**
 * Paints the leaf's two maps: each leaf's colour as a factor around white, and a surface of the
 * normal, the leaf's coverage and its thickness.
 *
 * @returns The colour and the surface map.
 */
export function paintLeaf(): PaintedAtlas {
	const width = LEAF_WIDTH;
	const height = LEAF_HEIGHT;
	const color = new Uint8Array(width * height * 4);
	const surface = new Uint8Array(width * height * 4);
	const leaves: LeafPoint[] = new Array(width * height);
	const heights = new Float32Array(width * height);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const [kind, cardX, cardY] = leafCellOf(x, y);
			const leaf = leafCellAt(kind, cardX, cardY);
			const at = y * width + x;
			leaves[at] = leaf;
			heights[at] = leaf.height;
		}
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * 4;
			const leaf = leaves[y * width + x] as LeafPoint;
			color[at] = encode(leaf.color[0]);
			color[at + 1] = encode(leaf.color[1]);
			color[at + 2] = encode(leaf.color[2]);
			color[at + 3] = 255;
			const [nx, ny] = slope(heights, width, height, x, y, BUMP_LEAF * LEAF_CELL, false);
			const length = Math.hypot(nx, ny, 1);
			surface[at] = Math.round(clamp((nx / length) * 0.5 + 0.5, 0, 1) * 255);
			surface[at + 1] = Math.round(clamp((ny / length) * 0.5 + 0.5, 0, 1) * 255);
			surface[at + 2] = Math.round(clamp(leaf.alpha, 0, 1) * 255);
			surface[at + 3] = Math.round(clamp(leaf.alpha, 0, 1) * 0.8 * 255);
		}
	return {
		color: { width, height, data: color },
		surface: { width, height, data: surface },
	};
}
