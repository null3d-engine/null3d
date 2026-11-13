// Sparseness: a plant with a share of its foliage and of the branches that carried it taken away.
// The plant grows once, at its full density. Every foliage carrier, a shoot row or, on a plant
// without rows, an end axis such as a leaf, then takes a place in one order, and a sparser plant
// keeps the first carriers of that order and the wood from each of them to the root. So every
// sparser plant is a subset of every denser one: no leaf is scaled, nothing moves, and no piece
// hangs free.
//
// The order makes the removal even at every scale of the branching. A walk from the root lists the
// carriers: along each axis from its tip to its base, each of its own rows as it comes and each
// branch's carriers where the branch leaves. Every axis's foliage is then one run of the list, a
// great limb's as a twig's. The carriers take their places by the reversed bits of their index in
// the list: the first, then the middle, then the quarters, and so on. The carriers kept so far
// therefore stand spread along the whole list, and every run of it holds its share of them to
// within about twice the logarithm of the list's length. So each limb, branch and twig keeps the
// plant's share of its own foliage, and an axis goes only when its share falls below one carrier.
//
// What never goes: the stems, the great limbs, and the outermost carrier of every axis that stays.
// Each axis's first carrier in the list, the one nearest its tip, takes the earliest place its run
// holds, so an axis that stays keeps its whole length and ends in the foliage it grew. The
// sparsest plant is its trunk and great limbs with a tuft at each end.
//
// A plant of sockets thins by whole sockets instead, each with every row it holds, so a piece stays
// whole or goes whole, and by whole branches first. Each branch that leaves a stem or a great limb
// is a unit, and the sockets on a stem or limb itself are one more. The units stand in the
// walk's order and take places by reversed bits, so the kept units stand spread along every limb
// and round the plant. A kept unit keeps at least half its pieces, spread along it by the same rule;
// past that the units go whole, the last of the order first. So the sparsest plant
// is the trunk, the great limbs and a few clothed branches. Each axis is cut back to the last piece
// it keeps, or the last branch that leaves it, so nothing kept ends in bare wood.

import type { ShootRows } from '../asset';
import { AXIS_ARM, AXIS_LIMB, AXIS_ROOT, AXIS_STEM, type MacroSkeleton } from '../core/graph';
import { hashAt } from '../core/hash';
import { atan2 } from '../core/math';
import { keptSkeleton } from './coarsen';

/**
 * The least share of a stem's thickest limb that makes a limb great, where the record names none.
 *
 * @category api/vegetation
 */
export const GREAT_LIMB_SHARE = 0.5;

/**
 * The share of its foliage the sparsest plant keeps, where the record names none.
 *
 * @category api/vegetation
 */
export const FOLIAGE_FLOOR = 0.1;

/** A place that marks a row or an axis that is no carrier. */
const NO_PLACE = 0xffffffff;

/** The order in which a plant's foliage goes as it thins, found once from the plant as grown. */
export interface SparseOrder {
	/** Whether the carriers are the shoot rows; otherwise they are the end axes. */
	readonly byRows: boolean;
	/** The carriers: the plant's shoot rows, or its end axes where it has no rows. */
	readonly carriers: number;
	/** Each row's place in the order, or each axis's on a plant without rows: 0 is the last to go. */
	readonly place: Uint32Array;
	/**
	 * The carriers as the walk from the root meets them, a row's index or an axis's: each axis's
	 * foliage is one run of the list, so a stretch of the list is a neighbourhood of the crown.
	 */
	readonly list: Uint32Array;
	/**
	 * Each bare branch's place among the carriers: a branch that carries no foliage stays while the
	 * axis it leaves stays and the plant keeps more carriers than this.
	 */
	readonly barePlace: Uint32Array;
	/** Per axis: 1 for a stem or a great limb, which stays at every sparseness. */
	readonly structural: Uint8Array;
	/**
	 * Per axis: 1 for wood that stays whole at every sparseness: the stems, the great limbs, the
	 * wood to the plant's highest node and the wood under each pinned row.
	 */
	readonly whole: Uint8Array;
	/** Per axis: the carriers on it and on every branch that leaves it. */
	readonly carried: Uint32Array;
	/** The fewest carriers the plant may keep: the outermost of each stem, great limb and pinned axis. */
	readonly least: number;
	/** Whether the carriers are the plant's sockets, each with all of its rows. */
	readonly bySockets: boolean;
	/** Each row's socket, on a plant of sockets. */
	readonly socketOf?: Uint32Array;
}

