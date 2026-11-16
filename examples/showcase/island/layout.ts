// The search that lays out the island's roads and house plots, in the order a real place grows. It is
// chaotic: one small change to a number moves many houses. So it runs only in the tool that writes the
// stored plan (write-layout.ts), and the scene loads that plan.
import { random } from '../../lib/procedural';
import {
	bake,
	circleRadius,
	currentGround,
	edgeGrid,
	FEWEST_ON_LANE,
	inCore,
	inWorld,
	KEEPS,
	LOOKUP,
	type Lot,
	lookupKey,
	MOST_OFF_FORM,
	MOST_OFF_GROUND,
	NEIGHBOUR,
	onHilltop,
	padFaces,
	rasterAll,
	read,
	roadHeight,
	STEEPEST_BANK,
	STEEPEST_DRIVE,
} from './ground';
import {
	beachShare,
	formHeight,
	golfShare,
	hypot,
	inland,
	naturalHeight,
	northOfRidge,
	onOutcrop,
	sandAt,
	townShare,
	VILLAGES,
} from './island';
import { GARDEN_KINDS, HOUSE_KINDS } from './kit';
import { ALL_ROADS } from './network';
import {
	LANE,
	LOCAL_RADIUS,
	PARKS,
	type Road,
	type RoadPoint,
	SIDE_LANE,
	STREET_RADIUS,
	THROUGH_RADIUS,
	TWIN_GAP,
} from './routes';

/** How far from the tower's middle a stair ends at its door, and the steepest it climbs, as a rise over a run. */
const STAIR_DOOR = 13;
const STEEPEST_STAIR = 0.6;
/** How much longer a stair runs than its rise and steepest grade ask, so that it can follow its land. */
const STAIR_SPARE = 1.2;
/** How far past its street's turning circle a stair starts, in meters. */
const STAIR_CLEAR = 4.5;
/** The points of a stair's first steps, which stay low. */
const STAIR_LOW = 3;
/** The least rise of a stair over a run: every tread stands above the one before it. */
const LEAST_STAIR = 0.04;
/** How far a tower's level pad reaches from its middle, in meters. */
const TOWER_PAD = 12;

/** The stone stair from each village up to its hill's tower's door: its points, with their heights. */
export const STAIRS: readonly (readonly { x: number; y: number; z: number }[])[] = VILLAGES.map(
	([vx, vz, , radius], k) => {
		const [, , doorY] = KEEPS[k] as readonly [number, number, number];
		// The stair starts on the village's street that comes nearest its tower, where the street ends.
		let start = { x: vx, y: doorY, z: vz + radius };
		let before = start;
		let least = Number.POSITIVE_INFINITY;
		for (const road of ALL_ROADS) {
			if (road.half <= SIDE_LANE || road.half >= LANE) continue;
			road.points.forEach((p, at) => {
				const r = hypot(p.x - vx, p.z - vz);
				if (r > radius || r >= least) return;
				least = r;
				start = p;
				before = road.points[Math.max(0, at - 2)] as RoadPoint;
			});
		}
		// It winds on around the tower the way that its street was winding, closing on the door. Its
		// length gives it the run that its rise asks.
		const length = ((doorY - start.y) / STEEPEST_STAIR) * STAIR_SPARE;
		// Its first step stands at the edge of the street's turning circle.
		const clear = (circleRadius(SIDE_LANE + 0.2) + STAIR_CLEAR) / least;
		const sense =
			Math.sign((start.x - vx) * (start.z - before.z) - (start.z - vz) * (start.x - before.x)) || 1;
		const sweep = length / ((least + STAIR_DOOR) / 2);
		const bearing = Math.atan2(start.z - vz, start.x - vx) + sense * clear;
		const lift =
			doorY - formHeight(vx + Math.cos(bearing) * TOWER_PAD, vz + Math.sin(bearing) * TOWER_PAD);
		const points: { x: number; y: number; z: number }[] = [];
		const count = Math.ceil(length / 1.5) + STAIR_LOW;
		for (let n = 0; n <= count; n++) {
			const t = n / count;
			const r = least + (STAIR_DOOR - least) * t;
			const angle = bearing + sense * sweep * t;
			const [x, z] = [vx + Math.cos(angle) * r, vz + Math.sin(angle) * r];
			// The land under a flight: the hill's form, with the bank that falls from the tower's pad.
			const land =
				formHeight(x, z) + Math.max(0, lift - Math.max(0, r - TOWER_PAD) * STEEPEST_BANK);
			points.push({ x, y: land, z });
		}
		// The flight follows that land as closely as it can, always rising, and no steeper than its limit.
		const span = (a: number, b: number) => {
			const [p, q] = [points[a] as RoadPoint, points[b] as RoadPoint];
			return hypot(p.x - q.x, p.z - q.z);
		};
		(points[0] as RoadPoint).y = start.y;
		(points[count] as RoadPoint).y = doorY;
		for (let n = 1; n < count; n++) {
			const [p, q] = [points[n] as RoadPoint, points[n - 1] as RoadPoint];
			const d = span(n, n - 1);
			// Its first steps stay low, on the ground beside the street.
			const most = n < STAIR_LOW ? LEAST_STAIR * 2 : STEEPEST_STAIR;
			p.y = Math.min(q.y + d * most, Math.max(q.y + d * LEAST_STAIR, p.y));
		}
		for (let n = count - 1; n > 0; n--) {
			const [p, q] = [points[n] as RoadPoint, points[n + 1] as RoadPoint];
			const d = span(n, n + 1);
			p.y = Math.min(q.y - d * LEAST_STAIR, Math.max(q.y - d * STEEPEST_STAIR, p.y));
		}
		return points;
	},
);

