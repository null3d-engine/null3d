// The pixels of the bark and leaf atlases, made in the browser the first time a page asks for them.
// A page ships no image file: these functions paint the same atlas on every device, from integer
// hashes alone, so no texture is downloaded and none differs between machines.
//
// Bark is stretched Voronoi plates warped by fractal noise, with cracks between them and fibres up
// the trunk. A leaf comes from an outline with veins written into a height field, and the gradient
// of that field gives the normal map. Each cell holds a spray of leaves that differ in outline,
// colour and veins, and one in five of them has lost a piece of its edge, so a crown does not read
// as a tiled pattern. Each atlas has a colour map, whose values multiply the species' own colour,
// and a surface map that holds the normal, the bark's roughness or the leaf's coverage, and the
// leaf's thickness.

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

/** The most leaves or needles that one card draws. */
const MAX_LEAVES = 40;
/** How wide a leaf's outline fades out at its edge, in fractions of a cell. */
const LEAF_EDGE = 0.006;
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

/** How a leaf family's outline is cut, before each leaf's own variation. */
interface LeafFamily {
	/** The width profile, as `sin(pi * t ** profile)`: 0.5 is widest at the leaf's middle. */
	readonly profile: number;
	/** How wide a leaf grows against its length. */
	readonly aspect: number;
	/** How many teeth each edge carries, and how deep they cut. */
	readonly teeth: number;
	readonly toothDepth: number;
	/** How many lobes each edge carries, and how deep their sinuses cut. */
	readonly lobes: number;
	readonly lobeDepth: number;
	/** How many veins each half of the blade carries. */
	readonly veins: number;
}

/** The families that the cells' leaves grow from. */
const FAMILIES = {
	oak: {
		profile: 1.3,
		aspect: 0.28,
		teeth: 8,
		toothDepth: 0.05,
		lobes: 5,
		lobeDepth: 0.4,
		veins: 5,
	},
	beech: {
		profile: 0.85,
		aspect: 0.25,
		teeth: 13,
		toothDepth: 0.1,
		lobes: 0,
		lobeDepth: 0,
		veins: 6,
	},
	birch: {
		profile: 0.95,
		aspect: 0.28,
		teeth: 10,
		toothDepth: 0.14,
		lobes: 0,
		lobeDepth: 0,
		veins: 5,
	},
	willow: {
		profile: 1.15,
		aspect: 0.17,
		teeth: 15,
		toothDepth: 0.09,
		lobes: 0,
		lobeDepth: 0,
		veins: 7,
	},
	pinna: {
		profile: 0.9,
		aspect: 0.22,
		teeth: 6,
		toothDepth: 0.1,
		lobes: 2,
		lobeDepth: 0.2,
		veins: 3,
	},
	needle: { profile: 1, aspect: 0.1, teeth: 0, toothDepth: 0, lobes: 0, lobeDepth: 0, veins: 1 },
	blade: { profile: 1, aspect: 0.06, teeth: 0, toothDepth: 0, lobes: 0, lobeDepth: 0, veins: 3 },
	hosta: {
		profile: 0.55,
		aspect: 0.42,
		teeth: 0,
		toothDepth: 0,
		lobes: 9,
		lobeDepth: 0.08,
		veins: 8,
	},
} satisfies Record<string, LeafFamily>;

/** One leaf's outline, its veins and its colour: no two leaves of a card share them. */
interface LeafShape extends LeafFamily {
	/** How far the midrib bows to one side, against the leaf's length. */
	readonly bend: number;
	/** How much narrower one side of the midrib grows than the other. */
	readonly skew: number;
	/** How far the veins stand out of the blade. */
	readonly veinStrength: number;
	/** The brightness of the leaf's own colour, and how far it leans from green to yellow. */
	readonly brightness: number;
	readonly warmth: number;
	/** How much light the leaf's body lets through. */
	readonly thickness: number;
}

