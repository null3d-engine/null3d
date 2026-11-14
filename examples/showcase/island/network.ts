// The island's road network, built level by level as real networks are. The coast road rings the
// island above its cliffs. One main road climbs from the quay, past the square and the church, across
// the coast road and up the dry valley, then wraps the highest hill at a steady grade up to its
// village. A collector leaves it for each of the other hilltops. Local lanes leave these roads square
// and hold a level along the contours, so houses stand in rows along the slope. The town's lanes fan
// out from the quay, narrowing uphill.
//
// A road is driven, not searched: it moves in short steps with a heading, and each step may turn by a
// limited angle, so no road can turn tighter than its radius and a hairpin cannot exist. Its height
// changes by at most the steepest grade per step, and it steers so that the ground keeps to that
// height. Each step is tested against every other road. A road meets another only square, on that
// road's middle line, and never after running beside it. A road that finds no way on ends in a turning
// circle, or is left out when it has too little length to serve anyone.
import {
	beachShare,
	GROUND,
	golfShare,
	hypot,
	inland,
	naturalHeight,
	northOfRidge,
	SUMMITS,
	townShare,
	VILLAGES,
} from './island';
import {
	ACCESS_RUN,
	CLIMB,
	COLLECTOR,
	LANE,
	LOCAL_RADIUS,
	MAIN,
	MAX_GRADE,
	PARKS,
	type Point,
	QUAY_RADIUS,
	type Road,
	type RoadEnd,
	type RoadPoint,
	SIDE_LANE,
	SPINE,
	STEEPEST_ACCESS,
	STREET,
	STREET_RADIUS,
	THROUGH_RADIUS,
	TOWN_CORE,
	TWIN_GAP,
	tightest,
} from './routes';

/** The most that a local road's height may leave the ground, in meters. */
const MOST_CUT = 5.5;
/** The most that a lane's first stretch may stand above the land's form, on its shelf's fill, in meters. */
const LANE_BENCH = 15;
/** The most that a lane's first meters may lie below the land's form, leaving its parent uphill, in meters. */
const LANE_CUT = 8.5;
/** The slope of the bank left between a local road and any other, and the plan width of the lanes' shelves. */
const LANE_BANK = 1.4;
const LANE_ROOM = 20;
const ROAD_ROOM = 16;
/** The meters along the coast road between two lanes of the flat ground. */
const APRON_GAP = 80;
/** The longest side lane, in meters: it serves four to ten houses. */
const SIDE_MOST = 120;
/** How far from its parent a lane turns along the contour, in meters. */
const LANE_TURN = 12;
/** The meters along a road between two lanes that fork from it on one side. */
const FORK_GAP = 95;
/** The longest lane, in meters: a lane serves a cluster or two, and stops. */
const LANE_MOST = 240;
/** How far a lane's leaving leans from square to its parent, in radians. */
const LANE_LEAN = 0.35;

/** The length of a driving step, and the meters between two points of a finished road. */
const STEP = 4;
const ROAD_STEP = 3;

/** The grid of the surveyed ground: its cell, its side, and its height and slope at each cell. */
const SURVEY = 8;
const SIDE = Math.ceil(GROUND / SURVEY) + 1;

/** A box blur of a square grid over a radius in cells, in three passes along each axis. */
function blurred(grid: Float32Array, radius: number): Float32Array {
	let from = grid;
	const span = radius * 2 + 1;
	for (let pass = 0; pass < 3; pass++) {
		const across = new Float32Array(SIDE * SIDE);
		for (let j = 0; j < SIDE; j++) {
			const row = j * SIDE;
			let sum = 0;
			for (let i = -radius; i <= radius; i++) sum += from[row + Math.max(0, i)] as number;
			for (let i = 0; i < SIDE; i++) {
				across[row + i] = sum / span;
				sum +=
					(from[row + Math.min(SIDE - 1, i + radius + 1)] as number) -
					(from[row + Math.max(0, i - radius)] as number);
			}
		}
		const down = new Float32Array(SIDE * SIDE);
		for (let i = 0; i < SIDE; i++) {
			let sum = 0;
			for (let j = -radius; j <= radius; j++) sum += across[Math.max(0, j) * SIDE + i] as number;
			for (let j = 0; j < SIDE; j++) {
				down[j * SIDE + i] = sum / span;
				sum +=
					(across[Math.min(SIDE - 1, j + radius + 1) * SIDE + i] as number) -
					(across[Math.max(0, j - radius) * SIDE + i] as number);
			}
		}
		from = down;
	}
	return from;
}

/** The ground's height, and its height with the small shapes smoothed for lanes and for through roads. */
const level = new Float32Array(SIDE * SIDE);
for (let j = 0; j < SIDE; j++)
	for (let i = 0; i < SIDE; i++)
		level[j * SIDE + i] = Math.max(
			naturalHeight(i * SURVEY - GROUND / 2, j * SURVEY - GROUND / 2),
			1.5,
		);
const laneLevel = blurred(level, 1);
const roadLevel = blurred(level, 3);

/** A surveyed grid's value at a point, between its nearest cells. */
function survey(grid: Float32Array, x: number, z: number): number {
	const u = Math.min(SIDE - 1.001, Math.max(0, (x + GROUND / 2) / SURVEY));
	const v = Math.min(SIDE - 1.001, Math.max(0, (z + GROUND / 2) / SURVEY));
	const [i, j] = [Math.floor(u), Math.floor(v)];
	const [s, t] = [u - i, v - j];
	const at = j * SIDE + i;
	const top = (grid[at] as number) * (1 - s) + (grid[at + 1] as number) * s;
	const bottom = (grid[at + SIDE] as number) * (1 - s) + (grid[at + SIDE + 1] as number) * s;
	return top * (1 - t) + bottom * t;
}

/** A surveyed grid's slope at a point, as its rise along x and along z. */
function fall(grid: Float32Array, x: number, z: number): [number, number] {
	return [
		(survey(grid, x + SURVEY, z) - survey(grid, x - SURVEY, z)) / (2 * SURVEY),
		(survey(grid, x, z + SURVEY) - survey(grid, x, z - SURVEY)) / (2 * SURVEY),
	];
}

/** The shortest turn from one heading to another, in radians. */
function turnTo(from: number, to: number): number {
	const t = (to - from) % (Math.PI * 2);
	return t > Math.PI ? t - Math.PI * 2 : t < -Math.PI ? t + Math.PI * 2 : t;
}

/** The finished roads, and the lookup that finds their points near a place. */
const roads: Road[] = [];
const HASH = 24;
const hash = new Map<number, [number, number][]>();
const hashKey = (x: number, z: number) =>
	(Math.floor(x / HASH) + 256) * 512 + (Math.floor(z / HASH) + 256);

/** Calls `visit` with each road point within a reach of a place. */
function eachNear(
	x: number,
	z: number,
	reach: number,
	visit: (road: number, at: number, d: number) => void,
): void {
	const span = Math.ceil(reach / HASH);
	const [cx, cz] = [Math.floor(x / HASH) + 256, Math.floor(z / HASH) + 256];
	for (let i = -span; i <= span; i++)
		for (let j = -span; j <= span; j++) {
			const list = hash.get((cx + i) * 512 + cz + j);
			if (!list) continue;
			for (const [road, at] of list) {
				const p = (roads[road] as Road).points[at] as RoadPoint;
				const d = hypot(p.x - x, p.z - z);
				if (d <= reach) visit(road, at, d);
			}
		}
}

/** The distance from a place to the nearest road, leaving one road out, past the reach if none. */
function clearance(x: number, z: number, reach: number, skip: number): number {
	let best = reach + 1;
	eachNear(x, z, reach, (road, _at, d) => {
		if (road !== skip && d < best) best = d;
	});
	return best;
}

