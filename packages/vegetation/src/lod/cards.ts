// The card levels: each shoot row becomes its prototype's three card planes in the first card
// level, in plant space, at the size of the shoot the card pictures. The second level keeps every
// second card of the first in the rows' space-filling order, and every row that sets the leaf
// form's extent. Each kept card grows about its middle to make up the cover of the card that went,
// by the square root of that step at most (D-241's card rule), and only as far as the plant's leaf
// form reaches: a card's picture never stands outside the hull of the shoots drawn at their own
// size, so every level is the same plant, as tall, as wide and as deep.
//
// A card vertex carries its row's wind record (high and low byte, global in the species' table), the
// row's flutter phase, and the row's sky visibility. Its second texture coordinate holds the share
// of the way up the card, for the shoot's bend, and the plane: 0 and 1 for the crossed vertical
// planes, 2 for the horizontal one, over 2.
import type { MeshArrays, ShootRows, SpeciesKitData } from '../asset';
import { atan2, length3, normalize3, quatRotate, type Vector3 } from '../core/math';
import { MeshWriter } from '../leaf/writer';
import type { MeshInput } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';

/** A card's corners: signs of its right and up half-extents. */
export const CARD_CORNERS = [
	[-1, -1],
	[1, -1],
	[1, 1],
	[-1, 1],
] as const;

/** The second coordinate that marks a card's stalk, in a place that the three card planes leave free. */
const STALK_PLANE = 0.75;

/** Metres from a card to a branch its level draws within which the card joins the plant. */
const SEED_REACH = 2.5;

/** Metres between two cards within which their leaves meet, so one joins the other's clump. */
const CARD_REACH = 2;

/** Texels of the card atlas with at least this coverage are the picture; the rest is clear. */
const OPAQUE = 128;

/** The bands of height and the sectors round the plant that the leaf form's hull is read in. */
const HULL_BANDS = 24;
const HULL_SECTORS = 24;

/** How far past the leaf form's hull a grown card's picture may stand, as a share: none to speak of. */
const HULL_SLACK = 1e-4;

/** The halvings that find how far a card may grow inside the hull. */
const GROW_STEPS = 6;

/** The sectors round the plant in each of which the row that reaches farthest is a row of the rim. */
const RIM_SECTORS = 16;

/** What a card plane's atlas cell pictures. */
interface Pictured {
	/**
	 * The edge of the picture: points on the plane's right and up extents, each from -1 to 1. For
	 * each row of the plane's texels, they are the left side of its first texel of at least half
	 * cover and the right side of its last. The picture lies inside their hull.
	 */
	readonly edge: readonly (readonly [right: number, up: number])[];
	/** The share of the plane that the picture covers. */
	readonly share: number;
}

/** The whole plane, for a kit with no atlas. */
const WHOLE_PLANE: Pictured = {
	edge: [
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1],
	],
	share: 1,
};

/** Each atlas's pictures, by the cell's place in it, read once. */
const PICTURED = new WeakMap<Uint8Array, Map<number, Pictured>>();

/** The picture on one card plane. */
function picturedOf(
	kit: SpeciesKitData,
	cell: readonly [number, number, number, number],
): Pictured {
	const size = kit.cards.size;
	const pixels = kit.cards.color;
	if (size <= 0 || pixels.length < size * size * 4) return WHOLE_PLANE;
	let known = PICTURED.get(pixels);
	if (!known) {
		known = new Map();
		PICTURED.set(pixels, known);
	}
	const [x, y, w, h] = cell;
	const key = (y * size + x) * 4096 + w;
	let found = known.get(key);
	if (!found) {
		const edge: [number, number][] = [];
		let covered = 0;
		for (let j = 0; j < h; j++) {
			let left = -1;
			let right = -1;
			for (let i = 0; i < w; i++) {
				if ((pixels[((y + j) * size + x + i) * 4 + 3] as number) < OPAQUE) continue;
				if (left < 0) left = i;
				right = i;
				covered++;
			}
			if (left < 0) continue;
			for (const up of [(j / h) * 2 - 1, ((j + 1) / h) * 2 - 1])
				edge.push([(left / w) * 2 - 1, up], [((right + 1) / w) * 2 - 1, up]);
		}
		found = { edge, share: w * h > 0 ? covered / (w * h) : 0 };
		known.set(key, found);
	}
	return found;
}

/**
 * The hull of a plant's leaf form: how far the pictures of its shoots, each at its own size, reach
 * from the plant's axis in each band of height and each sector round it, and their lowest and
 * highest points. A grown card's picture stays inside it.
 */
export interface FoliageHull {
	/** The plant's axis. */
	readonly x: number;
	readonly z: number;
	/** The lowest and the highest point of the leaf form's pictures. */
	readonly low: number;
	readonly high: number;
	/** The least and the most the pictures reach across and in depth: x, then z. */
	readonly across: readonly [number, number];
	readonly depth: readonly [number, number];
	/** The square of the farthest reach, per band of height then sector. */
	readonly reach: Float32Array;
	/**
	 * One flag per row, 1 for a row of the rim: the row whose picture stands highest, each row
	 * whose picture ends the leaf form across or in depth, and the row that reaches farthest from
	 * the plant's axis in each sector round it. Every card level keeps these rows, so it is as tall
	 * and as wide as the leaf form from every side.
	 */
	readonly rim: Uint8Array;
}

/** Each plant's hull, by its rows, found once. */
const HULLS = new WeakMap<ShootRows, FoliageHull>();

/** The place in a hull's table of a point's band and sector. */
function hullCell(hull: FoliageHull, x: number, y: number, z: number): number {
	const tall = Math.max(1e-9, hull.high - hull.low);
	const band = Math.min(
		HULL_BANDS - 1,
		Math.max(0, Math.floor(((y - hull.low) / tall) * HULL_BANDS)),
	);
	const turn = atan2(z - hull.z, x - hull.x) / (2 * Math.PI) + 0.5;
	const sector = Math.min(HULL_SECTORS - 1, Math.max(0, Math.floor(turn * HULL_SECTORS)));
	return band * HULL_SECTORS + sector;
}

/**
 * Calls back with each point on the edge of the picture of each of a row's card planes, in plant
 * space, for a card moved by `shift` and grown by `grow` about each plane's middle.
 */
function picturedCorners(
	kit: SpeciesKitData,
	rows: ShootRows,
	r: number,
	planes: number,
	grow: number,
	shift: Readonly<Vector3>,
	each: (x: number, y: number, z: number) => void,
): void {
	const prototype = kit.prototypes[rows.prototype[r] as number];
	if (!prototype) return;
	const scale = rows.scale[r] as number;
	const local: Vector3 = [0, 0, 0];
	const world: Vector3 = [0, 0, 0];
	for (const plane of prototype.card.planes.slice(0, planes)) {
		for (const [sx, sy] of picturedOf(kit, plane.front).edge) {
			for (let c = 0; c < 3; c++)
				local[c] =
					((plane.centre[c] as number) +
						grow * (sx * (plane.right[c] as number) + sy * (plane.up[c] as number))) *
					scale;
			quatRotate(rows.rotation, r * 4, local, world);
			each(
				(rows.position[r * 3] as number) + world[0] + shift[0],
				(rows.position[r * 3 + 1] as number) + world[1] + shift[1],
				(rows.position[r * 3 + 2] as number) + world[2] + shift[2],
			);
		}
	}
}