/** One leaf's shape, from its family and a seed of its own. */
function leafShape(seed: number, family: LeafFamily): LeafShape {
	const at = (key: number) => random2(seed, key);
	return {
		profile: family.profile * (0.9 + 0.2 * at(1)),
		aspect: family.aspect * (0.85 + 0.3 * at(2)),
		teeth: Math.round(family.teeth * (0.75 + 0.5 * at(3))),
		toothDepth: family.toothDepth * (0.6 + 0.8 * at(4)),
		lobes: family.lobes,
		lobeDepth: family.lobeDepth * (0.75 + 0.5 * at(5)),
		veins: Math.max(2, Math.round(family.veins * (0.7 + 0.6 * at(6)))),
		bend: (at(7) * 2 - 1) * 0.08,
		skew: (at(8) * 2 - 1) * 0.08,
		veinStrength: 0.5 + 0.5 * at(9),
		brightness: 0.55 + 0.55 * at(10),
		warmth: (at(11) * 2 - 1) * 0.75,
		thickness: 0.55 + 0.3 * at(12),
	};
}

/** One leaf placed on a card: where it is seated, the way it points and how far it grows. */
interface PlacedLeaf {
	readonly shape: LeafShape;
	/** Where the leaf's base sits on the card, from its bottom left corner. */
	readonly baseX: number;
	readonly baseY: number;
	/** The midrib's direction from the card's up axis, turned to the right, as its sine and cosine. */
	readonly sin: number;
	readonly cos: number;
	/** The leaf's length along its midrib, against the cell's width. */
	readonly length: number;
	/** The bite that damage takes from one edge: along, across and radius, as fractions of the length. */
	readonly bite: readonly [number, number, number] | null;
	/** The box that the leaf's outline cannot reach past, as its left, bottom, right and top. */
	readonly box: readonly [number, number, number, number];
	/** A number of the leaf, so its blotches differ from those of the leaves beside it. */
	readonly seed: number;
}

/** Places one leaf of a family at a point, at an angle from the card's up axis. */
function placeLeaf(
	seed: number,
	family: LeafFamily,
	baseX: number,
	baseY: number,
	angle: number,
	length: number,
): PlacedLeaf {
	const shape = leafShape(seed, family);
	// One leaf in five has lost a piece of its edge, so a crown never reads as a tiled pattern.
	const side = random2(seed, 22) < 0.5 ? -1 : 1;
	const bite: readonly [number, number, number] | null =
		random2(seed, 21) < 0.22
			? [
					0.35 + 0.4 * random2(seed, 23),
					side * length * shape.aspect * (0.55 + 0.35 * random2(seed, 24)),
					(0.07 + 0.05 * random2(seed, 25)) * length,
				]
			: null;
	const sin = Math.sin(angle);
	const cos = Math.cos(angle);
	// The leaf cannot reach past the box around its own base, tip and widest points.
	const half = length * shape.aspect * (1 + Math.abs(shape.skew));
	const reach = Math.abs(shape.bend) * length + half + 0.01;
	const tipX = baseX + sin * length;
	const tipY = baseY + cos * length;
	return {
		shape,
		baseX,
		baseY,
		sin,
		cos,
		length,
		bite,
		box: [
			Math.min(baseX, tipX) - reach,
			Math.min(baseY, tipY) - reach,
			Math.max(baseX, tipX) + reach,
			Math.max(baseY, tipY) + reach,
		],
		seed,
	};
}

/** How wide a leaf grows at a point along its midrib, against its own half width. */
function leafHalfWidth(shape: LeafShape, t: number): number {
	if (t <= 0 || t >= 1) return 0;
	const envelope = Math.sqrt(Math.sin(Math.PI * t));
	// The profile rounds the leaf's tip and base rather than cutting them to points.
	let width = Math.sin(Math.PI * t ** shape.profile) ** 0.7;
	if (shape.teeth > 0)
		width *= 1 + shape.toothDepth * (teethWave(t * shape.teeth) - 0.4) * envelope;
	if (shape.lobes > 0) {
		const lobe = 0.5 + 0.5 * Math.cos(2 * Math.PI * t * shape.lobes);
		width *= 1 - shape.lobeDepth * (1 - lobe) * envelope;
	}
	return Math.max(width, 0);
}

