// What the tool adds on top of the frozen search: small changes to named roads, and rows of attached
// houses in the town, on the quay, behind the beach and over the village crowns. No house of the search
// moves, and each addition keeps clear of what stands already.

import {
	bake,
	currentGround,
	edgeGrid,
	inCore,
	type Lot,
	MOST_OFF_FORM,
	MOST_OFF_GROUND,
	NEIGHBOUR,
	padFaces,
	rasterAll,
	read,
	roadEdge,
	type Tread,
	WAY_HALF,
} from './ground';
import {
	BAY,
	beachShare,
	formHeight,
	golfShare,
	hypot,
	inland,
	QUAY_FROM,
	QUAY_TO,
	quayWallZ,
	sandAt,
	townShare,
	VILLAGES,
} from './island';
import { HOUSE_KINDS } from './kit';
import { PARKS, type Road, type RoadPoint, STREET_RADIUS } from './routes';

/** The most sand that may lie under a house's plot, as the land's weight of it. */
const MOST_SAND = 0.1;
/** The half width of a village street. */
const VILLAGE_STREET_HALF = 1.95;
/** The attached house kinds, by their numbers in `HOUSE_KINDS`. */
const ATTACHED = HOUSE_KINDS.flatMap((kind, k) => (kind.town ? [k] : []));
/** A plain random number from an integer: the same on every engine. */
const hashed = (n: number): number => {
	let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** The rounds in which an added house may settle to its ground before it goes. */
const SETTLE_ROUNDS = 4;
/** The most houses that stand highest on a crown, and how far from its tower they stand, in meters. */
const CROWN_TOP = 4;
const CROWN_RADIUS = 30;
/** The width of an alley through a row of houses, in meters. */
const ALLEY = 3;
/** How far a house's plot keeps from a stair's line, in meters. */
const STAIR_ROOM = 1.3;

/** Whether two plots' rectangles overlap, by the gap test along each of their axes. */
function plotsTouch(a: Lot, b: Lot, gap: number): boolean {
	const corners = (lot: Lot) => {
		const [w, back, front] = lot.plot;
		const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
		return (
			[
				[-w, -back],
				[w, -back],
				[w, front],
				[-w, front],
			] as const
		).map(([u, v]) => [lot.x + u * c + v * s, lot.z - u * s + v * c] as const);
	};
	const [ca, cb] = [corners(a), corners(b)];
	for (const lot of [a, b])
		for (const [ax, az] of [
			[Math.cos(lot.yaw), -Math.sin(lot.yaw)],
			[Math.sin(lot.yaw), Math.cos(lot.yaw)],
		] as const) {
			const span = (list: readonly (readonly [number, number])[]) => {
				const d = list.map(([x, z]) => x * ax + z * az);
				return [Math.min(...d), Math.max(...d)] as const;
			};
			const [alo, ahi] = span(ca);
			const [blo, bhi] = span(cb);
			if (ahi + gap < blo || bhi + gap < alo) return false;
		}
	return true;
}

/** The nearest point of any other road to a place: its road, its index and how far it lies. */
function nearestOther(roads: readonly Road[], road: Road, x: number, z: number) {
	let best = { other: road, at: 0, d: Number.POSITIVE_INFINITY };
	for (const other of roads) {
		if (other === road) continue;
		const { points } = other;
		// A road's own end is not its middle, where another road leaves it.
		for (let at = 3; at + 3 < points.length; at++) {
			const p = points[at] as RoadPoint;
			const d = hypot(p.x - x, p.z - z);
			if (d < best.d) best = { other, at, d };
		}
	}
	return best;
}

/** The meters between two junctions on a road under which they read as a mistake. */
const JUNCTION_GAP = 15;
/** The points of a road that follow its start when the start moves. */
const START_BLEND = 24;
/** The points of a road whose height follows its start. */
const HEIGHT_BLEND = 16;

/** Moves a road's start along the road it leaves, with its first points easing after it. */
function moveStart(road: Road, to: RoadPoint): void {
	const first = road.points[0] as RoadPoint;
	const [dx, dy, dz] = [to.x - first.x, to.y - first.y, to.z - first.z];
	for (let k = 0; k < Math.min(START_BLEND, road.points.length - 1); k++) {
		const share = (1 - k / START_BLEND) ** 2;
		const p = road.points[k] as RoadPoint;
		p.x += dx * share;
		p.y += dy * Math.max(0, 1 - k / HEIGHT_BLEND) ** 2;
		p.z += dz * share;
	}
}

/**
 * Resolves junctions under a limit apart on one road: two on opposite sides line up as a true crossroads
 * when they are close, and otherwise the later road's start moves along until they stand apart.
 */
export function spaceJunctions(roads: readonly Road[]): number {
	let moved = 0;
	for (const parent of roads) {
		// Each road that meets this one: the place, and whether it is a road's start, which can move.
		const meets = roads
			.filter((road) => road !== parent && road.end !== 'loop')
			.flatMap((road) => {
				const ends = [{ end: road.points[0] as RoadPoint, start: true }];
				if (road.end === 'junction')
					ends.push({ end: road.points[road.points.length - 1] as RoadPoint, start: false });
				return ends.map(({ end, start }) => {
					const near = nearestOther(roads, road, end.x, end.z);
					return { road, start, at: near.at, on: near.other === parent && near.d < 1 };
				});
			})
			.filter(({ on }) => on)
			.sort((a, b) => a.at - b.at);
		for (let k = 0; k + 1 < meets.length; k++) {
			const [a, b] = [meets[k], meets[k + 1]] as [(typeof meets)[0], (typeof meets)[0]];
			const gap = (b.at - a.at) * 3;
			if (a.road === b.road || gap >= JUNCTION_GAP) continue;
			const [mover, fixed, dir] = b.start ? [b, a, 1] : a.start ? [a, b, -1] : [undefined, a, 0];
			if (!mover) continue;
			const p = parent.points[fixed.at] as RoadPoint;
			const q = parent.points[fixed.at + 1] as RoadPoint;
			const [tx, tz] = [q.x - p.x, q.z - p.z];
			const side = (road: Road) => {
				const s = road.points[road.points.length > 6 ? 6 : 1] as RoadPoint;
				return Math.sign(tx * (s.z - p.z) - tz * (s.x - p.x));
			};
			// Close and on opposite sides: one crossroads. Otherwise the start moves on along the road.
			const at =
				gap < 8 && side(a.road) !== side(b.road)
					? fixed.at
					: Math.max(
							1,
							Math.min(fixed.at + dir * Math.ceil(JUNCTION_GAP / 3), parent.points.length - 2),
						);
			// A road that others join near its start stays where it is.
			const joined = roads.some((other) => {
				if (other === mover.road || other === parent) return false;
				const e = other.points[0] as RoadPoint;
				return mover.road.points.slice(1, START_BLEND).some((t) => hypot(t.x - e.x, t.z - e.z) < 1);
			});
			if (joined || mover.road.radius === STREET_RADIUS) continue;
			moveStart(mover.road, parent.points[at] as RoadPoint);
			mover.at = at;
			moved++;
		}
	}
	return moved;
}

/** A place on a road's end: its x and z, in meters. */
type Place = readonly [number, number];

/** The junctions that stand too close to another, each with the points it moves along the road it meets. */
const JOIN_SHIFTS: readonly (readonly [Place, number])[] = [
	[[-204, 225], 1],
	[[-203, 262], 2],
	[[-13, 161], 2],
	[[-14, 146], 2.2],
	[[6, 213], -1.2],
	[[1, 206], 0.9],
	[[48, 182], -3],
	[[-388, -137], 8],
	[[-213, -20], 1.2],
	[[-206, -16], -1.2],
];
/** The turning circles too close to another, each with the points cut from the end of its road. */
const CIRCLE_CUTS: readonly (readonly [Place, number])[] = [
	[[20, -202], 5],
	[[-552, -268], 6],
];
/** The short roads that end in a circle with too few houses to serve, which go with their houses. */
const SPARE_ROADS: readonly Place[] = [
	[-194, 62],
	[54, 70],
];
/** The circles that another road reaches, so they stay, which take houses along the end of their road. */
const SERVED_CIRCLES: readonly (readonly [Place, number])[] = [
	[[205, -360], 3],
	[[355, -186], 2],
];
/** The points of a served circle's road, back from its end, that its new houses stand along. */
const SERVED_REACH = 14;

/** The road end that stands within a few meters of a place, and which end it is. */
function endAt(roads: readonly Road[], [x, z]: Place): { road: Road; start: boolean } {
	for (const road of roads)
		for (const start of [true, false]) {
			const end = road.points[start ? 0 : road.points.length - 1] as RoadPoint;
			if (hypot(end.x - x, end.z - z) < 4) return { road, start };
		}
	throw new Error(`no road ends near ${x}, ${z}`);
}

/** The points of a road that follow an end shifted along the road that it meets. */
const SHIFT_BLEND = 40;

/** Moves a road's end to a place, with the road's points easing after it, and any road that leaves those points. */
function moveEnd(roads: readonly Road[], road: Road, start: boolean, to: RoadPoint): void {
	const { points } = road;
	const at = (k: number) => points[start ? k : points.length - 1 - k] as RoadPoint;
	const first = at(0);
	const [dx, dy, dz] = [to.x - first.x, to.y - first.y, to.z - first.z];
	const reach = Math.min(SHIFT_BLEND, points.length - 1);
	const riders: { other: Road; at: number }[] = [];
	for (const other of roads) {
		if (other === road) continue;
		const e = other.points[0] as RoadPoint;
		for (let k = 1; k < reach; k++) {
			const p = at(k);
			if (hypot(p.x - e.x, p.z - e.z) < 1) riders.push({ other, at: k });
		}
	}
	for (let k = 0; k < reach; k++) {
		const share = (1 - k / reach) ** 2;
		const p = at(k);
		p.x += dx * share;
		p.y += dy * share;
		p.z += dz * share;
	}
	for (const rider of riders) moveEnd(roads, rider.other, true, at(rider.at));
}

/** Moves each junction that stands too close to another along the road that it meets. */
export function shiftJoins(roads: readonly Road[]): void {
	for (const [place, steps] of JOIN_SHIFTS) {
		const { road, start } = endAt(roads, place);
		const end = road.points[start ? 0 : road.points.length - 1] as RoadPoint;
		const { other, at } = nearestOther(roads, road, end.x, end.z);
		// A shift of part of a point stands that share of the way to the next one.
		const whole = Math.trunc(steps);
		const [p, q] = [other.points[at + whole], other.points[at + whole + Math.sign(steps)]] as [
			RoadPoint,
			RoadPoint,
		];
		const share = Math.abs(steps - whole);
		moveEnd(roads, road, start, {
			x: p.x + (q.x - p.x) * share,
			y: p.y + (q.y - p.y) * share,
			z: p.z + (q.z - p.z) * share,
		});
	}
}

/** Cuts back the circles that stand too close to another. */
export function cutCircles(roads: readonly Road[]): void {
	for (const [place, count] of CIRCLE_CUTS) {
		const { road } = endAt(roads, place);
		road.points.length -= count;
	}
}

/** Takes away the roads that serve too few houses, with those houses. */
export function dropSpareRoads(roads: Road[], lots: Lot[]): { roads: Road[]; lots: Lot[] } {
	const spare = new Set(SPARE_ROADS.map((place) => endAt(roads, place).road));
	return {
		roads: roads.filter((road) => !spare.has(road)),
		lots: lots.filter((lot) => !spare.has(lot.road)),
	};
}

/** The longest that a house's drive may run, in meters. */
const GATE_RUN = 25;
/** The steepest that a house's drive may run from its gate. */
const GATE_GRADE = 0.132;

/** A house whose road moved under its gate takes the nearest point of that road that keeps its drive's grade. */
export function mendGates(lots: readonly Lot[]): void {
	for (const lot of lots) {
		const { half } = HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number];
		const grade = ({ x, y, z }: RoadPoint) =>
			Math.abs(lot.y - y) / Math.max(hypot(lot.x - x, lot.z - z) - half[1], 1);
		if (grade(lot.gate) <= GATE_GRADE) continue;
		let best = lot.gate;
		let nearest = Number.POSITIVE_INFINITY;
		for (const p of lot.road.points) {
			const d = hypot(lot.x - p.x, lot.z - p.z);
			if (d - half[1] > 25 || grade(p) > GATE_GRADE || d >= nearest) continue;
			nearest = d;
			best = p;
		}
		lot.gate = best;
	}
}