/** No move of a card from its row's own place. */
const NO_SHIFT: Readonly<Vector3> = [0, 0, 0];

/**
 * The hull of a dressed variant's leaf form.
 *
 * @param input The dressed variant.
 * @returns The hull.
 * @category api/vegetation
 */
export function foliageHull(input: Pick<MeshInput, 'kit' | 'rows' | 'skeleton'>): FoliageHull {
	const { rows, kit, skeleton } = input;
	const known = HULLS.get(rows);
	if (known) return known;
	const points: number[] = [];
	const x0 = (skeleton.bounds.min[0] + skeleton.bounds.max[0]) / 2;
	const z0 = (skeleton.bounds.min[2] + skeleton.bounds.max[2]) / 2;
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	const across: [number, number] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
	const depth: [number, number] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
	// The rows that set the extent: the highest, the two ends across, the two ends in depth, then
	// the farthest of each sector, with how far each of those reaches.
	const ends = new Int32Array(5 + RIM_SECTORS).fill(-1);
	const farthest = new Float64Array(RIM_SECTORS);
	for (let r = 0; r < rows.count; r++)
		picturedCorners(kit, rows, r, Number.POSITIVE_INFINITY, 1, NO_SHIFT, (x, y, z) => {
			points.push(x, y, z);
			if (y < low) low = y;
			if (y > high) {
				high = y;
				ends[0] = r;
			}
			if (x < across[0]) {
				across[0] = x;
				ends[1] = r;
			}
			if (x > across[1]) {
				across[1] = x;
				ends[2] = r;
			}
			if (z < depth[0]) {
				depth[0] = z;
				ends[3] = r;
			}
			if (z > depth[1]) {
				depth[1] = z;
				ends[4] = r;
			}
			const reach = (x - x0) ** 2 + (z - z0) ** 2;
			const turn = atan2(z - z0, x - x0) / (2 * Math.PI) + 0.5;
			const sector = Math.min(RIM_SECTORS - 1, Math.max(0, Math.floor(turn * RIM_SECTORS)));
			if (reach > (farthest[sector] as number)) {
				farthest[sector] = reach;
				ends[5 + sector] = r;
			}
		});
	const rim = new Uint8Array(rows.count);
	for (const r of ends) if (r >= 0) rim[r] = 1;
	const hull: FoliageHull = {
		x: x0,
		z: z0,
		low: points.length > 0 ? low : 0,
		high: points.length > 0 ? high : 0,
		across,
		depth,
		reach: new Float32Array(HULL_BANDS * HULL_SECTORS),
		rim,
	};
	const own = new Float32Array(HULL_BANDS * HULL_SECTORS);
	for (let i = 0; i < points.length; i += 3) {
		const x = points[i] as number;
		const z = points[i + 2] as number;
		const cell = hullCell(hull, x, points[i + 1] as number, z);
		const reach = (x - hull.x) ** 2 + (z - hull.z) ** 2;
		if (reach > (own[cell] as number)) own[cell] = reach;
	}
	// A cell reaches as far as its neighbours do, so a card that leans across a band's or a sector's
	// edge is judged by the crown beside it and not by an empty slice of it.
	for (let band = 0; band < HULL_BANDS; band++)
		for (let sector = 0; sector < HULL_SECTORS; sector++) {
			let most = 0;
			for (let db = -1; db <= 1; db++) {
				const b = band + db;
				if (b < 0 || b >= HULL_BANDS) continue;
				for (let ds = -1; ds <= 1; ds++)
					most = Math.max(
						most,
						own[b * HULL_SECTORS + ((sector + ds + HULL_SECTORS) % HULL_SECTORS)] as number,
					);
			}
			hull.reach[band * HULL_SECTORS + sector] = most;
		}
	HULLS.set(rows, hull);
	return hull;
}

/**
 * How much a row's cards may grow about their middles and keep their pictures inside the leaf
 * form's hull: the growth asked for where that fits, or else the most that does, never under 1.
 * Cards with no room to grow where they stand draw back from the hull as they grow, toward the
 * middle of the plant, so their pictures reach no farther out than at their own size.
 *
 * @param input The dressed variant.
 * @param r The row whose prototype and turn the cards take.
 * @param wanted The growth asked for.
 * @param planes The card planes drawn, every plane by default.
 * @param shift How far the cards stand from the row's own place.
 * @param back Receives how far the grown cards draw back from where they stood. Cards grow where
 *   they stand for a caller that gives none.
 * @returns The growth.
 * @category api/vegetation
 */
export function growthInHull(
	input: Pick<MeshInput, 'kit' | 'rows' | 'skeleton'>,
	r: number,
	wanted: number,
	planes = Number.POSITIVE_INFINITY,
	shift: Readonly<Vector3> = NO_SHIFT,
	back?: Vector3,
): number {
	if (back) back.fill(0);
	if (!(wanted > 1)) return 1;
	const { kit, rows } = input;
	const hull = foliageHull(input);
	// The way from the cards to the middle of the plant, which a card with no room draws back along.
	const inward = normalize3([
		hull.x - (rows.position[r * 3] as number) - shift[0],
		(hull.low + hull.high) / 2 - (rows.position[r * 3 + 1] as number) - shift[1],
		hull.z - (rows.position[r * 3 + 2] as number) - shift[2],
	]);
	// How far the pictures of the grown cards reach against that way.
	const outward = (grow: number): number => {
		let most = Number.NEGATIVE_INFINITY;
		picturedCorners(kit, rows, r, planes, grow, shift, (x, y, z) => {
			most = Math.max(most, -(x * inward[0] + y * inward[1] + z * inward[2]));
		});
		return most;
	};
	const moved: Vector3 = [0, 0, 0];
	const fits = (grow: number, move: number): boolean => {
		for (let c = 0; c < 3; c++) moved[c] = (shift[c] as number) + move * (inward[c] as number);
		let inside = true;
		picturedCorners(kit, rows, r, planes, grow, moved, (x, y, z) => {
			if (!inside) return;
			const tall = (hull.high - hull.low) * HULL_SLACK;
			if (y < hull.low - tall || y > hull.high + tall) inside = false;
			else if (x < hull.across[0] || x > hull.across[1] || z < hull.depth[0] || z > hull.depth[1])
				inside = false;
			else if (
				(x - hull.x) ** 2 + (z - hull.z) ** 2 >
				(hull.reach[hullCell(hull, x, y, z)] as number) * (1 + HULL_SLACK)
			)
				inside = false;
		});
		return inside;
	};
	if (fits(wanted, 0)) return wanted;
	// Cards draw back only for a caller that takes the move.
	const own = back ? outward(1) : 0;
	const drawBack = (grow: number): number => (back ? Math.max(0, outward(grow) - own) : 0);
	let low = 1;
	let lowMove = 0;
	let high = wanted;
	for (let step = 0; step <= GROW_STEPS; step++) {
		// The first try is the growth asked for; each later one halves what is left.
		const middle = step === 0 ? wanted : (low + high) / 2;
		const move = drawBack(middle);
		if (fits(middle, move)) {
			low = middle;
			lowMove = move;
			if (step === 0) break;
		} else high = middle;
	}
	if (back) for (let c = 0; c < 3; c++) back[c] = lowMove * (inward[c] as number);
	return low;
}