/** The width of the alley behind a hilltop's first row of houses, and how far its second row stands above the first, in meters. */
const ROW_ALLEY = 1.5;
const ROW_STEP = 1.7;
/** The walled plots that hillside houses take, by their numbers in the garden kinds: mostly small, some not. */
const HILL_GARDENS = [4, 3, 3, 1, 1, 2, 0];
/** The depth below the land's form at which a grown lane's stretch counts as a deep cut, in meters. */
const DEEP_LANE_CUT = 10;
/** The most height that a country plot's ground may span, in meters. */
const PLOT_RANGE = 12;
/** The height between two neighbouring pads that needs no bank, in meters, and the slope of the bank that a greater height takes. */
const PAD_STEP = 3;
const PAD_BANK = 1.4;
/** The most that the land may stand above a hilltop's street where its second row of houses stands, in meters. */
const MOST_SUNK = 12;
/** The slope of the bank between a plot and a stair that passes it at another height. */
const STAIR_ROOM = 2.2;
/** The height above which a through road takes few houses, so most stand low on the hills, in meters. */
const UPPER_ROAD = 86;
/** The depth below the land's form at which a road's cut counts as deep, in meters. */
const DEEP_ROAD_CUT = 9;
/** The house kinds that each kind of place builds, by their numbers in `HOUSE_KINDS`. */
/** The house kinds narrow enough for a hillside's small plot. */
const NARROW_KINDS = HOUSE_KINDS.flatMap((kind, k) => (kind.half[0] <= 5.5 ? [k] : []));
const TOWN_KINDS = HOUSE_KINDS.flatMap((kind, k) => (kind.town ? [k] : []));
const COUNTRY_KINDS = HOUSE_KINDS.flatMap((kind, k) => (kind.town ? [] : [k]));
/** The garden kinds that a country plot may take: a pool is the rarer one. */
const GARDEN_ODDS = [0, 1, 1, 2, 2, 3, 3, 3, 1, 2, 5];