/** The triangle wave of a leaf's teeth: 0 in a sinus, 1 at a tooth's point. */
function teethWave(value: number): number {
	const part = value - Math.floor(value);
	return 1 - 2 * Math.abs(part - 0.5);
}

/** How wide one leaf grows at a point of it, against the cell's width, on the side that it lies. */
function leafWidth(leaf: PlacedLeaf, t: number, across: number): number {
	const skew = across < 0 ? -leaf.shape.skew : leaf.shape.skew;
	return leafHalfWidth(leaf.shape, t) * leaf.shape.aspect * leaf.length * (1 + skew);
}

/** Where a point of a card lies in one leaf, and how far it lies outside that leaf's outline. */
interface LeafSpot {
	/** How far the point lies towards the leaf's tip, from 0 at its base to 1 at its tip. */
	readonly t: number;
	/** How far the point lies from the midrib, against the leaf's half width there. */
	readonly across: number;
	/** How far the point lies outside the outline, as a fraction of the cell's width. */
	readonly distance: number;
}

/** A point of a card in the frame of one leaf of it. */
function leafSpotAt(leaf: PlacedLeaf, cardX: number, cardY: number): LeafSpot {
	const dx = cardX - leaf.baseX;
	const dy = cardY - leaf.baseY;
	const along = dx * leaf.sin + dy * leaf.cos;
	const t = along / leaf.length;
	// The midrib bows towards one side as a leaf grows, so the leaves of a card read as curved.
	const across =
		dx * leaf.cos -
		dy * leaf.sin -
		leaf.shape.bend * leaf.length * Math.sin(Math.PI * clamp(t, 0, 1));
	const width = leafWidth(leaf, t, across);
	let distance = Math.max(Math.abs(across) - width, -along, along - leaf.length);
	const bite = leaf.bite;
	if (bite !== null)
		distance = Math.max(
			distance,
			bite[2] - Math.hypot(across - bite[1], along - bite[0] * leaf.length),
		);
	return { t, across: width > 1e-6 ? across / width : 2, distance };
}

/** How far a point of a card lies outside one leaf, which the cell's painter compares. */
function leafDistance(leaf: PlacedLeaf, cardX: number, cardY: number): number {
	// A leaf reaches no further from its base than a box around its own outline, so a point outside
	// that box costs one comparison instead of the whole outline.
	if (
		cardX < (leaf.box[0] as number) ||
		cardY < (leaf.box[1] as number) ||
		cardX > (leaf.box[2] as number) ||
		cardY > (leaf.box[3] as number)
	)
		return 1;
	return leafSpotAt(leaf, cardX, cardY).distance;
}

/** One leaf's paint at a point of it: its colour factor, the height of its blade, its thickness. */
interface LeafPaint {
	readonly color: readonly [number, number, number];
	readonly height: number;
	readonly thickness: number;
}