/** How many rows of the space-filling order a card level takes one of. */
function cardStep(level: 1 | 2, share = 1): number {
	const own = 1 << (level - 1);
	return Math.max(1, Math.round(own / Math.max(0.05, Math.min(1, share))));
}

/**
 * Whether a card level's step keeps a row, and the most it may grow the row's cards: every second
 * row of the level above in the space-filling order, grown by the square root of the step where
 * the leaf form's hull has that much room (`growthInHull`). A share below one thins the level's
 * own rows further, by the same rule; the review tool tests the share to measure what the cards
 * buy. A level also keeps the rows of the leaf form's rim (`cardRows`).
 *
 * @param order The row's rank on the space-filling curve.
 * @param level The card level.
 * @param share The share of the level's own card rows to keep, from 0.05 to 1.
 * @returns The most the row's cards may grow, or 0 when the step drops it.
 * @category api/vegetation
 */
export function cardKeep(order: number, level: 1 | 2, share = 1): number {
	const every = cardStep(level, share);
	if (order % every !== 0) return 0;
	const grow = Math.sqrt(every);
	return grow;
}

/**
 * The most each row's cards may grow at a card level, 0 for a row the level drops. A level keeps
 * the row each step of the space-filling order names (`cardKeep`), and it keeps every row of the
 * leaf form's rim. A rim row takes the place of its step's own row, so the level holds no more
 * cards for it unless two rows of one step both stand on the rim.
 *
 * @param input The dressed variant.
 * @param level The card level.
 * @returns One growth per row.
 * @category api/vegetation
 */
export function cardRows(
	input: Pick<MeshInput, 'kit' | 'rows' | 'skeleton' | 'cards'>,
	level: 1 | 2,
): Float32Array {
	const { rows } = input;
	const every = cardStep(level, input.cards ?? 1);
	const grow = Math.sqrt(every);
	const out = new Float32Array(rows.count);
	const rim = every > 1 ? foliageHull(input).rim : undefined;
	// The steps whose own row gives its place to a row of the rim.
	const given = new Set<number>();
	if (rim)
		for (let r = 0; r < rows.count; r++) {
			const order = rows.order[r] as number;
			if (rim[r] === 1 && order % every !== 0) given.add(Math.floor(order / every));
		}
	for (let r = 0; r < rows.count; r++) {
		const order = rows.order[r] as number;
		if (rim?.[r] === 1 || (order % every === 0 && !given.has(Math.floor(order / every))))
			out[r] = grow;
	}
	return out;
}

/**
 * The area of the picture on a row's cards as a camera sees it: that of the plane that pictures
 * the most, since the crossed planes show one shoot from each side.
 */
function rowCover(kit: SpeciesKitData, rows: ShootRows, r: number): number {
	const prototype = kit.prototypes[rows.prototype[r] as number];
	if (!prototype) return 0;
	let most = 0;
	for (const plane of prototype.card.planes) {
		const area =
			4 *
			length3(plane.right[0], plane.right[1], plane.right[2]) *
			length3(plane.up[0], plane.up[1], plane.up[2]) *
			picturedOf(kit, plane.front).share;
		if (area > most) most = area;
	}
	const scale = rows.scale[r] as number;
	return most * scale * scale;
}

/**
 * How much a level's cards grow to make up the cover of the wood the level does not draw: the
 * square root of one and that wood's share of the cover of the leaf form's cards. A branch's cover
 * is the area a camera sees of it from its side. A level that draws all the wood grows nothing.
 *
 * @param input The dressed variant.
 * @param drawn Whether the level draws an axis.
 * @returns The growth, 1 or more.
 */
function woodMakeUp(input: MeshInput, drawn: (axis: number) => boolean): number {
	const { skeleton, rows, kit } = input;
	const { axes, position, radius } = skeleton;
	let wood = 0;
	for (let a = 0; a < axes.count; a++) {
		if (drawn(a)) continue;
		for (let n = axes.first[a] as number; n < (axes.last[a] as number); n++)
			wood +=
				length3(
					(position[n * 3 + 3] as number) - (position[n * 3] as number),
					(position[n * 3 + 4] as number) - (position[n * 3 + 1] as number),
					(position[n * 3 + 5] as number) - (position[n * 3 + 2] as number),
				) *
				((radius[n] as number) + (radius[n + 1] as number));
	}
	if (wood <= 0) return 1;
	let cards = 0;
	for (let r = 0; r < rows.count; r++) cards += rowCover(kit, rows, r);
	return cards > 0 ? Math.sqrt(1 + wood / cards) : 1;
}

/**
 * How a level joins its cards to the plant. A plant that sparseness took foliage from keeps every
 * card its level keeps, and draws the branch under each card that would otherwise hang free: the
 * sparseness has chosen what the plant holds, and every level shows that same plant. A plant as
 * grown drops such a card unless its options say otherwise.
 */
type CardJoin = NonNullable<MeshInput['cardJoin']> | 'support';

/**
 * The join rule of a dressed variant. A skeleton that names where its axes stood as grown is one
 * that sparseness took foliage from.
 */
function joinOf(input: MeshInput): CardJoin {
	return input.cardJoin ?? (input.skeleton.axes.origin ? 'support' : 'remove');
}

/** The card rows a level keeps, by the level's share of the rows' space-filling order. */
function keptRows(input: MeshInput, level: 1 | 2): number[] {
	const { rows, kit } = input;
	const kept: number[] = [];
	const grows = cardRows(input, level);
	for (let r = 0; r < rows.count; r++) {
		if (grows[r] === 0) continue;
		if (!kit.prototypes[rows.prototype[r] as number]) continue;
		kept.push(r);
	}
	return kept;
}

/**
 * Of some card rows, those joined to the plant: a card joins where its own leaves reach a branch
 * that is drawn, or another joined card.
 *
 * @param input The dressed variant.
 * @param kept The card rows a level keeps.
 * @param drawn Whether the level draws an axis.
 * @returns One flag per row of the variant, 1 for a joined card.
 */
function joinedCards(
	input: MeshInput,
	kept: readonly number[],
	drawn: (axis: number) => boolean,
): Uint8Array {
	const { skeleton, rows } = input;
	const { position, axisOf, nodeCount } = skeleton;
	const joined = new Uint8Array(rows.count);
	const queue: number[] = [];
	const seedReach = SEED_REACH * SEED_REACH;
	for (const r of kept) {
		const x = rows.position[r * 3] as number;
		const y = rows.position[r * 3 + 1] as number;
		const z = rows.position[r * 3 + 2] as number;
		let best = Number.POSITIVE_INFINITY;
		for (let n = 0; n < nodeCount; n++) {
			if (!drawn(axisOf[n] as number)) continue;
			const dx = (position[n * 3] as number) - x;
			const dy = (position[n * 3 + 1] as number) - y;
			const dz = (position[n * 3 + 2] as number) - z;
			const d = dx * dx + dy * dy + dz * dz;
			if (d < best) best = d;
		}
		if (best <= seedReach) {
			joined[r] = 1;
			queue.push(r);
		}
	}
	const cardReach = CARD_REACH * CARD_REACH;
	while (queue.length > 0) {
		const r = queue.pop() as number;
		const x = rows.position[r * 3] as number;
		const y = rows.position[r * 3 + 1] as number;
		const z = rows.position[r * 3 + 2] as number;
		for (const other of kept) {
			if (joined[other]) continue;
			const dx = (rows.position[other * 3] as number) - x;
			const dy = (rows.position[other * 3 + 1] as number) - y;
			const dz = (rows.position[other * 3 + 2] as number) - z;
			if (dx * dx + dy * dy + dz * dz <= cardReach) {
				joined[other] = 1;
				queue.push(other);
			}
		}
	}
	return joined;
}