/** The houses that stand on their ground, once it is baked for all of them. */
export function dropOffGround(all: readonly Lot[], stairs: readonly (readonly Tread[])[]): Lot[] {
	let lots = [...all];
	for (let round = 0; round < 3; round++) {
		bake(lots, stairs);
		const land = currentGround();
		const kept = lots.filter((lot) => {
			if (Math.abs(lot.y - formHeight(lot.x, lot.z)) > MOST_OFF_FORM) return false;
			const { half } = HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number];
			const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
			return [
				[half[0], half[1]],
				[-half[0], half[1]],
				[half[0], -half[1]],
				[-half[0], -half[1]],
			].every(([u, v]) => {
				const [x, z] = [
					lot.x + (u as number) * c + (v as number) * s,
					lot.z - (u as number) * s + (v as number) * c,
				];
				return roadEdge(x, z) >= 0 && Math.abs(read(land, x, z) - lot.y) <= MOST_OFF_GROUND * 1.1;
			});
		});
		if (kept.length === lots.length) break;
		lots = kept;
	}
	return lots.filter((lot) =>
		lots.some((o) => o !== lot && hypot(o.x - lot.x, o.z - lot.z) < NEIGHBOUR),
	);
}

/** Whether a line from a house's door to its gate passes through another house. */
function wayBlocked(lot: Lot, gate: RoadPoint, all: readonly Lot[]): boolean {
	const hd = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half[1];
	const [fx, fz] = [lot.x + Math.sin(lot.yaw) * (hd + 0.2), lot.z + Math.cos(lot.yaw) * (hd + 0.2)];
	const [dx, dz] = [gate.x - fx, gate.z - fz];
	const length = hypot(dx, dz);
	// A drive crosses no other road.
	const [lx, lz] = [gate.x - lot.x, gate.z - lot.z];
	const run = hypot(lx, lz);
	for (let t = lot.road.half + 1.5; t < run * 0.95 - lot.road.half; t += 1)
		if (read(edgeGrid, gate.x - (lx * t) / run, gate.z - (lz * t) / run) < -0.2) return true;
	for (const other of all) {
		if (other === lot || Math.abs(other.x - fx) + Math.abs(other.z - fz) > length + 24) continue;
		const [hw, hz] = (HOUSE_KINDS[other.kind] as (typeof HOUSE_KINDS)[number]).half;
		const [c, s] = [Math.cos(other.yaw), Math.sin(other.yaw)];
		for (let t = 0; t <= length; t += 0.5) {
			const [ox, oz] = [fx + (dx * t) / length - other.x, fz + (dz * t) / length - other.z];
			if (Math.abs(ox * c - oz * s) < hw + WAY_HALF && Math.abs(ox * s + oz * c) < hz + WAY_HALF)
				return true;
		}
	}
	return false;
}