/**
 * The place of each index of a list of `count` by the reversed bits of the index: index 0 takes
 * place 0, and the indices that hold the first places always stand spread along the whole list.
 */
function reversedPlaces(count: number): Uint32Array {
	let bits = 0;
	while (1 << bits < count) bits++;
	const reversed = new Uint32Array(count);
	for (let i = 0; i < count; i++) {
		let r = 0;
		for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
		reversed[i] = r;
	}
	const byReversed = Array.from({ length: count }, (_, i) => i).sort(
		(a, b) => (reversed[a] as number) - (reversed[b] as number),
	);
	const places = new Uint32Array(count);
	for (let place = 0; place < count; place++) places[byReversed[place] as number] = place;
	return places;
}

/**
 * The stems and great limbs of a skeleton. A stem is an axis with no parent that is a stem or a
 * ground plant's crown. A great limb is a limb or an arm that leaves a stem with at least `share`
 * of the radius of the thickest limb that leaves the same stem.
 *
 * @param skeleton The skeleton.
 * @param share The least share of the thickest limb's radius that makes a limb great.
 * @returns One flag per axis, 1 for a stem or a great limb.
 * @category api/vegetation
 */
export function structuralAxes(skeleton: MacroSkeleton, share: number): Uint8Array {
	const { axes, radius } = skeleton;
	const out = new Uint8Array(axes.count);
	const thickest = new Float64Array(axes.count);
	const limb = (a: number) => {
		const parent = axes.parent[a] as number;
		const kind = axes.kind[a] as number;
		return (
			parent >= 0 &&
			(kind === AXIS_LIMB || kind === AXIS_ARM) &&
			(axes.parent[parent] as number) < 0 &&
			(axes.kind[parent] as number) === AXIS_STEM
		);
	};
	for (let a = 0; a < axes.count; a++) {
		const kind = axes.kind[a] as number;
		if ((axes.parent[a] as number) < 0) {
			if (kind === AXIS_STEM || kind === AXIS_ROOT) out[a] = 1;
		} else if (limb(a)) {
			const parent = axes.parent[a] as number;
			const base = radius[axes.first[a] as number] as number;
			if (base > (thickest[parent] as number)) thickest[parent] = base;
		}
	}
	for (let a = 0; a < axes.count; a++) {
		if (!limb(a)) continue;
		const base = radius[axes.first[a] as number] as number;
		if (base >= share * (thickest[axes.parent[a] as number] as number)) out[a] = 1;
	}
	return out;
}

/**
 * The part of the plant each axis's wood belongs to: 0 for the trunk, an axis with no parent; 1 for
 * a great limb; 2 for a branch. A sparser plant's axes take the parts they had as grown, since its
 * stems and great limbs all stay.
 *
 * @param skeleton The skeleton.
 * @param share The least share of the thickest limb's radius that makes a limb great.
 * @returns One part per axis.
 * @category api/vegetation
 */
export function woodParts(skeleton: MacroSkeleton, share: number = GREAT_LIMB_SHARE): Uint8Array {
	const great = structuralAxes(skeleton, share);
	const parts = new Uint8Array(skeleton.axes.count);
	for (let a = 0; a < parts.length; a++)
		parts[a] = (skeleton.axes.parent[a] as number) < 0 ? 0 : great[a] ? 1 : 2;
	return parts;
}

/**
 * The order in which a plant's foliage goes as it thins.
 *
 * @param skeleton The skeleton as grown.
 * @param rows The shoot rows as grown, each with its node and, as its record, its axis.
 * @param limbs The least share of the thickest limb's radius that makes a limb great.
 * @param pinned Rows that stay at every sparseness, such as the row that holds the plant's top.
 * @returns The order.
 * @category api/vegetation
 */