/**
 * The branches some card rows stand on: for each row, the axis of its node, or of the nearest node
 * where the rows name none, and every axis above it.
 */
function branchesUnder(input: MeshInput, cards: readonly number[]): Uint8Array {
	const { skeleton, rows } = input;
	const { position, axisOf, nodeCount, axes } = skeleton;
	const out = new Uint8Array(axes.count);
	for (const r of cards) {
		let axis = -1;
		if (rows.node) axis = axisOf[rows.node[r] as number] as number;
		else {
			const x = rows.position[r * 3] as number;
			const y = rows.position[r * 3 + 1] as number;
			const z = rows.position[r * 3 + 2] as number;
			let best = Number.POSITIVE_INFINITY;
			for (let n = 0; n < nodeCount; n++) {
				const dx = (position[n * 3] as number) - x;
				const dy = (position[n * 3 + 1] as number) - y;
				const dz = (position[n * 3 + 2] as number) - z;
				const d = dx * dx + dy * dy + dz * dz;
				if (d < best) {
					best = d;
					axis = axisOf[n] as number;
				}
			}
		}
		for (let a = axis; a >= 0 && out[a] !== 1; a = axes.parent[a] as number) out[a] = 1;
	}
	return out;
}

/**
 * The branches a level draws beside its own orders so its cards stay joined: with a `branch` join,
 * the branches under every card the level keeps; on a plant that sparseness took foliage from, the
 * branches under each card that reaches neither the level's wood nor a joined card.
 *
 * @param input The dressed variant.
 * @param level The card level.
 * @returns One flag per axis, 1 for a branch the level draws for its cards; undefined when the
 *   level draws its own orders alone.
 * @category api/vegetation
 */
export function supportAxes(input: MeshInput, level: 1 | 2): Uint8Array | undefined {
	const join = joinOf(input);
	if (join === 'branch') return branchesUnder(input, keptRows(input, level));
	if (join !== 'support') return undefined;
	const kept = keptRows(input, level);
	const keep = input.record.lod.woodOrders[level - 1] ?? 255;
	const orders = input.skeleton.axes.order;
	const joined = joinedCards(input, kept, (axis) => (orders[axis] as number) <= keep);
	return branchesUnder(
		input,
		kept.filter((r) => joined[r] === 0),
	);
}

/**
 * The kept card rows that a twig join must give a line to the wood: those whose leaves reach no
 * drawn branch and no other joined card.
 *
 * @param input The dressed variant.
 * @param level The card level.
 * @returns The rows that need a twig.
 * @category api/vegetation
 */
export function cardTwigs(input: MeshInput, level: 1 | 2): number[] {
	const keep = input.record.lod.woodOrders[level - 1] ?? 255;
	const orders = input.skeleton.axes.order;
	const kept = keptRows(input, level);
	const joined = joinedCards(input, kept, (axis) => (orders[axis] as number) <= keep);
	return kept.filter((r) => joined[r] === 0);
}

/**
 * The card rows a level draws, each joined to the plant: a card joins where its own leaves reach a
 * branch the level draws, or another joined card, so no clump of cards hangs free. A level that
 * thins the wood as well as the cards drops the cards whose branch went with it, unless its join
 * rule draws that branch or a twig to it.
 *
 * @param input The dressed variant.
 * @param level The card level.
 * @returns One flag per row, 1 for a card the level draws.
 * @category api/vegetation
 */
export function connectedCards(input: MeshInput, level: 1 | 2): Uint8Array {
	const keep = input.record.lod.woodOrders[level - 1] ?? 255;
	const orders = input.skeleton.axes.order;
	const join = joinOf(input);
	const kept = keptRows(input, level);
	// A twig join keeps every kept card, and the mesh draws the unjoined ones a line to the wood.
	// A level that draws the branch under each card it keeps holds them all too.
	if (join === 'twig' || join === 'support') {
		const all = new Uint8Array(input.rows.count);
		for (const r of kept) all[r] = 1;
		return all;
	}
	const support = join === 'branch' ? branchesUnder(input, kept) : undefined;
	return joinedCards(
		input,
		kept,
		(axis) => (orders[axis] as number) <= keep || support?.[axis] === 1,
	);
}

/**
 * The shoot cards of one variant at a card level.
 *
 * @param input The dressed variant.
 * @param level The card level.
 * @returns The cards' mesh.
 */
