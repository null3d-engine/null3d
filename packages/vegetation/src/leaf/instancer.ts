// The instancer: shoot rows on the bud sites of the grown skeleton. Each bud serves the stretch of
// its axis back to the bud before it, and carries as many rows as the record's shoots per metre at
// its vigor give that stretch: the first at the bud, the rest spread back along the stretch, rolled
// about the axis by the phyllotaxis. A row picks the shoot class whose vigor range holds its bud's
// vigor and a prototype of that class by hash, turns its leaves toward the sky by the record's
// skyward share, bends by the record's lift or the plant's tropism and takes its scale. A bud in
// less light than the shade-prune line carries none, but an axis's end bud is spared: it keeps at
// least one row unless it stands in less light than the record's tip line. Where the record gives a
// sky-prune line, the finished crown is lit once and every row its leaves leave in less sky than
// that goes. Where the record trims bare wood, the twigs that then bear no row go from the
// skeleton. Rows then take a space-filling order, which the thinned card level keeps every second
// of. The coarseness leaves every row in place: it changes how smoothly the plant is drawn, not how
// many leaves the plant grows.
import type { ShootPrototype, ShootRows } from '../asset';
import type { MacroSkeleton } from '../core/graph';
import { BUD_AREOLE, BUD_DORMANT, BUD_TERMINAL } from '../core/graph';
import { hashAt, unitAt } from '../core/hash';
import {
	cos,
	cross3,
	length3,
	normalize3,
	quatAxisAngle,
	quatFromFrame,
	quatMultiply,
	quatRotate,
	radians,
	sin,
	type Vector3,
} from '../core/math';
import type { Scaffold, Species } from '../core/record';
import { curveAt, spreadAt } from '../core/types';
import { rowCentre } from '../crown/density';
import { crownSkyAt, lightCrown } from '../crown/visibility';
import { bareTrimmed } from '../grow/coarsen';
import type { CrownLight, DressInput } from '../stages';
import { inLeaf } from './season';

/** Sky visibility and bent normal of a row before the crown's light gives it its own. */
const OPEN_SKY = 250;
const BENT_UP = 0x88;
/** Degrees a row turns from straight up or down at most, by the plant's tropism. */
const TROPISM_LIMIT = 30;
/** Bits per axis of the space-filling key. */
const ORDER_BITS = 10;
/** The clump field's value below which a patch stands bare, so even a twig's tip there keeps no rosette. */
const BARE_PATCH = 0.5;
/** The thickest wood, as a radius in metres, that a bare trim takes. */
const MOST_TRIM = 0.1;
/** The share of a height layer's shoots, the best lit, whose sky a layered sky-prune line reads. */
const LAYER_LIT = 0.1;

/** Purposes of the instancer's hash keys, so no two draws share one. */
const Purpose = {
	Count: 1,
	Prototype: 2,
	Roll: 3,
	Scale: 4,
	Phase: 5,
	Azimuth: 6,
	Spacing: 7,
	Season: 8,
	Clump: 9,
	Vigor: 11,
	Fan: 12,
} as const;

/** The golden angle, which spreads a socket's rows evenly round its line. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** The least share of a socket's fan that one of its side rows leans out by. */
const FAN_LEAST = 0.5;

/**
 * The prototypes a bud of this vigor may draw: those whose class's range holds it, or those of the
 * nearest range when none does. A cutting's prototype is never among them, so a species that grows
 * cuttings from shoots of their own keeps them off its crown.
 *
 * @param prototypes The kit's prototypes.
 * @param vigor The bud's vigor.
 * @returns Their indices.
 * @category api/vegetation
 */
export function prototypesFor(
	prototypes: readonly Pick<ShootPrototype, 'vigor' | 'cutting'>[],
	vigor: number,
): number[] {
	const holding: number[] = [];
	let nearest: number[] = [];
	let gap = Infinity;
	prototypes.forEach((prototype, index) => {
		if (prototype.cutting) return;
		const [lo, hi] = prototype.vigor;
		const away = vigor < lo ? lo - vigor : vigor > hi ? vigor - hi : 0;
		if (away === 0) holding.push(index);
		if (away < gap) {
			gap = away;
			nearest = [index];
		} else if (away === gap) nearest.push(index);
	});
	return holding.length > 0 ? holding : nearest;
}

/** Degrees between successive shoots along an axis, by the record's phyllotaxis of macro buds. */
function divergence(record: Species): number {
	const arrangement =
		record.growth.model === 'self-organizing'
			? record.growth.buds.arrangement
			: record.shoots?.phyllotaxis;
	switch (arrangement?.kind) {
		case 'spiral':
			return arrangement.divergence;
		case 'distichous':
			return 180;
		case 'opposite':
			return arrangement.decussate ? 90 : 180;
		case 'whorled':
			return 360 / Math.max(2, arrangement.count);
		default:
			return 137.50776405;
	}
}

