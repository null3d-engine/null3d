// The instancer: shoot rows on the bud sites of the grown skeleton. Each bud serves the stretch of
// its axis back to the bud before it, and carries as many rows as the record's shoots per metre at
// its vigor give that stretch: the first at the bud, the rest spread back along the stretch, rolled
// about the axis by the phyllotaxis. A row picks the shoot class whose vigor range holds its bud's
// vigor and a prototype of that class by hash, turns its leaves toward the sky by the record's
// skyward share, bends by the plant's tropism and takes its scale. A bud in less light than the
// shade-prune line carries none. Rows then take a space-filling order, which the thinned card level
// keeps every second of.
import type { ShootPrototype, ShootRows } from '../asset';
import { BUD_DORMANT, BUD_TERMINAL } from '../core/graph';
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
import type { DressInput } from '../stages';
import { inLeaf } from './season';

/** Sky visibility and bent normal of a row before the crown's light gives it its own. */
const OPEN_SKY = 250;
const BENT_UP = 0x88;
/** Degrees a row turns from straight up or down at most, by the plant's tropism. */
const TROPISM_LIMIT = 30;
/** Bits per axis of the space-filling key. */
const ORDER_BITS = 10;

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
} as const;

/**
 * The prototypes a bud of this vigor may draw: those whose class's range holds it, or those of the
 * nearest range when none does.
 *
 * @param prototypes The kit's prototypes.
 * @param vigor The bud's vigor.
 * @returns Their indices.
 * @category api/vegetation
 */
export function prototypesFor(
	prototypes: readonly Pick<ShootPrototype, 'vigor'>[],
	vigor: number,
): number[] {
	const holding: number[] = [];
	let nearest: number[] = [];
	let gap = Infinity;
	prototypes.forEach((prototype, index) => {
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

/** Degrees a row turns toward the sky (positive) or the ground, from the finest order's tropism. */
function tropismTurn(record: Species): number {
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
}

/** The space-filling key of a point inside a box: its axes' bits interleaved, high bits first. */
function spaceKey(p: Readonly<Vector3>, min: readonly number[], side: number): number {
	const max = 2 ** ORDER_BITS - 1;
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
 * The shoot rows of one variant, before the crown's light gives each its sky visibility.
 *
 * @param input The grown skeleton, the kit, the record, the seed and the variant.
 * @returns The rows.
 */
export function placeShoots(input: DressInput): ShootRows {
	const { record, seed, variant, skeleton, kit } = input;
	const shoots = record.shoots;
	const rows: Row[] = [];
	if (!shoots || kit.prototypes.length === 0) return packRows(rows, skeleton.bounds);
	const salt = record.seedSalt;
	const draw = (purpose: number, a = 0, b = 0) => unitAt(seed, salt, variant * 64 + purpose, a, b);
	const pick = (purpose: number, a = 0, b = 0) => hashAt(seed, salt, variant * 64 + purpose, a, b);
	const buds = skeleton.buds;
	const position = skeleton.position;
	const step = divergence(record);
	const angle = radians(lateralAngle(record));
	const tropism = radians(tropismTurn(record));
	const skyward = Math.min(1, Math.max(0, shoots.placement.skyward));
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
	for (const b of order) {
		const axis = buds.axis[b] as number;
		const kind = buds.kind[b] as number;
		const at: Vector3 = [
			buds.position[b * 3] as number,
			buds.position[b * 3 + 1] as number,
			buds.position[b * 3 + 2] as number,
		];
		const before = previous.get(axis);
		previous.set(axis, b);
		if (kind === BUD_DORMANT) continue;
		if ((buds.light[b] as number) < shoots.placement.shadePrune) continue;
		const vigor = buds.vigor[b] as number;
		// The stretch this bud serves: back to the bud before it on its axis, or to its node's parent.
		const node = buds.node[b] as number;
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
		const expected = curveAt(shoots.placement.perMetre, vigor) * stretch;
		const count = Math.max(
			kind === BUD_TERMINAL ? 1 : 0,
			Math.floor(expected + draw(Purpose.Count, b)),
		);
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
				// Spread back along the stretch, each a step of the phyllotaxis round the axis.
				const share = (k + 0.5 * draw(Purpose.Spacing, b, k)) / count;
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
			});
		}
	}
	return packRows(rows, skeleton.bounds);
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
	};
	const side = Math.max(
		bounds.max[0] - bounds.min[0],
		bounds.max[1] - bounds.min[1],
		bounds.max[2] - bounds.min[2],
	);
	const keys: number[] = [];
	rows.forEach((row, r) => {
		out.prototype[r] = row.prototype;
		out.position.set(row.position, r * 3);
		out.rotation.set(row.rotation, r * 4);
		out.scale[r] = row.scale;
		out.record[r] = row.record;
		out.phase[r] = row.phase;
		keys.push(spaceKey(row.position, bounds.min, side));
	});
	const ranked = keys
		.map((_, r) => r)
		.sort((a, b) => (keys[a] as number) - (keys[b] as number) || a - b);
	ranked.forEach((row, rank) => {
		out.order[row] = rank;
	});
	return out;
}