/** The paint of one leaf at a point of it: its veins, its surface and the colour of its blade. */
function leafPaint(leaf: PlacedLeaf, cardX: number, cardY: number, spot: LeafSpot): LeafPaint {
	const shape = leaf.shape;
	const edge = clamp(spot.across, 0, 1);
	// The veins run from the midrib out towards the tip. Each leaf carries its own number and its own
	// strength, so two leaves of one card never show the same markings.
	const phase = spot.t * shape.veins - edge * 0.9;
	const part = phase - Math.floor(phase);
	const vein =
		(1 - smoothstep(0, 0.12, Math.min(part, 1 - part))) *
		(1 - smoothstep(0.72, 1, edge)) *
		smoothstep(0.04, 0.2, spot.t);
	const midrib = line(spot.across, 0.12);
	const height =
		0.42 +
		0.3 * (1 - edge * edge) -
		0.14 * smoothstep(0.82, 1, edge) +
		0.3 * midrib +
		0.22 * shape.veinStrength * vein +
		0.12 * (spot.t - 0.5);
	// The tip catches more light, a slow blotch mottles the blade, and the rim darkens so that two
	// leaves that overlap still read apart.
	const blotch = 0.84 + 0.3 * value2(cardX * 6 + leaf.seed * 7.3, cardY * 6 + leaf.seed * 3.1);
	const rim = 1 - 0.58 * smoothstep(0.72, 1, edge);
	const light =
		shape.brightness *
		(0.84 + 0.26 * spot.t) *
		(0.82 + 0.18 * smoothstep(0, 0.3, spot.t)) *
		blotch *
		rim;
	const shade = light * (1 - 0.14 * vein) + 0.12 * midrib * light;
	// Each leaf leans towards yellow or towards a deeper green, and a slow blotch shifts its hue
	// again, so one leaf is not one flat colour.
	const hue = value2(cardX * 3 + leaf.seed * 11.7, cardY * 3 + leaf.seed * 5.3) - 0.5;
	const warmth = clamp(shape.warmth + hue * 0.5, -1, 1);
	const red = shade * (1 + 0.16 * warmth);
	const blue = shade * (1 - 0.24 * warmth);
	// The brightest channel is kept at or below white, so a warm leaf shows its hue instead of
	// clipping to a pastel.
	const top = Math.max(red, shade, blue);
	const norm = top > 1 ? 1 / top : 1;
	return {
		color: [red * norm, shade * norm, blue * norm],
		height,
		thickness: shape.thickness * (1 - 0.3 * edge),
	};
}

/** One leaf cell's point: its colour as a factor around white, its coverage, height and thickness. */
interface LeafPoint {
	color: readonly [number, number, number];
	alpha: number;
	height: number;
	thickness: number;
}

/** What one cell of the leaf block paints at a point of itself. */
interface LeafCellPainter {
	readonly at: (cardX: number, cardY: number) => LeafPoint;
}

/** A texel that holds no leaf: the painter fills its colour and height from the cell's mean. */
const EMPTY_CELL_POINT: LeafPoint = { color: [1, 1, 1], alpha: 0, height: 0.5, thickness: 0.6 };

/** How far a point of a card lies outside the stem that runs up its middle. */
function stemDistance(cardX: number, cardY: number, lean: number, half: number): number {
	const along = 0.5 + lean * Math.sin(Math.PI * cardY) - cardX;
	return Math.abs(along) - half * (1 - 0.4 * cardY);
}

/** A point of the stem: a dark twig that the card's leaves grow from. */
function stemPoint(distance: number, cardY: number): LeafPoint {
	const shade = 0.5 + 0.12 * cardY;
	return {
		color: [shade, shade * 1.12, shade * 0.72],
		alpha: cover(distance, LEAF_EDGE),
		height: 0.3 + 0.12 * cardY,
		thickness: 0.5,
	};
}

/** Paints a cell from its leaves and the stem that carries them, or from its leaves alone. */
function leafSpray(leaves: readonly PlacedLeaf[], stem: number | null): LeafCellPainter {
	return {
		at(cardX, cardY) {
			let winner: PlacedLeaf | null = null;
			let nearest = 1;
			let covers = 0;
			for (const leaf of leaves) {
				const distance = leafDistance(leaf, cardX, cardY);
				if (distance < 0) covers += 1;
				if (distance < nearest) {
					nearest = distance;
					winner = leaf;
				}
			}
			if (stem !== null) {
				const distance = stemDistance(cardX, cardY, stem, 0.007);
				if (distance < nearest) return stemPoint(distance, cardY);
			}
			if (winner === null) return EMPTY_CELL_POINT;
			const spot = leafSpotAt(winner, cardX, cardY);
			const paint = leafPaint(winner, cardX, cardY, spot);
			// A leaf darkens where another leaf lies over it, as a pile of leaves shades itself. Without
			// that shade, two overlapping leaves of one tone read as one shape.
			const shade = 1 - 0.14 * Math.min(covers - 1, 2);
			return {
				color: [paint.color[0] * shade, paint.color[1] * shade, paint.color[2] * shade],
				alpha: cover(spot.distance, LEAF_EDGE),
				height: paint.height,
				thickness: paint.thickness,
			};
		},
	};
}