/** Degrees between a lateral shoot and its axis. */
function lateralAngle(record: Species): number {
	return record.growth.model === 'self-organizing' ? curveAt(record.growth.buds.angle, 1) : 45;
}

/**
 * Degrees a row turns toward the sky (positive) or the ground: the record's lift, or else the
 * finest order's tropism.
 */
function tropismTurn(record: Species): number {
	const lift = record.shoots?.placement.lift;
	if (lift !== undefined) return Math.max(-TROPISM_LIMIT, Math.min(TROPISM_LIMIT, lift));
	if (record.growth.model !== 'self-organizing') return 0;
	const bend = curveAt(record.growth.tropism.photo, 1) + curveAt(record.growth.tropism.gravi, 1);
	return Math.max(-TROPISM_LIMIT, Math.min(TROPISM_LIMIT, bend * TROPISM_LIMIT));
}

/** A row under construction. */
interface Row {
	prototype: number;
	position: Vector3;
	rotation: number[];
	scale: number;
	record: number;
	phase: number;
	/** The node of the bud the row stands on, and the bud's axis. */
	node: number;
	axis: number;
	/** From the row's place back to the far end of the stretch it serves. */
	back: Vector3;
}

/** A variant's shoot rows and the skeleton they stand on, its bare wood trimmed where the record asks. */
export interface DressedShoots {
	readonly rows: ShootRows;
	readonly skeleton: MacroSkeleton;
}

/**
 * A smooth value noise at a point, 0 to 1: hashed at the corners of a unit cell and eased between
 * them, so it makes patches of one cell across rather than the speckle of a per-point hash.
 */
function latticeNoise(
	seed: number,
	salt: number,
	purpose: number,
	x: number,
	y: number,
	z: number,
): number {
	const ix = Math.floor(x);
	const iy = Math.floor(y);
	const iz = Math.floor(z);
	const ease = (t: number) => t * t * (3 - 2 * t);
	const fx = ease(x - ix);
	const fy = ease(y - iy);
	const fz = ease(z - iz);
	let value = 0;
	for (let dz = 0; dz < 2; dz++)
		for (let dy = 0; dy < 2; dy++)
			for (let dx = 0; dx < 2; dx++) {
				const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
				if (weight === 0) continue;
				const corner = ((ix + dx) * 7919 + (iy + dy)) * 7919 + (iz + dz);
				value += weight * unitAt(seed, salt, purpose, corner);
			}
	return value;
}

/**
 * Metres along its axis to each node, and each axis's own length: how far a shoot stands from the
 * end of the axis that carries it, which is what the tip bias weights by.
 */
function axisReach(skeleton: MacroSkeleton): {
	readonly along: Float64Array;
	readonly ends: Float64Array;
} {
	const { nodeCount, parent, position, axisOf, axes } = skeleton;
	const along = new Float64Array(nodeCount);
	const known = new Uint8Array(nodeCount);
	const path: number[] = [];
	for (let start = 0; start < nodeCount; start++) {
		if (known[start]) continue;
		path.length = 0;
		let at = start;
		while (at >= 0 && !known[at]) {
			known[at] = 1;
			path.push(at);
			at = parent[at] as number;
		}
		let base = at >= 0 ? (along[at] as number) : 0;
		for (let i = path.length - 1; i >= 0; i--) {
			const node = path[i] as number;
			const up = parent[node] as number;
			if (up < 0) {
				along[node] = 0;
				base = 0;
				continue;
			}
			const dx = (position[node * 3] as number) - (position[up * 3] as number);
			const dy = (position[node * 3 + 1] as number) - (position[up * 3 + 1] as number);
			const dz = (position[node * 3 + 2] as number) - (position[up * 3 + 2] as number);
			const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
			base = (axisOf[node] as number) === (axisOf[up] as number) ? base + length : length;
			along[node] = base;
		}
	}
	const ends = new Float64Array(axes.count);
	for (let n = 0; n < nodeCount; n++) {
		const axis = axisOf[n] as number;
		if ((along[n] as number) > (ends[axis] as number)) ends[axis] = along[n] as number;
	}
	return { along, ends };
}

/**
 * The distance from each bud site to the nearest node of an axis of `order` or coarser: the wood
 * that the limb masses stand on. A bud on that wood reads 0, and the distance grows through the
 * space between one limb and the next.
 */
