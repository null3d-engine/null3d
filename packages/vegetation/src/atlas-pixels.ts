import type { BarkCellName } from './species';

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

/** A painted map: its size in texels and four bytes per texel, rows from the top.
 *
 * @category api/vegetation
 */
export interface AtlasPixels {
	/** Texels across. */
	readonly width: number;
	/** Rows down. */
	readonly height: number;
	/** Four bytes per texel, the first row first. */
	readonly data: Uint8Array;
}

/** How many texels one bark cell is across and down. Each cell tiles about a branch. */
export const BARK_SIZE = 256;
/** How many bark cells the block holds across and down: one painter for each bark family. */
export const BARK_CELLS_X = 4;
export const BARK_CELLS_Y = 2;
/** The bark block's size in texels, its cells together. */
export const BARK_WIDTH = BARK_CELLS_X * BARK_SIZE;
export const BARK_HEIGHT = BARK_CELLS_Y * BARK_SIZE;
/** How many cells the leaf block holds across and down. */
export const LEAF_CELLS_X = 6;
export const LEAF_CELLS_Y = 2;
/** How many texels one leaf cell is across and down. */
export const LEAF_CELL = 256;
/** The leaf block's size in texels. */
export const LEAF_WIDTH = LEAF_CELLS_X * LEAF_CELL;
export const LEAF_HEIGHT = LEAF_CELLS_Y * LEAF_CELL;