/**
 * Gives every house a clear way to its road: one whose line to its gate crosses a house takes the
 * nearest point of its road that keeps its drive's grade with a clear line, and with none it goes.
 */
export function clearWays(all: readonly Lot[]): { lots: Lot[]; moved: number; gone: number } {
	let lots = [...all];
	let [moved, gone] = [0, 0];
	for (let round = 0; round < 3; round++) {
		const kept: Lot[] = [];
		for (const lot of lots) {
			if (!wayBlocked(lot, lot.gate, lots)) {
				kept.push(lot);
				continue;
			}
			const { half } = HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number];
			let best: RoadPoint | undefined;
			let nearest = Number.POSITIVE_INFINITY;
			for (const p of lot.road.points) {
				const d = hypot(lot.x - p.x, lot.z - p.z);
				const run = d - half[1];
				if (run > GATE_RUN || d >= nearest) continue;
				if (Math.abs(lot.y - p.y) / Math.max(run, 1) > GATE_GRADE) continue;
				if (wayBlocked(lot, p, lots)) continue;
				nearest = d;
				best = p;
			}
			if (best) {
				lot.gate = best;
				moved++;
				kept.push(lot);
			} else gone++;
		}
		if (kept.length === lots.length) break;
		lots = kept;
	}
	return { lots, moved, gone };
}