export function sparseOrder(
	skeleton: MacroSkeleton,
	rows: ShootRows,
	limbs: number = GREAT_LIMB_SHARE,
	pinned: readonly number[] = [],
): SparseOrder {
	const { axes, position, nodeCount } = skeleton;
	const count = axes.count;
	const nodes = rows.node;
	const byRows = rows.count > 0 && nodes !== undefined;
	const structural = structuralAxes(skeleton, limbs);
	// The families: each axis's own rows and the branches that leave it. The plant's root family
	// holds the axes with no parent.
	const root = count;
	const children: number[][] = Array.from({ length: count + 1 }, () => []);
	for (let a = 0; a < count; a++) {
		const parent = axes.parent[a] as number;
		(children[parent < 0 ? root : parent] as number[]).push(a);
	}
	const ownRows: number[][] = Array.from({ length: count }, () => []);
	if (byRows) for (let r = 0; r < rows.count; r++) ownRows[rows.record[r] as number]?.push(r);
	// The carriers each axis holds with every branch below it. A child follows its parent, so a
	// backward pass sums each branch before the axis it leaves.
	const carried = new Uint32Array(count);
	for (let a = count - 1; a >= 0; a--) {
		const own = byRows
			? (ownRows[a] as number[]).length
			: (children[a] as number[]).length === 0 && !structural[a]
				? 1
				: 0;
		carried[a] = (carried[a] as number) + own;
		const parent = axes.parent[a] as number;
		if (parent >= 0) carried[parent] = (carried[parent] as number) + (carried[a] as number);
	}
	// What stays whatever the cut: the stems and great limbs, the wood up to the plant's highest
	// node, and the wood under each pinned row.
	const stays = structural.slice();
	const pin = (axis: number) => {
		for (let a = axis; a >= 0 && !stays[a]; a = axes.parent[a] as number) stays[a] = 1;
	};
	let highest = -1;
	for (let n = 0; n < nodeCount; n++)
		if (highest < 0 || (position[n * 3 + 1] as number) > (position[highest * 3 + 1] as number))
			highest = n;
	if (highest >= 0) pin(skeleton.axisOf[highest] as number);
	if (byRows)
		for (const r of pinned) {
			pin(rows.record[r] as number);
			pin(skeleton.axisOf[(nodes as Uint32Array)[r] as number] as number);
		}
	// The walk. A family's members stand from the tip of their axis to its base: a row at its node,
	// a branch where it leaves. Rows at one node stand in an order of their own, so a regular
	// spacing of rows about an axis never falls in step with the places. The plant's root family
	// stands round the plant by the bearing of each axis's tip.
	const centreX = (skeleton.bounds.min[0] + skeleton.bounds.max[0]) / 2;
	const centreZ = (skeleton.bounds.min[2] + skeleton.bounds.max[2]) / 2;
	const along = (member: number): number => {
		if (member >= 0) return (nodes as Uint32Array)[member] as number;
		const a = -member - 1;
		if ((axes.parent[a] as number) >= 0)
			return (axes.parentNode[a] as number) + (axes.parentT[a] as number) * 0.5;
		const tip = axes.last[a] as number;
		return atan2(
			(position[tip * 3 + 2] as number) - centreZ,
			(position[tip * 3] as number) - centreX,
		);
	};
	const tie = (member: number) => (member >= 0 ? hashAt(member, 1) : hashAt(-member - 1, 2));
	/** The members of an axis's family that carry foliage, a row as its index, a branch below zero. */
	const family = (parent: number): number[] => {
		const members: number[] = [];
		for (const a of children[parent] as number[])
			if ((carried[a] as number) > 0) members.push(-a - 1);
		if (parent < count && byRows) for (const r of ownRows[parent] as number[]) members.push(r);
		const at = new Map<number, number>();
		for (const member of members) at.set(member, along(member));
		return members.sort(
			(a, b) => (at.get(b) as number) - (at.get(a) as number) || tie(a) - tie(b) || a - b,
		);
	};
	// The list of carriers, and the run of it each axis's foliage takes.
	const list: number[] = [];
	const runStart = new Int32Array(count).fill(-1);
	const runEnd = new Int32Array(count);
	const open: { readonly axis: number; readonly members: number[]; at: number }[] = [
		{ axis: root, members: family(root), at: 0 },
	];
	while (open.length > 0) {
		const top = open[open.length - 1] as (typeof open)[number];
		if (top.at >= top.members.length) {
			if (top.axis < count) runEnd[top.axis] = list.length;
			open.pop();
			continue;
		}
		const member = top.members[top.at++] as number;
		if (member >= 0) {
			list.push(member);
			continue;
		}
		const a = -member - 1;
		runStart[a] = list.length;
		if (!byRows && (children[a] as number[]).length === 0) {
			list.push(a);
			runEnd[a] = list.length;
		} else open.push({ axis: a, members: family(a), at: 0 });
	}
	// The places, by the reversed bits of each carrier's index in the list. Then each axis's first
	// carrier takes the earliest place of its run, parents before the branches that leave them, so
	// whatever stays of an axis's foliage, its outermost carrier stays with it.
	const places = reversedPlaces(list.length);
	for (let a = 0; a < count; a++) {
		const start = runStart[a] as number;
		if (start < 0) continue;
		let earliest = start;
		for (let i = start + 1; i < (runEnd[a] as number); i++)
			if ((places[i] as number) < (places[earliest] as number)) earliest = i;
		const place = places[earliest] as number;
		places[earliest] = places[start] as number;
		places[start] = place;
	}
	// The carriers that never go lead the order: the first of each axis that stays, and the pinned
	// rows. Every axis above one of them stays too, so the rule of the first carrier still holds.
	const forced = new Uint8Array(list.length);
	for (let a = 0; a < count; a++)
		if (stays[a] && (runStart[a] as number) >= 0) forced[runStart[a] as number] = 1;
	if (byRows) {
		const pinnedRows = new Set(pinned);
		for (let i = 0; i < list.length; i++) if (pinnedRows.has(list[i] as number)) forced[i] = 1;
	}
	const ordered = Array.from({ length: list.length }, (_, i) => i).sort(
		(a, b) =>
			(forced[b] as number) - (forced[a] as number) ||
			(places[a] as number) - (places[b] as number),
	);
	const place = new Uint32Array(byRows ? rows.count : count).fill(NO_PLACE);
	let least = 0;
	ordered.forEach((index, at) => {
		place[list[index] as number] = at;
		if (forced[index]) least++;
	});
	// The bare branches thin beside the foliage, spread by the same rule through their own list.
	const bare: number[] = [];
	for (let a = 0; a < count; a++) if ((carried[a] as number) === 0 && !structural[a]) bare.push(a);
	const barePlace = new Uint32Array(count);
	const bareAt = reversedPlaces(bare.length);
	bare.forEach((a, i) => {
		barePlace[a] = stays[a]
			? 0
			: Math.floor(((bareAt[i] as number) * list.length) / Math.max(1, bare.length));
	});
	const sockets = byRows ? rowSockets(skeleton, rows) : undefined;
	if (sockets) {
		const thinned = socketPlaces(skeleton, sockets, list, least, structural, place, barePlace);
		return {
			byRows,
			carriers: thinned.carriers,
			place,
			list: Uint32Array.from(list),
			barePlace,
			structural,
			whole: stays,
			carried,
			least: thinned.least,
			bySockets: true,
			socketOf: sockets,
		};
	}
	return {
		byRows,
		carriers: list.length,
		place,
		list: Uint32Array.from(list),
		barePlace,
		structural,
		whole: stays,
		carried,
		least,
		bySockets: false,
	};
}