/** The most leaves or needles that one card draws. */
const MAX_LEAVES = 72;
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
	/** How many lobes radiate from the leaf's base; absent or zero for an outline along the midrib. */
	readonly palmate?: number;
	/** How deep the sinuses of a palmate leaf cut, as a share of its reach. */
	readonly sinus?: number;
	/** How many veins each half of the blade carries. */
	readonly veins: number;
	/**
	 * True for a blade whose outline is a circle, which an aspen's leaf nearly is. The profile then
	 * gives way, because `sin` holds its width too long at the base and the tip.
	 */
	readonly circle?: boolean;
	/** The share of the blade that forms its point, narrowing to nothing instead of rounding. */
	readonly tip?: number;
	/** False for a family whose reference leaves have unbroken margins, with no feeding damage. */
	readonly bites?: boolean;
	/** How far the veins stand out of the blade, against the usual depth. The default is 1. */
	readonly veinDepth?: number;
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
	// A cell of smooth, entire oval leaves, for the live oak and the evergreen oaks.
	beech: {
		profile: 0.7,
		aspect: 0.3,
		teeth: 0,
		toothDepth: 0,
		lobes: 0,
		lobeDepth: 0,
		veins: 6,
	},
	// A live oak's leaf: small, stiff, oblong to oval, with an entire margin and a pale midrib.
	liveoak: {
		profile: 0.9,
		aspect: 0.26,
		teeth: 0,
		toothDepth: 0,
		lobes: 0,
		lobeDepth: 0,
		veins: 5,
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
	// A wavy margin: many shallow teeth, so the edge undulates rather than cutting.
	wavy: {
		profile: 0.78,
		aspect: 0.3,
		teeth: 22,
		toothDepth: 0.035,
		lobes: 0,
		lobeDepth: 0,
		veins: 6,
	},
	// A maple's leaf: five lobes whose sinuses cut towards the base, so the outline is a hand rather
	// than a blade with wavy edges.
	palmate: {
		profile: 1,
		aspect: 0.46,
		teeth: 0,
		toothDepth: 0,
		lobes: 0,
		lobeDepth: 0,
		veins: 5,
		palmate: 5,
		sinus: 0.5,
	},
	// A small round leaf, nearly as wide as it is long, on a flattened stalk.
	round: {
		profile: 0.55,
		aspect: 0.34,
		teeth: 0,
		toothDepth: 0,
		lobes: 0,
		lobeDepth: 0,
		veins: 4,
	},
	// A quaking aspen's leaf: a blade as wide as it is long, its margin cut by fine even teeth, and
	// a short abrupt point where the midrib runs out.
	aspen: {
		profile: 1,
		aspect: 0.52,
		teeth: 26,
		toothDepth: 0.045,
		lobes: 0,
		lobeDepth: 0,
		veins: 6,
		circle: true,
		tip: 0.09,
		bites: false,
		veinDepth: 0.5,
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
	// A spruce's needle: short, narrow and smooth, widest near its base and tapering to a point, so
	// a rank of them reads as needles rather than as the fringe of a blade.
	needle: {
		profile: 1.9,
		aspect: 0.0625,
		teeth: 0,
		toothDepth: 0,
		lobes: 0,
		lobeDepth: 0,
		veins: 1,
		// A needle carries no visible vein, so its blade stays smooth rather than leaf-like.
		veinDepth: 0.2,
	},
	// A pine's needle: a long, narrow blade in pairs, about twenty times its own width, with no
	// visible vein so the pair reads as needles rather than as a fern.
	fascicle: {
		profile: 1.6,
		aspect: 0.038,
		teeth: 0,
		toothDepth: 0,
		lobes: 0,
		lobeDepth: 0,
		veins: 0,
		veinDepth: 0.15,
	},
	blade: { profile: 1, aspect: 0.06, teeth: 0, toothDepth: 0, lobes: 0, lobeDepth: 0, veins: 3 },
	// The papery sheath at a pine fascicle's base: short, broad and pale.
	sheath: { profile: 0.6, aspect: 0.3, teeth: 0, toothDepth: 0, lobes: 0, lobeDepth: 0, veins: 0 },
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
	/** The brightness of the leaf's own colour, and how much that brightness varies. */
	readonly brightness: number;
	readonly variation: number;
	/** The palmate lobes, or zero for a leaf measured across its midrib, and their sinus depth. */
	readonly palmate: number;
	readonly sinus: number;
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
		variation: (at(11) * 2 - 1) * 0.75,
		palmate: family.palmate ?? 0,
		sinus: family.sinus ?? 0.45,
		// The outline's own switches ride through, or a family that asks for a circle, a point or a
		// smooth blade would paint the ordinary outline and nothing would say so.
		circle: family.circle === true,
		tip: family.tip ?? 0,
		veinDepth: family.veinDepth ?? 1,
		bites: family.bites,
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
		family.bites !== false && random2(seed, 21) < 0.22
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
	// The profile rounds the leaf's tip and base rather than cutting them to points. A circular
	// blade takes the circle's own half width instead, because the profile holds its width too long
	// at either end and reads as an ovate leaf rather than a round one.
	let width = shape.circle
		? 2 * Math.sqrt(t * (1 - t))
		: Math.sin(Math.PI * t ** shape.profile) ** 0.7;
	// A leaf that ends in a point keeps the circle until the point begins, then narrows straight to
	// the tip: an aspen's short acuminate point, not a rounded end.
	const tip = shape.tip ?? 0;
	if (tip > 0 && t > 1 - tip) width *= (1 - t) / tip;
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
	let distance: number;
	let scale: number;
	if (leaf.shape.palmate > 0) {
		// A palmate leaf's outline is a reach from its base at each angle, so its lobes radiate
		// rather than run along the midrib. Each lobe peaks where the wave peaks, and a sinus
		// between two lobes cuts the reach by the leaf's own depth.
		const reachAngle = Math.atan2(across, Math.max(1e-6, along));
		const spread = 1.2;
		const u = clamp((reachAngle + spread) / (2 * spread), 0, 1);
		const wave = 0.5 + 0.5 * Math.cos(2 * Math.PI * (leaf.shape.palmate - 1) * u);
		const reach =
			leaf.length *
			(1 - 0.22 * (Math.abs(reachAngle) / spread) ** 2) *
			(1 - leaf.shape.sinus * (1 - wave));
		// Beyond the palmate spread there is no leaf, so a sideways point cannot take the end lobe's
		// reach for a base.
		distance = Math.abs(reachAngle) > spread ? 1 : Math.hypot(along, across) - Math.max(0, reach);
		scale = Math.max(1e-6, leaf.length * leaf.shape.aspect);
	} else {
		const width = leafWidth(leaf, t, across);
		distance = Math.max(Math.abs(across) - width, -along, along - leaf.length);
		scale = width;
	}
	const bite = leaf.bite;
	if (bite !== null)
		distance = Math.max(
			distance,
			bite[2] - Math.hypot(across - bite[1], along - bite[0] * leaf.length),
		);
	return { t, across: scale > 1e-6 ? across / scale : 2, distance };
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
		0.22 * (shape.veinDepth ?? 1) * shape.veinStrength * vein +
		0.12 * (spot.t - 0.5);
	// The tip catches more light and a slow blotch mottles the blade. The rim darkens a little, so
	// two leaves that overlap still read apart: a deep band turns every edge of a distant crown
	// into a dark speckle, so the fall is shallow and starts close to the outline.
	const blotch = 0.84 + 0.3 * value2(cardX * 6 + leaf.seed * 7.3, cardY * 6 + leaf.seed * 3.1);
	const rim = 1 - 0.24 * smoothstep(0.86, 1, edge);
	const light =
		shape.brightness *
		(0.84 + 0.26 * spot.t) *
		(0.82 + 0.18 * smoothstep(0, 0.3, spot.t)) *
		blotch *
		rim;
	const shade = light * (1 - 0.14 * vein) + 0.12 * midrib * light;
	// Each leaf varies in brightness and not in hue. The atlas serves every species colour, so the
	// variation has no channel of its own to lean toward: a blue leaf varies toward a paler blue,
	// and a green one toward a paler green. A slow blotch moves the brightness again, so one leaf
	// is not one flat tone.
	const blotchHue = value2(cardX * 3 + leaf.seed * 11.7, cardY * 3 + leaf.seed * 5.3) - 0.5;
	const variation = clamp(shape.variation + blotchHue * 0.5, -1, 1);
	const lean = 1 + 0.18 * variation;
	const red = shade * lean;
	const blue = shade * lean;
	const green = shade * lean;
	// The brightest channel is kept at or below white, so a bright leaf keeps its tint instead of
	// clipping to a pastel.
	const top = Math.max(red, green, blue);
	const norm = top > 1 ? 1 / top : 1;
	return {
		color: [red * norm, green * norm, blue * norm],
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

/** How wide a cell fades out at its edge, as a share of the cell. */
const RIM_FADE = 0.02;

/**
 * The card's coverage at its rim, which falls to nothing at the cell's edge. A leaf that grows past
 * the edge is cut there, and without the fall its cut is a straight line that a crown shows as a
 * seam along the card's border.
 */
function cellRim(cardX: number, cardY: number): number {
	const across = smoothstep(0, RIM_FADE, Math.min(cardX, 1 - cardX));
	const up = smoothstep(0, RIM_FADE, Math.min(cardY, 1 - cardY));
	return across * up;
}

/** How far a point of a card lies outside the stem that runs up its middle. */
function stemDistance(cardX: number, cardY: number, lean: number, half: number): number {
	const along = 0.5 + lean * Math.sin(Math.PI * cardY) - cardX;
	return Math.abs(along) - half * (1 - 0.4 * cardY);
}

/** A point of the stem: a dark twig that the card's leaves grow from. */
function stemPoint(distance: number, cardY: number): LeafPoint {
	const shade = 0.5 + 0.12 * cardY;
	return {
		// The stem is a neutral tone, so it takes the species' own colour as the leaves do.
		color: [shade, shade, shade],
		alpha: cover(distance, LEAF_EDGE),
		height: 0.3 + 0.12 * cardY,
		thickness: 0.5,
	};
}

/** How many tiles across and down a cell sorts its leaves into, for the painter's lookup. */
const CELL_TILES = 16;

/** The tile of a cell that holds a coordinate, from 0 to the last tile. */
function tileOf(value: number): number {
	return Math.min(CELL_TILES - 1, Math.max(0, Math.floor(value * CELL_TILES)));
}

/**
 * The leaves of a spray sorted into square tiles of the cell, so a texel tests the leaves that can
 * reach it rather than all of them. A leaf reaches no further than its own box, so the rest cost
 * nothing, and a cell of many leaves paints in the time a cell of few took.
 */
function tileLeaves(leaves: readonly PlacedLeaf[]): readonly (readonly PlacedLeaf[])[] {
	const tiles: PlacedLeaf[][] = Array.from({ length: CELL_TILES * CELL_TILES }, () => []);
	for (const leaf of leaves) {
		const [left, bottom, right, top] = leaf.box as readonly [number, number, number, number];
		for (let y = tileOf(bottom); y <= tileOf(top); y++)
			for (let x = tileOf(left); x <= tileOf(right); x++) tiles[y * CELL_TILES + x]?.push(leaf);
	}
	return tiles;
}

/** Paints a cell from its leaves and the stem that carries them, or from its leaves alone. */
function leafSpray(
	all: readonly PlacedLeaf[],
	stem: number | null,
	stalk: number | null = null,
): LeafCellPainter {
	const leaves = tileLeaves(all);
	return {
		at(cardX, cardY) {
			let winner: PlacedLeaf | null = null;
			let nearest = 1;
			let covers = 0;
			let nearestStalk = 1;
			const tile = tileOf(cardY) * CELL_TILES + tileOf(cardX);
			for (const leaf of leaves[tile] as readonly PlacedLeaf[]) {
				const distance = leafDistance(leaf, cardX, cardY);
				if (distance < 0) covers += 1;
				if (distance < nearest) {
					nearest = distance;
					winner = leaf;
				}
				// A leaf on a stalk hangs off the stem, and the stalk is drawn from the stem to the
				// leaf's own base, wherever the leaf leans.
				if (stalk !== null) {
					const nearX = clamp(cardX, Math.min(0.5, leaf.baseX), Math.max(0.5, leaf.baseX));
					const toStalk = Math.hypot(cardX - nearX, cardY - leaf.baseY) - stalk;
					if (toStalk < nearestStalk) nearestStalk = toStalk;
				}
			}
			if (stem !== null) {
				const distance = stemDistance(cardX, cardY, stem, 0.007);
				if (distance < nearest) return stemPoint(distance, cardY);
			}
			if (nearestStalk < nearest) return stemPoint(nearestStalk, cardY);
			if (winner === null) return EMPTY_CELL_POINT;
			const spot = leafSpotAt(winner, cardX, cardY);
			const paint = leafPaint(winner, cardX, cardY, spot);
			// A leaf darkens where another leaf lies over it, as a pile of leaves shades itself. Without
			// that shade, two overlapping leaves of one tone read as one shape, and a card seen close
			// shows the union of its leaves as one lobed outline instead of the leaves themselves.
			const shade = 1 - 0.2 * Math.min(covers - 1, 2);
			return {
				color: [paint.color[0] * shade, paint.color[1] * shade, paint.color[2] * shade],
				alpha: cover(spot.distance, LEAF_EDGE) * cellRim(cardX, cardY),
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
	/**
	 * How far a leaf's angle may wander either side of its lean, in radians. A wide wander breaks the
	 * card's outline into leaf edges and makes its leaves face different ways.
	 */
	readonly turn?: number;
	/** The length of the first and the last leaf, against the cell's width. */
	readonly length: readonly [number, number];
	/** How far a leaf's base may sit from the stem, as a share of the cell's width. */
	readonly spread: number;
	/**
	 * The half width of the stalk that joins a leaf's base to the stem, as a share of the cell's
	 * width. Leave it out for a leaf that sits on the stem itself.
	 */
	readonly stalk?: number;
}

/** Places a spray of leaves over a card, each at a point and an angle of its own. */
function sprayLeaves(seed: number, family: LeafFamily, options: SprayOptions): PlacedLeaf[] {
	const leaves: PlacedLeaf[] = [];
	const count = Math.min(options.count, MAX_LEAVES);
	const turn = options.turn ?? 0.3;
	for (let i = 0; i < count; i++) {
		// The leaves rise up the card in their turn, but each sits at its own height on its own side.
		const f = count > 1 ? (i + random2(seed * 131 + i, 7)) / count : 0.5;
		const key = seed * 131 + i;
		const side = random2(key, 8) < 0.5 ? -1 : 1;
		const along = options.from + (options.to - options.from) * f;
		const lean = options.lean[0] + (options.lean[1] - options.lean[0]) * f;
		const angle = side * lean + (random2(key, 6) - 0.5) * 2 * turn;
		// Bases stay inside the card's middle, so a leaning leaf is not cut off at the cell's edge.
		const baseX = clamp(0.5 + (random2(key, 5) - 0.5) * 2 * options.spread, 0.2, 0.8);
		const length =
			(options.length[0] + (options.length[1] - options.length[0]) * f) *
			(0.82 + 0.36 * random2(key, 4));
		const leaf = placeLeaf(key, family, baseX, along, angle, length);
		const stalk = options.stalk;
		if (stalk === undefined) {
			leaves.push(leaf);
			continue;
		}
		// The stalk reaches from the stem to the leaf's base, so the tile lookup must hold the leaf
		// wherever the stalk runs as well as wherever the blade reaches.
		const [left, bottom, right, top] = leaf.box as readonly [number, number, number, number];
		leaves.push({
			...leaf,
			box: [
				Math.min(left, Math.min(0.5, baseX) - stalk),
				Math.min(bottom, along - stalk),
				Math.max(right, Math.max(0.5, baseX) + stalk),
				Math.max(top, along + stalk),
			],
		});
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

/**
 * A spruce shoot: a thin woody twig with short needles in two opposite ranks, each needle angled
 * forward toward the tip, as its own reference shows. The needles stand apart by more than their
 * width, so the twig shows between them and a close view reads needles rather than a feather.
 */
function shootCell(seed: number): LeafCellPainter {
	const leaves: PlacedLeaf[] = [];
	const count = 108;
	// The twig bows a little, so its silhouette is not a ruled line.
	const bow = 0.012;
	for (let i = 0; i < count; i++) {
		const key = seed * 131 + i;
		const f = (i + 0.5) / count;
		const side = i % 2 === 0 ? -1 : 1;
		const along = 0.04 + 0.92 * f;
		// The needles lean forward along the twig, a little more toward its tip.
		const lean = 1.12 + 0.14 * Math.sin(Math.PI * f);
		const angle = side * lean + (random2(key, 6) - 0.5) * 0.18;
		const length = (0.26 - 0.1 * f) * (0.85 + 0.3 * random2(key, 4));
		const baseX = 0.5 + bow * Math.sin(Math.PI * f);
		leaves.push(placeLeaf(key, FAMILIES.needle, baseX, along, angle, length));
	}
	return leafSpray(leaves, bow);
}

/**
 * A pine's fascicles: bunches of long needles that leave one point of a twig and part as they grow,
 * with bare twig between one bunch and the next.
 */
function fascicleCell(seed: number): LeafCellPainter {
	const leaves: PlacedLeaf[] = [];
	const bundles = 30;
	const bow = 0.01;
	for (let bundle = 0; bundle < bundles; bundle++) {
		const key = seed * 131 + bundle;
		const f = bundle / (bundles - 1);
		const baseY = 0.06 + 0.86 * f;
		const baseX = 0.5 + bow * Math.sin(Math.PI * f) + (random2(key, 3) - 0.5) * 0.03;
		const turn = (random2(key, 5) - 0.5) * 0.6;
		// The papery sheath that holds a pair together at its base.
		leaves.push(placeLeaf(key * 3 + 1, FAMILIES.sheath, baseX, baseY, turn, 0.05));
		for (let needle = 0; needle < 2; needle++) {
			const sub = key * 7 + needle;
			const side = needle === 0 ? -1 : 1;
			// The pair stays together at the sheath and parts along its length.
			const angle = turn + side * (0.3 + 0.24 * random2(sub, 6));
			const length = (0.24 - 0.07 * f) * (0.9 + 0.2 * random2(sub, 4));
			leaves.push(placeLeaf(sub, FAMILIES.fascicle, baseX, baseY, angle, length));
		}
	}
	return leafSpray(leaves, bow);
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

/** The twelve cells of the leaf block, in the order that the atlas lays them out. */
function leafCells(): LeafCellPainter[] {
	return [
		// Four sprays of broadleaves, each a different outline: an oak's lobes, a beech's fine teeth, a
		// birch's small teeth and a willow's long narrow blade. Each carries many small leaves at
		// angles of their own, so a card's outline breaks into leaf edges and its leaves face apart.
		leafSpray(
			sprayLeaves(11, FAMILIES.oak, {
				count: 62,
				from: 0.04,
				to: 0.9,
				lean: [0.4, 1.4],
				turn: 0.9,
				length: [0.27, 0.17],
				spread: 0.2,
			}),
			0.03,
		),
		leafSpray(
			sprayLeaves(23, FAMILIES.liveoak, {
				count: 44,
				from: 0.04,
				to: 0.9,
				lean: [0.5, 1.3],
				turn: 0.8,
				length: [0.2, 0.12],
				spread: 0.2,
			}),
			0.02,
		),
		leafSpray(
			sprayLeaves(37, FAMILIES.birch, {
				count: 60,
				from: 0.03,
				to: 0.9,
				lean: [0.45, 1.45],
				turn: 0.95,
				length: [0.22, 0.14],
				spread: 0.21,
			}),
			0.03,
		),
		leafSpray(
			sprayLeaves(41, FAMILIES.willow, {
				count: 62,
				from: 0.04,
				to: 0.9,
				lean: [0.4, 1.35],
				turn: 0.8,
				length: [0.32, 0.2],
				spread: 0.18,
			}),
			0.03,
		),
		leafSpray(
			sprayLeaves(71, FAMILIES.wavy, {
				count: 30,
				from: 0.04,
				to: 0.9,
				lean: [0.45, 1.35],
				turn: 0.75,
				length: [0.32, 0.22],
				spread: 0.17,
			}),
			0.02,
		),
		// A quaking aspen: six leaves hang apart on long flattened stalks. The stalks are what the
		// species shows, because a leaf on one turns edge-on in the least wind, so the card draws
		// the gap between the leaves rather than a packed clump.
		leafSpray(
			sprayLeaves(79, FAMILIES.aspen, {
				count: 5,
				from: 0.14,
				to: 0.86,
				lean: [1.05, 0.85],
				turn: 0.3,
				length: [0.28, 0.22],
				spread: 0.3,
				stalk: 0.006,
			}),
			0.02,
			0.006,
		),
		// A maple's palmate leaf, whose lobes radiate from its base rather than running along the
		// midrib.
		leafSpray(
			sprayLeaves(113, FAMILIES.palmate, {
				count: 20,
				from: 0.04,
				to: 0.88,
				lean: [0.5, 1.3],
				turn: 0.6,
				length: [0.34, 0.24],
				spread: 0.2,
			}),
			0.03,
		),
		// A conifer's shoot, a fern's frond, a clump of grass blades and a broad leaf. The shoot
		// carries short needles along a twig, so a card reads as a spray of needles rather than as a
		// broad blade with serrated edges.
		shootCell(53),
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
		// A pine's long needles, in bunches along a twig.
		fascicleCell(97),
	];
}

/** The two maps of one atlas: its colour map and its surface map.
 *
 * @category api/vegetation
 */
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

/** How one bark family is cut: its plates, its cracks, its fibre and its colour. */
interface BarkFamily {
	/** Plates across and along the cell. A low count makes a broad plate, a high one a fine scale. */
	readonly across: number;
	readonly along: number;
	/** How far the plates warp, how wide a crack runs, and how deep it cuts. */
	readonly warp: number;
	readonly crackWidth: number;
	readonly depth: number;
	/** How strongly the fibres and the fine noise break the surface. */
	readonly fibre: number;
	/** The darkest and lightest tone of the family, as factors around white. */
	readonly dark: readonly [number, number, number];
	readonly light: readonly [number, number, number];
	/** How much moss the family may carry, from 0 to 1. */
	readonly moss: number;
	/** A birch's horizontal lenticels, or a willow's vertical ridges. */
	readonly lenticels?: boolean;
	/** How many bands of lenticels a cell holds, and how dense the marks are within each, 0 to 1. */
	readonly lenticelRows?: number;
	readonly lenticelDensity?: number;
	readonly ridges?: boolean;
	/** How many dark scars a cell carries, where a branch died and the bark closed over it. */
	readonly scars?: number;
	/**
	 * True for bark with no plates at all: one unbroken surface, as an aspen's bole is. The lattice
	 * then gives way, and the lenticels and scars alone mark the bark.
	 */
	readonly smooth?: boolean;
	/** How strongly a smooth bark's tone drifts across the cell, so it is not one flat colour. */
	readonly mottle?: number;
	/**
	 * How tall a plate runs against its width. A value under one stretches the plates down the
	 * trunk, as a live oak's furrows do, without changing the lattice's counts.
	 */
	readonly vertical?: number;
	/**
	 * The colour of the seam between two plates, where the bark has split and the wood behind shows.
	 * A family that leaves it out darkens its cracks with the rest of the surface.
	 */
	readonly crack?: readonly [number, number, number];
}

/** The six bark families, in the order that the atlas lays them out. */
const BARK_FAMILIES: Readonly<Record<BarkCellName, BarkFamily>> = {
	// Every family counts several plates down the trunk as well as across it: a family that
	// counts one repeats the same motif down the bole, and that reads as a border, not as bark.
	birch: {
		across: 1,
		along: 9,
		warp: 0.3,
		crackWidth: 0.03,
		depth: 0.45,
		fibre: 0.02,
		dark: [0.55, 0.53, 0.5],
		light: [1.24, 1.22, 1.18],
		moss: 0.05,
		lenticels: true,
		lenticelRows: 30,
		lenticelDensity: 0.5,
		scars: 2,
	},
	// A Scots pine's bark: orange-red plates that flake apart, smaller and greyer low on the trunk.
	pine: {
		across: 8,
		along: 6,
		warp: 0.85,
		crackWidth: 0.08,
		depth: 0.5,
		fibre: 0.05,
		dark: [0.34, 0.19, 0.1],
		light: [1.28, 0.78, 0.42],
		moss: 0.12,
	},
	// A live oak's bark: long wavy vertical furrows with broad flat ridges between them.
	oak: {
		across: 9,
		along: 2,
		vertical: 0.16,
		warp: 1.2,
		crackWidth: 0.16,
		depth: 0.9,
		fibre: 0.03,
		dark: [0.16, 0.14, 0.13],
		light: [0.72, 0.68, 0.62],
		moss: 0.1,
		ridges: true,
	},
	beech: {
		across: 5,
		along: 4,
		warp: 0.35,
		crackWidth: 0.04,
		depth: 0.16,
		fibre: 0.008,
		dark: [0.66, 0.65, 0.63],
		light: [1.14, 1.13, 1.1],
		moss: 0.05,
	},
	spruce: {
		across: 11,
		along: 9,
		warp: 0.7,
		crackWidth: 0.34,
		depth: 0.7,
		fibre: 0.08,
		dark: [0.34, 0.28, 0.24],
		light: [1.02, 0.95, 0.86],
		crack: [1.0, 0.66, 0.5],
		moss: 0.08,
	},
	// An aspen's bark: one smooth pale surface, unbroken by plates, marked by dense fine horizontal
	// lenticels and a few large dark scars where branches died.
	aspen: {
		across: 2,
		along: 2,
		warp: 0,
		crackWidth: 0.01,
		depth: 0,
		fibre: 0.012,
		dark: [0.88, 0.88, 0.84],
		light: [1.12, 1.11, 1.06],
		moss: 0.05,
		lenticels: true,
		lenticelRows: 44,
		lenticelDensity: 0.42,
		scars: 2,
		smooth: true,
		mottle: 0.35,
	},
	// A holm oak's bark: small dark plates that scale off, with shallow cracks between them.
	holm: {
		across: 12,
		along: 9,
		warp: 0.4,
		crackWidth: 0.04,
		depth: 0.3,
		fibre: 0.02,
		dark: [0.2, 0.19, 0.17],
		light: [0.95, 0.9, 0.82],
		moss: 0.05,
	},
	willow: {
		across: 12,
		along: 2,
		vertical: 0.16,
		warp: 1.2,
		crackWidth: 0.09,
		depth: 0.55,
		fibre: 0.02,
		dark: [0.34, 0.32, 0.29],
		light: [1.1, 1.05, 0.98],
		moss: 0.08,
		ridges: true,
	},
};

/**
 * The bark families in the order that the painter lays them out, which fixes each one's cell. The
 * map that a species reads is built from this list, so the painted order and the read order cannot
 * drift apart: a family added here moves the cells that follow it, and both sides move together.
 *
 * @category api/vegetation
 */
export const BARK_FAMILY_ORDER = Object.keys(BARK_FAMILIES) as readonly BarkCellName[];

/** The nearest bark plate's distance, the next one's, and a number of the nearest plate. */
function plates(
	x: number,
	y: number,
	across: number,
	along: number,
	vertical: number,
): [number, number, number] {
	const wholeX = Math.floor(x);
	const wholeY = Math.floor(y);
	const partX = x - wholeX;
	const partY = y - wholeY;
	let first = 8;
	let second = 8;
	let near = 0;
	for (let oy = -1; oy <= 1; oy++)
		for (let ox = -1; ox <= 1; ox++) {
			// The lattice wraps by its own counts, so the plate pattern repeats exactly with the cell.
			const cellX = (((wholeX + ox) % across) + across) % across;
			const cellY = (((wholeY + oy) % along) + along) % along;
			const atX = random2(cellX, cellY);
			const atY = random2(cellX + 31, cellY + 17);
			const dx = ox + atX - partX;
			const dy = (oy + atY - partY) * vertical;
			// Each plate runs to its own size, so the lattice never shows as an even grid of cells.
			const size = 0.72 + 0.56 * random2(cellX + 13, cellY + 29);
			const d = Math.hypot(dx, dy) / size;
			if (d < first) {
				second = first;
				first = d;
				near = random2(cellX + 7, cellY + 3);
			} else if (d < second) second = d;
		}
	return [first, second, near];
}

/** A noise that repeats with the cell: a sum of sines at whole cycles across and along it. */
function periodicBark(u: number, v: number, across: number, along: number, seed: number): number {
	const first = Math.sin(2 * Math.PI * (across * u) + seed * 1.7);
	const second = Math.sin(2 * Math.PI * (along * v) + seed * 3.1);
	const third = Math.sin(2 * Math.PI * ((across + 1) * u + along * v) + seed * 5.3);
	return 0.5 + 0.22 * first + 0.18 * second + 0.1 * third;
}

/** The bark's plate coordinates at a point, warped by noise, and the nearest plate's number. */
function barkPlates(u: number, v: number, family: BarkFamily): [number, number, number] {
	// A smooth family has no lattice at all: one plate covers the cell, so the surface stays
	// unbroken and only the lenticels and the scars mark it.
	if (family.smooth === true) return [0, 1, 0.5];
	// A warp built from sines of whole cycles wraps with the cell, so a bark tile's seam does not
	// show where the pattern repeats.
	// Two warps: a slow one that bends the plates and a faster one that makes their widths uneven.
	// Both count whole cycles, so the cell still tiles.
	const warp =
		((Math.sin(2 * Math.PI * (2 * u) + 1.3) + Math.sin(2 * Math.PI * (3 * v) + 2.1)) * 0.5 +
			(Math.sin(2 * Math.PI * (5 * u) + 0.7) + Math.sin(2 * Math.PI * (7 * v) + 4.2)) * 0.22) *
		family.warp;
	const across = (u * family.across) % family.across;
	const along = (v * family.along) % family.along;
	const [first, second, near] = plates(
		across + warp,
		along,
		family.across,
		family.along,
		family.vertical ?? 1,
	);
	return [first, second, near];
}

/**
 * The dash field of the lenticels, periodic across the cell: every wave counts whole cycles, so the
 * field meets itself at the cell's seam. Noise would not: its value at the seam jumps, and the trunk
 * shows a line down its side every time the bark comes round.
 */
function periodicDash(u: number, band: number): number {
	const phase = random2(band, 17) * Math.PI * 2;
	const first = Math.sin(2 * Math.PI * 3 * u + phase);
	const second = Math.sin(2 * Math.PI * 7 * u + phase * 1.7);
	const third = Math.sin(2 * Math.PI * 13 * u + phase * 0.3);
	return 0.5 + 0.06 * first + 0.16 * second + 0.28 * third;
}

/** A bark's lenticels: short horizontal dashes where its pores open. */
function lenticel(u: number, v: number, family: BarkFamily): number {
	const rows = family.lenticelRows ?? 18;
	const density = family.lenticelDensity ?? 0.62;
	// The rows wander as the trunk's surface swells, so the marks do not sit on a ruled grid, and
	// each dash keeps its own length, so a row is a scatter rather than a dotted line. Both waves
	// count whole cycles across the cell, so the field still wraps at its seam.
	const wander = (periodicBark(u, 0, 3, 1, 7) - 0.5) * 0.45;
	const seat = v * rows + wander;
	const band = Math.floor(seat);
	const shift = random2(band, 3) * 4;
	const along = teethWave(seat);
	const length = 0.55 + 0.45 * periodicBark(u, 0, 5, 1, band + 2);
	const marks = smoothstep(density, density + 0.2, periodicDash(u, band + shift)) * length;
	return marks * (1 - smoothstep(0.05, 0.2, along));
}

/**
 * The bark's scars: a few dark patches where a branch died and the bark closed over it. Each scar
 * keeps clear of the cell's edge, so a tile's seam cannot cut one in half.
 */
function barkScar(u: number, v: number, family: BarkFamily): number {
	const count = family.scars ?? 0;
	let scar = 0;
	for (let i = 0; i < count; i++) {
		const centreX = 0.16 + 0.68 * random2(i + 1, 41);
		const centreY = 0.16 + 0.68 * random2(i + 1, 43);
		const size = 0.035 + 0.055 * random2(i + 1, 47);
		// No two scars share an outline: each branch died at its own angle and the bark closed over
		// it unevenly. One repeated shape is what makes a bark read as a pattern rather than a bole.
		const wide = 0.8 + 0.5 * random2(i + 1, 53);
		const tall = 0.9 + 0.6 * random2(i + 1, 59);
		// The scar's edge wobbles on waves that count whole cycles, like every other bark term, so
		// the mark meets itself across the cell's seam.
		const wobble = 1 + 0.35 * (periodicDash(u, i * 7) * periodicDash(v, i * 11) - 0.25);
		const reach = Math.hypot((u - centreX) / wide, (v - centreY) / tall) / (size * wobble);
		// The bark closed over the stub in rings, so the knot is a dark core banded by its own
		// ridges rather than one even patch: the ridge wave counts whole cycles, so it wraps.
		const ridge =
			0.62 +
			0.38 * teethWave(reach * 3.5 + random2(i + 1, 61) + (periodicDash(u, i * 5) - 0.5) * 0.9);
		scar = Math.max(scar, (1 - smoothstep(0.78, 1, reach)) * ridge);
	}
	return scar;
}

/** A willow's ridges: long vertical furrows, broken by the same slow noise as its plates. */
function ridge(u: number, v: number): number {
	const across = Math.sin(u * Math.PI * 18 + fbm2(u * 4, v * 3, 2) * 3);
	return smoothstep(0.55, 1, Math.abs(across)) * (0.5 + 0.5 * fbm2(u * 9, v * 2, 2));
}

/** The bark's height at a point of its own tiling coordinates. */
function barkHeight(u: number, v: number, family: BarkFamily): number {
	const [first, second, near] = barkPlates(u, v, family);
	const crack = smoothstep(0, family.crackWidth, second - first);
	let height = (0.25 + 0.65 * crack) * (0.75 + 0.5 * near);
	height += (periodicBark(u, v, 45, 9, 1) - 0.5) * family.fibre * crack;
	height += (periodicBark(u, v, 11, 2, 2) - 0.5) * family.depth * 0.07;
	if (family.lenticels) height -= lenticel(u, v, family) * 0.08;
	height += (periodicBark(u, v, 2, 3, 11) - 0.5) * (family.mottle ?? 0);
	if (family.ridges) height += ridge(u, v) * 0.12;
	return height;
}

/** How much light a bark point reflects, as a factor around white. */
function barkColorAt(
	u: number,
	v: number,
	height: number,
	plate: number,
	family: BarkFamily,
	crack: number,
): [number, number, number] {
	const mix = clamp(height, 0, 1);
	const shade = 0.72 + 0.52 * plate;
	let split = 0;
	const lenticels = family.lenticels ? 1 - 0.7 * lenticel(u, v, family) : 1;
	const feature = family.ridges ? 1 - 0.25 * (1 - ridge(u, v)) : lenticels;
	const moss = smoothstep(0.55, 0.85, periodicBark(u, v, 2, 1, 3)) * family.moss;
	// A family that names a crack colour shows the split wood there: the seam between two plates
	// keeps its own tone however deep the shadow falls into it.
	if (family.crack) split = 1 - crack;
	return [0, 1, 2].map((channel) => {
		const dark = family.dark[channel] as number;
		const light = family.light[channel] as number;
		const base = dark + (light - dark) * mix;
		const seam = family.crack?.[channel] ?? 0;
		const laid = base + (seam - base) * split;
		const withMoss = laid * shade * feature * (1 - moss) + [0.62, 0.85, 0.42][channel]! * moss;
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

/**
 * Paints the bark's two maps: each family's colour as a factor around white, and a surface of the
 * normal and the roughness that lies under it. The block holds six cells, one for each family; the
 * bark of a branch samples its own species' cell and repeats within it.
 *
 * @returns The colour and the surface map.
 * @category api/vegetation
 */
export function paintBark(): PaintedAtlas {
	const width = BARK_WIDTH;
	const height = BARK_HEIGHT;
	const color = new Uint8Array(width * height * 4);
	const surface = new Uint8Array(width * height * 4);
	const names = Object.keys(BARK_FAMILIES) as BarkCellName[];
	for (const [kind, name] of names.entries()) {
		const family = BARK_FAMILIES[name];
		const col = kind % BARK_CELLS_X;
		const row = Math.floor(kind / BARK_CELLS_X);
		const heights = heightField(BARK_SIZE, BARK_SIZE, (x, y) =>
			barkHeight(x / BARK_SIZE, y / BARK_SIZE, family),
		);
		// A cell's last column and row stand for the end of the cycle, which is its beginning. Copying
		// the first column and row into them makes the slope at the neighbouring texel see the wrapped
		// surface rather than a value a hair short of the cycle: otherwise the normal map turns up a
		// thin ridge along every tile join, which the trunk shows as a line.
		for (let y = 0; y < BARK_SIZE; y++)
			heights[y * BARK_SIZE + BARK_SIZE - 1] = heights[y * BARK_SIZE] ?? 0;
		for (let x = 0; x < BARK_SIZE; x++) heights[(BARK_SIZE - 1) * BARK_SIZE + x] = heights[x] ?? 0;
		for (let y = 0; y < BARK_SIZE; y++)
			for (let x = 0; x < BARK_SIZE; x++) {
				const u = x / BARK_SIZE;
				const v = y / BARK_SIZE;
				const [first, second, near] = barkPlates(u, v, family);
				const crack = smoothstep(0, family.crackWidth, second - first);
				const tint = barkColorAt(u, v, heights[y * BARK_SIZE + x] ?? 0, near, family, crack);
				const at = ((row * BARK_SIZE + y) * width + col * BARK_SIZE + x) * 4;
				color[at] = encode(tint[0]);
				color[at + 1] = encode(tint[1]);
				color[at + 2] = encode(tint[2]);
				color[at + 3] = 255;
				// A scar rides in the surface map's alpha, which a bark material does not read: the
				// shader takes that channel for a leaf's thickness alone. The material samples this
				// map again at a coarser tiling, so the knots do not repeat with the bark's cells.
				const scar = barkScar(u, v, family);
				const [nx, ny] = slope(heights, BARK_SIZE, BARK_SIZE, x, y, BUMP_BARK * BARK_SIZE, true);
				const length = Math.hypot(nx, ny, 1);
				const roughness = 0.72 + 0.25 * periodicBark(u, v, 20, 2, 5);
				surface[at] = Math.round(clamp((nx / length) * 0.5 + 0.5, 0, 1) * 255);
				surface[at + 1] = Math.round(clamp((ny / length) * 0.5 + 0.5, 0, 1) * 255);
				surface[at + 2] = Math.round(clamp(roughness, 0, 1) * 255);
				surface[at + 3] = Math.round((1 - scar) * 255);
			}
		// The cell's last column repeats its first and its last row repeats its first, so the
		// sampler's wrap meets itself exactly. The painters count whole cycles, but the texture's
		// last texel still holds the value a hair before the cycle ends, and that half texel is the
		// faint line down a trunk and across it.
		for (const map of [color, surface]) {
			for (let y = 0; y < BARK_SIZE; y++) {
				const first = ((row * BARK_SIZE + y) * width + col * BARK_SIZE) * 4;
				const last = first + (BARK_SIZE - 1) * 4;
				for (let c = 0; c < 4; c++) map[last + c] = map[first + c] as number;
			}
			for (let x = 0; x < BARK_SIZE; x++) {
				const first = (row * BARK_SIZE * width + col * BARK_SIZE + x) * 4;
				const last = (((row + 1) * BARK_SIZE - 1) * width + col * BARK_SIZE + x) * 4;
				for (let c = 0; c < 4; c++) map[last + c] = map[first + c] as number;
			}
		}
	}
	return {
		color: { width, height, data: color },
		surface: { width, height, data: surface },
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
 * @category api/vegetation
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
