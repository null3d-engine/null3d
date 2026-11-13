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
import { cos, length3, normalize3, quatRotate, sin, type Vector3 } from '../core/math';
import { MeshWriter } from '../leaf/writer';
import type { MeshInput } from '../stages';
import { VARIANT_RECORDS } from '../wind/records';

/** A card's corners: signs of its right and up half-extents. */
const CORNERS = [
	[-1, -1],
	[1, -1],
	[1, 1],
	[-1, 1],
] as const;

/** The second coordinate that marks a card's stalk, in a place that the three card planes leave free. */
const STALK_PLANE = 0.75;

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
	 * The edge of the picture: points on the plane's right and up extents, each from -1 to 1, two
	 * numbers a point. For each row of the plane's texels, they are the left side of its first texel
	 * of at least half cover and the right side of its last, at the row's bottom and top, each point
	 * once. The picture lies inside their hull.
	 */
	readonly edge: Float64Array;
	/** The share of the plane that the picture covers. */
	readonly share: number;
}

/** The whole plane, for a kit with no atlas. */
const WHOLE_PLANE: Pictured = { edge: new Float64Array(CORNERS.flat()), share: 1 };

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
		const edge: number[] = [];
		// A row that starts or ends where the row below it does shares that point with it.
		const seen = new Set<number>();
		const point = (across: number, up: number): void => {
			const at = across * (h + 1) + up;
			if (seen.has(at)) return;
			seen.add(at);
			edge.push((across / w) * 2 - 1, (up / h) * 2 - 1);
		};
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
			for (const up of [j, j + 1]) {
				point(left, up);
				point(right + 1, up);
			}
		}
		found = { edge: new Float64Array(edge), share: w * h > 0 ? covered / (w * h) : 0 };
		known.set(key, found);
	}
	return found;
}

/**
 * The hull of a plant's leaf form: how far the pictures of its shoots, each at its own size, reach
 * from the plant's axis in each band of height and each sector round it, and their lowest and
 * highest points. A grown card's picture stays inside it.
 *
 * @category api/vegetation
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

/**
 * The edges between the sectors round an axis, for a number of sectors: the direction of each, as
 * its cosine and sine, from a half turn back round to a half turn forward.
 */
function sectorEdges(sectors: number): Float64Array {
	const edges = new Float64Array((sectors + 1) * 2);
	for (let k = 0; k <= sectors; k++) {
		const turn = -Math.PI + (k * 2 * Math.PI) / sectors;
		edges[k * 2] = cos(turn);
		edges[k * 2 + 1] = sin(turn);
	}
	return edges;
}

const RIM_EDGES = sectorEdges(RIM_SECTORS);
const HULL_EDGES = sectorEdges(HULL_SECTORS);

/**
 * The sector round an axis that a direction stands in, counted from a half turn back: the sectors
 * of its half of the turn are passed while the direction stands beyond their far edge. A direction
 * of no length stands at no turn, as the arctangent gives.
 */
function sectorOf(dx: number, dz: number, sectors: number, edges: Float64Array): number {
	const half = sectors / 2;
	if (dx === 0 && dz === 0) return half;
	let k = dz < 0 ? 0 : half;
	const last = k + half - 1;
	while (
		k < last &&
		(edges[(k + 1) * 2] as number) * dz - (edges[(k + 1) * 2 + 1] as number) * dx >= 0
	)
		k++;
	return k;
}

/** The place in a hull's table of a point's band and sector. */
function hullCell(hull: FoliageHull, x: number, y: number, z: number): number {
	const tall = Math.max(1e-9, hull.high - hull.low);
	const band = Math.min(
		HULL_BANDS - 1,
		Math.max(0, Math.floor(((y - hull.low) / tall) * HULL_BANDS)),
	);
	return band * HULL_SECTORS + sectorOf(x - hull.x, z - hull.z, HULL_SECTORS, HULL_EDGES);
}

/** The points that `rowEdge` writes, three numbers a point; it grows as a row needs. */
let edgePoints = new Float64Array(3 * 1024);

/** A plane's middle and its right and up half-extents, scaled and turned as its row places them. */
const MIDDLE: Vector3 = [0, 0, 0];
const RIGHT: Vector3 = [0, 0, 0];
const UP: Vector3 = [0, 0, 0];
const SCALED: Vector3 = [0, 0, 0];

/** Scales a vector of a card plane and turns it as a row turns its shoot. */
function turned(
	rows: ShootRows,
	r: number,
	v: Readonly<Vector3>,
	scale: number,
	out: Vector3,
): void {
	SCALED[0] = (v[0] as number) * scale;
	SCALED[1] = (v[1] as number) * scale;
	SCALED[2] = (v[2] as number) * scale;
	quatRotate(rows.rotation, r * 4, SCALED, out);
}