/** What the additions keep clear of, and how they stand. */
class Infill {
	readonly added: Lot[] = [];
	constructor(
		private readonly lots: readonly Lot[],
		private readonly stairs: readonly (readonly Tread[])[],
	) {}

	/** The plot of an attached house of a kind, with its front toward a place. */
	house(n: number, x: number, y: number, z: number, yaw: number, road: Road, gate: RoadPoint): Lot {
		const kind = ATTACHED[Math.floor(hashed(n) * ATTACHED.length)] as number;
		const { half, reach } = HOUSE_KINDS[kind] as (typeof HOUSE_KINDS)[number];
		return {
			x,
			y,
			z,
			yaw,
			kind,
			garden: -1,
			road,
			gate,
			plot: [half[0], half[1], half[1]],
			reach,
			tone: hashed(n + 7777),
		};
	}

	/** Places a house when its plot is free of the sea, roads, other plots, stairs and the church's ground. */
	place(lot: Lot, gap = 0.05): boolean {
		const { x, z, reach } = lot;
		if (inland(x, z) < 8 || golfShare(x, z) > 0.02 || inCore(x, z)) return false;
		if (beachShare(x, z) > 0.2 && inland(x, z) < 55) return false;
		if (PARKS.some(([px, pz, r]) => hypot(x - px, z - pz) < r + reach)) return false;
		const [w, back, front] = lot.plot;
		const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
		for (let u = -w; u <= w + 0.01; u += w / 3)
			for (let v = -back; v <= front + 0.01; v += (back + front) / 4) {
				const [px, pz] = [x + u * c + v * s, z - u * s + v * c];
				if (read(edgeGrid, px, pz) < 0.6 || inland(px, pz) < 6 || inCore(px, pz)) return false;
				if (sandAt(px, pz) > MOST_SAND) return false;
				if (px >= QUAY_FROM - 8 && px <= QUAY_TO + 8 && pz > quayWallZ(px) - 1) return false;
			}
		for (const stair of this.stairs)
			for (const p of stair) {
				const [dx, dz] = [p.x - x, p.z - z];
				const [u, v] = [dx * c - dz * s, dx * s + dz * c];
				if (Math.abs(u) < w + STAIR_ROOM && v < front + STAIR_ROOM && v > -back - STAIR_ROOM)
					return false;
			}
		for (const other of [...this.lots, ...this.added]) {
			if (Math.abs(other.x - x) + Math.abs(other.z - z) > 50) continue;
			// Two pads at different heights leave room for a bank between them.
			if (plotsTouch(lot, other, Math.max(gap, (Math.abs(lot.y - other.y) - 3) / 3))) return false;
		}
		if (Math.abs(lot.y - formHeight(x, z)) > 12) return false;
		this.added.push(lot);
		return true;
	}
}