/** Which side of a line a point lies on. */
const sideOf = (ax: number, az: number, bx: number, bz: number, px: number, pz: number) =>
	(bx - ax) * (pz - az) - (bz - az) * (px - ax);

/** The road that a stretch crosses, or -1. A parent's first meters, and the road it ends on, don't count. */
function crossed(
	a: { x: number; z: number },
	b: { x: number; z: number },
	parent: number,
	parentAt: number,
	target = -1,
): number {
	let found = -1;
	const reach = hypot(b.x - a.x, b.z - a.z) / 2 + ROAD_STEP + 2;
	eachNear((a.x + b.x) / 2, (a.z + b.z) / 2, reach, (road, at) => {
		if (road === target) return;
		if (road === parent && Math.abs(at - parentAt) < 5) return;
		const { points } = roads[road] as Road;
		const p = points[at] as RoadPoint;
		const q = points[at + 1];
		if (!q) return;
		const hit =
			sideOf(a.x, a.z, b.x, b.z, p.x, p.z) * sideOf(a.x, a.z, b.x, b.z, q.x, q.z) <= 0 &&
			sideOf(p.x, p.z, q.x, q.z, a.x, a.z) * sideOf(p.x, p.z, q.x, q.z, b.x, b.z) <= 0;
		if (hit) found = road;
	});
	return found;
}

/** A line at even steps along it. */
function resample(line: readonly RoadPoint[]): RoadPoint[] {
	const out: RoadPoint[] = [{ ...(line[0] as RoadPoint) }];
	let left = ROAD_STEP;
	for (let k = 0; k + 1 < line.length; k++) {
		const a = line[k] as RoadPoint;
		const b = line[k + 1] as RoadPoint;
		const span = hypot(b.x - a.x, b.z - a.z);
		let at = left;
		while (at <= span) {
			const t = at / span;
			out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
			at += ROAD_STEP;
		}
		left = at - span;
	}
	const end = line[line.length - 1] as RoadPoint;
	const last = out[out.length - 1] as RoadPoint;
	if (hypot(end.x - last.x, end.z - last.z) < ROAD_STEP * 0.5) out.pop();
	out.push({ ...end });
	return out;
}

/** Relaxes a line toward its neighbours, so it bends in wide curves. Its first and last points stay. */
function relax(line: RoadPoint[], passes: number): void {
	for (let pass = 0; pass < passes; pass++) {
		let [px, pz] = [line[0]?.x ?? 0, line[0]?.z ?? 0];
		for (let k = 1; k + 1 < line.length; k++) {
			const p = line[k] as RoadPoint;
			const n = line[k + 1] as RoadPoint;
			const [x, z] = [p.x, p.z];
			p.x += ((px + n.x) / 2 - x) * 0.5;
			p.z += ((pz + n.z) / 2 - z) * 0.5;
			[px, pz] = [x, z];
		}
	}
}

/** Brings a line's heights under the grade and smooths them, with its ends held. */
function ease(line: RoadPoint[], steepest = MAX_GRADE * 0.96): void {
	for (let pass = 0; pass < 4; pass++) {
		let before = (line[0] as RoadPoint).y;
		for (let k = 1; k + 1 < line.length; k++) {
			const p = line[k] as RoadPoint;
			const y = p.y;
			p.y += ((before + (line[k + 1] as RoadPoint).y) / 2 - y) * 0.5;
			before = y;
		}
	}
	const limit = (k: number, from: number) => {
		const p = line[k] as RoadPoint;
		const q = line[from] as RoadPoint;
		const most = hypot(p.x - q.x, p.z - q.z) * steepest;
		p.y = Math.min(q.y + most, Math.max(q.y - most, p.y));
	};
	for (let pass = 0; pass < 8; pass++) {
		for (let k = 1; k + 1 < line.length; k++) limit(k, k - 1);
		for (let k = line.length - 2; k > 0; k--) limit(k, k + 1);
	}
	for (let k = 1; k + 1 < line.length; k++) limit(k, k - 1);
}

/** Adds a finished line to the network and its lookup. */
function register(points: RoadPoint[], half: number, end: RoadEnd, radius: number): Road {
	// A turning circle lies level with the road's last stretch.
	if (end === 'circle' && points.length > 8) {
		const y = (points[points.length - 4] as RoadPoint).y;
		for (let k = points.length - 3; k < points.length; k++) (points[k] as RoadPoint).y = y;
	}
	const road: Road = { points, half, end, radius };
	const index = roads.length;
	roads.push(road);
	points.forEach((p, at) => {
		const key = hashKey(p.x, p.z);
		const list = hash.get(key);
		if (list) list.push([index, at]);
		else hash.set(key, [[index, at]]);
	});
	return road;
}

/** Finishes a driven line and adds it to the network, with its curves rounded and its heights eased. */
function commit(line: RoadPoint[], half: number, end: RoadEnd, radius: number): Road {
	const points = resample(line);
	relax(points, radius >= THROUGH_RADIUS ? 40 : 16);
	ease(points);
	return register(points, half, end, radius);
}

/** The state of a road as it is driven. */
interface Wheel {
	x: number;
	y: number;
	z: number;
	heading: number;
	/** The meters driven so far. */
	run: number;
}

/** What a driven road needs: where it wants to head, its limits and where it must stop. */
interface Drive {
	radius: number;
	/** The most meters to drive. */
	most: number;
	/** The heading that the road wants at its present place, or undefined when it has arrived. */
	aim: (wheel: Wheel) => number | undefined;
	/** Whether the road may stand at a place. */
	free: (x: number, z: number, wheel: Wheel) => boolean;
	/** The ground that the road follows, and a height that it holds, when it holds one. */
	ground: Float32Array;
	hold?: (wheel: Wheel) => number | undefined;
	/** The road that this one leaves from, and the place on it. */
	parent: number;
	parentAt: number;
	/** The meters driven before the road may join another road. */
	settle: number;
	/** The most that the height may leave the ground before the road stops, in meters. */
	cut: number;
	/** The most that the road may turn in one sense, in radians. */
	wind: number;
	/** The steepest that the road may run, if not the through roads' limit. */
	grade?: number;
	/** The meters over which the road may stand on its shelf's fill, away from the land's form. */
	bench?: number;
	/** Whether the road may join others. */
	joins: boolean;
}

/** The meters of a line's last stretch that lie beside a road, away from their junction. */
function besideTarget(line: readonly RoadPoint[], target: number, end: RoadPoint): number {
	let meters = 0;
	for (let k = line.length - 1, walked = 0; k > 0 && walked < 60; k--) {
		const p = line[k] as RoadPoint;
		const q = line[k - 1] as RoadPoint;
		const span = hypot(p.x - q.x, p.z - q.z);
		walked += span;
		if (hypot(p.x - end.x, p.z - end.z) < TWIN_GAP * 1.2) continue;
		let near = false;
		eachNear(p.x, p.z, TWIN_GAP + 3, (road) => {
			if (road === target) near = true;
		});
		if (near) meters += span;
	}
	return meters;
}