/** How a spray of leaves fills a card. */
interface SprayOptions {
	/** How many leaves the spray carries. */
	readonly count: number;
	/** Where the first and the last leaf are seated along the card, from its base to its tip. */
	readonly from: number;
	readonly to: number;
	/** The angle from the card's up axis that the first and the last leaf lean out by. */
	readonly lean: readonly [number, number];
	/** The length of the first and the last leaf, against the cell's width. */
	readonly length: readonly [number, number];
	/** How far the leaves' bases sit either side of the stem. */
	readonly spread: number;
}

/** Places a spray of leaves along a card, alternating the sides that they grow from. */
function sprayLeaves(seed: number, family: LeafFamily, options: SprayOptions): PlacedLeaf[] {
	const leaves: PlacedLeaf[] = [];
	const count = Math.min(options.count, MAX_LEAVES);
	for (let i = 0; i < count; i++) {
		const f = count > 1 ? i / (count - 1) : 0.5;
		const key = seed * 131 + i;
		const side = (i & 1) === 0 ? 1 : -1;
		const along = options.from + (options.to - options.from) * f + (random2(key, 3) - 0.5) * 0.07;
		const lean = options.lean[0] + (options.lean[1] - options.lean[0]) * f;
		const length =
			(options.length[0] + (options.length[1] - options.length[0]) * f) *
			(0.9 + 0.2 * random2(key, 4));
		leaves.push(
			placeLeaf(
				key,
				family,
				0.5 + side * options.spread * random2(key, 5),
				along,
				side * (lean + 0.3 * (random2(key, 6) - 0.5)),
				length,
			),
		);
	}
	return leaves;
}

/** A clump of grass blades that rise from the bottom of a card and fan out. */
function clumpCell(seed: number): LeafCellPainter {
	const leaves: PlacedLeaf[] = [];
	for (let i = 0; i < 11; i++) {
		const key = seed * 131 + i;
		const f = (i - 5) / 5;
		leaves.push(
			placeLeaf(
				key,
				FAMILIES.blade,
				0.5 + f * 0.13,
				0.02,
				f * 0.38 + (random2(key, 6) - 0.5) * 0.2,
				0.82 + 0.16 * random2(key, 4) - 0.1 * Math.abs(f),
			),
		);
	}
	return leafSpray(leaves, null);
}

/** A broad leaf that fills its cell, with a smaller one behind it so the cell is not one cut-out. */
function broadCell(seed: number): LeafCellPainter {
	return leafSpray(
		[
			placeLeaf(seed + 3, FAMILIES.hosta, 0.6, 0.05, -0.3, 0.5),
			placeLeaf(seed, FAMILIES.hosta, 0.48, 0.03, 0.05, 0.9),
		],
		null,
	);
}