export function cardMesh(input: MeshInput, level: 1 | 2): MeshArrays {
	const { rows, kit } = input;
	const mesh = new MeshWriter();
	const size = kit.cards.size || 1;
	const base = input.variant * VARIANT_RECORDS;
	const local: Vector3 = [0, 0, 0];
	const world: Vector3 = [0, 0, 0];
	const connected = connectedCards(input, level);
	const { skeleton } = input;
	const { position, axisOf, nodeCount } = skeleton;
	const keep = input.record.lod.woodOrders[level - 1] ?? 255;
	const twigs = input.cardJoin === 'twig' ? new Set(cardTwigs(input, level)) : undefined;
	const grows = cardRows(input, level);
	const back: Vector3 = [0, 0, 0];
	const support = supportAxes(input, level);
	const more = woodMakeUp(
		input,
		(axis) => (skeleton.axes.order[axis] as number) <= keep || support?.[axis] === 1,
	);
	for (let r = 0; r < rows.count; r++) {
		const most = (grows[r] as number) * more;
		if (most === 0 || connected[r] === 0) continue;
		const prototype = kit.prototypes[rows.prototype[r] as number];
		if (!prototype) continue;
		// A card grows to make up the cover its level does not draw, a dropped neighbour's and the
		// dropped wood's, as far as the leaf form's hull lets it.
		const grow = growthInHull(input, r, most, undefined, NO_SHIFT, back);
		const scale = rows.scale[r] as number;
		const record = base + (rows.record[r] as number);
		const colour = [
			(record >>> 8) & 255,
			record & 255,
			rows.phase[r] as number,
			rows.sky[r] as number,
		];
		const px = rows.position[r * 3] as number;
		const py = rows.position[r * 3 + 1] as number;
		const pz = rows.position[r * 3 + 2] as number;
		prototype.card.planes.forEach((plane, k) => {
			const n = normalize3([
				plane.right[1] * plane.up[2] - plane.right[2] * plane.up[1],
				plane.right[2] * plane.up[0] - plane.right[0] * plane.up[2],
				plane.right[0] * plane.up[1] - plane.right[1] * plane.up[0],
			]);
			const normal = quatRotate(rows.rotation, r * 4, n, [0, 0, 0]);
			const first = mesh.vertices;
			const [rx, ry, rw, rh] = plane.front;
			for (const [sx, sy] of CARD_CORNERS) {
				for (let c = 0; c < 3; c++)
					local[c] =
						((plane.centre[c] as number) +
							grow * (sx * (plane.right[c] as number) + sy * (plane.up[c] as number))) *
						scale;
				quatRotate(rows.rotation, r * 4, local, world);
				mesh.vertex(
					[px + back[0] + world[0], py + back[1] + world[1], pz + back[2] + world[2]],
					normal,
					[(rx + ((sx + 1) / 2) * rw) / size, (ry + ((sy + 1) / 2) * rh) / size],
					[(sy + 1) / 2, k / 2],
					colour,
				);
			}
			mesh.quad(first, first + 1, first + 2, first + 3);
		});
		// A twig join's line runs from the card to the nearest branch the level draws, so the card
		// stands on the plant even where its own twig is not drawn.
		if (twigs?.has(r)) {
			let best = Number.POSITIVE_INFINITY;
			let bx = 0;
			let by = 0;
			let bz = 0;
			for (let n = 0; n < nodeCount; n++) {
				const axis = axisOf[n] as number;
				if ((skeleton.axes.order[axis] as number) > keep) continue;
				const dx = (position[n * 3] as number) - px;
				const dy = (position[n * 3 + 1] as number) - py;
				const dz = (position[n * 3 + 2] as number) - pz;
				const d = dx * dx + dy * dy + dz * dz;
				if (d < best) {
					best = d;
					bx = position[n * 3] as number;
					by = position[n * 3 + 1] as number;
					bz = position[n * 3 + 2] as number;
				}
			}
			if (Number.isFinite(best) && best > 1e-8) {
				const dl = Math.sqrt(best);
				const normal: Vector3 = [(bx - px) / dl, (by - py) / dl, (bz - pz) / dl];
				const first = mesh.vertices;
				mesh.vertex([px, py, pz], normal, [0, 0], [0, STALK_PLANE], colour);
				mesh.vertex([px, py, pz], normal, [1, 0], [0, STALK_PLANE], colour);
				mesh.vertex([bx, by, bz], normal, [1, 0], [1, STALK_PLANE], colour);
				mesh.vertex([bx, by, bz], normal, [0, 0], [1, STALK_PLANE], colour);
				mesh.quad(first, first + 1, first + 2, first + 3);
				mesh.quad(first + 3, first + 2, first + 1, first);
			}
		}
		const stalk = Math.max(0, input.record.lod.cardStalk ?? 0);
		if (stalk > 0 && rows.back) {
			const bx = rows.back[r * 3] as number;
			const by = rows.back[r * 3 + 1] as number;
			const bz = rows.back[r * 3 + 2] as number;
			// The line's two ends: the row's own origin, and either the stretch's far end or, where
			// the record asks, the centre of the foliage the card carries. That centre stands ahead
			// of the row by the shoot's own length, so the stretch alone can end short of it and
			// leave the leaves joined to nothing; the line then runs the whole way from the wood.
			const from: Vector3 = [px, py, pz];
			let to: Vector3 = [px + bx, py + by, pz + bz];
			const centre = input.record.lod.cardStalkToFoliage
				? prototype.card.planes[0]?.centre
				: undefined;
			if (centre) {
				quatRotate(
					rows.rotation,
					r * 4,
					[centre[0] * scale, centre[1] * scale, centre[2] * scale],
					world,
				);
				to = [px + back[0] + world[0], py + back[1] + world[1], pz + back[2] + world[2]];
			}
			const dx = to[0] - from[0];
			const dy = to[1] - from[1];
			const dz = to[2] - from[2];
			const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (length > 1e-6) {
				// The supporting twig as a line from the parent's end to the leaves' centre: two
				// coincident vertices at each end, which the vertex stage widens to the record's least
				// width on screen.
				const normal: Vector3 = [dx / length, dy / length, dz / length];
				const first = mesh.vertices;
				mesh.vertex(from, normal, [0, 0], [0, STALK_PLANE], colour);
				mesh.vertex(from, normal, [1, 0], [0, STALK_PLANE], colour);
				mesh.vertex(to, normal, [1, 0], [1, STALK_PLANE], colour);
				mesh.vertex(to, normal, [0, 0], [1, STALK_PLANE], colour);
				mesh.quad(first, first + 1, first + 2, first + 3);
				// The line shows from either side of the plant: the vertex stage widens it, so its
				// winding turns with the view, and a back face is not culled.
				mesh.quad(first + 3, first + 2, first + 1, first);
			}
		}
	}
	return mesh.finishMesh();
}

/** The triangles of one stalk: a line of two faces from a card to the wood. */
export const STALK_TRIANGLES = 4;

/**
 * How near a card's plane must pass to the drawn wood, or to another card's middle, for the two to
 * count as touching, in metres.
 */
const CARD_TOUCH = 0.2;

/** The cells a side of the grid that finds a cluster's neighbours, and half of them. */
const GRID_SPAN = 4096;
const GRID_HALF = GRID_SPAN / 2;

/** How many root-mean-square distances of its rows from its middle a cluster's cards cover. */
const CLUSTER_SPREAD = 1.25;

/**
 * One cluster of a level's cards under a triangle maximum: a run of neighbouring shoot rows drawn as
 * one card set.
 *
 * @category api/vegetation
 */
export interface CardCluster {
	/** The row whose prototype, turn and bytes the cluster's cards take. */
	readonly row: number;
	/** The rows it stands for. */
	readonly rows: number;
	/** The centre of its cards, in plant space. */
	readonly centre: Vector3;
	/** How much its cards grow about their centre. */
	readonly grow: number;
	/** How far its cards reach from their centre, in metres. */
	readonly reach: number;
	/** The nearest point of the drawn wood under it, where the level draws wood it hangs on. */
	readonly anchor?: Vector3;
	/** Whether a line joins it to its anchor: its cards touch neither the wood nor a joined card. */
	readonly stalk: boolean;
}

/**
 * How a level draws an axis's wood: not at all, along the axis, or as one straight run from its
 * base to its tip.
 */
export type DrawnWood = 0 | 1 | 2;

/** The point where an axis leaves its parent, or its own base for an axis with no parent. */
function junction(skeleton: MeshInput['skeleton'], axis: number, out: Vector3): Vector3 {
	const { axes, position } = skeleton;
	const parent = axes.parent[axis] as number;
	const node = axes.parentNode[axis] as number;
	if (parent < 0 || node < 0) {
		const first = axes.first[axis] as number;
		out[0] = position[first * 3] as number;
		out[1] = position[first * 3 + 1] as number;
		out[2] = position[first * 3 + 2] as number;
		return out;
	}
	const next = Math.min(node + 1, axes.last[parent] as number);
	const t = axes.parentT[axis] as number;
	for (let k = 0; k < 3; k++)
		out[k] = (position[node * 3 + k] as number) * (1 - t) + (position[next * 3 + k] as number) * t;
	return out;
}

/**
 * The nearest point of the drawn wood under a shoot row: the row's own node where its axis is
 * drawn, or else the place where the first axis above it that is drawn takes the branch it hangs
 * on. On an axis drawn as one straight run, the point is moved onto that run.
 */