/** A row of attached houses along a stretch of road, on one side, stepping with the road's height. */
function rowAlong(
	infill: Infill,
	road: Road,
	from: number,
	to: number,
	side: number,
	limit: number,
	seed: number,
	second = 0,
): number {
	let placed = 0;
	let firsts = 0;
	let wait = 0;
	const { points } = road;
	const step = Math.sign(to - from) || 1;
	for (let k = from; k !== to && placed < limit; k += step) {
		const [a, p, b] = [
			points[Math.max(0, k - 1)] as RoadPoint,
			points[k] as RoadPoint,
			points[Math.min(points.length - 1, k + 1)] as RoadPoint,
		];
		wait -= 3;
		if (wait > 0) continue;
		const along = Math.atan2(b.z - a.z, b.x - a.x);
		const [nx, nz] = [-Math.sin(along) * side, Math.cos(along) * side];
		const yaw = Math.atan2(-nx, -nz);
		const n = seed + k * 3 + side;
		const probe = infill.house(n, 0, 0, 0, yaw, road, p);
		const d = probe.plot[1];
		const off = road.half + 1.2 + d;
		const lot = infill.house(n, p.x + nx * off, p.y, p.z + nz * off, yaw, road, p);
		if (!infill.place(lot)) {
			wait = 3;
			continue;
		}
		placed++;
		// Where a second row stands behind, every other gap leaves an alley through to its doors.
		firsts++;
		wait = 2 * lot.plot[0] + 0.1 + (second > 0 && firsts % 2 === 0 ? ALLEY : 0);
		// The second row stands behind each alley, so its door has a clear way through to the road. It steps
		// up the slope, or down it on the side where the land falls away.
		if (second > 0 && firsts % 2 === 0) {
			const reach = Math.round((lot.plot[0] + ALLEY / 2) / 3) * step;
			const gate = points[Math.max(0, Math.min(points.length - 1, k + reach))] as RoadPoint;
			const back = off + 2 * d + 1.2;
			const [rx, rz] = [gate.x + nx * back, gate.z + nz * back];
			const rise = Math.min(second, (back - d) * 0.12, MOST_ROW_RISE);
			const y = formHeight(rx, rz) >= gate.y ? gate.y + rise : gate.y - rise;
			if (infill.place(infill.house(n + 1, rx, y, rz, yaw, road, gate))) placed++;
		}
	}
	return placed;
}