function limbMassReach(skeleton: MacroSkeleton, order: number): Float64Array {
	const { axes, buds, position } = skeleton;
	const segments: number[] = [];
	for (let a = 0; a < axes.count; a++) {
		if ((axes.order[a] as number) > order) continue;
		const first = axes.first[a] as number;
		const last = axes.last[a] as number;
		for (let n = first; n < last; n++) segments.push(n);
	}
	const out = new Float64Array(buds.count);
	for (let b = 0; b < buds.count; b++) {
		const x = buds.position[b * 3] as number;
		const y = buds.position[b * 3 + 1] as number;
		const z = buds.position[b * 3 + 2] as number;
		let best = Number.POSITIVE_INFINITY;
		for (const n of segments) {
			const ax = position[n * 3] as number;
			const ay = position[n * 3 + 1] as number;
			const az = position[n * 3 + 2] as number;
			const dx = (position[(n + 1) * 3] as number) - ax;
			const dy = (position[(n + 1) * 3 + 1] as number) - ay;
			const dz = (position[(n + 1) * 3 + 2] as number) - az;
			const length = dx * dx + dy * dy + dz * dz;
			const along =
				length > 1e-12
					? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / length))
					: 0;
			const px = ax + dx * along - x;
			const py = ay + dy * along - y;
			const pz = az + dz * along - z;
			const distance = Math.sqrt(px * px + py * py + pz * pz);
			if (distance < best) best = distance;
		}
		out[b] = best;
	}
	return out;
}

/** The space-filling key of a point inside a box: its axes' bits interleaved, high bits first. */
function spaceKey(p: Readonly<Vector3>, min: readonly number[], side: number): number {
	const max = (1 << ORDER_BITS) - 1;
	const scale = side > 0 ? max / side : 0;
	const at = [0, 1, 2].map((c) =>
		Math.min(max, Math.max(0, Math.round(((p[c] as number) - (min[c] as number)) * scale))),
	);
	let key = 0;
	for (let bit = ORDER_BITS - 1; bit >= 0; bit--)
		for (const axis of at) key = key * 2 + ((axis >> bit) & 1);
	return key;
}

/**
 * The shoot rows of one variant, before the crown's light gives each its sky visibility: the rows
 * `dressShoots` places, bare trim included, without the skeleton they stand on.
 *
 * @param input The grown skeleton, the kit, the record, the seed and the variant.
 * @returns The rows.
 */
export function placeShoots(input: DressInput): ShootRows {
	return dressShoots(input).rows;
}

/**
 * The shoot rows of one variant and the skeleton they stand on. Where the record gives a bare trim,
 * the twigs that bear no row go from the skeleton, and each row's wind record follows its axis to
 * its place in the trimmed skeleton. Where the record prunes or trims, the skeleton's crown base is
 * the lowest row's height; otherwise the skeleton is the one given.
 *
 * @param input The grown skeleton, the kit, the record, the seed and the variant.
 * @returns The rows and their skeleton.
 */
/**
 * Thins each axis's rows evenly to the record's budget, so an axis carries at most the rows it names.
 * The rows kept stand spread along the axis, and an axis under the budget keeps every row.
 */
function cappedRows(rows: Row[], cap: number | undefined): Row[] {
	if (cap === undefined) return rows;
	const byAxis = new Map<number, number[]>();
	for (let index = 0; index < rows.length; index++) {
		const row = rows[index] as Row;
		const list = byAxis.get(row.axis) ?? [];
		list.push(index);
		byAxis.set(row.axis, list);
	}
	const drop = new Uint8Array(rows.length);
	let capped = false;
	for (const list of byAxis.values()) {
		if (list.length <= cap) continue;
		capped = true;
		const stride = list.length / cap;
		const keep = new Set<number>();
		for (let k = 0; k < cap; k++)
			keep.add(list[Math.min(list.length - 1, Math.floor((k + 0.5) * stride))] as number);
		for (const index of list) if (!keep.has(index)) drop[index] = 1;
	}
	return capped ? rows.filter((_, index) => drop[index] === 0) : rows;
}

export function dressShoots(input: DressInput): DressedShoots {
	const rows = cappedRows(placedRows(input), input.record.shoots?.placement.rowsPerAxis);
	const limit = Math.min(MOST_TRIM, Math.max(0, input.record.shoots?.placement.bareTrim ?? 0));
	let lowest = Number.POSITIVE_INFINITY;
	for (const row of rows) lowest = Math.min(lowest, row.position[1]);
	const trimmed =
		limit > 0 && rows.length > 0
			? bareTrimmed(
					input.skeleton,
					rows.map((row) => row.node),
					rows.map((row) => row.axis),
					limit,
					lowest,
					input.record.shoots?.placement.bareEnds !== false,
				)
			: undefined;
	if (!trimmed) {
		// A pruned crown stands on what it kept.
		const pruned = (input.record.shoots?.placement.skyPrune ?? 0) > 0 && rows.length > 0;
		const skeleton =
			pruned && lowest !== input.skeleton.crownBase
				? { ...input.skeleton, crownBase: lowest }
				: input.skeleton;
		return { rows: finishedRows(rows, skeleton), skeleton };
	}
	const { skeleton, axisOut } = trimmed;
	for (const row of rows) {
		const axis = axisOut[row.axis] as number;
		row.axis = axis;
		row.record = skeleton.axes.record[axis] as number;
	}
	return { rows: finishedRows(rows, skeleton), skeleton };
}

