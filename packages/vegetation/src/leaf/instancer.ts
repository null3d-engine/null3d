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
// of. A coarser plant keeps a share of the rows, spread evenly along that order, and grows each
// kept row so that the leaf area holds.
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
import type { Species } from '../core/record';
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
} as const;

/** The share of shoot rows that the coarsest plant drops. */
export const THIN_MOST = 0.8;

/** The most that a coarser plant's kept rows grow by. */
export const GROW_MOST = 2.25;

/**
 * The share of shoot rows a plant of a coarseness keeps, and the scale that the kept rows grow by:
 * enough to keep the leaf area, whose share is the scale squared, up to the most they grow by.
 *
 * @param coarseness From 0 to 1.
 * @returns The share and the scale.
 */
export function rowThinning(coarseness: number): { keep: number; grow: number } {
	const keep = 1 - THIN_MOST * Math.min(1, Math.max(0, coarseness));
	return { keep, grow: Math.min(GROW_MOST, 1 / Math.sqrt(keep)) };
}

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
export function dressShoots(input: DressInput): DressedShoots {
	const rows = placedRows(input);
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
				)
			: undefined;
	if (!trimmed) {
		// A pruned crown stands on what it kept.
		const pruned = (input.record.shoots?.placement.skyPrune ?? 0) > 0 && rows.length > 0;
		const skeleton =
			pruned && lowest !== input.skeleton.crownBase
				? { ...input.skeleton, crownBase: lowest }
				: input.skeleton;
		return { rows: finishedRows(input, rows, skeleton), skeleton };
	}
	const { skeleton, axisOut } = trimmed;
	for (const row of rows) {
		const axis = axisOut[row.axis] as number;
		row.axis = axis;
		row.record = skeleton.axes.record[axis] as number;
	}
	return { rows: finishedRows(input, rows, skeleton), skeleton };
}

/** The rows as the table, thinned for a coarser plant, in the space-filling order of a skeleton's bounds. */
function finishedRows(input: DressInput, rows: Row[], skeleton: MacroSkeleton): ShootRows {
	const coarse = (input.coarseness ?? 0) > 0;
	const kept = coarse ? thinned(rows, skeleton.bounds, rowThinning(input.coarseness ?? 0)) : rows;
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
			rows.push({
				prototype: candidates[pick(Purpose.Prototype, b, k) % candidates.length] as number,
				position: place,
				rotation,
				scale: spreadAt(shoots.placement.scale, draw(Purpose.Scale, b, k)),
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
 * The share of rows that a coarser plant keeps, spread evenly through the crown: every row whose
 * step along the space-filling curve crosses a whole share, each grown by the thinning's scale; in
 * their order.
 */
function thinned(
	rows: readonly Row[],
	bounds: DressInput['skeleton']['bounds'],
	thinning: { keep: number; grow: number },
): Row[] {
	const ranked = spaceRanks(rows, bounds);
	const kept = new Uint8Array(rows.length);
	for (let k = 0; k < ranked.length; k++)
		if (Math.floor((k + 1) * thinning.keep) > Math.floor(k * thinning.keep))
			kept[ranked[k] as number] = 1;
	const out: Row[] = [];
	rows.forEach((row, r) => {
		if (kept[r]) out.push({ ...row, scale: row.scale * thinning.grow });
	});
	return out;
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