/** The most that a second row may stand above the first, so that their two pads hold. */
const MOST_ROW_RISE = 1.3;
/** The half width of a stone stair, in meters. */
const STAIR_HALF = 0.8;
/** The houses that the quay's row, the town's blocks, the beach and the crowns may each add. */
const QUAY_MOST = 34;
const TOWN_MOST = 70;
const BEACH_MOST = 40;
const CROWN_MOST = 22;
/** The most houses in a village, against the rule of 50, with some in hand. */
const VILLAGE_MOST = 46;

/** Everything that the tool adds to the frozen search. */
export function addLayers(
	roads: readonly Road[],
	lots: readonly Lot[],
	stairs: readonly (readonly Tread[])[],
): { added: Lot[]; stairRoads: Road[]; counts: Record<string, number> } {
	rasterAll(roads);
	const infill = new Infill(lots, stairs);
	const counts: Record<string, number> = {};
	// The quay's row stands on the land side of the long street, from the harbour's west to its east.
	const quay = roads.find((road) => road.half === 2.7) as Road;
	const on = quay.points.flatMap((p, k) => (p.x > -215 && p.x < 40 ? [k] : []));
	const landSide = (k: number) => {
		const [p, q] = [quay.points[k] as RoadPoint, quay.points[k + 1] as RoadPoint];
		const [nx, nz] = [-(q.z - p.z), q.x - p.x];
		return inland(p.x + nx * 4, p.z + nz * 4) > inland(p.x - nx * 4, p.z - nz * 4) ? 1 : -1;
	};
	const [start, stop] = [on[0] as number, on[on.length - 1] as number];
	counts.quay = rowAlong(infill, quay, start, stop, landSide(start), QUAY_MOST, 1000);
	// The town's blocks fill along their streets, nearest the church first, two rows deep where there is room.
	const [cx, cz] = [-92, 186];
	const streets = roads
		.filter((road) => road.radius === STREET_RADIUS && road.end !== 'circle')
		.filter(({ points }) => {
			const mid = points[points.length >> 1] as RoadPoint;
			return townShare(mid.x, mid.z) > 0.3;
		})
		.sort((a, b) => {
			const [p, q] = [a.points[a.points.length >> 1], b.points[b.points.length >> 1]] as [
				RoadPoint,
				RoadPoint,
			];
			return hypot(p.x - cx, p.z - cz) - hypot(q.x - cx, q.z - cz);
		});
	let town = 0;
	for (const [n, road] of streets.entries())
		for (const side of [1, -1]) {
			if (town >= TOWN_MOST) break;
			town += rowAlong(
				infill,
				road,
				3,
				road.points.length - 3,
				side,
				TOWN_MOST - town,
				2000 + n * 500,
				1.2,
			);
		}
	counts.town = town;
	// Behind the beach, attached houses stand along the coast road in tiers up the slope.
	const coast = roads[0] as Road;
	const behind = coast.points.flatMap((p, k) =>
		hypot(p.x - BAY.x, p.z - BAY.z) < BAY.radius + 220 && p.x > 120 ? [k] : [],
	);
	let beach = 0;
	for (const side of [1, -1]) {
		const [p, q] = [
			coast.points[behind[0] as number] as RoadPoint,
			coast.points[(behind[0] as number) + 1] as RoadPoint,
		];
		const [nx, nz] = [-(q.z - p.z) * side, (q.x - p.x) * side];
		const far = hypot(p.x + nx - BAY.x, p.z + nz - BAY.z) > hypot(p.x - BAY.x, p.z - BAY.z);
		if (far)
			beach += rowAlong(
				infill,
				coast,
				behind[0] as number,
				behind[behind.length - 1] as number,
				side,
				BEACH_MOST,
				20000,
				1.8,
			);
	}
	counts.beach = beach;
	// Each village's streets fill with attached rows, and rows step up the stair over its crown.
	counts.crown = 0;
	const stairRoads: Road[] = stairs.map((points) => ({
		points: [...points],
		half: STAIR_HALF,
		end: 'path',
		radius: 0,
	}));
	VILLAGES.forEach(([vx, vz, , radius], v) => {
		const already = lots.filter((lot) => hypot(lot.x - vx, lot.z - vz) < radius * 1.35).length;
		const room = Math.min(CROWN_MOST, VILLAGE_MOST - already);
		const stair = stairRoads[v] as Road;
		let placed = 0;
		for (const side of [1, -1]) {
			if (placed >= room) break;
			placed += rowAlong(
				infill,
				stair,
				2,
				stair.points.length - 2,
				side,
				room - placed,
				50000 + v * 1000,
			);
		}
		for (const road of roads) {
			if (road.half !== VILLAGE_STREET_HALF) continue;
			const mid = road.points[road.points.length >> 1] as RoadPoint;
			if (hypot(mid.x - vx, mid.z - vz) > radius * 1.35) continue;
			for (const side of [1, -1]) {
				if (placed >= room) break;
				placed += rowAlong(
					infill,
					road,
					3,
					road.points.length - 2,
					side,
					room - placed,
					40000 + v * 1000,
				);
			}
		}
		// A few houses stand highest on the crown, facing down to the street below them.
		let high = 0;
		for (const road of roads) {
			if (road.half !== VILLAGE_STREET_HALF) continue;
			road.points.forEach((p, k) => {
				const r = hypot(p.x - vx, p.z - vz);
				if (high >= CROWN_TOP || k % 4 !== 0 || r < CROWN_RADIUS + 8 || r > radius * 1.1) return;
				const [nx, nz] = [(vx - p.x) / r, (vz - p.z) / r];
				const yaw = Math.atan2(-nx, -nz);
				const [x, z] = [p.x + nx * (r - CROWN_RADIUS), p.z + nz * (r - CROWN_RADIUS)];
				const run = r - CROWN_RADIUS - 4;
				const y = Math.min(p.y + run * 0.12, formHeight(x, z));
				if (infill.place(infill.house(70000 + v * 1000 + k, x, y, z, yaw, road, p))) high++;
			});
		}
		placed += high;
		// The road that arrives holds a row too, as the village's way in.
		for (const road of roads) {
			if (road.half === VILLAGE_STREET_HALF || road.end === 'loop') continue;
			const inside = road.points.flatMap((p, k) =>
				hypot(p.x - vx, p.z - vz) < radius * 1.3 ? [k] : [],
			);
			if (inside.length < 6) continue;
			for (const side of [1, -1]) {
				if (placed >= room) break;
				const [from, to] = [inside[0] as number, inside[inside.length - 1] as number];
				placed += rowAlong(infill, road, from, to, side, room - placed, 60000 + v * 1000, 1.3);
			}
		}
		counts[`crown${v}`] = placed;
		counts.crown = (counts.crown as number) + placed;
	});
	// An added house that the baked ground leaves off its floor goes, and the land is baked again.
	let added = infill.added;
	const every = stairs;
	for (let round = 0; round < 12; round++) {
		bake([...lots, ...added], every);
		const land = currentGround();
		const off = (lot: Lot) => {
			const { half } = HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number];
			const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
			return [
				[half[0], half[1]],
				[-half[0], half[1]],
				[half[0], -half[1]],
				[-half[0], -half[1]],
			].some(([u, v]) => {
				const [x, z] = [
					lot.x + (u as number) * c + (v as number) * s,
					lot.z - (u as number) * s + (v as number) * c,
				];
				return Math.abs(read(land, x, z) - lot.y) > MOST_OFF_GROUND;
			});
		};
		const bad = [...lots, ...added].filter(off);
		// An added house first settles to the ground that it stands on, taking the nearest gate that keeps its
		// drive's grade from there. One that still stands off its ground after that goes.
		if (round < SETTLE_ROUNDS) {
			let settled = 0;
			for (const lot of added) {
				if (!bad.includes(lot)) continue;
				const y = read(land, lot.x, lot.z);
				const { half } = HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number];
				let [gate, nearest] = [undefined as RoadPoint | undefined, Number.POSITIVE_INFINITY];
				for (const p of lot.road.points) {
					const d = hypot(lot.x - p.x, lot.z - p.z);
					const run = d - half[1];
					if (run > GATE_RUN || d >= nearest || Math.abs(y - p.y) / Math.max(run, 1) > GATE_GRADE)
						continue;
					[gate, nearest] = [p, d];
				}
				if (!gate) continue;
				lot.y = y;
				lot.gate = gate;
				settled++;
			}
			if (settled > 0) continue;
		}
		const gone = new Set(
			added.filter(
				(lot) =>
					bad.includes(lot) ||
					bad.some(
						(other) => !added.includes(other) && hypot(other.x - lot.x, other.z - lot.z) < 16,
					),
			),
		);
		if (gone.size === 0) break;
		added = added.filter((lot) => !gone.has(lot));
	}
	// An added house that stands in a tall face against the ground beside it goes too.
	for (let round = 0; round < 2; round++) {
		bake([...lots, ...added], every);
		const faces = padFaces(added, true);
		if (faces.size === 0) break;
		added = added.filter((lot) => !faces.has(lot));
	}
	const placed = infill.added.length;
	for (const [k, [place, count]] of SERVED_CIRCLES.entries()) {
		const { road } = endAt(roads, place);
		const last = road.points.length - 2;
		const served = (side: number, room: number, seed: number) =>
			rowAlong(infill, road, last, last - SERVED_REACH, side, room, seed);
		const first = served(1, count, 80000 + k * 1000);
		counts[`served${k}`] = first + served(-1, count - first, 81000 + k * 1000);
	}
	added = [...added, ...infill.added.slice(placed)];
	const all = [...lots, ...added];
	added = added.filter((lot) =>
		all.some((o) => o !== lot && hypot(o.x - lot.x, o.z - lot.z) < NEIGHBOUR),
	);
	counts.kept = added.length;
	return { added, stairRoads, counts };
}