function anchorOf(
	input: MeshInput,
	row: number,
	drawn: (axis: number) => DrawnWood,
): Vector3 | undefined {
	const { skeleton, rows } = input;
	const { axes, position, axisOf } = skeleton;
	if (!rows.node) return undefined;
	const node = rows.node[row] as number;
	let axis = axisOf[node] as number;
	const at: Vector3 = [
		position[node * 3] as number,
		position[node * 3 + 1] as number,
		position[node * 3 + 2] as number,
	];
	while (axis >= 0 && drawn(axis) === 0) {
		junction(skeleton, axis, at);
		axis = axes.parent[axis] as number;
	}
	if (axis < 0) return undefined;
	if (drawn(axis) === 2) {
		const from = junction(skeleton, axis, [0, 0, 0]);
		const tip = axes.last[axis] as number;
		const dx = (position[tip * 3] as number) - from[0];
		const dy = (position[tip * 3 + 1] as number) - from[1];
		const dz = (position[tip * 3 + 2] as number) - from[2];
		const length = dx * dx + dy * dy + dz * dz;
		const along =
			length > 1e-12
				? Math.min(
						1,
						Math.max(
							0,
							((at[0] - from[0]) * dx + (at[1] - from[1]) * dy + (at[2] - from[2]) * dz) / length,
						),
					)
				: 0;
		at[0] = from[0] + dx * along;
		at[1] = from[1] + dy * along;
		at[2] = from[2] + dz * along;
	}
	return at;
}

/** The most triangles a wood mesh may hold for its surface to be searched triangle by triangle. */
const SEARCHED_TRIANGLES = 2048;

/**
 * The nearest point of a wood mesh's surface to a point: by its triangles where the mesh is small,
 * as a few straight runs are, and by its vertices where it is fine enough that a vertex is near
 * every point of it.
 *
 * @param wood The wood's mesh.
 * @returns A function from a point to the nearest point of the surface, or undefined for no wood.
 * @category api/vegetation
 */
export function woodSurface(wood: MeshArrays): ((point: Vector3) => Vector3) | undefined {
	const { positions, indices } = wood;
	if (indices.length === 0) return undefined;
	if (indices.length / 3 <= SEARCHED_TRIANGLES)
		return (point) => {
			let best = Number.POSITIVE_INFINITY;
			const out: Vector3 = [point[0], point[1], point[2]];
			const near: Vector3 = [0, 0, 0];
			for (let t = 0; t < indices.length; t += 3) {
				nearestOnTriangle(
					point,
					positions,
					(indices[t] as number) * 3,
					(indices[t + 1] as number) * 3,
					(indices[t + 2] as number) * 3,
					near,
				);
				const d = (near[0] - point[0]) ** 2 + (near[1] - point[1]) ** 2 + (near[2] - point[2]) ** 2;
				if (d < best) {
					best = d;
					out[0] = near[0];
					out[1] = near[1];
					out[2] = near[2];
				}
			}
			return out;
		};
	// A grid of the vertices, searched outward ring by ring of cells from the point's own.
	const cell = SURFACE_CELL;
	const key = (x: number, y: number, z: number) =>
		((x + GRID_HALF) * GRID_SPAN + (y + GRID_HALF)) * GRID_SPAN + (z + GRID_HALF);
	const grid = new Map<number, number[]>();
	for (let v = 0; v < positions.length; v += 3) {
		const k = key(
			Math.floor((positions[v] as number) / cell),
			Math.floor((positions[v + 1] as number) / cell),
			Math.floor((positions[v + 2] as number) / cell),
		);
		const list = grid.get(k);
		if (list) list.push(v);
		else grid.set(k, [v]);
	}
	return (point) => {
		const x = Math.floor(point[0] / cell);
		const y = Math.floor(point[1] / cell);
		const z = Math.floor(point[2] / cell);
		let best = Number.POSITIVE_INFINITY;
		let found = -1;
		for (let ring = 0; ring <= SURFACE_RINGS; ring++) {
			for (let dx = -ring; dx <= ring; dx++)
				for (let dy = -ring; dy <= ring; dy++)
					for (let dz = -ring; dz <= ring; dz++) {
						if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== ring) continue;
						for (const v of grid.get(key(x + dx, y + dy, z + dz)) ?? []) {
							const d =
								((positions[v] as number) - point[0]) ** 2 +
								((positions[v + 1] as number) - point[1]) ** 2 +
								((positions[v + 2] as number) - point[2]) ** 2;
							if (d < best) {
								best = d;
								found = v;
							}
						}
					}
			// A vertex found in a ring is the nearest once the next ring out cannot hold a nearer one.
			if (found >= 0 && best <= (ring * cell) ** 2) break;
		}
		return found < 0
			? [point[0], point[1], point[2]]
			: [
					positions[found] as number,
					positions[found + 1] as number,
					positions[found + 2] as number,
				];
	};
}

/** The side of the cells that hold a fine wood mesh's vertices, in metres, and the rings searched. */
const SURFACE_CELL = 0.5;
const SURFACE_RINGS = 12;

/** The nearest point of a triangle to a point. */
function nearestOnTriangle(
	p: Readonly<Vector3>,
	v: ArrayLike<number>,
	a: number,
	b: number,
	c: number,
	out: Vector3,
): void {
	const at = (i: number, k: number) => v[i + k] as number;
	const sub = (i: number, j: number): Vector3 => [
		at(i, 0) - at(j, 0),
		at(i, 1) - at(j, 1),
		at(i, 2) - at(j, 2),
	];
	const dot = (x: Readonly<Vector3>, y: Readonly<Vector3>) =>
		x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
	const ab = sub(b, a);
	const ac = sub(c, a);
	const ap: Vector3 = [p[0] - at(a, 0), p[1] - at(a, 1), p[2] - at(a, 2)];
	const set = (wa: number, wb: number, wc: number) => {
		for (let k = 0; k < 3; k++) out[k] = wa * at(a, k) + wb * at(b, k) + wc * at(c, k);
	};
	const d1 = dot(ab, ap);
	const d2 = dot(ac, ap);
	if (d1 <= 0 && d2 <= 0) {
		set(1, 0, 0);
		return;
	}
	const bp: Vector3 = [p[0] - at(b, 0), p[1] - at(b, 1), p[2] - at(b, 2)];
	const d3 = dot(ab, bp);
	const d4 = dot(ac, bp);
	if (d3 >= 0 && d4 <= d3) {
		set(0, 1, 0);
		return;
	}
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const t = d1 / (d1 - d3 || 1);
		set(1 - t, t, 0);
		return;
	}
	const cp: Vector3 = [p[0] - at(c, 0), p[1] - at(c, 1), p[2] - at(c, 2)];
	const d5 = dot(ab, cp);
	const d6 = dot(ac, cp);
	if (d6 >= 0 && d5 <= d6) {
		set(0, 0, 1);
		return;
	}
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const t = d2 / (d2 - d6 || 1);
		set(1 - t, 0, t);
		return;
	}
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const t = (d4 - d3) / (d4 - d3 + (d5 - d6) || 1);
		set(0, 1 - t, t);
		return;
	}
	const sum = va + vb + vc || 1;
	set(va / sum, vb / sum, vc / sum);
}