/**
 * Cuts each axis of a plant of sockets that carries foliage back to the last node that holds a kept
 * piece or that a kept branch leaves, so no kept axis ends in bare wood. The wood that stays whole
 * at every sparseness stays whole, and so does wood that never carried foliage. An axis whose node
 * of leaving was cut goes.
 */
function cutBack(
	skeleton: MacroSkeleton,
	rows: ShootRows,
	order: SparseOrder,
	kept: number,
	keepTo: Int32Array,
): void {
	const { axes, axisOf } = skeleton;
	const nodes = rows.node as Uint32Array;
	const last = new Int32Array(axes.count).fill(-1);
	for (let r = 0; r < rows.count; r++) {
		if ((order.place[r] as number) >= kept) continue;
		const node = nodes[r] as number;
		const axis = axisOf[node] as number;
		if (node > (last[axis] as number)) last[axis] = node;
	}
	for (let a = axes.count - 1; a >= 0; a--) {
		if ((keepTo[a] as number) < 0) continue;
		const own = order.whole[a] || (order.carried[a] as number) === 0;
		if (!own) keepTo[a] = Math.min(keepTo[a] as number, last[a] as number);
		const parent = axes.parent[a] as number;
		if ((keepTo[a] as number) >= 0 && parent >= 0 && (order.carried[a] as number) > 0) {
			const from = axes.parentNode[a] as number;
			if (from > (last[parent] as number)) last[parent] = from;
		}
	}
	// A cut can reach a node that a later axis leaves; children follow their parents in the table.
	for (let a = 0; a < axes.count; a++) {
		const parent = axes.parent[a] as number;
		if ((keepTo[a] as number) < 0 || parent < 0) continue;
		if ((keepTo[parent] as number) < (axes.parentNode[a] as number)) keepTo[a] = -1;
	}
}