/** The eight cells of the leaf block, in the order that the atlas lays them out. */
function leafCells(): LeafCellPainter[] {
	return [
		// Four sprays of broadleaves, each a different outline: an oak's lobes, a beech's fine teeth, a
		// birch's small teeth and a willow's long narrow blade.
		leafSpray(
			sprayLeaves(11, FAMILIES.oak, {
				count: 11,
				from: 0.05,
				to: 0.95,
				lean: [0.95, 1.4],
				length: [0.42, 0.28],
				spread: 0.05,
			}),
			0.03,
		),
		leafSpray(
			sprayLeaves(23, FAMILIES.beech, {
				count: 12,
				from: 0.05,
				to: 0.95,
				lean: [1, 1.45],
				length: [0.36, 0.25],
				spread: 0.05,
			}),
			0.02,
		),
		leafSpray(
			sprayLeaves(37, FAMILIES.birch, {
				count: 13,
				from: 0.04,
				to: 0.96,
				lean: [1.05, 1.5],
				length: [0.32, 0.22],
				spread: 0.05,
			}),
			0.03,
		),
		leafSpray(
			sprayLeaves(41, FAMILIES.willow, {
				count: 10,
				from: 0.05,
				to: 0.95,
				lean: [0.95, 1.35],
				length: [0.46, 0.3],
				spread: 0.05,
			}),
			0.03,
		),
		// A conifer's needle spray, a fern's frond, a clump of grass blades and a broad leaf.
		leafSpray(
			sprayLeaves(53, FAMILIES.needle, {
				count: 28,
				from: 0.06,
				to: 0.96,
				lean: [1.2, 0.8],
				length: [0.3, 0.1],
				spread: 0.01,
			}),
			0.012,
		),
		leafSpray(
			sprayLeaves(67, FAMILIES.pinna, {
				count: 22,
				from: 0.08,
				to: 0.94,
				lean: [1.35, 1.25],
				length: [0.3, 0.1],
				spread: 0.01,
			}),
			0.01,
		),
		clumpCell(73),
		broadCell(83),
	];
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
	const cells = leafCells();
	const leaves: LeafPoint[] = new Array(width * height);
	const heights = new Float32Array(width * height);
	// What each cell's leaves average. A texel that holds no leaf takes that colour and that height,
	// so a mip level that averages the cell keeps the leaves' hue, and no silhouette edge makes a
	// step that the normal map would bend.
	const meanColor = new Float64Array(cells.length * 3);
	const meanHeight = new Float64Array(cells.length);
	const counted = new Float64Array(cells.length);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const [kind, cardX, cardY] = leafCellOf(x, y);
			const leaf = (cells[kind] as LeafCellPainter).at(cardX, cardY);
			leaves[y * width + x] = leaf;
			if (leaf.alpha <= 0.5) continue;
			const sum = kind * 3;
			meanColor[sum] = (meanColor[sum] ?? 0) + leaf.color[0];
			meanColor[sum + 1] = (meanColor[sum + 1] ?? 0) + leaf.color[1];
			meanColor[sum + 2] = (meanColor[sum + 2] ?? 0) + leaf.color[2];
			meanHeight[kind] = (meanHeight[kind] ?? 0) + leaf.height;
			counted[kind] = (counted[kind] ?? 0) + 1;
		}
	for (let kind = 0; kind < cells.length; kind++) {
		const count = Math.max(1, counted[kind] ?? 0);
		for (let channel = 0; channel < 3; channel++)
			meanColor[kind * 3 + channel] = (meanColor[kind * 3 + channel] ?? 0) / count;
		meanHeight[kind] = (meanHeight[kind] ?? 0) / count;
	}
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const [kind] = leafCellOf(x, y);
			const at = y * width + x;
			const leaf = leaves[at] as LeafPoint;
			const covered = leaf.alpha > 0;
			const tint: readonly [number, number, number] = covered
				? leaf.color
				: [meanColor[kind * 3] ?? 1, meanColor[kind * 3 + 1] ?? 1, meanColor[kind * 3 + 2] ?? 1];
			heights[at] = covered ? leaf.height : (meanHeight[kind] ?? 0.5);
			leaves[at] = {
				color: tint,
				alpha: leaf.alpha,
				height: heights[at] ?? 0.5,
				thickness: leaf.thickness,
			};
			const texel = at * 4;
			color[texel] = encode(tint[0]);
			color[texel + 1] = encode(tint[1]);
			color[texel + 2] = encode(tint[2]);
			color[texel + 3] = 255;
		}
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const at = (y * width + x) * 4;
			const leaf = leaves[y * width + x] as LeafPoint;
			const [nx, ny] = slope(heights, width, height, x, y, BUMP_LEAF * LEAF_CELL, false);
			const length = Math.hypot(nx, ny, 1);
			surface[at] = Math.round(clamp((nx / length) * 0.5 + 0.5, 0, 1) * 255);
			surface[at + 1] = Math.round(clamp((ny / length) * 0.5 + 0.5, 0, 1) * 255);
			surface[at + 2] = Math.round(clamp(leaf.alpha, 0, 1) * 255);
			surface[at + 3] = Math.round(clamp(leaf.alpha * leaf.thickness, 0, 1) * 255);
		}
	return {
		color: { width, height, data: color },
		surface: { width, height, data: surface },
	};
}