/** Whether two plots' rectangles overlap, by the gap test along each of their axes. */
function plotsMeet(a: Lot, b: Lot, gap: number): boolean {
	const corners = (lot: Lot) => {
		const [w, back, front] = lot.plot;
		return [
			inWorld(lot, -w, -back),
			inWorld(lot, w, -back),
			inWorld(lot, w, front),
			inWorld(lot, -w, front),
		];
	};
	const [ca, cb] = [corners(a), corners(b)];
	for (const lot of [a, b])
		for (const [ax, az] of [
			[Math.cos(lot.yaw), -Math.sin(lot.yaw)],
			[Math.sin(lot.yaw), Math.cos(lot.yaw)],
		] as const) {
			const project = (list: (readonly [number, number])[]) => {
				let [lo, hi] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
				for (const [x, z] of list) {
					const d = x * ax + z * az;
					lo = Math.min(lo, d);
					hi = Math.max(hi, d);
				}
				return [lo, hi] as const;
			};
			const [alo, ahi] = project(ca);
			const [blo, bhi] = project(cb);
			if (ahi + gap < blo || bhi + gap < alo) return false;
		}
	return true;
}

/** Whether a point lies on or beside a village's stone stair. */
function onStair(x: number, z: number): boolean {
	return STAIRS.some((stair) => stair.some((p) => Math.abs(p.x - x) + Math.abs(p.z - z) < 3));
}