/**
 * The socket a point at a node stands at, on a plant of sockets: the socket at that node that
 * stands nearest it. Every row of a socket stands at the socket's own place, and the sockets of one
 * shoot share a place, so the rows of a shoot all find its first socket.
 */
function socketFinder(
	skeleton: MacroSkeleton,
): (node: number, x: number, y: number, z: number) => number {
	const { buds } = skeleton;
	const atNode = new Map<number, number[]>();
	for (let b = 0; b < buds.count; b++) {
		const node = buds.node[b] as number;
		const list = atNode.get(node);
		if (list) list.push(b);
		else atNode.set(node, [b]);
	}
	return (node, x, y, z) => {
		const candidates = atNode.get(node);
		if (!candidates) return -1;
		let best = candidates[0] as number;
		let nearest = Number.POSITIVE_INFINITY;
		for (const b of candidates) {
			const dx = (buds.position[b * 3] as number) - x;
			const dy = (buds.position[b * 3 + 1] as number) - y;
			const dz = (buds.position[b * 3 + 2] as number) - z;
			const d = dx * dx + dy * dy + dz * dz;
			if (d < nearest) {
				nearest = d;
				best = b;
			}
		}
		return best;
	};
}

/**
 * Each row's socket on a plant of sockets: the socket at the row's node that stands nearest the
 * row. A shoot whose sockets share one place is one socket here, so it thins whole.
 *
 * @param skeleton The skeleton as grown.
 * @param rows The shoot rows as grown, each with its node.
 * @returns One socket per row, or undefined on a plant without sockets.
 * @category api/vegetation
 */
export function rowSockets(skeleton: MacroSkeleton, rows: ShootRows): Uint32Array | undefined {
	const nodes = rows.node;
	if (!skeleton.buds.sockets || !nodes || rows.count === 0) return undefined;
	const find = socketFinder(skeleton);
	const out = new Uint32Array(rows.count);
	for (let r = 0; r < rows.count; r++) {
		const socket = find(
			nodes[r] as number,
			rows.position[r * 3] as number,
			rows.position[r * 3 + 1] as number,
			rows.position[r * 3 + 2] as number,
		);
		if (socket < 0) return undefined;
		out[r] = socket;
	}
	return out;
}

/** The least share of its pieces that a kept unit of a plant of sockets keeps before it goes whole. */
const CLOTHED = 0.5;