/**
 * The clusters of a level's cards under a triangle maximum. The rows stand in the order a walk of
 * the plant meets them, so a run of the list is a neighbourhood of the crown; the list is cut into
 * `count` runs, and each run draws one card set at the middle of its rows' cards. A cluster of one
 * row is that row's own card. A larger one grows by the square root of its rows, so the crown keeps
 * its cover, but never past the reach of the rows it stands for.
 *
 * Every cluster stays joined to the plant: one of its card planes passes the wood the level draws,
 * or the middle of a joined cluster, within a hand's breadth, or it takes a stalk, a line to the
 * wood.
 *
 * @param input The dressed variant.
 * @param walk The rows in the order a walk of the plant meets them.
 * @param count The clusters to make, from 1 to the rows.
 * @param drawn How the level draws each axis's wood.
 * @param planes The card planes each cluster draws, from 1 to 3.
 * @param surface The nearest point of the drawn wood's surface to a point, so a cluster hangs on
 *   wood that is drawn and not on an axis inside it; the axis's own place when absent.
 * @returns The clusters.
 * @category api/vegetation
 */
export function cardClusters(
	input: MeshInput,
	walk: ArrayLike<number>,
	count: number,
	drawn: (axis: number) => DrawnWood,
	planes = 3,
	surface?: (point: Vector3) => Vector3,
): CardCluster[] {
	const { rows, kit } = input;
	const total = walk.length;
	const clusters = Math.max(0, Math.min(total, Math.floor(count)));
	const centre: Vector3 = [0, 0, 0];
	const local: Vector3 = [0, 0, 0];
	/** The middle of a row's first card plane, in plant space. */
	const cardCentre = (r: number, out: Vector3): Vector3 => {
		const plane = kit.prototypes[rows.prototype[r] as number]?.card.planes[0];
		const scale = rows.scale[r] as number;
		local[0] = (plane?.centre[0] ?? 0) * scale;
		local[1] = (plane?.centre[1] ?? 0) * scale;
		local[2] = (plane?.centre[2] ?? 0) * scale;
		quatRotate(rows.rotation, r * 4, local, out);
		out[0] += rows.position[r * 3] as number;
		out[1] += rows.position[r * 3 + 1] as number;
		out[2] += rows.position[r * 3 + 2] as number;
		return out;
	};
	const edge: Vector3 = [0, 0, 0];
	const right: Vector3 = [0, 0, 0];
	const up: Vector3 = [0, 0, 0];
	const lead: Vector3 = [0, 0, 0];
	/** The distance from a point to the nearest of a cluster's card planes, as the mesh draws them. */
	const toCards = (
		cluster: { readonly row: number; readonly centre: Vector3; readonly grow: number },
		point: Readonly<Vector3>,
	): number => {
		const r = cluster.row;
		const prototype = kit.prototypes[rows.prototype[r] as number];
		const scale = rows.scale[r] as number;
		const first = prototype?.card.planes[0];
		if (!prototype || !first) return Number.POSITIVE_INFINITY;
		quatRotate(rows.rotation, r * 4, [first.centre[0], first.centre[1], first.centre[2]], lead);
		let nearest = Number.POSITIVE_INFINITY;
		for (const plane of prototype.card.planes.slice(0, planes)) {
			quatRotate(rows.rotation, r * 4, [plane.centre[0], plane.centre[1], plane.centre[2]], edge);
			quatRotate(rows.rotation, r * 4, [plane.right[0], plane.right[1], plane.right[2]], right);
			quatRotate(rows.rotation, r * 4, [plane.up[0], plane.up[1], plane.up[2]], up);
			const dx = point[0] - (cluster.centre[0] + (edge[0] - lead[0]) * scale);
			const dy = point[1] - (cluster.centre[1] + (edge[1] - lead[1]) * scale);
			const dz = point[2] - (cluster.centre[2] + (edge[2] - lead[2]) * scale);
			const half = cluster.grow * scale;
			const rl = Math.sqrt(right[0] ** 2 + right[1] ** 2 + right[2] ** 2) || 1;
			const ul = Math.sqrt(up[0] ** 2 + up[1] ** 2 + up[2] ** 2) || 1;
			const across = Math.max(
				0,
				Math.abs((dx * right[0] + dy * right[1] + dz * right[2]) / rl) - rl * half,
			);
			const along = Math.max(0, Math.abs((dx * up[0] + dy * up[1] + dz * up[2]) / ul) - ul * half);
			const nx = right[1] * up[2] - right[2] * up[1];
			const ny = right[2] * up[0] - right[0] * up[2];
			const nz = right[0] * up[1] - right[1] * up[0];
			const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
			const off = Math.abs(dx * nx + dy * ny + dz * nz) / nl;
			nearest = Math.min(nearest, Math.sqrt(across * across + along * along + off * off));
		}
		return nearest;
	};
	const made: {
		row: number;
		rows: number;
		centre: Vector3;
		grow: number;
		reach: number;
		anchor?: Vector3;
		joined: boolean;
	}[] = [];
	let longest = 0;
	// Where each run ends. An even cut would often fall inside a branch's foliage and join the end
	// of one branch to the start of the next, so each cut moves, within a quarter of a run, to the
	// widest step between two neighbours of the walk: the place where the walk leaves a branch.
	const ends = new Uint32Array(clusters);
	const window = clusters > 0 ? Math.floor(total / clusters / 4) : 0;
	const before: Vector3 = [0, 0, 0];
	for (let c = 0; c < clusters; c++) {
		const even = Math.floor(((c + 1) * total) / clusters);
		let cut = even;
		if (c < clusters - 1 && window > 0) {
			let widest = -1;
			for (let i = Math.max(1, even - window); i <= Math.min(total - 1, even + window); i++) {
				cardCentre(walk[i - 1] as number, before);
				cardCentre(walk[i] as number, centre);
				const step =
					(centre[0] - before[0]) ** 2 +
					(centre[1] - before[1]) ** 2 +
					(centre[2] - before[2]) ** 2;
				if (step > widest) {
					widest = step;
					cut = i;
				}
			}
		}
		ends[c] = cut;
	}
	for (let c = 0; c < clusters; c++) {
		const from = c === 0 ? 0 : (ends[c - 1] as number);
		const to = ends[c] as number;
		const members = to - from;
		if (members <= 0) continue;
		const row = walk[from + (members >> 1)] as number;
		const middle: Vector3 = [0, 0, 0];
		for (let i = from; i < to; i++) {
			cardCentre(walk[i] as number, centre);
			middle[0] += centre[0] / members;
			middle[1] += centre[1] / members;
			middle[2] += centre[2] / members;
		}
		// How far the run's rows stand from its middle, as the root of their mean square: a card
		// that covers this much holds most of the run without following its farthest shoot.
		let spread = 0;
		for (let i = from; i < to && members > 1; i++) {
			cardCentre(walk[i] as number, centre);
			spread +=
				((centre[0] - middle[0]) ** 2 +
					(centre[1] - middle[1]) ** 2 +
					(centre[2] - middle[2]) ** 2) /
				members;
		}
		spread = Math.sqrt(spread) * CLUSTER_SPREAD;
		const plane = kit.prototypes[rows.prototype[row] as number]?.card.planes[0];
		const half =
			(rows.scale[row] as number) *
			(plane
				? Math.max(
						Math.sqrt(plane.right[0] ** 2 + plane.right[1] ** 2 + plane.right[2] ** 2),
						Math.sqrt(plane.up[0] ** 2 + plane.up[1] ** 2 + plane.up[2] ** 2),
					)
				: 0);
		const fit = half > 1e-9 ? (spread + half) / half : 1;
		// The cluster's cards stand at the middle of its rows and grow to make up their cover, as far
		// as the leaf form's hull lets them.
		cardCentre(row, centre);
		const grow = growthInHull(input, row, Math.max(1, Math.min(Math.sqrt(members), fit)), planes, [
			middle[0] - centre[0],
			middle[1] - centre[1],
			middle[2] - centre[2],
		]);
		const onAxis = anchorOf(input, row, drawn);
		const anchor = onAxis && surface ? surface(onAxis) : onAxis;
		const joined =
			anchor !== undefined && toCards({ row, centre: middle, grow }, anchor) <= CARD_TOUCH;
		const reach = grow * half;
		longest = Math.max(longest, reach);
		made.push({
			row,
			rows: members,
			centre: middle,
			grow,
			reach,
			joined,
			...(anchor ? { anchor } : {}),
		});
	}
	// The clusters whose cards touch a joined cluster's are joined too. A grid of cells as wide as
	// the longest reach finds each cluster's neighbours without comparing every pair.
	if (made.some((cluster) => !cluster.joined) && longest > 0) {
		const cell = 2 * longest;
		// A cell's key: its three indices, each within a span that holds any plant, in one number.
		const key = (x: number, y: number, z: number) =>
			((x + GRID_HALF) * GRID_SPAN + (y + GRID_HALF)) * GRID_SPAN + (z + GRID_HALF);
		const grid = new Map<number, number[]>();
		const cellOf = (p: Vector3) =>
			[Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)] as const;
		made.forEach((cluster, index) => {
			const [x, y, z] = cellOf(cluster.centre);
			const list = grid.get(key(x, y, z));
			if (list) list.push(index);
			else grid.set(key(x, y, z), [index]);
		});
		const queue: number[] = [];
		made.forEach((cluster, index) => {
			if (cluster.joined) queue.push(index);
		});
		while (queue.length > 0) {
			const a = made[queue.pop() as number] as (typeof made)[number];
			const [x, y, z] = cellOf(a.centre);
			for (let dx = -1; dx <= 1; dx++)
				for (let dy = -1; dy <= 1; dy++)
					for (let dz = -1; dz <= 1; dz++)
						for (const other of grid.get(key(x + dx, y + dy, z + dz)) ?? []) {
							const b = made[other] as (typeof made)[number];
							if (b.joined) continue;
							// A card's planes pass through its middle, so two clusters touch where a plane
							// of one passes the middle of the other.
							if (toCards(a, b.centre) <= CARD_TOUCH || toCards(b, a.centre) <= CARD_TOUCH) {
								b.joined = true;
								queue.push(other);
							}
						}
		}
	}
	return made.map(({ joined, ...cluster }) => ({
		...cluster,
		stalk: !joined && cluster.anchor !== undefined,
	}));
}

