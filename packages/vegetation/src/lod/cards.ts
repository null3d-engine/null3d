// The card levels: each shoot row becomes its prototype's three card planes in the first card
// level, in plant space. The second level keeps every second card of the first in the rows'
// space-filling order, and each kept card grows about its middle by the square root of that step,
// so the thinned crown covers about as much as the full one (D-241's card rule).
//
// A card vertex carries its row's wind record (high and low byte, global in the species' table), the
// row's flutter phase, and the row's sky visibility. Its second texture coordinate holds the share
// of the way up the card, for the shoot's bend, and the plane: 0 and 1 for the crossed vertical
// planes, 2 for the horizontal one, over 2.
import type { MeshArrays } from '../asset';
import { normalize3, quatRotate, type Vector3 } from '../core/math';
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

/** Metres from a card to a branch its level draws within which the card joins the plant. */
const SEED_REACH = 2.5;

/** Metres between two cards within which their leaves meet, so one joins the other's clump. */
const CARD_REACH = 2;

/**
 * Whether a card level keeps a row, and how much it grows the row's cards: every second row of the
 * level above in the space-filling order, grown by the square root of the step. A share below one
 * thins the level's own rows further, by the same rule, so the kept cards grow to hold the crown
 * they stood on; the review tool tests the share to measure what the cards buy.
 *
 * @param order The row's rank on the space-filling curve.
 * @param level The card level.
 * @param share The share of the level's own card rows to keep, from 0.05 to 1.
 * @returns The growth of the row's cards, or 0 when the level drops it.
 * @category api/vegetation
 */
export function cardKeep(order: number, level: 1 | 2, share = 1): number {
	const own = 1 << (level - 1);
	const every = Math.max(1, Math.round(own / Math.max(0.05, Math.min(1, share))));
	if (order % every !== 0) return 0;
	const grow = Math.sqrt(every);
	return grow;
}

/**
 * The branches the cards of a level stand on: for each kept card row, the skeleton axis of its
 * nearest node, and every axis above it. A level that draws these branches keeps its cards joined
 * without dropping them.
 *
 * @param input The dressed variant.
 * @param level The card level.
 * @returns One flag per axis, 1 for a branch a card stands on.
 * @category api/vegetation
 */
export function supportAxes(input: MeshInput, level: 1 | 2): Uint8Array {
	const { skeleton, rows } = input;
	const { position, axisOf, nodeCount, axes } = skeleton;
	const out = new Uint8Array(axes.count);
	for (let r = 0; r < rows.count; r++) {
		if (cardKeep(rows.order[r] as number, level, input.cards ?? 1) === 0) continue;
		const x = rows.position[r * 3] as number;
		const y = rows.position[r * 3 + 1] as number;
		const z = rows.position[r * 3 + 2] as number;
		let best = Number.POSITIVE_INFINITY;
		let axis = -1;
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
		if (axis >= 0) out[axis] = 1;
	}
	for (let a = axes.count - 1; a >= 0; a--) {
		if (out[a] !== 1) continue;
		let parent = axes.parent[a] as number;
		while (parent >= 0) {
			out[parent] = 1;
			parent = axes.parent[parent] as number;
		}
	}
	return out;
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
	const { skeleton, rows, kit } = input;
	const keep = input.record.lod.woodOrders[level - 1] ?? 255;
	const { position, axisOf, nodeCount } = skeleton;
	const kept: number[] = [];
	for (let r = 0; r < rows.count; r++) {
		if (cardKeep(rows.order[r] as number, level, input.cards ?? 1) === 0) continue;
		if (!kit.prototypes[rows.prototype[r] as number]) continue;
		kept.push(r);
	}
	const connected = new Uint8Array(rows.count);
	const queue: number[] = [];
	const seedReach = SEED_REACH * SEED_REACH;
	for (const r of kept) {
		const x = rows.position[r * 3] as number;
		const y = rows.position[r * 3 + 1] as number;
		const z = rows.position[r * 3 + 2] as number;
		let best = Number.POSITIVE_INFINITY;
		for (let n = 0; n < nodeCount; n++) {
			const axis = axisOf[n] as number;
			if ((skeleton.axes.order[axis] as number) > keep) continue;
			const dx = (position[n * 3] as number) - x;
			const dy = (position[n * 3 + 1] as number) - y;
			const dz = (position[n * 3 + 2] as number) - z;
			const d = dx * dx + dy * dy + dz * dz;
			if (d < best) best = d;
		}
		if (best <= seedReach) {
			connected[r] = 1;
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
			if (connected[other]) continue;
			const dx = (rows.position[other * 3] as number) - x;
			const dy = (rows.position[other * 3 + 1] as number) - y;
			const dz = (rows.position[other * 3 + 2] as number) - z;
			if (dx * dx + dy * dy + dz * dz <= cardReach) {
				connected[other] = 1;
				queue.push(other);
			}
		}
	}
	return kept.filter((r) => connected[r] === 0);
}