/**
 * The places of a plant of sockets, by whole branches first. Every row takes its socket's place,
 * and the sockets stand in three runs: those that hold a carrier that never goes; then the clothed
 * part of every unit, unit by unit in the units' order, so whole units go from its end; then the
 * rest of every unit, by its share along the unit, so each unit thins evenly down to its clothed
 * part. A unit's sockets stand in the walk's order and take places by reversed bits, spread from its
 * base to its tips. The bare branches keep their own spread, counted in sockets. Writes the rows' and the bare branches'
 * places in place.
 *
 * @returns The sockets that hold rows, and how many of them never go.
 */
function socketPlaces(
	skeleton: MacroSkeleton,
	sockets: Uint32Array,
	list: readonly number[],
	leastRows: number,
	structural: Uint8Array,
	place: Uint32Array,
	barePlace: Uint32Array,
): { readonly carriers: number; readonly least: number } {
	const { axes, buds } = skeleton;
	// Each socket's earliest place among its rows, and its unit: the branch that leaves a stem or a
	// great limb and holds it, or, for the sockets on a stem or great limb itself, that axis's own.
	const earliest = new Map<number, number>();
	const unitOf = new Map<number, number>();
	const units: number[][] = [];
	const unitIndex = new Map<number, number>();
	for (const row of list) {
		const socket = sockets[row] as number;
		earliest.set(socket, Math.min(earliest.get(socket) ?? NO_PLACE, place[row] as number));
		if (unitOf.has(socket)) continue;
		let axis = buds.axis[socket] as number;
		let key = axes.count + axis;
		if (!structural[axis]) {
			for (
				let parent = axes.parent[axis] as number;
				parent >= 0 && !structural[parent];
				parent = axes.parent[axis] as number
			)
				axis = parent;
			key = axis;
		}
		let unit = unitIndex.get(key);
		if (unit === undefined) {
			unit = units.length;
			unitIndex.set(key, unit);
			units.push([]);
		}
		unitOf.set(socket, unit);
		(units[unit] as number[]).push(socket);
	}
	const forced = (socket: number) => (earliest.get(socket) as number) < leastRows;
	// The units take places by the reversed bits of their place in the walk; a unit that holds a
	// socket that never goes comes first.
	const spread = reversedPlaces(units.length);
	const unitPlace = new Float64Array(units.length);
	units.forEach((members, u) => {
		unitPlace[u] = (members.some(forced) ? -units.length : 0) + (spread[u] as number);
	});
	const always: number[] = [];
	const clothed: { socket: number; unit: number; rank: number }[] = [];
	const rest: { socket: number; unit: number; share: number }[] = [];
	// Sockets that leave one node, such as a tuft's shoots from its stool, stand by their bearing
	// round the plant, so the ones a unit keeps stand spread round it.
	const centreX = (skeleton.bounds.min[0] + skeleton.bounds.max[0]) / 2;
	const centreZ = (skeleton.bounds.min[2] + skeleton.bounds.max[2]) / 2;
	const bearing = (socket: number) =>
		atan2(
			(buds.position[socket * 3 + 2] as number) - centreZ,
			(buds.position[socket * 3] as number) - centreX,
		);
	const walkAt = new Map<number, number>();
	list.forEach((row, i) => {
		const node = buds.node[sockets[row] as number] as number;
		if (!walkAt.has(node)) walkAt.set(node, i);
	});
	units.forEach((members, u) => {
		members.sort(
			(a, b) =>
				(walkAt.get(buds.node[a] as number) as number) -
					(walkAt.get(buds.node[b] as number) as number) ||
				bearing(a) - bearing(b) ||
				a - b,
		);
		// A unit's sockets stand in the walk's order along it, and take places by reversed bits, so
		// the pieces a unit keeps stand spread from its base to its tips.
		const along = reversedPlaces(members.length);
		const core = Math.ceil(members.length * CLOTHED);
		members.forEach((socket, i) => {
			const rank = along[i] as number;
			if (forced(socket)) always.push(socket);
			else if (rank < core) clothed.push({ socket, unit: u, rank });
			else rest.push({ socket, unit: u, share: rank / members.length });
		});
	});
	always.sort((a, b) => (earliest.get(a) as number) - (earliest.get(b) as number));
	clothed.sort(
		(a, b) => (unitPlace[a.unit] as number) - (unitPlace[b.unit] as number) || a.rank - b.rank,
	);
	rest.sort(
		(a, b) => a.share - b.share || (unitPlace[a.unit] as number) - (unitPlace[b.unit] as number),
	);
	const socketPlace = new Map<number, number>();
	for (const socket of always) socketPlace.set(socket, socketPlace.size);
	for (const { socket } of clothed) socketPlace.set(socket, socketPlace.size);
	for (const { socket } of rest) socketPlace.set(socket, socketPlace.size);
	for (const row of list) place[row] = socketPlace.get(sockets[row] as number) as number;
	const carriers = socketPlace.size;
	for (let a = 0; a < barePlace.length; a++)
		barePlace[a] = Math.floor(((barePlace[a] as number) * carriers) / Math.max(1, list.length));
	return { carriers, least: always.length };
}