/**
 * Writes into `edgePoints` each point on the edge of the picture of each of a row's card planes, in
 * plant space, for a card moved by a shift and grown about each plane's middle. A plane is turned
 * once, and each point is its middle and its extents in proportion.
 *
 * @returns The number of points.
 */
function rowEdge(
	kit: SpeciesKitData,
	rows: ShootRows,
	r: number,
	grow: number,
	shiftX: number,
	shiftY: number,
	shiftZ: number,
): number {
	const prototype = kit.prototypes[rows.prototype[r] as number];
	if (!prototype) return 0;
	const scale = rows.scale[r] as number;
	const px = (rows.position[r * 3] as number) + shiftX;
	const py = (rows.position[r * 3 + 1] as number) + shiftY;
	const pz = (rows.position[r * 3 + 2] as number) + shiftZ;
	let count = 0;
	for (const plane of prototype.card.planes) {
		const edge = picturedOf(kit, plane.front).edge;
		const need = (count + edge.length / 2) * 3;
		if (need > edgePoints.length) {
			const more = new Float64Array(Math.max(need, edgePoints.length * 2));
			more.set(edgePoints.subarray(0, count * 3));
			edgePoints = more;
		}
		turned(rows, r, plane.centre, scale, MIDDLE);
		turned(rows, r, plane.right, scale, RIGHT);
		turned(rows, r, plane.up, scale, UP);
		const mx = px + MIDDLE[0];
		const my = py + MIDDLE[1];
		const mz = pz + MIDDLE[2];
		for (let i = 0; i < edge.length; i += 2) {
			const u = grow * (edge[i] as number);
			const v = grow * (edge[i + 1] as number);
			const at = count * 3;
			edgePoints[at] = mx + u * RIGHT[0] + v * UP[0];
			edgePoints[at + 1] = my + u * RIGHT[1] + v * UP[1];
			edgePoints[at + 2] = mz + u * RIGHT[2] + v * UP[2];
			count++;
		}
	}
	return count;
}

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
	let points = 0;
	for (let r = 0; r < rows.count; r++) {
		const count = rowEdge(kit, rows, r, 1, 0, 0, 0);
		points += count;
		for (let i = 0; i < count * 3; i += 3) {
			const x = edgePoints[i] as number;
			const y = edgePoints[i + 1] as number;
			const z = edgePoints[i + 2] as number;
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
			const sector = sectorOf(x - x0, z - z0, RIM_SECTORS, RIM_EDGES);
			if (reach > (farthest[sector] as number)) {
				farthest[sector] = reach;
				ends[5 + sector] = r;
			}
		}
	}
	const rim = new Uint8Array(rows.count);
	for (const r of ends) if (r >= 0) rim[r] = 1;
	const hull: FoliageHull = {
		x: x0,
		z: z0,
		low: points > 0 ? low : 0,
		high: points > 0 ? high : 0,
		across,
		depth,
		reach: new Float32Array(HULL_BANDS * HULL_SECTORS),
		rim,
	};
	// The bands are known once the lowest and highest points are, so a second pass reads the reach.
	const own = new Float32Array(HULL_BANDS * HULL_SECTORS);
	for (let r = 0; r < rows.count; r++) {
		const count = rowEdge(kit, rows, r, 1, 0, 0, 0);
		for (let i = 0; i < count * 3; i += 3) {
			const x = edgePoints[i] as number;
			const z = edgePoints[i + 2] as number;
			const cell = hullCell(hull, x, edgePoints[i + 1] as number, z);
			const reach = (x - hull.x) ** 2 + (z - hull.z) ** 2;
			if (reach > (own[cell] as number)) own[cell] = reach;
		}
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
 * @param back Receives how far the grown cards draw back from where they stood. Cards grow where
 *   they stand for a caller that gives none.
 * @returns The growth.
 * @category api/vegetation
 */
export function growthInHull(
	input: Pick<MeshInput, 'kit' | 'rows' | 'skeleton'>,
	r: number,
	wanted: number,
	back?: Vector3,
): number {
	if (back) back.fill(0);
	if (!(wanted > 1)) return 1;
	const { kit, rows } = input;
	const hull = foliageHull(input);
	// The way from the cards to the middle of the plant, which a card with no room draws back along.
	const inward = normalize3([
		hull.x - (rows.position[r * 3] as number),
		(hull.low + hull.high) / 2 - (rows.position[r * 3 + 1] as number),
		hull.z - (rows.position[r * 3 + 2] as number),
	]);
	// How far the pictures of the grown cards reach against that way.
	const outward = (grow: number): number => {
		let most = Number.NEGATIVE_INFINITY;
		const count = rowEdge(kit, rows, r, grow, 0, 0, 0);
		for (let i = 0; i < count * 3; i += 3)
			most = Math.max(
				most,
				-(
					(edgePoints[i] as number) * inward[0] +
					(edgePoints[i + 1] as number) * inward[1] +
					(edgePoints[i + 2] as number) * inward[2]
				),
			);
		return most;
	};
	const tall = (hull.high - hull.low) * HULL_SLACK;
	const fits = (grow: number, move: number): boolean => {
		const count = rowEdge(kit, rows, r, grow, move * inward[0], move * inward[1], move * inward[2]);
		for (let i = 0; i < count * 3; i += 3) {
			const x = edgePoints[i] as number;
			const y = edgePoints[i + 1] as number;
			const z = edgePoints[i + 2] as number;
			if (y < hull.low - tall || y > hull.high + tall) return false;
			if (x < hull.across[0] || x > hull.across[1] || z < hull.depth[0] || z > hull.depth[1])
				return false;
			if (
				(x - hull.x) ** 2 + (z - hull.z) ** 2 >
				(hull.reach[hullCell(hull, x, y, z)] as number) * (1 + HULL_SLACK)
			)
				return false;
		}
		return true;
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
function cardStep(level: 1 | 2): number {
	return 1 << (level - 1);
}

/**
 * Whether a card level's step keeps a row, and the most it may grow the row's cards: every second
 * row of the level above in the space-filling order, grown by the square root of the step where
 * the leaf form's hull has that much room (`growthInHull`). A level also keeps the rows of the
 * leaf form's rim (`cardRows`).
 *
 * @param order The row's rank on the space-filling curve.
 * @param level The card level.
 * @returns The most the row's cards may grow, or 0 when the step drops it.
 * @category api/vegetation
 */
export function cardKeep(order: number, level: 1 | 2): number {
	const every = cardStep(level);
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
	input: Pick<MeshInput, 'kit' | 'rows' | 'skeleton'>,
	level: 1 | 2,
): Float32Array {
	const { rows } = input;
	const every = cardStep(level);
	const out = new Float32Array(rows.count);
	const rim = every > 1 ? foliageHull(input).rim : undefined;
	// The steps whose own row gives its place to a row of the rim.
	const given = new Set<number>();
	if (rim)
		for (let r = 0; r < rows.count; r++) {
			const order = rows.order[r] as number;
			if (rim[r] === 1 && order % every !== 0) given.add(Math.floor(order / every));
		}
	const rimGrow = cardKeep(0, level);
	for (let r = 0; r < rows.count; r++) {
		const order = rows.order[r] as number;
		if (rim?.[r] === 1) out[r] = rimGrow;
		else if (!given.has(Math.floor(order / every))) out[r] = cardKeep(order, level);
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
 * @param keep The highest order of wood the level draws.
 * @returns The growth, 1 or more.
 */
function woodMakeUp(input: MeshInput, keep: number): number {
	const { skeleton, rows, kit } = input;
	const { axes, position, radius } = skeleton;
	let wood = 0;
	for (let a = 0; a < axes.count; a++) {
		if ((axes.order[a] as number) <= keep) continue;
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
	const grows = cardRows(input, level);
	const back: Vector3 = [0, 0, 0];
	const more = woodMakeUp(input, input.record.lod.woodOrders[level - 1] ?? 255);
	for (let r = 0; r < rows.count; r++) {
		const most = (grows[r] as number) * more;
		if (most === 0) continue;
		const prototype = kit.prototypes[rows.prototype[r] as number];
		if (!prototype) continue;
		// A card grows to make up the cover its level does not draw, a dropped neighbour's and the
		// dropped wood's, as far as the leaf form's hull lets it.
		const grow = growthInHull(input, r, most, back);
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
			for (const [sx, sy] of CORNERS) {
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
		const stalk = Math.max(0, input.record.lod.cardStalk ?? 0);
		if (stalk > 0 && rows.back) {
			const bx = rows.back[r * 3] as number;
			const by = rows.back[r * 3 + 1] as number;
			const bz = rows.back[r * 3 + 2] as number;
			// The line's two ends: the row's own origin, and either the stretch's far end or, where
			// the record asks, the centre of the foliage the card carries. That centre stands ahead
			// of the row by the shoot's own length, so the stretch alone can end short of it and
			// leave the leaves joined to nothing; the line then runs the whole way from the wood.
			let from: Vector3 = [px, py, pz];
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