/** The rows as the table, in the space-filling order of a skeleton's bounds. */
function finishedRows(rows: Row[], skeleton: MacroSkeleton): ShootRows {
	// The coarseness dial keeps every shoot row: it changes how smoothly the plant is drawn, not how
	// many leaves the plant grows.
	const kept = rows;
	return packRows(kept, skeleton.bounds);
}

/**
 * The light of a variant's crown as its rows stand before any sky prune, which the prune reads, or
 * undefined when the record gives no sky-prune line. Found once, it serves the plant at every
 * coarseness.
 *
 * @param input The grown skeleton, the kit, the record, the seed and the variant.
 * @returns The crown's light.
 */
export function pruneLight(input: DressInput): CrownLight | undefined {
	if (!((input.record.shoots?.placement.skyPrune ?? 0) > 0)) return undefined;
	const rows = placedRows(input, false);
	if (rows.length === 0) return undefined;
	return lightCrown(input, packRows(rows, input.skeleton.bounds));
}

/**
 * The rows that see at least a share of the sky through the crown's own leaves, a tip's rosette
 * among them: a row whose leaves stand deep in the leaf mass goes. The light is the input's crown
 * light where it gives one, or else the crown is lit once from every row.
 */
function skyPruned(input: DressInput, rows: Row[], line: number): Row[] {
	if (!(line > 0) || rows.length === 0) return rows;
	const packed = packRows(rows, input.skeleton.bounds);
	const light = input.pruneLight;
	if (!light) lightCrown(input, packed);
	const prototypes = input.kit.prototypes;
	const centre: Vector3 = [0, 0, 0];
	const sky = new Float64Array(rows.length);
	const height = new Float64Array(rows.length);
	rows.forEach((row, r) => {
		rowCentre(packed, r, prototypes[row.prototype]?.length ?? 0, centre);
		height[r] = centre[1];
		sky[r] = light
			? Math.round(
					OPEN_SKY * Math.min(1, Math.max(0, crownSkyAt(light, centre[0], centre[1], centre[2]))),
				)
			: (packed.sky[r] as number);
	});
	const share = Math.min(1, line);
	const layer = input.record.shoots?.placement.skyPruneLayer;
	if (!(layer !== undefined && layer > 0)) {
		const cut = Math.round(OPEN_SKY * share);
		return rows.filter((_, r) => (sky[r] as number) >= cut);
	}
	// Each height layer reads the sky of its own best-lit shoots, so its lit rim stays and its
	// shaded middle goes, at the crown's foot as at its top.
	const bands = new Map<number, number[]>();
	for (let r = 0; r < rows.length; r++) {
		const band = Math.floor((height[r] as number) / layer);
		const list = bands.get(band) ?? [];
		list.push(sky[r] as number);
		bands.set(band, list);
	}
	const lit = new Map<number, number>();
	for (const [band, list] of bands) {
		list.sort((a, b) => b - a);
		lit.set(band, list[Math.min(list.length - 1, Math.floor(list.length * LAYER_LIT))] as number);
	}
	return rows.filter((_, r) => {
		const best = lit.get(Math.floor((height[r] as number) / layer)) as number;
		return (sky[r] as number) >= share * best;
	});
}

/**
 * The rows of one variant on its bud sites, before the coarse thinning, with the crown-light prune
 * taken unless asked not to.
 */