/**
 * The carriers a plant keeps at a sparseness: all of them at 0, and the floor's share at 1, never
 * fewer than the order's least.
 *
 * @param order The plant's order.
 * @param sparse The sparseness, from 0 to 1.
 * @param floor The share of its carriers the sparsest plant keeps, from 0 to 1.
 * @returns The count.
 * @category api/vegetation
 */
export function sparseKeep(order: SparseOrder, sparse: number, floor: number): number {
	const share = 1 - Math.min(1, Math.max(0, sparse)) * (1 - Math.min(1, Math.max(0, floor)));
	return Math.min(order.carriers, Math.max(order.least, Math.round(order.carriers * share)));
}

/** A plant with a share of its foliage removed. */
export interface SparsePlant {
	/** The skeleton that stays, with the frame of the plant as grown. */
	readonly skeleton: MacroSkeleton;
	/** The rows that stay, each with its index in the plant as grown. */
	readonly rows: ShootRows;
}

/**
 * The plant that keeps the first `keep` carriers of its order: those rows, or those end axes, every
 * axis from each of them to the root, and the bare branches whose places pass. An axis stays whole or goes whole, and the wood that stays keeps its place and its
 * radii. The plant keeps the bounds, the height and the crown base it grew with, so every
 * sparseness of one plant shares one frame.
 *
 * @param skeleton The skeleton as grown.
 * @param rows The shoot rows as grown, each with its node and, as its record, its axis.
 * @param order The plant's order.
 * @param keep The carriers to keep.
 * @param least The fewest carriers the plant may keep: the order's own least for a sparseness,
 *   which holds the plant's height and outline, and fewer where a triangle maximum must go below it.
 * @returns The sparser plant, or undefined when nothing goes.
 * @category api/vegetation
 */