/** A curve from a place and heading to a point on a road, arriving square to it. */
function arrive(
	wheel: Wheel,
	line: readonly RoadPoint[],
	target: number,
	at: number,
	radius: number,
	plan: Drive,
): RoadPoint[] | undefined {
	const points = (roads[target] as Road).points;
	if (points.length < 3) return undefined;
	const k = Math.min(points.length - 2, Math.max(1, at));
	const p = points[k] as RoadPoint;
	const a = points[k - 1] as RoadPoint;
	const b = points[k + 1] as RoadPoint;
	const length = hypot(b.x - a.x, b.z - a.z) || 1;
	const [tx, tz] = [(b.x - a.x) / length, (b.z - a.z) / length];
	const [sx, sz] = [wheel.x - p.x, wheel.z - p.z];
	const side = -tz * sx + tx * sz >= 0 ? 1 : -1;
	const [nx, nz] = [-tz * side, tx * side];
	const span = hypot(sx, sz);
	// The road must come from in front of the point it joins.
	if ((sx * nx + sz * nz) / (span || 1) < 0.5) return undefined;
	const pull = span * 0.42;
	const c1 = [
		wheel.x + Math.cos(wheel.heading) * pull,
		wheel.z + Math.sin(wheel.heading) * pull,
	] as const;
	const c2 = [p.x + nx * pull, p.z + nz * pull] as const;
	const steps = Math.max(5, Math.ceil(span / ROAD_STEP));
	const curve: RoadPoint[] = [];
	for (let s = 1; s <= steps; s++) {
		const t = s / steps;
		const u = 1 - t;
		const [w0, w1, w2, w3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
		curve.push({
			x: w0 * wheel.x + w1 * c1[0] + w2 * c2[0] + w3 * p.x,
			y: wheel.y + (p.y - wheel.y) * t,
			z: w0 * wheel.z + w1 * c1[1] + w2 * c2[1] + w3 * p.z,
		});
	}
	if (tightest([{ x: wheel.x, z: wheel.z }, ...curve], 2) < radius) return undefined;
	let before: { x: number; z: number } = wheel;
	for (const [k, point] of curve.entries()) {
		// Only the curve's last stretch may touch the road it ends on.
		const ends = k >= curve.length - 2 ? target : -1;
		if (crossed(before, point, plan.parent, plan.parentAt, ends) >= 0) return undefined;
		before = point;
	}
	const run = curve.length * ROAD_STEP;
	if (Math.abs(p.y - wheel.y) > run * MAX_GRADE * 0.9) return undefined;
	if (besideTarget([...line, ...curve], target, p) > 15) return undefined;
	return curve;
}

/** Drives a road until it arrives, joins another road or must stop. */
function drive(
	start: Wheel,
	plan: Drive,
): { line: RoadPoint[]; end: 'arrived' | 'joined' | 'stopped' } {
	const wheel = { ...start };
	const line: RoadPoint[] = [{ x: wheel.x, y: wheel.y, z: wheel.z }];
	const turnLimit = STEP / (plan.radius * 1.1);
	let rate = 0;
	let turned = 0;
	const grade = plan.grade ?? MAX_GRADE * 0.9;
	while (wheel.run < plan.most) {
		const aim = plan.aim(wheel);
		if (aim === undefined) return { line, end: 'arrived' };
		// The turn eases in and out, so that a curve grows and fades without a kink.
		const wanted = Math.max(-turnLimit, Math.min(turnLimit, turnTo(wheel.heading, aim)));
		rate += (wanted - rate) * 0.6;
		wheel.heading += rate;
		turned += rate;
		if (Math.abs(turned) > plan.wind) return { line, end: 'stopped' };
		const [fromX, fromZ] = [wheel.x, wheel.z];
		wheel.x += Math.cos(wheel.heading) * STEP;
		wheel.z += Math.sin(wheel.heading) * STEP;
		wheel.run += STEP;
		const ground = survey(plan.ground, wheel.x, wheel.z);
		const held = plan.hold?.(wheel) ?? ground;
		wheel.y += Math.max(-grade * STEP, Math.min(grade * STEP, held - wheel.y));
		if (
			!plan.free(wheel.x, wheel.z, wheel) ||
			(survey(level, wheel.x, wheel.z) > wheel.y
				? survey(level, wheel.x, wheel.z) - wheel.y >
					(wheel.run < 40 && plan.bench ? LANE_CUT : plan.cut)
				: wheel.y - survey(level, wheel.x, wheel.z) >
					(wheel.run < (plan.bench ?? 0) ? LANE_BENCH : plan.cut))
		)
			return { line, end: 'stopped' };
		// A road that would pass through another stops well back from it.
		if (crossed({ x: fromX, z: fromZ }, wheel, plan.parent, plan.parentAt) >= 0) {
			line.length = Math.max(1, line.length - 5);
			return { line, end: 'stopped' };
		}
		line.push({ x: wheel.x, y: wheel.y, z: wheel.z });
		if (wheel.run < plan.settle) continue;
		// Another road ahead: the nearest curve that reaches it square and wide enough ends this road.
		let joined: RoadPoint[] | undefined;
		let closest = Number.POSITIVE_INFINITY;
		eachNear(wheel.x, wheel.z, 62, (index, at, d) => {
			if (index === plan.parent && Math.abs(at - plan.parentAt) * ROAD_STEP < 60) return;
			const p = (roads[index] as Road).points[at] as RoadPoint;
			const ahead =
				((p.x - wheel.x) * Math.cos(wheel.heading) + (p.z - wheel.z) * Math.sin(wheel.heading)) /
				(d || 1);
			if (d < closest && ahead > -0.2) closest = d;
			if (!plan.joins || ahead < 0.55 || d < 16 || at % 2 !== 0) return;
			const curve = arrive(wheel, line, index, at, plan.radius, plan);
			if (curve && (!joined || curve.length < joined.length)) joined = curve;
		});
		if (joined) {
			line.push(...joined);
			return { line, end: 'joined' };
		}
		// Too close to a road that it cannot join: the road stops, well back from it.
		if (plan.joins && closest < TWIN_GAP) {
			line.length = Math.max(1, line.length - 6);
			return { line, end: 'stopped' };
		}
	}
	return { line, end: 'stopped' };
}

/** The steepest that a village street runs, so that its houses sit square to it. */
const VILLAGE_STREET_GRADE = 0.065;
/** How many runs along a road's normal a link road's last knot stands off it. */
const LINK_SQUARE = 5;
/** The run along a road's normal by which a street meets it, in meters. */
const SQUARE_RUN = 14;
/** The radius of the arc by which a village street turns from its first run, in meters. */
const ARM_ARC = 24;
/** The nearest that the first place a village street's arc aims at may lie, in meters. */
const ARM_AIM = 36;
/** The points of the straight run by which a village street leaves its road. */
const ARM_RUN = 7;

/** A smooth line through places, as a list of points at their surveyed height. */
function spline(knots: readonly Point[], closed: boolean, ground: Float32Array): RoadPoint[] {
	const count = knots.length;
	const at = (k: number): Point =>
		knots[closed ? (k + count) % count : Math.max(0, Math.min(count - 1, k))] as Point;
	const line: RoadPoint[] = [];
	for (let k = 0; k < (closed ? count : count - 1); k++) {
		const [ax, az] = at(k - 1);
		const [bx, bz] = at(k);
		const [cx, cz] = at(k + 1);
		const [dx, dz] = at(k + 2);
		const steps = Math.max(2, Math.ceil(hypot(cx - bx, cz - bz) / ROAD_STEP));
		for (let s = 0; s < steps; s++) {
			const t = s / steps;
			const [t2, t3] = [t * t, t * t * t];
			const x =
				0.5 *
				(2 * bx +
					(cx - ax) * t +
					(2 * ax - 5 * bx + 4 * cx - dx) * t2 +
					(3 * bx - ax - 3 * cx + dx) * t3);
			const z =
				0.5 *
				(2 * bz +
					(cz - az) * t +
					(2 * az - 5 * bz + 4 * cz - dz) * t2 +
					(3 * bz - az - 3 * cz + dz) * t3);
			line.push({ x, y: survey(ground, x, z), z });
		}
	}
	const [ex, ez] = closed ? (knots[0] as Point) : (knots[count - 1] as Point);
	line.push({ x: ex, y: survey(ground, ex, ez), z: ez });
	return line;
}

/** A street through places, at the ground's height, whose ends lie on any road close by. */
function street(
	places: readonly Point[],
	half = STREET,
	end: RoadEnd = 'junction',
	widest = 0,
	square = SQUARE_RUN,
): Road {
	const first = snapped(places[0] as Point);
	const last = end === 'junction' ? snapped(places[places.length - 1] as Point) : undefined;
	const knots: Point[] = [...places];
	knots[0] = [first?.x ?? (places[0] as Point)[0], first?.z ?? (places[0] as Point)[1]];
	if (last) knots[knots.length - 1] = [last.x, last.z];
	// A street meets a road square to it, by a short run along that road's normal.
	if (last)
		knots.splice(knots.length - 1, 0, squareTo(last, knots[knots.length - 2] as Point, square));
	if (first && square > 0) knots.splice(1, 0, squareTo(first, knots[1] as Point, square));
	const points = resample(spline(knots, false, laneLevel));
	if (first)
		for (let k = 0; k < (end === 'circle' ? 4 : 1); k++) (points[k] as RoadPoint).y = first.y;
	if (last) (points[points.length - 1] as RoadPoint).y = last.y;
	const [fx, fz] = [(points[0] as RoadPoint).x, (points[0] as RoadPoint).z];
	relax(points.slice(2, Math.max(3, points.length - 2)), 12);
	fair(points, Math.max(widest, STREET_RADIUS) * 1.12, 1);
	(points[0] as RoadPoint).x = fx;
	(points[0] as RoadPoint).z = fz;
	const steepest = end === 'circle' ? VILLAGE_STREET_GRADE : MAX_GRADE * 0.96;
	ease(points, steepest);
	// A street leaves its parent on the level, across the parent's width.
	if (first && end === 'circle') {
		for (let k = 0; k < 4; k++) (points[k] as RoadPoint).y = first.y;
		for (let k = 4; k < points.length; k++) {
			const [p, q] = [points[k] as RoadPoint, points[k - 1] as RoadPoint];
			const most = hypot(p.x - q.x, p.z - q.z) * steepest;
			p.y = Math.min(q.y + most, Math.max(q.y - most, p.y));
		}
	}
	return register(points, half, end, STREET_RADIUS);
}

/** A point a little way out from a road's point, on the road's normal, on the side toward a place. */
function squareTo(end: RoadPoint, toward: Point, run = SQUARE_RUN): Point {
	let tangent = 0;
	let owner = Number.POSITIVE_INFINITY;
	eachNear(end.x, end.z, 1, (road, at) => {
		// Of the roads that meet here, the street meets the oldest.
		if (road >= owner) return;
		owner = road;
		const { points } = roads[road] as Road;
		const a = points[Math.max(0, at - 1)] as RoadPoint;
		const b = points[Math.min(points.length - 1, at + 1)] as RoadPoint;
		tangent = Math.atan2(b.z - a.z, b.x - a.x);
	});
	const [nx, nz] = [-Math.sin(tangent), Math.cos(tangent)];
	const side = (toward[0] - end.x) * nx + (toward[1] - end.z) * nz >= 0 ? 1 : -1;
	return [end.x + nx * side * run, end.z + nz * side * run];
}

/** The middle line of a road close to a street's end, where the street joins that road. */
function snapped([x, z]: Point): RoadPoint | undefined {
	let least = 16;
	let found: RoadPoint | undefined;
	eachNear(x, z, 16, (road, at, d) => {
		if (d < least) {
			least = d;
			found = (roads[road] as Road).points[at] as RoadPoint;
		}
	});
	return found;
}

/**
 * The town's lanes: a fan from the quay that narrows uphill to the coast road, and short cross lanes
 * between its ribs, spaced wider uphill. The two streets that hold the church and the square are ribs.
 */
function townStreets(): void {
	const west = TOWN_CORE[0];
	// One long street comes down from the coast road, runs along the quay around the harbour's head, and
	// climbs back to the coast road on the far side.
	street(
		[
			onCoast(-318, 105),
			[-322, 180],
			[-300, 262],
			[-262, 322],
			[-220, 306],
			[-155, 280],
			[-85, 275],
			[-16, 289],
			[30, 312],
			[80, 322],
			[116, 275],
			[126, 200],
			[118, 130],
			onCoast(112, 82),
		],
		STREET + 0.5,
		'junction',
		QUAY_RADIUS,
	);
	// The main road starts here: from the quay past the square and the church to the coast road.
	street([[-56, 276], [-52, 235], [-56, 195], [-64, 145], [-60, 105], onCoast(-62, 64)], SPINE);
	street([[-190, 285], [-212, 240], [-186, 190], [-150, 140], onCoast(-122, 86)]);
	street([[-240, 305], [-262, 255], [-232, 200], [-226, 150], onCoast(-208, 90)]);
	street([[6, 292], [22, 240], [-8, 190], [-14, 140], onCoast(-2, 82)]);
	street([[44, 318], [82, 262], [52, 200], [58, 140], onCoast(52, 85)]);
	street([
		[-155, 146],
		[-125, 152],
		[-96, 138],
		[-58, 134],
	]);
	street([
		[west, 272],
		[west - 6, 230],
		[west + 5, 190],
		[west - 1, 146],
	]);
	// Two short streets climb past the top road, so that the town does not stop at it.
	street([onCoast(-190, 100), [-204, 82], [-194, 62]], STREET, 'circle');
	street([onCoast(46, 100), [60, 86], [54, 70]], STREET, 'circle');
	// The cross lanes, each square to its ribs, with a bend along the way.
	street([
		[-262, 252],
		[-236, 246],
		[-211, 238],
	]);
	street([
		[west - 5, 246],
		[-168, 254],
		[-201, 262],
	]);
	street([
		[-56, 172],
		[-32, 178],
		[-10, 172],
	]);
	street([
		[7, 215],
		[34, 222],
		[60, 216],
	]);
	street([
		[-12, 160],
		[22, 164],
		[56, 158],
	]);
	street([
		[18, 256],
		[50, 262],
		[80, 256],
	]);
	street([
		[-204, 225],
		[-170, 232],
		[west - 2, 226],
	]);
	street([
		[-176, 176],
		[-156, 180],
		[west + 2, 172],
	]);
	street([
		[-56, 240],
		[-20, 246],
		[22, 240],
	]);
	street([
		[-54, 205],
		[-24, 200],
		[1, 205],
	]);
	street([
		[-60, 150],
		[-34, 148],
		[-13, 148],
	]);
	street([
		[-8, 190],
		[22, 194],
		[53, 190],
	]);
	street([
		[-251, 280],
		[-222, 272],
		[-196, 272],
	]);
}

/** The nearest place on the coast road to a place. */
function onCoast(x: number, z: number): Point {
	const road = roads[0] as Road;
	const p = road.points[nearestOn(road, x, z)] as RoadPoint;
	return [p.x, p.z];
}

/** The coast road's places in turn, clockwise from behind the beach's northern end. */
const COAST: readonly Point[] = [
	[300, -35],
	[215, 22],
	[132, 58],
	[48, 98],
	[-62, 58],
	[-178, 106],
	[-320, 76],
	[-440, 112],
	[-532, 150],
	[-590, 75],
	[-590, -40],
	[-600, -150],
	[-620, -270],
	[-625, -395],
	[-565, -470],
	[-430, -520],
	[-255, -525],
	[-120, -555],
	[15, -530],
	[135, -498],
	[250, -482],
	[350, -410],
	[445, -320],
	[470, -225],
	[436, -150],
	[378, -82],
];

/** Lays the coast road around the whole island through its places, moved inland where the sea is near. */
function coastRoad(): Road {
	const knots = COAST.map(([px, pz]) => {
		let [x, z] = [px, pz];
		for (let k = 0; k < 30 && inland(x, z) < 27; k++) {
			const e = 6;
			const [gx, gz] = [inland(x + e, z) - inland(x - e, z), inland(x, z + e) - inland(x, z - e)];
			const length = hypot(gx, gz) || 1;
			x += (gx / length) * 5;
			z += (gz / length) * 5;
		}
		return [x, z] as const;
	});
	const points = resample(spline(knots, true, roadLevel));
	// The ring relaxes as a closed line, so its seam bends as widely as the rest.
	const count = points.length - 1;
	for (let pass = 0; pass < 70; pass++) {
		const xs = points.map((p) => p.x);
		const zs = points.map((p) => p.z);
		for (let k = 0; k < count; k++) {
			const [a, c] = [(k + count - 1) % count, (k + 1) % count];
			const p = points[k] as RoadPoint;
			p.x += (((xs[a] as number) + (xs[c] as number)) / 2 - p.x) * 0.5;
			p.z += (((zs[a] as number) + (zs[c] as number)) / 2 - p.z) * 0.5;
		}
	}
	const first = points[0] as RoadPoint;
	const last = points[count] as RoadPoint;
	last.x = first.x;
	last.z = first.z;
	for (const p of points) p.y = survey(roadLevel, p.x, p.z);
	last.y = first.y;
	ease(points);
	return register(points, MAIN, 'loop', THROUGH_RADIUS);
}

/** The nearest point of a road to a place, as its index. */
function nearestOn(road: Road, x: number, z: number): number {
	let best = 0;
	let least = Number.POSITIVE_INFINITY;
	road.points.forEach((p, k) => {
		const d = hypot(p.x - x, p.z - z);
		if (d < least) {
			least = d;
			best = k;
		}
	});
	return best;
}

/** A wheel that leaves a road square, on the side toward a place. */
function leaving(road: Road, at: number, x: number, z: number): Wheel {
	const p = road.points[at] as RoadPoint;
	const a = road.points[Math.max(0, at - 1)] as RoadPoint;
	const b = road.points[Math.min(road.points.length - 1, at + 1)] as RoadPoint;
	const along = Math.atan2(b.z - a.z, b.x - a.x);
	const [nx, nz] = [-Math.sin(along), Math.cos(along)];
	const side = (x - p.x) * nx + (z - p.z) * nz >= 0 ? 1 : -1;
	return { x: p.x, y: p.y, z: p.z, heading: along + (side * Math.PI) / 2, run: 0 };
}

/** The passes in which a laid road settles to the land. */
const SETTLE_PASSES = 36;
/** The least grade that a laid road may take to follow the land, as a rise over a run. */
const FOLLOW_LEAST = 0.05;
/** The grade above which a laid road keeps to its laid heights, as a rise over a run. */
const FOLLOW_MOST = 0.07;
/** The meters at each end of a laid road that lie level. */
const LEVEL_RUN = 9;

/** The sharpest break between a laid road's neighbouring stretches, in radians. */
const MOST_CORNER = 0.14;

/** Rounds a line, past its held points, until no bend over two strides is tighter than a radius. */
function fair(line: RoadPoint[], radius: number, held: number): void {
	const stride = 2;
	const from = Math.max(held, 1);
	for (let pass = 0; pass < 1500; pass++) {
		// A tight place and its neighbours round together, so that rounding leaves no new corner.
		const tight = new Set<number>();
		for (let k = 1; k + stride < line.length; k++) {
			const [a, p, b] = [
				line[Math.max(0, k - stride)] as RoadPoint,
				line[k] as RoadPoint,
				line[k + stride] as RoadPoint,
			];
			const [ax, az, bx, bz] = [p.x - a.x, p.z - a.z, b.x - p.x, b.z - p.z];
			const bend = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
			const [q, n1] = [line[k - 1] as RoadPoint, line[k + 1] as RoadPoint];
			const corner = Math.abs(
				Math.atan2(
					(p.x - q.x) * (n1.z - p.z) - (p.z - q.z) * (n1.x - p.x),
					(p.x - q.x) * (n1.x - p.x) + (p.z - q.z) * (n1.z - p.z),
				),
			);
			if ((hypot(ax, az) + hypot(bx, bz)) / 2 / (bend || 1e-6) >= radius && corner < MOST_CORNER)
				continue;
			for (let n = Math.max(from, k - 4); n <= Math.min(line.length - 2, k + 4); n++) tight.add(n);
		}
		if (tight.size === 0) break;
		for (const k of tight) {
			const [a, p, b] = [line[k - 1] as RoadPoint, line[k] as RoadPoint, line[k + 1] as RoadPoint];
			p.x += ((a.x + b.x) / 2 - p.x) * 0.5;
			p.z += ((a.z + b.z) / 2 - p.z) * 0.5;
		}
	}
}

/** The place, and the radii, inside which the main road's swing keeps to its drawn line. */
const SWING: readonly [number, number, number, number] = [350, -195, 100, 140];

/** How freely a laid road may settle at a place: not at all on its swing, whose two legs stand apart. */
function looseAt({ x, z }: RoadPoint): number {
	const r = hypot(x - SWING[0], z - SWING[1]);
	return Math.min(1, Math.max(0, (r - SWING[2]) / (SWING[3] - SWING[2])));
}

/**
 * Lays an authored line along the land. The line starts at a height and rises at set grades, and each
 * place on it settles a short way across the slope to where the land stands at the road's height, so
 * the road lies on the land with its bends near where they were drawn. Its first points stay.
 */
function laid(
	knots: readonly Point[],
	startY: number,
	grade: (run: number, length: number) => number,
	held = 8,
	endY?: number,
): RoadPoint[] {
	let line = resample(spline(knots, false, roadLevel));
	const heights = () => {
		let length = 0;
		for (let k = 1; k < line.length; k++) {
			const [p, q] = [line[k] as RoadPoint, line[k - 1] as RoadPoint];
			length += hypot(p.x - q.x, p.z - q.z);
		}
		let [y, run] = [startY, 0];
		line.forEach((p, k) => {
			const q = line[k - 1];
			if (q) {
				const span = hypot(p.x - q.x, p.z - q.z);
				run += span;
				// A road leaves its parent and reaches its turning circle on the level.
				if (run > LEVEL_RUN && length - run > LEVEL_RUN) y += span * grade(run, length);
			}
			p.y = y;
		});
	};
	for (let pass = 0; pass < SETTLE_PASSES; pass++) {
		heights();
		for (let k = held; k + 1 < line.length; k++) {
			const p = line[k] as RoadPoint;
			const [gx, gz] = fall(roadLevel, p.x, p.z);
			const m = hypot(gx, gz);
			if (m < 0.08) continue;
			// The pull toward the land's height eases in past the road's first points.
			const fromEnd = endY === undefined ? 30 : line.length - k;
			const ease = Math.min(1, ((k - held + 1) / 30) ** 2, (fromEnd / 30) ** 2) * looseAt(p);
			const off = Math.max(-3, Math.min(3, (p.y - survey(roadLevel, p.x, p.z)) / m)) * ease;
			p.x += (gx / m) * off;
			p.z += (gz / m) * off;
		}
		relax(line.slice(Math.min(held, line.length - 2)), 2);
		line = resample(line);
	}
	// The line settles first, is smoothed second, and takes its heights last, so its grade holds.
	const kept = 1;
	relax(line.slice(kept), 4);
	line = resample(line);
	fair(line, THROUGH_RADIUS * 1.14, kept);
	line = resample(line);
	// Rounding draws a wrap in toward its hill, so the line settles once more, by little, and rounds again.
	for (let pass = 0; pass < 14; pass++) {
		heights();
		for (let k = held; k + 1 < line.length; k++) {
			const p = line[k] as RoadPoint;
			const [gx, gz] = fall(roadLevel, p.x, p.z);
			const m = hypot(gx, gz);
			if (m < 0.08) continue;
			const fromEnd = endY === undefined ? 30 : line.length - k;
			const ease = Math.min(1, ((k - held + 1) / 30) ** 2, (fromEnd / 30) ** 2) * looseAt(p);
			const off = Math.max(-1.5, Math.min(1.5, (p.y - survey(roadLevel, p.x, p.z)) / m)) * ease;
			p.x += (gx / m) * off;
			p.z += (gz / m) * off;
		}
		relax(line.slice(kept), 1);
		line = resample(line);
	}
	fair(line, THROUGH_RADIUS * 1.14, kept);
	line = resample(line);
	heights();
	// Last, the height follows the land as closely as its grade lets it, from the start on, so that the
	// road neither cuts nor fills more than it must. Where it must end at a height, it ends there.
	let run = 0;
	for (let k = 1; k < line.length; k++) {
		const [p, q] = [line[k] as RoadPoint, line[k - 1] as RoadPoint];
		const span = hypot(p.x - q.x, p.z - q.z);
		run += span;
		const most = span * Math.max(Math.abs(grade(run, run + 999)), FOLLOW_LEAST);
		// A road that needs all its grade to gain its height keeps the height that it was laid at.
		if (Math.abs(grade(run, run + 999)) > FOLLOW_MOST) continue;
		if (run > LEVEL_RUN)
			p.y = Math.min(q.y + most, Math.max(q.y - most, survey(laneLevel, p.x, p.z)));
		else p.y = q.y;
	}
	if (endY !== undefined) {
		(line[line.length - 1] as RoadPoint).y = endY;
		for (let k = line.length - 2; k >= 0; k--) {
			const [p, q] = [line[k] as RoadPoint, line[k + 1] as RoadPoint];
			const most = hypot(p.x - q.x, p.z - q.z) * MAX_GRADE * 0.96;
			p.y = Math.min(q.y + most, Math.max(q.y - most, p.y));
		}
		(line[0] as RoadPoint).y = startY;
	}
	return line;
}

/** The radius of the arc by which a laid road leaves its parent, in meters. */
const LEAD_RADIUS = 48;
/** How far from square a laid road may lean as it leaves its parent, in radians. */
const LEAD_LEAN = 0.05;

/** The nearest that the knot a road's first arc aims at may lie, in meters. */
const LEAD_AIM = 90;

/**
 * The knots of a road that leaves another square to it, turns by a wide arc toward the first place on
 * its line that lies far enough off to reach, and runs on along the line. Gives the arc's knot count too.
 */
function leadFrom(
	road: Road,
	at: number,
	line: readonly Point[],
	radius = LEAD_RADIUS,
	straight = 6,
	nearest = LEAD_AIM,
): { knots: Point[]; held: number } {
	const start = road.points[at] as RoadPoint;
	let aim = 1;
	while (
		aim + 1 < line.length &&
		hypot((line[aim] as Point)[0] - start.x, (line[aim] as Point)[1] - start.z) < nearest
	)
		aim++;
	const [x, z] = line[aim] as Point;
	const wheel = leaving(road, at, x, z);
	const arc: Point[] = [[wheel.x, wheel.z]];
	// The road leans toward its aim as it leaves, within what a neat junction allows.
	let heading =
		wheel.heading +
		Math.max(
			-LEAD_LEAN,
			Math.min(LEAD_LEAN, turnTo(wheel.heading, Math.atan2(z - wheel.z, x - wheel.x))),
		);
	const most = ROAD_STEP / radius;
	let [px, pz] = [wheel.x, wheel.z];
	for (let k = 0; k < 40; k++) {
		const left = turnTo(heading, Math.atan2(z - pz, x - px));
		if (k >= straight + 2 && Math.abs(left) < 0.03) break;
		if (k >= straight) heading += Math.max(-most, Math.min(most, left));
		px += Math.cos(heading) * ROAD_STEP;
		pz += Math.sin(heading) * ROAD_STEP;
		arc.push([px, pz]);
	}
	return { knots: [...arc, ...line.slice(aim)], held: arc.length };
}

/** How much further the main and west villages' streets run, since their roads arrive on the crown's far side. */
const MAIN_VILLAGE_REACH = 1.3;
/** How much further the east village's streets run, to hold its houses. */
const EAST_VILLAGE_REACH = 1.12;
/** How far back along the arriving road each of a village's two streets leaves it, in points. */
const ARM_LEAVES: readonly number[] = [3, 9];
/**
 * Each village street's sense around the tower, its sweep in radians, how far in it ends, as a share of
 * the radius, and how soon it closes on the tower, the lower the sooner.
 */
const ARMS: readonly (readonly [number, number, number, number])[] = [
	[1, 1.2, 0.72, 0.5],
	[-1, 2.6, 0.58, 0.55],
];

/**
 * A village's streets: two streets leave the arriving road square to it, one behind the other, and curve
 * part way around the tower in opposite senses, so they end far apart and never ring the crown. Their
 * houses stand wall to wall on both sides. The stair runs on from the street that closes on the tower.
 */
function villageStreets(
	arrival: Road,
	village: readonly [number, number, number, number],
	reach = 1,
): void {
	const [vx, vz, , radius] = village;
	const { points } = arrival;
	// The street that leaves first turns back from the way the road runs, so the two never cross.
	const [tail, ending] = [
		points[points.length - 1] as RoadPoint,
		points[points.length - 6] as RoadPoint,
	];
	const [ex, ez] = [tail.x - vx, tail.z - vz];
	const turning = Math.sign(-ez * (tail.x - ending.x) + ex * (tail.z - ending.z)) || 1;
	ARMS.forEach(([side, sweep, inner, closes], k) => {
		const sense = side * turning;
		const start = points[points.length - 1 - (ARM_LEAVES[k] as number)] as RoadPoint;
		const r0 = hypot(start.x - vx, start.z - vz);
		const bearing = Math.atan2(start.z - vz, start.x - vx);
		const arc: Point[] = [[start.x, start.z]];
		for (let n = 2; n <= 8; n++) {
			const t = n / 8;
			const [angle, r] = [
				bearing + sense * sweep * reach * t,
				r0 + (radius * inner * reach ** 1.1 - r0) * t ** closes,
			];
			arc.push([vx + Math.cos(angle) * r, vz + Math.sin(angle) * r]);
		}
		// The street leaves its road square, by a short straight run and a tight arc, and then follows its line.
		const at = points.length - 1 - (ARM_LEAVES[k] as number);
		const { knots } = leadFrom(arrival, at, arc, ARM_ARC, ARM_RUN, ARM_AIM);
		street(knots, SIDE_LANE + 0.2, 'circle', 0, 0);
	});
}

/** Whether a local road may stand at a place. */
function localFree(x: number, z: number): boolean {
	const [gx, gz] = fall(laneLevel, x, z);
	return (
		inland(x, z) > 26 &&
		golfShare(x, z) < 0.02 &&
		townShare(x, z) < 0.3 &&
		!(beachShare(x, z) > 0.2 && inland(x, z) < 55) &&
		!PARKS.some(([px, pz, r]) => hypot(x - px, z - pz) < r + 6) &&
		!SUMMITS.some(([sx, sz, , r]) => hypot(x - sx, z - sz) < r) &&
		!VILLAGES.some(([vx, vz, , r]) => hypot(x - vx, z - vz) < r * 1.3) &&
		!northOfRidge(x, z) &&
		hypot(gx, gz) < 0.95
	);
}

/** Drives a local road off a road, square to it, and then level along the contour. */
/**
 * Whether a local road may stand at a place at a height: it leaves room for a bank to every other road,
 * and for its own shelf beside the others. A road's first meters from its parent don't count.
 */
function roomFor(
	x: number,
	z: number,
	y: number,
	parent: number,
	parentAt: number,
	apart = false,
): boolean {
	let room = true;
	eachNear(x, z, 80, (road, at, d) => {
		if (road === parent && (Math.abs(at - parentAt) * ROAD_STEP < 60 || (apart && d >= TWIN_GAP)))
			return;
		const other = roads[road] as Road;
		const p = other.points[at] as RoadPoint;
		const width =
			road === parent ? TWIN_GAP + 1 : other.radius >= THROUGH_RADIUS ? ROAD_ROOM : LANE_ROOM;
		if (d < Math.abs(p.y - y) / LANE_BANK + width) room = false;
	});
	return room;
}

function branch(
	parent: number,
	at: number,
	side: number,
	half: number,
	most: number,
	shortest: number,
	forward = 0,
): Road | undefined {
	const owner = roads[parent] as Road;
	const p = owner.points[at] as RoadPoint;
	const a = owner.points[Math.max(0, at - 1)] as RoadPoint;
	const b = owner.points[Math.min(owner.points.length - 1, at + 1)] as RoadPoint;
	const along = Math.atan2(b.z - a.z, b.x - a.x);
	// A lane leaves at a wide angle, leaning the way that it will run along the contour.
	const heading = along + (side * Math.PI) / 2 - side * forward * LANE_LEAN;
	let height: number | undefined;
	const { line, end } = drive(
		{ x: p.x, y: p.y, z: p.z, heading, run: 0 },
		{
			radius: LOCAL_RADIUS,
			most,
			parent,
			parentAt: at,
			settle: 30,
			cut: MOST_CUT,
			grade: STEEPEST_ACCESS,
			bench: 110,
			wind: 2.6,
			joins: true,
			ground: laneLevel,
			hold: () => height,
			free: (x, z, wheel) =>
				inland(x, z) > 12 &&
				(wheel.run < 30 || (localFree(x, z) && roomFor(x, z, wheel.y, parent, at, true))),
			aim: (wheel) => {
				const off = hypot(wheel.x - p.x, wheel.z - p.z);
				const ground = survey(laneLevel, wheel.x, wheel.z);
				const [gx, gz] = fall(laneLevel, wheel.x, wheel.z);
				const m = hypot(gx, gz);
				// The lane stands clear of its parent, then holds this level along the contour.
				if (height === undefined) {
					if (off < LANE_TURN) return heading;
					height = p.y + Math.max(-6, Math.min(6, ground - p.y));
				}
				if (m < 0.04) return wheel.heading;
				const contour = Math.atan2(gx, -gz);
				const toward = wheel.run < 70 && forward !== 0 ? heading : wheel.heading;
				const across =
					Math.abs(turnTo(toward, contour)) < Math.PI / 2 ? contour : contour + Math.PI;
				const up = Math.atan2(gz, gx);
				const pull = Math.max(-0.7, Math.min(0.7, ((height - ground) / (m + 0.1)) * 0.06));
				return across + Math.sign(turnTo(across, up)) * pull;
			},
		},
	);
	const trimmed = end === 'stopped' ? trim(line) : line;
	if (trimmed.length * STEP < shortest) return undefined;
	return commit(trimmed, half, end === 'stopped' ? 'circle' : 'junction', LOCAL_RADIUS);
}

/** Takes a stopped road's end back to where a turning circle has room. */
function trim(line: RoadPoint[]): RoadPoint[] {
	const out = [...line];
	while (out.length > 4) {
		const p = out[out.length - 1] as RoadPoint;
		if (
			inland(p.x, p.z) > 30 &&
			Math.abs(survey(level, p.x, p.z) - p.y) < 2.5 &&
			clearance(p.x, p.z, TWIN_GAP + 8, -1) > TWIN_GAP + 6
		)
			break;
		out.length -= 1;
	}
	return out;
}

function growLocal(
	parents: readonly number[],
	half: number,
	most: number,
	shortest: number,
	gap: number,
	probe: number,
): void {
	for (const parent of parents) {
		const { points } = roads[parent] as Road;
		for (const side of [1, -1]) {
			let wait = gap * 0.6;
			for (let at = 8; at + 8 < points.length; at += 3) {
				wait -= ROAD_STEP * 3;
				if (wait > 0) continue;
				const p = points[at] as RoadPoint;
				const q = points[at + 1] as RoadPoint;
				const [gx, gz] = fall(laneLevel, p.x, p.z);
				if (hypot(gx, gz) > 0.85) continue;
				const along = Math.atan2(q.z - p.z, q.x - p.x);
				const heading = along + (side * Math.PI) / 2;
				// On a slope a lane leans the way that its parent draws away from it: forward where it leaves
				// downhill of a rising parent, and back where it leaves uphill.
				const rising = q.y >= p.y ? 1 : -1;
				const uphill = Math.cos(heading) * gx + Math.sin(heading) * gz > 0;
				const lean = hypot(gx, gz) < 0.15 ? 0 : uphill ? -rising : rising;
				const [ox, oz] = [p.x + Math.cos(heading) * probe, p.z + Math.sin(heading) * probe];
				if (!localFree(ox, oz) || clearance(ox, oz, probe * 0.82, -1) < probe * 0.82) continue;
				if (branch(parent, at, side, half, most, shortest, lean)) wait = gap;
			}
		}
	}
}

/**
 * The main road's authored line after the coast road: north up the island's middle from the church, a
 * long traverse east across the south face, a wide swing on the gentle foot of the eastern hill, a second
 * traverse back west across the whole face, and around the west of the main hill to its village.
 */
const MAIN_LINE: readonly Point[] = [
	[-62, 40],
	[-60, -5],
	[-52, -50],
	[40, -85],
	[170, -115],
	[270, -118],
	[342, -122],
	[388, -176],
	[384, -240],
	[335, -294],
	[278, -282],
	[235, -222],
	[170, -240],
	[90, -285],
	[10, -262],
	[-70, -212],
	[-150, -208],
	[-235, -285],
	[-285, -345],
	[-302, -424],
	[-222, -456],
	[-168, -425],
];
/** The main road's grade. */
const MAIN_GRADE = MAX_GRADE * 1.02;

/** The eastern hill road's authored line, from the saddle along the crest to the village. */
const EAST_LINE: readonly Point[] = [
	[71, -344],
	[128, -354],
	[205, -360],
];
/** The eastern hill road's climb, as a rise over a run. */
const EAST_GRADE = 0.09;
/** The western road's authored line, from the coast road up the west-centre to the western village. */
const WEST_LINE: readonly Point[] = [
	[-470, 118],
	[-470, 40],
	[-445, -60],
	[-405, -150],
	[-395, -250],
	[-420, -335],
	[-465, -360],
];
/** The middle road's authored line, from the main road's first bend across to the western road. */
const MIDDLE_LINE: readonly Point[] = [
	[-52, -50],
	[-120, -80],
	[-220, -115],
	[-320, -150],
	[-405, -150],
];

/**
 * The tiers of the south and west faces: each one's road and place on it, a place that says which way
 * it runs, its length, its rise along that length, and the height that it first climbs or falls by, so
 * that it draws away from a road that lies along the same contour. Each traces its height along the
 * land's contour, so it follows the land wherever the land lies.
 */
const TIERS: readonly (readonly [
	'main' | 'west' | 'middle' | 'coast',
	Point,
	Point,
	number,
	number,
	number,
])[] = [
	['middle', [-207, -15], [-60, -200], 280, 0.01, 16],
	['middle', [-290, -125], [-100, -100], 280, 0.012, 4],
	['main', [111, -125], [-200, -60], 280, 0.012, 0],
	['main', [340, -170], [250, -30], 170, -0.07, 0],
	['west', [-420, -335], [-100, -250], 280, 0.01, 18],
	['coast', [-590, 20], [-300, 40], 200, 0.02, 0],
];

/** The grade at which a tier climbs or falls away from its parent's contour, as a rise over a run. */
const TIER_CLIMB = 0.085;

/** A tier's grade at a distance along it: its climb away from its parent, then its own. */
const tierGrade = (run: number, grade: number, rise: number) =>
	run < Math.abs(rise) / TIER_CLIMB ? Math.sign(rise) * TIER_CLIMB : grade;

/** The most that a tier may stand off the land, in meters: past it the tier stops. */
const TIER_OFF = 14;
/** The longest tier, in meters: a longer stretch of contour takes a tier from another place. */
const TIER_MOST = 290;

/** The knots of a line that runs along the land's contour from a place, toward another, rising as it goes. */
function contourLine(
	start: Point,
	toward: Point,
	length: number,
	grade: number,
	rise: number,
): Point[] {
	const knots: Point[] = [start];
	let [x, z] = start;
	let target = survey(laneLevel, x, z);
	let heading = Math.atan2(toward[1] - z, toward[0] - x);
	const stride = 12;
	for (let walked = 0; walked < length; walked += stride) {
		const [gx, gz] = fall(laneLevel, x, z);
		const m = hypot(gx, gz) || 1;
		// Of the contour's two ways, the line takes the one nearer its heading.
		const contour = Math.atan2(gx, -gz);
		heading = Math.abs(turnTo(heading, contour)) < Math.PI / 2 ? contour : contour + Math.PI;
		target += stride * tierGrade(walked, grade, rise);
		x += Math.cos(heading) * stride;
		z += Math.sin(heading) * stride;
		const off = Math.max(-4, Math.min(4, (target - survey(laneLevel, x, z)) / m));
		x += (gx / m) * off;
		z += (gz / m) * off;
		if (inland(x, z) < 30 || golfShare(x, z) > 0.02 || northOfRidge(x, z)) break;
		if (walked % 36 === 24) knots.push([x, z]);
	}
	return knots;
}

/** The clubhouse above the golf course. */
const CLUB: Point = [432, -66];

/** Every road the land can carry, from the coast road down to the local lanes. */
export const ALL_ROADS: readonly Road[] = (() => {
	const ring = coastRoad();
	townStreets();
	type Main = readonly [number, number, number, number];
	// The main road runs on from the coast road, up the island's middle and around to the main village.
	const foot = nearestOn(ring, -62, 64);
	const footPoint = ring.points[foot] as RoadPoint;
	const mainLead = leadFrom(ring, foot, MAIN_LINE);
	const mainRoad = register(
		laid(
			mainLead.knots,
			footPoint.y,
			(run, length) => (length - run < ACCESS_RUN ? STEEPEST_ACCESS : MAIN_GRADE),
			mainLead.held,
		),
		CLIMB,
		'circle',
		THROUGH_RADIUS,
	);
	const mainIndex = roads.length - 1;
	villageStreets(mainRoad, VILLAGES[0] as Main, MAIN_VILLAGE_REACH);
	/** A road that leaves another along an authored line at a grade, and ends in a turning circle. */
	const branchRoad = (from: Road, line: readonly Point[], grade: number): number => {
		const first = line[0] as Point;
		const at = nearestOn(from, first[0], first[1]);
		const lead = leadFrom(from, at, line);
		register(
			laid(lead.knots, (from.points[at] as RoadPoint).y, () => grade, lead.held),
			COLLECTOR,
			'circle',
			THROUGH_RADIUS,
		);
		return roads.length - 1;
	};
	/** A road that leaves one road along an authored line and ends on another, at that road's height. */
	const linkRoad = (from: Road, line: readonly Point[], onto: Road): number => {
		const first = line[0] as Point;
		const end = line[line.length - 1] as Point;
		const at = nearestOn(from, first[0], first[1]);
		const target = onto.points[nearestOn(onto, end[0], end[1])] as RoadPoint;
		const before = line[line.length - 2] as Point;
		const [ox, oz] = squareTo(target, before);
		// The link's last stretch arrives square, along the road it ends on's normal.
		const lead = leadFrom(from, at, [
			...line.slice(0, -1),
			[target.x + (ox - target.x) * LINK_SQUARE, target.z + (oz - target.z) * LINK_SQUARE],
			[target.x + (ox - target.x) * 2, target.z + (oz - target.z) * 2],
			[target.x, target.z],
		]);
		const startY = (from.points[at] as RoadPoint).y;
		register(
			laid(lead.knots, startY, () => MAX_GRADE * 0.96, lead.held, target.y),
			COLLECTOR,
			'junction',
			THROUGH_RADIUS,
		);
		return roads.length - 1;
	};
	const eastIndex = branchRoad(mainRoad, EAST_LINE, EAST_GRADE);
	villageStreets(roads[eastIndex] as Road, VILLAGES[1] as Main, EAST_VILLAGE_REACH);
	const westIndex = branchRoad(ring, WEST_LINE, MAX_GRADE * 0.97);
	villageStreets(roads[westIndex] as Road, VILLAGES[2] as Main, MAIN_VILLAGE_REACH);
	const middleIndex = linkRoad(mainRoad, MIDDLE_LINE, roads[westIndex] as Road);
	/** A lane along an authored line that stops short of any road it nears, with room for its circle. */
	const tierRoad = (from: Road, line: readonly Point[], grade: number, rise: number): number[] => {
		const first = line[0] as Point;
		const at = nearestOn(from, first[0], first[1]);
		const lead = leadFrom(from, at, line);
		const whole = laid(
			lead.knots,
			(from.points[at] as RoadPoint).y,
			(run) => tierGrade(run, grade, rise),
			lead.held,
		);
		const parent = roads.indexOf(from);
		let keep = Math.min(whole.length, Math.floor(TIER_MOST / ROAD_STEP));
		for (let k = 12; k < keep; k++) {
			const p = whole[k] as RoadPoint;
			if (
				Math.abs(p.y - survey(level, p.x, p.z)) > TIER_OFF ||
				!roomFor(p.x, p.z, p.y, parent, at) ||
				crossed(whole[k - 1] as RoadPoint, p, parent, at) >= 0
			) {
				keep = k - 4;
				break;
			}
		}
		if (keep * ROAD_STEP < 60) return [];
		register(whole.slice(0, keep), LANE, 'circle', THROUGH_RADIUS);
		return [roads.length - 1];
	};
	const tiers = TIERS.flatMap(([owner, start, toward, length, grade, rise]) => {
		const from = {
			main: mainRoad,
			coast: ring,
			west: roads[westIndex],
			middle: roads[middleIndex],
		}[owner] as Road;
		const p = from.points[nearestOn(from, start[0], start[1])] as RoadPoint;
		const line = contourLine([p.x, p.z], toward, length, grade, rise);
		return line.length > 2 ? tierRoad(from, line, grade, rise) : [];
	});
	// A short lane reaches the clubhouse from the coast road.
	const clubAt = nearestOn(ring, CLUB[0], CLUB[1]);
	const { line: clubLine } = drive(leaving(ring, clubAt, CLUB[0], CLUB[1]), {
		radius: LOCAL_RADIUS,
		most: 160,
		parent: 0,
		parentAt: clubAt,
		settle: 1e9,
		cut: 8,
		wind: 2,
		joins: false,
		ground: laneLevel,
		free: () => true,
		aim: (w) =>
			hypot(w.x - CLUB[0], w.z - CLUB[1]) < 12
				? undefined
				: Math.atan2(CLUB[1] - w.z, CLUB[0] - w.x),
	});
	commit(clubLine, LANE, 'circle', LOCAL_RADIUS);
	// Lanes first from the through roads, then side lanes from the lanes.
	growLocal(
		[...tiers, middleIndex, westIndex, mainIndex, eastIndex],
		LANE,
		LANE_MOST,
		48,
		FORK_GAP,
		22,
	);
	// The long lower apron and the flat ground: lanes off the coast road, and off the quay street to the west.
	growLocal([0, 1], LANE, LANE_MOST, 48, APRON_GAP, 22);
	const lanes = roads.flatMap((road, k) => (road.half === LANE && road.end !== 'loop' ? [k] : []));
	growLocal(lanes, SIDE_LANE, SIDE_MOST, 42, 70, 22);
	const sides = roads.flatMap((road, k) =>
		road.half === SIDE_LANE && road.radius === LOCAL_RADIUS ? [k] : [],
	);
	growLocal(sides, SIDE_LANE, SIDE_MOST, 42, 70, 22);
	return roads;
})();