/**
 * The card rows a level draws, each joined to the plant: a card joins where its own leaves reach a
 * branch the level draws, or another joined card, so no clump of cards hangs free. A level that
 * thins the wood as well as the cards drops the cards whose branch went with it.
 *
 * @param input The dressed variant.
 * @param level The card level.
 * @returns One flag per row, 1 for a card the level draws.
 * @category api/vegetation
 */
export function connectedCards(input: MeshInput, level: 1 | 2): Uint8Array {
	const { skeleton, rows, kit } = input;
	const keep = input.record.lod.woodOrders[level - 1] ?? 255;
	const join = input.cardJoin ?? 'remove';
	const support = join === 'branch' ? supportAxes(input, level) : undefined;
	const drawnAxis = (axis: number) =>
		(skeleton.axes.order[axis] as number) <= keep || support?.[axis] === 1;
	const { position, axisOf, nodeCount } = skeleton;
	const keptRows: number[] = [];
	for (let r = 0; r < rows.count; r++) {
		if (cardKeep(rows.order[r] as number, level, input.cards ?? 1) === 0) continue;
		if (!kit.prototypes[rows.prototype[r] as number]) continue;
		keptRows.push(r);
	}
	const connected = new Uint8Array(rows.count);
	const queue: number[] = [];
	const seedReach = SEED_REACH * SEED_REACH;
	for (const r of keptRows) {
		const x = rows.position[r * 3] as number;
		const y = rows.position[r * 3 + 1] as number;
		const z = rows.position[r * 3 + 2] as number;
		let best = Number.POSITIVE_INFINITY;
		for (let n = 0; n < nodeCount; n++) {
			const axis = axisOf[n] as number;
			if (!drawnAxis(axis)) continue;
			const dx = (position[n * 3] as number) - x;
			const dy = (position[n * 3 + 1] as number) - y;
			const dz = (position[n * 3 + 2] as number) - z;
			const d = dx * dx + dy * dy + dz * dz;
			if (d < best) best = d;
		}
		if (best <= seedReach) {
			connected[r] = 1;
			queue.push(r);
		}
	}
	// A twig join keeps every kept card; the mesh later draws the unjoined ones a line to the wood.
	const twigRows: number[] = [];
	if (join === 'twig')
		for (const r of keptRows)
			if (connected[r] === 0) {
				connected[r] = 1;
				twigRows.push(r);
			}
	const cardReach = CARD_REACH * CARD_REACH;
	while (queue.length > 0) {
		const r = queue.pop() as number;
		const x = rows.position[r * 3] as number;
		const y = rows.position[r * 3 + 1] as number;
		const z = rows.position[r * 3 + 2] as number;
		for (const other of keptRows) {
			if (connected[other]) continue;
			const dx = (rows.position[other * 3] as number) - x;
			const dy = (rows.position[other * 3 + 1] as number) - y;
			const dz = (rows.position[other * 3 + 2] as number) - z;
			if (dx * dx + dy * dy + dz * dz <= cardReach) {
				connected[other] = 1;
				queue.push(other);
			}
		}
	}
	return connected;
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
	const widen = Math.max(0, input.record.lod.cardGrow ?? 1);
	const base = input.variant * VARIANT_RECORDS;
	const local: Vector3 = [0, 0, 0];
	const world: Vector3 = [0, 0, 0];
	const connected = connectedCards(input, level);
	const { skeleton } = input;
	const { position, axisOf, nodeCount } = skeleton;
	const keep = input.record.lod.woodOrders[level - 1] ?? 255;
	const twigs = input.cardJoin === 'twig' ? new Set(cardTwigs(input, level)) : undefined;
	for (let r = 0; r < rows.count; r++) {
		const grow = cardKeep(rows.order[r] as number, level, input.cards ?? 1);
		if (grow === 0) continue;
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
		const px = rows.position[r * 3] as number;
		const py = rows.position[r * 3 + 1] as number;
		const pz = rows.position[r * 3 + 2] as number;
		if (connected[r] === 0) continue;
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
							grow * widen * (sx * (plane.right[c] as number) + sy * (plane.up[c] as number))) *
						scale;
				quatRotate(rows.rotation, r * 4, local, world);
				mesh.vertex(
					[px + world[0], py + world[1], pz + world[2]],
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
				to = [px + world[0], py + world[1], pz + world[2]];
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