export function sparsePlant(
	skeleton: MacroSkeleton,
	rows: ShootRows,
	order: SparseOrder,
	keep: number,
	least: number = order.least,
): SparsePlant | undefined {
	const kept = Math.min(order.carriers, Math.max(least, Math.round(keep)));
	if (kept >= order.carriers) return undefined;
	const { axes, buds } = skeleton;
	const count = axes.count;
	const stays = new Uint8Array(count);
	const nodes = rows.node;
	if (order.byRows && nodes) {
		for (let r = 0; r < rows.count; r++) {
			if ((order.place[r] as number) >= kept) continue;
			stays[rows.record[r] as number] = 1;
			stays[skeleton.axisOf[nodes[r] as number] as number] = 1;
		}
	} else {
		for (let a = 0; a < count; a++) if ((order.place[a] as number) < kept) stays[a] = 1;
	}
	for (let a = 0; a < count; a++) if (order.structural[a]) stays[a] = 1;
	for (let a = count - 1; a >= 0; a--) {
		const parent = axes.parent[a] as number;
		if (stays[a] && parent >= 0) stays[parent] = 1;
	}
	// A branch that carries no foliage rides with the axis it leaves, while its place passes.
	for (let a = 0; a < count; a++) {
		if (stays[a] || (order.carried[a] as number) > 0) continue;
		const parent = axes.parent[a] as number;
		if ((parent < 0 || stays[parent]) && (order.barePlace[a] as number) < kept) stays[a] = 1;
	}
	const keepTo = new Int32Array(count);
	for (let a = 0; a < count; a++) keepTo[a] = stays[a] ? (axes.last[a] as number) : -1;
	if (order.bySockets && nodes) cutBack(skeleton, rows, order, kept, keepTo);
	// On a plant of sockets the bud sites are its sockets, and a socket whose place holds no kept
	// piece leaves with its piece. The sockets of one shoot share its place and go with it.
	let budKept: Uint8Array | undefined;
	if (order.socketOf && nodes) {
		const held = new Uint8Array(buds.count);
		for (let r = 0; r < rows.count; r++)
			if ((order.place[r] as number) < kept) held[order.socketOf[r] as number] = 1;
		const find = socketFinder(skeleton);
		budKept = new Uint8Array(buds.count);
		for (let b = 0; b < buds.count; b++) {
			const at = find(
				buds.node[b] as number,
				buds.position[b * 3] as number,
				buds.position[b * 3 + 1] as number,
				buds.position[b * 3 + 2] as number,
			);
			budKept[b] = held[at] as number;
		}
	}
	const {
		skeleton: thinned,
		axisOut,
		nodeOut,
	} = keptSkeleton(skeleton, keepTo, skeleton.crownBase, budKept);
	const axisOrigin = new Uint32Array(thinned.axes.count);
	for (let a = 0; a < count; a++) {
		const out = axisOut[a] as number;
		if (out >= 0) axisOrigin[out] = axes.origin?.[a] ?? a;
	}
	const budOrigin = new Uint32Array(thinned.buds.count);
	let bud = 0;
	for (let b = 0; b < buds.count; b++)
		if (
			(axisOut[buds.axis[b] as number] as number) >= 0 &&
			(nodeOut[buds.node[b] as number] as number) >= 0 &&
			(!budKept || budKept[b] === 1)
		)
			budOrigin[bud++] = buds.origin?.[b] ?? b;
	const frame: MacroSkeleton = {
		...thinned,
		axes: { ...thinned.axes, origin: axisOrigin },
		buds: { ...thinned.buds, origin: budOrigin },
		bounds: skeleton.bounds,
		height: skeleton.height,
		crownBase: skeleton.crownBase,
	};
	if (!order.byRows || !nodes) return { skeleton: frame, rows };
	// A carrier is one row, or on a plant of sockets one socket with all of its rows.
	let held = 0;
	for (let r = 0; r < rows.count; r++) if ((order.place[r] as number) < kept) held++;
	const out = {
		count: held,
		prototype: new Uint8Array(held),
		position: new Float32Array(held * 3),
		rotation: new Float32Array(held * 4),
		scale: new Float32Array(held),
		record: new Uint16Array(held),
		phase: new Uint8Array(held),
		sky: new Uint8Array(held),
		bent: new Uint8Array(held),
		order: new Uint32Array(held),
		...(rows.back ? { back: new Float32Array(held * 3) } : {}),
		node: new Uint32Array(held),
		id: new Uint32Array(held),
	};
	let at = 0;
	for (let r = 0; r < rows.count; r++) {
		if ((order.place[r] as number) >= kept) continue;
		out.prototype[at] = rows.prototype[r] as number;
		out.position.set(rows.position.subarray(r * 3, r * 3 + 3), at * 3);
		out.rotation.set(rows.rotation.subarray(r * 4, r * 4 + 4), at * 4);
		out.scale[at] = rows.scale[r] as number;
		out.record[at] = axisOut[rows.record[r] as number] as number;
		out.phase[at] = rows.phase[r] as number;
		out.sky[at] = rows.sky[r] as number;
		out.bent[at] = rows.bent[r] as number;
		out.order[at] = rows.order[r] as number;
		if (rows.back && out.back) out.back.set(rows.back.subarray(r * 3, r * 3 + 3), at * 3);
		out.node[at] = nodeOut[nodes[r] as number] as number;
		out.id[at] = rows.id?.[r] ?? r;
		at++;
	}
	return { skeleton: frame, rows: out };
}