/** Lays house plots along the given roads, on the road grid as it now stands. */
function layLots(roads: readonly Road[], dropped: ReadonlySet<string>): Lot[] {
	const next = random(683);
	const lots: Lot[] = [];
	const near = new Map<number, Lot[]>();
	const place = (lot: Lot, gap: number, range: number): boolean => {
		const { x, z, reach, gate } = lot;
		if (dropped.has(`${Math.round(x)},${Math.round(z)}`)) return false;
		if (inland(x, z) < 18 || golfShare(x, z) > 0.02 || inCore(x, z)) return false;
		if (onOutcrop(x, z)) return false;
		// North of the ridge the land stays forest, past the villages on the crest.
		if (northOfRidge(x, z) && !onHilltop(x, z)) return false;
		if (beachShare(x, z) > 0.2 && inland(x, z) < 55) return false;
		if (PARKS.some(([px, pz, r]) => hypot(x - px, z - pz) < r + reach)) return false;
		const [w, back, front] = lot.plot;
		let [lowest, highest] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
		for (let u = -w; u <= w + 0.01; u += Math.max(2, w / 2))
			for (let v = -back; v <= front + 0.01; v += Math.max(2, (back + front) / 4)) {
				const [px, pz] = inWorld(lot, u, v);
				if (
					read(edgeGrid, px, pz) < 0.5 ||
					inland(px, pz) < 8 ||
					inCore(px, pz) ||
					onStair(px, pz) ||
					sandAt(px, pz) > 0.1
				)
					return false;
				const h = naturalHeight(px, pz);
				lowest = Math.min(lowest, h);
				highest = Math.max(highest, h);
			}
		if (highest - lowest > range) return false;
		// A drive leaves the road it serves at once, and crosses no other.
		const run = hypot(x - gate.x, z - gate.z);
		for (let t = (lot.road.half + 1) / run; t < 0.95; t += 0.15) {
			const [dx, dz] = [gate.x + (x - gate.x) * t, gate.z + (z - gate.z) * t];
			if (read(edgeGrid, dx, dz) < 0) return false;
		}
		// The floor's height keeps the drive under its steepest grade.
		const door = run - (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half[1];
		const most = Math.max(door, 1) * STEEPEST_DRIVE;
		const floor = Math.min(gate.y + most, Math.max(gate.y - most, (lowest + highest) / 2));
		if (Math.abs(floor - (lowest + highest) / 2) > range) return false;
		// A house wall to wall on a street stands at the street's own height.
		if (lot.garden >= 0) lot.y = Math.max(floor, 2.2);
		// A plot leaves room for a bank to any road that passes it at another height.
		for (const [u, v] of [
			[w, -back],
			[-w, -back],
			[w, front],
			[-w, front],
			[0, -back],
		] as const) {
			const [px, pz] = inWorld(lot, u, v);
			const edge = read(edgeGrid, px, pz);
			if (edge < 20 && Math.abs(read(roadHeight, px, pz) - lot.y) > edge * 1.4 + 3) return false;
		}
		if (Math.abs(lot.y - formHeight(x, z)) > MOST_OFF_FORM) return false;
		// A plot leaves room for a bank to a stair that passes it at another height.
		if (
			STAIRS.some((stair) =>
				stair.some((p) => hypot(p.x - x, p.z - z) < lot.reach + Math.abs(p.y - lot.y) / STAIR_ROOM),
			)
		)
			return false;
		for (let i = -1; i <= 1; i++)
			for (let j = -1; j <= 1; j++)
				for (const other of near.get(lookupKey(x + i * LOOKUP, z + j * LOOKUP)) ?? [])
					if (
						plotsMeet(lot, other, Math.max(gap, (Math.abs(lot.y - other.y) - PAD_STEP) / PAD_BANK))
					)
						return false;
		lots.push(lot);
		const key = lookupKey(x, z);
		const list = near.get(key);
		if (list) list.push(lot);
		else near.set(key, [lot]);
		return true;
	};
	// The town's streets and the hilltops build first, wall to wall with gaps, then the lanes.
	const ordered = [...roads].sort(
		(a, b) => Number(b.radius === STREET_RADIUS) - Number(a.radius === STREET_RADIUS),
	);
	for (const road of ordered) {
		const { points, half } = road;
		const local = half === LANE || half === SIDE_LANE;
		for (const side of [1, -1]) {
			let wait = next() * 14;
			let group = 2 + Math.floor(next() * 5);
			for (let k = 2; k + 2 < points.length; k++) {
				const a = points[k - 1] as RoadPoint;
				const b = points[k + 1] as RoadPoint;
				const p = points[k] as RoadPoint;
				wait -= hypot(b.x - a.x, b.z - a.z) / 2;
				if (wait > 0) continue;
				// A deep cut holds a retaining wall, so no drive leaves it.
				if (formHeight(p.x, p.z) - p.y > DEEP_ROAD_CUT) {
					wait = 3;
					continue;
				}
				const along = Math.atan2(b.z - a.z, b.x - a.x);
				const [nx, nz] = [-Math.sin(along) * side, Math.cos(along) * side];
				// A plot's front looks across the road, and yaw 0 faces +z.
				const yaw = Math.atan2(-nx, -nz);
				const dense =
					(road.radius === STREET_RADIUS && townShare(p.x, p.z) > 0.1) || onHilltop(p.x, p.z);
				if (dense) {
					const kind = TOWN_KINDS[Math.floor(next() * TOWN_KINDS.length)] as number;
					const house = HOUSE_KINDS[kind] as (typeof HOUSE_KINDS)[number];
					const [w, d] = house.half;
					const off = half + 2 + d;
					const [x, z] = [p.x + nx * off, p.z + nz * off];
					const lot: Lot = {
						x,
						y: p.y,
						z,
						yaw: yaw + (next() - 0.5) * (onHilltop(p.x, p.z) ? 0.5 : 0.18),
						kind,
						garden: -1,
						road,
						gate: p,
						plot: [w, d, d],
						reach: house.reach,
						tone: next(),
					};
					// Some places stay open, as yards and small gardens among the houses.
					const hilltop = onHilltop(p.x, p.z);
					const placed = place(lot, 0.05, hilltop ? 12 : 6);
					// On a hilltop a second row steps up behind the street's row, on the side toward the crest.
					if (placed && hilltop) {
						const back = off + 2 * d + ROW_ALLEY;
						const [rx, rz] = [p.x + nx * back, p.z + nz * back];
						if (formHeight(rx, rz) > formHeight(x, z) && formHeight(rx, rz) - p.y < MOST_SUNK)
							place({ ...lot, x: rx, z: rz, y: p.y + ROW_STEP }, 0.05, 12);
					}
					wait = placed ? 2 * w + 0.1 + (next() < 0.12 ? 1 + next() * 7 : 0) : 1;
					continue;
				}
				// The country's plots stand on the lanes, in groups with a gap between them. Other roads
				// take a house only now and then.
				const high = p.y > 18 && road.end !== 'loop';
				if (!local && next() > (!high ? 0.2 : p.y > UPPER_ROAD ? 0.25 : 0.72)) {
					wait = 12;
					continue;
				}
				const kinds = high ? NARROW_KINDS : COUNTRY_KINDS;
				const kind = kinds[Math.floor(next() * kinds.length)] as number;
				const house = HOUSE_KINDS[kind] as (typeof HOUSE_KINDS)[number];
				// On a steep hillside a house takes the smallest plot.
				const odds = high ? HILL_GARDENS : GARDEN_ODDS;
				const garden = odds[Math.floor(next() * odds.length)] as number;
				let plot = (GARDEN_KINDS[garden] as (typeof GARDEN_KINDS)[number]).plot;
				const tone = next();
				let placed = false;
				// The setback varies from house to house along the road.
				const first = Math.floor(next() * SETBACKS.length);
				for (let tries = 0; tries < SETBACKS.length; tries++) {
					const back = SETBACKS[(first + tries) % SETBACKS.length] as number;
					const off = half + back + plot[2];
					const [x, z] = [p.x + nx * off, p.z + nz * off];
					placed = place(
						{
							x,
							y: p.y,
							z,
							yaw: yaw + (next() - 0.5) * 0.4,
							kind,
							garden,
							road,
							gate: p,
							plot,
							reach: house.reach,
							tone,
						},
						0.8,
						PLOT_RANGE,
					);
					if (placed) break;
				}
				// A plot too large for its ground gives way to the smallest plot.
				if (!placed && high && garden !== 4) {
					const small = (GARDEN_KINDS[4] as (typeof GARDEN_KINDS)[number]).plot;
					const off = half + (SETBACKS[first] as number) + small[2];
					const [x, z] = [p.x + nx * off, p.z + nz * off];
					placed = place(
						{
							x,
							y: p.y,
							z,
							yaw: yaw + (next() - 0.5) * 0.4,
							kind,
							garden: 4,
							road,
							gate: p,
							plot: small,
							reach: house.reach,
							tone,
						},
						0.8,
						PLOT_RANGE,
					);
					if (placed) plot = small;
				}
				if (!placed) {
					wait = 3;
					continue;
				}
				group -= 1;
				wait = plot[0] * 2 + 0.4 + next() * 2.2;
				if (group <= 0) {
					group = 2 + Math.floor(next() * 5);
					wait += 2 + next() * 11;
				}
			}
		}
	}
	return lots;
}

/** Whether a road may be left out: a local road that nothing else joins. */
function joinedByOthers(road: Road, roads: readonly Road[]): boolean {
	return roads.some((other) => {
		if (other === road || other.end === 'loop') return false;
		const ends = [other.points[0] as RoadPoint];
		if (other.end === 'junction') ends.push(other.points[other.points.length - 1] as RoadPoint);
		return ends.some((end) => road.points.some((p) => hypot(p.x - end.x, p.z - end.z) < 1));
	});
}

/** Whether either joining end of a road no longer lies on any other road. */
function endsOnNothing(road: Road, roads: readonly Road[]): boolean {
	const ends = [road.points[0] as RoadPoint];
	if (road.end === 'junction') ends.push(road.points[road.points.length - 1] as RoadPoint);
	return ends.some(
		(end) =>
			!roads.some(
				(other) => other !== road && other.points.some((p) => hypot(p.x - end.x, p.z - end.z) < 3),
			),
	);
}

/** The setbacks of a country house from its road, in meters. */
const SETBACKS = [3.5, 4.5, 6, 8, 11];

/** How far a drive's strip may lie under its ground or over it, in meters, a little inside what the viewer would notice. */
const DRIVE_BURIED = 0.25;
const DRIVE_RAISED = 0.9;
/** The roads left, and the plots on them: the local roads with too few houses go, and the land is cut. */
export const NETWORK = (() => {
	let roads = [...ALL_ROADS];
	const dropped = new Set<string>();
	rasterAll(roads);
	let lots = layLots(roads, dropped);
	// A local road that crosses another away from its ends goes first.
	const cuts = (a: RoadPoint, b: RoadPoint, c: RoadPoint, d: RoadPoint) => {
		const side = (p: RoadPoint, q: RoadPoint, t: RoadPoint) =>
			(q.x - p.x) * (t.z - p.z) - (q.z - p.z) * (t.x - p.x);
		return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
	};
	roads = roads.filter((road) => {
		if (road.half > LANE || road.radius >= THROUGH_RADIUS) return true;
		const { points } = road;
		for (const other of roads) {
			if (other === road) continue;
			for (let i = 3; i + 1 < points.length; i++)
				for (let j = 0; j + 1 < other.points.length; j++) {
					const [a, c] = [points[i] as RoadPoint, other.points[j] as RoadPoint];
					if (Math.abs(a.x - c.x) + Math.abs(a.z - c.z) > 14) continue;
					if (cuts(a, points[i + 1] as RoadPoint, c, other.points[j + 1] as RoadPoint))
						return false;
				}
		}
		return true;
	});
	// A grown lane that strays out to sea, or that cuts deep into the land, goes too.
	roads = roads.filter((road) => {
		if (road.radius !== LOCAL_RADIUS) return true;
		let deep = 0;
		for (const p of road.points) {
			if (inland(p.x, p.z) < 3) return false;
			if (formHeight(p.x, p.z) - p.y > DEEP_LANE_CUT) deep += 3;
		}
		return deep < 12;
	});
	// A local road that runs close beside another, the same way, away from their junctions, goes too.
	roads = roads.filter((road) => {
		if (road.radius !== LOCAL_RADIUS) return true;
		let beside = 0;
		for (let i = 8; i + 8 < road.points.length; i++) {
			const [p, q] = [road.points[i] as RoadPoint, road.points[i + 1] as RoadPoint];
			const along = roads.some(
				(other) =>
					other !== road &&
					other.points.some((a, k) => {
						const b = other.points[k + 1];
						if (!b || hypot(a.x - p.x, a.z - p.z) >= TWIN_GAP - 1) return false;
						const dot = (q.x - p.x) * (b.x - a.x) + (q.z - p.z) * (b.z - a.z);
						return (
							Math.abs(dot) / (hypot(q.x - p.x, q.z - p.z) * hypot(b.x - a.x, b.z - a.z) || 1) >
							0.87
						);
					}),
			);
			beside = along ? beside + 1 : 0;
			if (beside >= 6) return false;
		}
		return true;
	});
	rasterAll(roads);
	lots = layLots(roads, dropped);
	// A local road that serves too few houses goes, and the plots are laid again without it.
	for (let round = 0; round < 12; round++) {
		const count = new Map<Road, number>();
		for (const lot of lots) count.set(lot.road, (count.get(lot.road) ?? 0) + 1);
		const useless = roads.filter(
			(road) =>
				(road.half === LANE || road.half === SIDE_LANE) &&
				road.end !== 'loop' &&
				(endsOnNothing(road, roads) ||
					((count.get(road) ?? 0) < FEWEST_ON_LANE && !joinedByOthers(road, roads))),
		);
		if (useless.length === 0) break;
		roads = roads.filter((road) => !useless.includes(road));
		rasterAll(roads);
		lots = layLots(roads, dropped);
	}
	// Plots that the cut land leaves off their ground go too, and the land is cut again.
	for (let round = 0; round < 6; round++) {
		bake(lots, STAIRS);
		const off = lots.filter((lot) => {
			const [hw, hd] = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half;
			return [
				[hw, hd],
				[-hw, hd],
				[hw, -hd],
				[-hw, -hd],
			].some(([u, v]) => {
				const [x, z] = inWorld(lot, u as number, v as number);
				return Math.abs(read(currentGround(), x, z) - lot.y) > MOST_OFF_GROUND;
			});
		});
		if (off.length === 0) break;
		// A house first settles to the ground that it stands on, within its drive's grade.
		if (round < 4) {
			for (const lot of off) {
				const house = HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number];
				const door = hypot(lot.x - lot.gate.x, lot.z - lot.gate.z) - house.half[1];
				const most = Math.max(door, 1) * STEEPEST_DRIVE;
				const y = read(currentGround(), lot.x, lot.z);
				lot.y = Math.min(lot.gate.y + most, Math.max(lot.gate.y - most, y));
			}
			continue;
		}
		const gone = new Set(off);
		lots = lots.filter((lot) => !gone.has(lot));
	}
	// A plot whose pad stands in a tall face against its neighbour goes, and the land is cut again.
	for (let round = 0; round < 2; round++) {
		const faces = padFaces(lots);
		if (faces.size === 0) break;
		lots = lots.filter((lot) => !faces.has(lot));
		bake(lots, STAIRS);
	}
	// A drive that the land's last changes left off its ground goes with its plot.
	lots = lots.filter((lot) => {
		if (lot.garden < 0) return true;
		const hd = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half[1];
		const [fx, fz] = [lot.x + Math.sin(lot.yaw) * hd, lot.z + Math.cos(lot.yaw) * hd];
		for (let t = 0.2; t < 1; t += 0.2) {
			const [x, z] = [lot.gate.x + (fx - lot.gate.x) * t, lot.gate.z + (fz - lot.gate.z) * t];
			const off = lot.gate.y + (lot.y - lot.gate.y) * t - read(currentGround(), x, z);
			if (off < -DRIVE_BURIED || off > DRIVE_RAISED) return false;
		}
		return true;
	});
	// A floor that settling left too far off the land's form goes.
	lots = lots.filter((lot) => Math.abs(lot.y - formHeight(lot.x, lot.z)) <= MOST_OFF_FORM);
	// A country house with no neighbour close by goes.
	lots = lots.filter((lot) =>
		lots.some((other) => other !== lot && hypot(other.x - lot.x, other.z - lot.z) < NEIGHBOUR),
	);
	// The lanes that the plots' own settling left with too few houses go last, with what stood on them.
	for (let round = 0; round < 6; round++) {
		const left = new Map<Road, number>();
		for (const lot of lots) left.set(lot.road, (left.get(lot.road) ?? 0) + 1);
		const idle = roads.filter(
			(road) =>
				(road.half === LANE || road.half === SIDE_LANE) &&
				road.end !== 'loop' &&
				(endsOnNothing(road, roads) ||
					((left.get(road) ?? 0) < FEWEST_ON_LANE && !joinedByOthers(road, roads))),
		);
		if (idle.length === 0) break;
		roads = roads.filter((road) => !idle.includes(road));
		lots = lots.filter((lot) => !idle.includes(lot.road));
	}
	rasterAll(roads);
	// A plot that settling left over its drive's steepest grade goes.
	lots = lots.filter((lot) => {
		const run = hypot(lot.x - lot.gate.x, lot.z - lot.gate.z);
		const door = run - (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half[1];
		return Math.abs(lot.y - lot.gate.y) / Math.max(door, 1) <= STEEPEST_DRIVE * 1.001;
	});
	// No house's corner stands on a road that a bend brought close.
	lots = lots.filter((lot) => {
		const [hw, hd] = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half;
		return [
			[hw, hd],
			[-hw, hd],
			[hw, -hd],
			[-hw, -hd],
		].every(([u, v]) => {
			const [x, z] = inWorld(lot, u as number, v as number);
			return read(edgeGrid, x, z) > 0.2;
		});
	});
	// A country house with no neighbour close by goes.
	lots = lots.filter((lot) =>
		lots.some((other) => other !== lot && hypot(other.x - lot.x, other.z - lot.z) < NEIGHBOUR),
	);
	// A lane that those last steps left with too few houses goes, with what stood on it.
	const left = new Map<Road, number>();
	for (const lot of lots) left.set(lot.road, (left.get(lot.road) ?? 0) + 1);
	const idle = roads.filter(
		(road) =>
			(road.half === LANE || road.half === SIDE_LANE) &&
			road.end !== 'loop' &&
			(left.get(road) ?? 0) < FEWEST_ON_LANE &&
			!joinedByOthers(road, roads),
	);
	roads = roads.filter((road) => !idle.includes(road));
	lots = lots.filter((lot) => !idle.includes(lot.road));
	rasterAll(roads);
	bake(lots, STAIRS);
	return { roads, lots };
})();