/**
 * The triangles of some card clusters: two for each plane of each cluster, and a stalk's for each
 * cluster that takes one.
 *
 * @param clusters The clusters.
 * @param planes The card planes each cluster draws, from 1 to 3.
 * @returns The count.
 * @category api/vegetation
 */
export function clusterTriangles(clusters: readonly CardCluster[], planes: number): number {
	let triangles = 0;
	for (const cluster of clusters) triangles += 2 * planes + (cluster.stalk ? STALK_TRIANGLES : 0);
	return triangles;
}

/**
 * The cards of some clusters, as one mesh: each cluster's planes about its centre, and a stalk to
 * its anchor where it takes one.
 *
 * @param input The dressed variant.
 * @param clusters The clusters.
 * @param planes The card planes each cluster draws, from 1 to 3: the two upright ones first.
 * @returns The cards' mesh.
 * @category api/vegetation
 */
export function clusterCardMesh(
	input: MeshInput,
	clusters: readonly CardCluster[],
	planes: number,
): MeshArrays {
	const { rows, kit } = input;
	const mesh = new MeshWriter();
	const size = kit.cards.size || 1;
	const base = input.variant * VARIANT_RECORDS;
	const local: Vector3 = [0, 0, 0];
	const world: Vector3 = [0, 0, 0];
	const first0: Vector3 = [0, 0, 0];
	for (const cluster of clusters) {
		const r = cluster.row;
		const prototype = kit.prototypes[rows.prototype[r] as number];
		if (!prototype) continue;
		const scale = rows.scale[r] as number;
		const record = base + (rows.record[r] as number);
		const colour = [
			(record >>> 8) & 255,
			record & 255,
			rows.phase[r] as number,
			rows.sky[r] as number,
		];
		const lead = prototype.card.planes[0];
		// The card set keeps its own shape and turn, and moves so its first plane's middle stands on
		// the cluster's centre.
		local[0] = (lead?.centre[0] ?? 0) * scale;
		local[1] = (lead?.centre[1] ?? 0) * scale;
		local[2] = (lead?.centre[2] ?? 0) * scale;
		quatRotate(rows.rotation, r * 4, local, first0);
		prototype.card.planes.slice(0, planes).forEach((plane, k) => {
			const n = normalize3([
				plane.right[1] * plane.up[2] - plane.right[2] * plane.up[1],
				plane.right[2] * plane.up[0] - plane.right[0] * plane.up[2],
				plane.right[0] * plane.up[1] - plane.right[1] * plane.up[0],
			]);
			const normal = quatRotate(rows.rotation, r * 4, n, [0, 0, 0]);
			const first = mesh.vertices;
			const [rx, ry, rw, rh] = plane.front;
			for (const [sx, sy] of CARD_CORNERS) {
				for (let c = 0; c < 3; c++)
					local[c] =
						((plane.centre[c] as number) +
							cluster.grow * (sx * (plane.right[c] as number) + sy * (plane.up[c] as number))) *
						scale;
				quatRotate(rows.rotation, r * 4, local, world);
				mesh.vertex(
					[
						cluster.centre[0] + world[0] - first0[0],
						cluster.centre[1] + world[1] - first0[1],
						cluster.centre[2] + world[2] - first0[2],
					],
					normal,
					[(rx + ((sx + 1) / 2) * rw) / size, (ry + ((sy + 1) / 2) * rh) / size],
					[(sy + 1) / 2, k / 2],
					colour,
				);
			}
			mesh.quad(first, first + 1, first + 2, first + 3);
		});
		if (!cluster.stalk || !cluster.anchor) continue;
		const from = cluster.centre;
		const to = cluster.anchor;
		const dx = to[0] - from[0];
		const dy = to[1] - from[1];
		const dz = to[2] - from[2];
		const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (length <= 1e-6) continue;
		// A line of two faces, which the vertex stage widens to the record's least width on screen.
		const normal: Vector3 = [dx / length, dy / length, dz / length];
		const first = mesh.vertices;
		mesh.vertex(from, normal, [0, 0], [0, STALK_PLANE], colour);
		mesh.vertex(from, normal, [1, 0], [0, STALK_PLANE], colour);
		mesh.vertex(to, normal, [1, 0], [1, STALK_PLANE], colour);
		mesh.vertex(to, normal, [0, 0], [1, STALK_PLANE], colour);
		mesh.quad(first, first + 1, first + 2, first + 3);
		mesh.quad(first + 3, first + 2, first + 1, first);
	}
	return mesh.finishMesh();
}