function placedRows(input: DressInput, bySky = true): Row[] {
	const { record, seed, variant, skeleton, kit } = input;
	const shoots = record.shoots;
	const rows: Row[] = [];
	if (!shoots || kit.prototypes.length === 0) return rows;
	// A scaffold plant's foliage stands at its sockets, where its foliage masses put it: no shade or
	// sky line thins it afterwards.
	if (record.growth.model === 'scaffold' || record.growth.model === 'frame')
		return socketRows(input, record.growth);
	const salt = record.seedSalt;
	const draw = (purpose: number, a = 0, b = 0) => unitAt(seed, salt, variant * 64 + purpose, a, b);
	const pick = (purpose: number, a = 0, b = 0) => hashAt(seed, salt, variant * 64 + purpose, a, b);
	const buds = skeleton.buds;
	const position = skeleton.position;
	// The bare column round each stem, below its share of the plant's height: an open-grown tree's
	// trunk and the bases of its great limbs carry no foliage, so the bole reads through the crown.
	const bole = shoots.placement.bareBole;
	const boleRadius = bole ? Math.max(0, bole.radius) : 0;
	const boleTop = bole ? Math.max(0, bole.height) * skeleton.height : 0;
	const stems: { base: Vector3; dir: Vector3 }[] = [];
	if (boleRadius > 0 && boleTop > 0)
		for (let a = 0; a < skeleton.axes.count; a++) {
			if ((skeleton.axes.parent[a] as number) >= 0) continue;
			const first = skeleton.axes.first[a] as number;
			const last = skeleton.axes.last[a] as number;
			const base: Vector3 = [
				position[first * 3] as number,
				position[first * 3 + 1] as number,
				position[first * 3 + 2] as number,
			];
			const dir = normalize3([
				(position[last * 3] as number) - base[0],
				(position[last * 3 + 1] as number) - base[1],
				(position[last * 3 + 2] as number) - base[2],
			]);
			if (dir[1] > 1e-6) stems.push({ base, dir });
		}
	/** Whether a point stands inside a stem's bare column, below its line. */
	const inBole = (point: Vector3): boolean => {
		if (stems.length === 0 || point[1] >= boleTop) return false;
		for (const stem of stems) {
			const t = (point[1] - stem.base[1]) / stem.dir[1];
			const sx = stem.base[0] + stem.dir[0] * t;
			const sz = stem.base[2] + stem.dir[2] * t;
			if (length3(point[0] - sx, 0, point[2] - sz) < boleRadius) return true;
		}
		return false;
	};
	const step = divergence(record);
	// A record may turn each shoot further out from its wood, so the crown's foliage reaches away
	// from the twigs that carry it; the shoot's foot stays on the wood either way.
	const degree = Math.min(
		90,
		Math.max(0, lateralAngle(record) + Math.max(0, shoots.placement.reach ?? 0)),
	);
	const angle = radians(degree);
	const tropism = radians(tropismTurn(record));
	const skyward = Math.min(1, Math.max(0, shoots.placement.skyward));
	const prune = Math.min(1, Math.max(0, shoots.placement.shadePrune));
	const tipPrune = shoots.placement.tipPrune;
	const bare =
		kit.prototypes.some((p) => p.leaves === 0) && kit.prototypes.some((p) => p.leaves > 0);
	// The previous bud on each axis, so each bud serves the stretch back to it.
	const previous = new Map<number, number>();
	const order = Array.from({ length: buds.count }, (_, b) => b).sort(
		(a, b) =>
			(buds.axis[a] as number) - (buds.axis[b] as number) ||
			(buds.node[a] as number) - (buds.node[b] as number) ||
			a - b,
	);
	const up: Vector3 = [0, 1, 0];
	const frame = [0, 0, 0, 1];
	const roll = [0, 0, 0, 1];
	const clump = shoots.placement.clump;
	const mass = shoots.placement.limbMass;
	const massDistance = mass ? limbMassReach(skeleton, mass.order) : undefined;
	const bias = Math.min(1, Math.max(0, shoots.placement.tipBias ?? 0));
	const reach = bias > 0 ? axisReach(skeleton) : undefined;
	for (const b of order) {
		const axis = buds.axis[b] as number;
		const kind = buds.kind[b] as number;
		// A dormant bud carries nothing, and it is no anchor for the stretch the next shoot's count
		// shares: a culm's sheath buds must not stretch its tip's shoot down the bare culm.
		if (kind === BUD_DORMANT) continue;
		const at: Vector3 = [
			buds.position[b * 3] as number,
			buds.position[b * 3 + 1] as number,
			buds.position[b * 3 + 2] as number,
		];
		const before = previous.get(axis);
		previous.set(axis, b);
		const node = buds.node[b] as number;
		const host = skeleton.axisOf[node] as number;
		// The clean bole carries no shoot: the trunk below the crown is bare, as the record says. The
		// rule is about the stem it names, so a limb that leaves the trunk above the line keeps the
		// foliage it carries below it.
		if (
			record.growth.model === 'self-organizing' &&
			host >= 0 &&
			(skeleton.axes.order[host] as number) === 0 &&
			(buds.position[b * 3 + 1] as number) < record.growth.shedding.cleanBole * skeleton.height
		)
			continue;
		// A bud at its axis's tip is the end of a branch, in the open sky the shade-prune line reads as
		// darkness inside the crown: it keeps its shoot, so no bare tip stands past the leaves.
		const atTip = host >= 0 && (skeleton.axes.last[host] as number) === node;
		if (!atTip && (buds.light[b] as number) < prune) continue;
		const vigor = buds.vigor[b] as number;
		// The stretch this bud serves: back to the bud before it on its axis, or to its node's parent.
		const parentNode = skeleton.parent[node] as number;
		let from: Vector3;
		if (before !== undefined)
			from = [
				buds.position[before * 3] as number,
				buds.position[before * 3 + 1] as number,
				buds.position[before * 3 + 2] as number,
			];
		else if (parentNode >= 0)
			from = [
				position[parentNode * 3] as number,
				position[parentNode * 3 + 1] as number,
				position[parentNode * 3 + 2] as number,
			];
		else from = [...at];
		const stretch = length3(at[0] - from[0], at[1] - from[1], at[2] - from[2]);
		let expected =
			curveAt(shoots.placement.perMetre, vigor) *
			stretch *
			Math.max(0, shoots.placement.density ?? 1);
		// The shoots gather towards the end of their axis: the stretch behind it thins, so the
		// foliage stands in masses at the axes' ends with wood showing between them.
		if (reach) {
			const total = reach.ends[axis] as number;
			const at = total > 1e-6 ? Math.min(1, (reach.along[node] as number) / total) : 1;
			expected *= 1 - bias + bias * at * Math.sqrt(at);
		}
		// The shoots gather into masses about a patch of the crown, with a thinner run round each
		// mass, so the crown reads as rosettes with sky and wood between rather than an even mesh of
		// leaves. The patches are spaced in space, not along the axes, so a mass is the same size
		// whatever the axis it sits on.
		let patch = 1;
		if (clump) {
			const depth = Math.min(1, Math.max(0, clump.depth));
			const spacing = Math.max(1e-3, clump.spacing);
			patch = latticeNoise(
				seed,
				salt,
				variant * 64 + Purpose.Clump,
				at[0] / spacing,
				at[1] / spacing,
				at[2] / spacing,
			);
			expected *= Math.max(0, 1 + depth * (2 * patch - 1));
			// A second scale below the first: the plates keep their own gaps, and within a plate the
			// foliage gathers into tufts with wood and sky between them, so the twig order shows.
			const fine = clump.fine;
			if (fine) {
				const step = Math.max(1e-3, fine.spacing);
				const tuft = latticeNoise(
					seed,
					salt,
					variant * 64 + Purpose.Clump + 1,
					at[0] / step,
					at[1] / step,
					at[2] / step,
				);
				expected *= Math.max(0, 1 + Math.min(1, Math.max(0, fine.depth)) * (2 * tuft - 1));
				// A tuft's own gaps stand as bare as a plate's, or a tuft's edge closes on a rosette.
				patch = Math.min(patch, tuft);
			}
		}
		// The crown's foliage stands on the plant's own limb masses: a shoot keeps its full density
		// near the wood of the record's coarsest orders and thins with its distance from that wood,
		// so the foliage gathers on the limbs and the space between one mass and the next stays open
		// through the crown.
		if (mass && massDistance) {
			const span = Math.max(1e-6, mass.reach - mass.hold);
			const apart = Math.min(1, Math.max(0, ((massDistance[b] as number) - mass.hold) / span));
			const share = 1 - Math.min(1, Math.max(0, mass.depth)) * apart * apart * (3 - 2 * apart);
			// Thin enough a part of the mass bears nothing at all: a bud here keeps no shoot by
			// chance, so the wood that carried it stands bare, the trim takes it, and the crown parts
			// into masses rather than unravels into whiskers.
			if (mass.bare !== undefined && share <= mass.bare) continue;
			expected *= share;
			patch = Math.min(patch, share);
		}
		// The outermost bud of an axis carries a rosette even where its vigor and stretch give none,
		// whether it is the axis's terminal bud or the live shoot that replaced a lost one: a twig
		// end bears leaves at the tip, so no bare spray stands past the crown's leaves. A patch the
		// clump field leaves bare keeps no rosette either, so a gap stands open between the masses
		// rather than closing on a rosette at every twig in it.
		// Where the record gives a tip line, a tip darker than it is a twig that starved: it bears
		// nothing, so the limbs between the foliage show instead of a rosette standing on every twig
		// in the crown's whole volume.
		const lit = tipPrune === undefined || (buds.light[b] as number) >= tipPrune;
		const keep = (kind === BUD_TERMINAL || atTip) && lit && patch > BARE_PATCH;
		// A cactus areole carries one spine cluster. The growth places every areole itself, so its site
		// gives one shoot whatever stretch of axis lies behind it.
		const count =
			kind === BUD_AREOLE
				? 1
				: Math.max(keep ? 1 : 0, Math.floor(expected + draw(Purpose.Count, b)));
		if (count === 0) continue;
		// The axis's direction at the bud.
		const tangent: Vector3 =
			stretch > 1e-6
				? normalize3([at[0] - from[0], at[1] - from[1], at[2] - from[2]])
				: quatRotate(buds.frame, b * 4, [0, 1, 0], [0, 0, 0]);
		// The season picks the leafy prototypes or their leafless twins, where the kit holds twins.
		const crownShare =
			(at[1] - skeleton.crownBase) / Math.max(1e-6, skeleton.height - skeleton.crownBase);
		const leafy = inLeaf(record, input.season, crownShare, draw(Purpose.Season, b));
		const offered = bare ? kit.prototypes.filter((p) => p.leaves > 0 === leafy) : kit.prototypes;
		const candidates = prototypesFor(offered, vigor).map(
			(k) => (offered[k] as ShootPrototype).index,
		);
		const woodRadius = buds.woodRadius[b] as number;
		const record16 = skeleton.axes.record[axis] as number;
		const azimuth0 = draw(Purpose.Azimuth, b) * 360;
		for (let k = 0; k < count; k++) {
			let direction: Vector3;
			let place: Vector3;
			if (k === 0) {
				direction = quatRotate(buds.frame, b * 4, [0, 1, 0], [0, 0, 0]);
				place = [...at];
			} else {
				// Spread back along the stretch, each a step of the phyllotaxis round the axis, as
				// far back as the record's gather allows: a small share keeps the shoots of one bud
				// together as a tuft at the node, and leaves the internode between nodes bare.
				const share =
					((k + 0.5 * draw(Purpose.Spacing, b, k)) / count) *
					Math.min(1, Math.max(0, shoots.placement.gather ?? 1));
				const centre: Vector3 = [
					at[0] + (from[0] - at[0]) * share,
					at[1] + (from[1] - at[1]) * share,
					at[2] + (from[2] - at[2]) * share,
				];
				const reference: Vector3 = Math.abs(tangent[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
				const side = normalize3(cross3(tangent, reference, [0, 0, 0]));
				const q = [0, 0, 0, 1];
				quatAxisAngle(tangent, radians(azimuth0 + k * step), q);
				const outward = quatRotate(q, 0, side, [0, 0, 0]);
				direction = normalize3([
					tangent[0] * cos(angle) + outward[0] * sin(angle),
					tangent[1] * cos(angle) + outward[1] * sin(angle),
					tangent[2] * cos(angle) + outward[2] * sin(angle),
				]);
				place = [
					centre[0] + outward[0] * woodRadius,
					centre[1] + outward[1] * woodRadius,
					centre[2] + outward[2] * woodRadius,
				];
			}
			// No shoot stands inside a stem's bare column: the bole and the great limbs' bases read.
			if (inBole(place)) continue;
			// The plant's tropism turns the row toward the sky or the ground.
			if (tropism !== 0) {
				const across = cross3(direction, up, [0, 0, 0]);
				if (length3(across[0], across[1], across[2]) > 1e-6) {
					normalize3(across);
					const q = [0, 0, 0, 1];
					quatAxisAngle(across, tropism, q);
					quatRotate(q, 0, direction, direction);
					normalize3(direction);
				}
			}
			// +Y along the shoot, +Z toward the sky, then rolled about +Y by what skyward leaves.
			quatFromFrame(direction, up, frame);
			const turn = (draw(Purpose.Roll, b, k) * 2 - 1) * Math.PI * (1 - skyward);
			quatAxisAngle([0, 1, 0], turn, roll);
			const rotation = [0, 0, 0, 1];
			quatMultiply(frame, 0, roll, 0, rotation);
			// A limb carries its own shoot length where the record gives one: the scale follows the
			// shoot's height in the crown, so the skirt and the top take different reaches.
			const byHeight = shoots.placement.scaleByHeight;
			const scale =
				spreadAt(shoots.placement.scale, draw(Purpose.Scale, b, k)) *
				(byHeight === undefined ? 1 : curveAt(byHeight, crownShare));
			rows.push({
				prototype: candidates[pick(Purpose.Prototype, b, k) % candidates.length] as number,
				position: place,
				rotation,
				scale,
				record: record16,
				phase: pick(Purpose.Phase, b, k) & 255,
				node,
				axis,
				back: [from[0] - place[0], from[1] - place[1], from[2] - place[2]],
			});
		}
	}
	return bySky ? skyPruned(input, rows, shoots.placement.skyPrune ?? 0) : rows;
}

/**
 * The rows of a scaffold plant: every socket holds the record's count of rows at its branch end.
 * The first runs on along the socket's own line and takes the socket's vigor; the others lean out
 * from that line by up to the record's fan, each a golden angle round it from the last, and draw a
 * vigor of their own, so one socket carries shoots of several classes as a branch end does. Each
 * row's scale is the record's, times its socket's own.
 */
function socketRows(
	input: DressInput,
	growth: { readonly sockets: Pick<Scaffold['sockets'], 'rows' | 'fan'> },
): Row[] {
	const { record, seed, variant, skeleton, kit } = input;
	const rows: Row[] = [];
	const shoots = record.shoots;
	if (!shoots) return rows;
	const salt = record.seedSalt;
	const draw = (purpose: number, a = 0, b = 0) => unitAt(seed, salt, variant * 64 + purpose, a, b);
	const pick = (purpose: number, a = 0, b = 0) => hashAt(seed, salt, variant * 64 + purpose, a, b);
	const { buds, position } = skeleton;
	const skyward = Math.min(1, Math.max(0, shoots.placement.skyward));
	const fan = radians(Math.min(120, Math.max(0, growth.sockets.fan)));
	const bare =
		kit.prototypes.some((p) => p.leaves === 0) && kit.prototypes.some((p) => p.leaves > 0);
	const up: Vector3 = [0, 1, 0];
	const frame = [0, 0, 0, 1];
	const roll = [0, 0, 0, 1];
	const along: Vector3 = [0, 0, 0];
	const side: Vector3 = [0, 0, 0];
	const fore: Vector3 = [0, 0, 0];
	for (let b = 0; b < buds.count; b++) {
		const at: Vector3 = [
			buds.position[b * 3] as number,
			buds.position[b * 3 + 1] as number,
			buds.position[b * 3 + 2] as number,
		];
		const node = buds.node[b] as number;
		const axis = buds.axis[b] as number;
		const parentNode = skeleton.parent[node] as number;
		const back: Vector3 =
			parentNode >= 0
				? [
						(position[parentNode * 3] as number) - at[0],
						(position[parentNode * 3 + 1] as number) - at[1],
						(position[parentNode * 3 + 2] as number) - at[2],
					]
				: [0, 0, 0];
		const crownShare =
			(at[1] - skeleton.crownBase) / Math.max(1e-6, skeleton.height - skeleton.crownBase);
		const leafy = inLeaf(record, input.season, crownShare, draw(Purpose.Season, b));
		const offered = bare ? kit.prototypes.filter((p) => p.leaves > 0 === leafy) : kit.prototypes;
		const size = buds.sockets?.scale[b] ?? 1;
		const record16 = skeleton.axes.record[axis] as number;
		quatRotate(buds.frame, b * 4, [0, 1, 0], along);
		quatRotate(buds.frame, b * 4, [1, 0, 0], side);
		quatRotate(buds.frame, b * 4, [0, 0, 1], fore);
		const count = Math.max(1, Math.round(spreadAt(growth.sockets.rows, draw(Purpose.Count, b))));
		const first = draw(Purpose.Azimuth, b) * 2 * Math.PI;
		for (let k = 0; k < count; k++) {
			const direction: Vector3 = [along[0], along[1], along[2]];
			if (k > 0) {
				const lean = fan * (FAN_LEAST + (1 - FAN_LEAST) * draw(Purpose.Fan, b, k));
				const round = first + k * GOLDEN;
				const c = cos(lean);
				const s = sin(lean);
				const cr = cos(round);
				const sr = sin(round);
				for (let i = 0; i < 3; i++)
					direction[i as 0] = along[i as 0] * c + (side[i as 0] * cr + fore[i as 0] * sr) * s;
				normalize3(direction);
			}
			const vigor = k === 0 ? (buds.vigor[b] as number) : draw(Purpose.Vigor, b, k);
			const candidates = prototypesFor(offered, vigor).map(
				(index) => (offered[index] as ShootPrototype).index,
			);
			if (candidates.length === 0) continue;
			// +Y along the shoot, +Z toward the sky, then rolled about +Y by what skyward leaves.
			quatFromFrame(direction, up, frame);
			const turn = (draw(Purpose.Roll, b, k) * 2 - 1) * Math.PI * (1 - skyward);
			quatAxisAngle([0, 1, 0], turn, roll);
			const rotation = [0, 0, 0, 1];
			quatMultiply(frame, 0, roll, 0, rotation);
			rows.push({
				prototype: candidates[pick(Purpose.Prototype, b, k) % candidates.length] as number,
				position: [at[0], at[1], at[2]],
				rotation,
				scale: spreadAt(shoots.placement.scale, draw(Purpose.Scale, b, k)) * size,
				record: record16,
				phase: pick(Purpose.Phase, b, k) & 255,
				node,
				axis,
				back,
			});
		}
	}
	return rows;
}

/** The rows' indices along the space-filling curve through the plant's bounds. */
function spaceRanks(rows: readonly Row[], bounds: DressInput['skeleton']['bounds']): number[] {
	const side = Math.max(
		bounds.max[0] - bounds.min[0],
		bounds.max[1] - bounds.min[1],
		bounds.max[2] - bounds.min[2],
	);
	const keys = rows.map((row) => spaceKey(row.position, bounds.min, side));
	return keys.map((_, r) => r).sort((a, b) => (keys[a] as number) - (keys[b] as number) || a - b);
}

/** The rows as the table's typed arrays, with their space-filling order. */
function packRows(rows: readonly Row[], bounds: DressInput['skeleton']['bounds']): ShootRows {
	const count = rows.length;
	const out = {
		count,
		prototype: new Uint8Array(count),
		position: new Float32Array(count * 3),
		rotation: new Float32Array(count * 4),
		scale: new Float32Array(count),
		record: new Uint16Array(count),
		phase: new Uint8Array(count),
		sky: new Uint8Array(count).fill(OPEN_SKY),
		bent: new Uint8Array(count).fill(BENT_UP),
		order: new Uint32Array(count),
		back: new Float32Array(count * 3),
	};
	rows.forEach((row, r) => {
		out.prototype[r] = row.prototype;
		out.position.set(row.position, r * 3);
		out.rotation.set(row.rotation, r * 4);
		out.scale[r] = row.scale;
		out.record[r] = row.record;
		out.phase[r] = row.phase;
		out.back.set(row.back, r * 3);
	});
	const ranked = spaceRanks(rows, bounds);
	ranked.forEach((row, rank) => {
		out.order[row] = rank;
	});
	return out;
}
