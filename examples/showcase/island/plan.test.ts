// The island's town plan keeps the rules of a real place, measured on the final roads and the final
// ground that the viewer sees. No road is too steep or turns too tight, roads meet only at junctions
// and never run side by side, every road leads somewhere, every lane serves houses, houses stand on
// their own ground with a graded drive, and the ground follows the roads without rising through them.
import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { scaledBudget } from '../../../tests/lib/run-budget.ts';
import { WAY_HALF } from './ground';
import {
	formHeight,
	golfShare,
	hypot,
	inland,
	naturalHeight,
	northOfRidge,
	OUTCROPS,
	onOutcrop,
	SUMMITS,
	sandAt,
	VILLAGES,
} from './island';
import {
	type Build,
	box,
	church,
	GARDEN_KINDS,
	HOUSE_KINDS,
	keep,
	lighthouse,
	pavilion,
} from './kit';
import { GROUND_ERROR } from './land';
import {
	circleRadius,
	doorOf,
	FEWEST_ON_LANE,
	FILL_SPOTS,
	groundHeight,
	HOUSE_ON_ROAD,
	KEEPS,
	LOTS,
	type Lot,
	MOST_OFF_FORM,
	MOST_OFF_GROUND,
	NEIGHBOUR,
	PLAN_FINGERPRINT,
	planFingerprint,
	ROADS,
	roadEdge,
	STAIRS,
	STEEPEST_DRIVE,
	stairTreads,
	standing,
	TERRACES,
	TREE_SPOTS,
	type TreeSpot,
	wayOf,
} from './plan';
import {
	CLIMB,
	LANE,
	LOCAL_RADIUS,
	MAIN,
	MAX_GRADE,
	PARKS,
	QUAY_RADIUS,
	type Road,
	type RoadPoint,
	SIDE_LANE,
	SPINE,
	STREET,
	THROUGH_RADIUS,
	TWIN_GAP,
	tightest,
} from './routes';
import {
	HULL_WATER,
	hullDepth,
	MOORINGS,
	MOST_RETAINING,
	parasolSpots,
	retainingRuns,
	stoneWalls,
} from './town';

/** Two turning grades: the road's own, with 3% for the rounding of its height, and on the ground. */
const GRADE_SLACK = 1.03;
const GROUND_GRADE = 0.12;
/** How far a measured radius may fall under the limit, for the steps of a line's 3 m points. */
const RADIUS_SLACK = 0.92;
/** How far a road's end may lie from the middle line of the road it joins, in meters. */
const JOIN = 1;
/** The shallowest angle at which two roads may meet, as its cosine, 6 m and 15 m back from the join. */
const SHALLOWEST = 0.5;
/** The meters that two junctions stand apart at least, and within which two ends make one junction. */
const FEWEST_JUNCTION_METERS = 15;
const SAME_JUNCTION = 0.5;
/** The meters that two turning circles stand apart at least. */
const FEWEST_CIRCLE_METERS = 40;
/** The houses that a road's turning circle serves at least. */
const FEWEST_ON_CIRCLE = 3;
/** The meters that a road may run beside another close by, counted away from their junction. */
/** The pixels that ground a far block lifts through a road may show, at the coarsest preset. */
const MOST_LIFT_PIXELS = 6;
const MOST_BESIDE = 15;
/** The meters around a junction that the side-by-side test leaves to the junction tests. */
const JOINT_SKIP = 15;
/** The largest share of country houses that may stand on the through roads. */
const MOST_ON_THROUGH = 0.3;
/** How far a drive strip may lie under its ground or over it, in meters. */
const STRIP_BURIED = 0.3;
const STRIP_RAISED = 1;
/** How far along a road a point must lie from another to count as the road's own lap, in meters. */
const OWN_LAP = 120;
/** The research's cap on a road's grade, the longest stretch at it, and a hill road's share of it. */
const ACCESS_GRADE = 0.12;
const MOST_ACCESS_RUN = 150;
const MOST_ACCESS_SHARE = 0.15;
/** How far from a summit its hill reaches, for that count, in meters. */
const HILL_REACH = 320;
/** A ground face: the most height within a run, in meters, away from named cliffs and outcrops. */
const FACE_RISE = 10;
const FACE_RUN = 4;
/** The depth below the land's own form at which a road's cut counts as deep, in meters. */
const DEEP_CUT = 10;
/** The slope of a bank between two laps of a road, and the width that its two shoulders hold. */
const LAP_BANK = 1.4;
const LAP_WIDTH = 8;
/** The largest share of final ground above 40 m that may stand over 1:1: about a fifth. */
const MOST_STEEP = 0.2;
/** The houses that the hillsides must hold, outside the villages, from this height up. */
const HILLSIDE_FROM = 40;
const HILLSIDE_HOUSES = 220;
const FACE_HOUSES = 180;
/** The fewest houses on the island. */
const LEAST_HOUSES = 650;
const NORTH_HOUSES = 40;
/** How far past its radius a village's houses reach, as a share of the radius. */
const VILLAGE_REACH = 1.35;
/** The fewest plot sizes on the hills, the commonest gap's largest share, and the longest lane, in meters. */
const LEAST_PLOT_SIZES = 4;
const MOST_GAP_SHARE = 0.22;
const LONGEST_LANE = 300;
/** How near a village's nearest house stands to its tower, in meters, and how far its highest stands under it. */
const TOWER_REACH = 35;
const TOWER_RISE = 25;
/** The height that the main road aims to reach at its village, the least that it may reach, and the most. */
const MAIN_ROAD_TOP = 160;
const MAIN_ROAD_FLOOR = 158;
const MAIN_ROAD_MOST = 170;
/** The most that any road may stand above the land's own form, or lie below it, in meters. */
const MOST_ROAD_FILL = 20;
const MOST_ROAD_CUT = 15;
/** A ground face that no road or plot may raise, in meters over the face's run. */
const WORST_FACE = 15;
/** How near a stair ends to its tower's middle. */
const STAIR_END = 15;
/** The most that a stair's tread may stand above its ground, in meters. */
const STAIR_FLOAT = 0.8;
/** The most that a drive may exceed the straight line from the quay: the median and the 90th percentile. */
const MOST_DRIVE_MEDIAN = 2;
const MOST_DRIVE_P90 = 2;
/** The most that the drive to a house at the far end of the long hillside lanes may exceed the straight line. */
const MOST_NAMED_DRIVE = 2.5;
/** How far from the quay those houses stand, and how near to that a house counts, in meters. */
const NAMED_DRIVE = 352;
const NAMED_DRIVE_REACH = 15;
/** The meters of road with no room for a bank to another road. */
const MOST_TIGHT = 300;
/** The shortest run of retaining wall, how near a wall must stand to a deep cut to hold it, in meters. */
const SHORTEST_WALL_RUN = 18;
const WALL_REACH = 14;
/** The least water under a boat, in meters. */
const BOAT_WATER = 5;
/** The most sand under a house's plot, and how far a stair's first step stands from its road's edge, in meters. */
const MOST_SAND = 0.1;
const STAIR_FROM_ROAD = 0.5;
/** The most that a wall's top may stand off the ground just behind it, in meters. */
const WALL_TOP_OFF = 0.8;
/** How far the ground behind a road must stand over it for a wall to have something to retain, in meters. */
const RETAINS = 2;

const isLocal = ({ radius, end }: Road) => radius === LOCAL_RADIUS && end !== 'loop';
/** The ends of a road that should lie on another road. */
function joints(road: Road): RoadPoint[] {
	if (road.end === 'loop') return [];
	const first = road.points[0] as RoadPoint;
	const last = road.points[road.points.length - 1] as RoadPoint;
	return road.end === 'junction' ? [first, last] : [first];
}
/** The nearest point of any other road to a place: its road, its index and how far it lies. */
function nearestOther(road: Road, x: number, z: number) {
	let best = { other: undefined as Road | undefined, at: 0, d: Number.POSITIVE_INFINITY };
	for (const other of ROADS) {
		if (other === road) continue;
		other.points.forEach((p, at) => {
			const d = hypot(p.x - x, p.z - z);
			if (d < best.d) best = { other, at, d };
		});
	}
	return best;
}
const side = (a: RoadPoint, b: RoadPoint, p: RoadPoint) =>
	(b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
const failures = (list: string[], limit = 8) =>
	`${list.length} failures, the first: ${list.slice(0, limit).join('; ')}`;

describe('the stored plan', () => {
	it(
		'is what the tool writes, from the search on',
		() => {
			for (const args of [['--check'], ['--search', '--check']]) {
				const run = Bun.spawnSync([
					process.execPath,
					'--conditions=null3d-source',
					fileURLToPath(new URL('./write-layout.ts', import.meta.url)),
					...args,
				]);
				expect(run.exitCode, `${args.join(' ')}: ${run.stderr.toString()}`).toBe(0);
			}
		},
		scaledBudget(60_000),
	);

	it('is the plan that the fingerprint names', () => {
		expect(planFingerprint()).toBe(PLAN_FINGERPRINT);
	});
});

/** The area two convex polygons share, each listed counterclockwise. */
function sharedArea(a: readonly number[][], b: readonly number[][]): number {
	let kept = a as number[][];
	b.forEach((from, i) => {
		const to = b[(i + 1) % b.length] as number[];
		const side = (p: number[]) =>
			(to[0]! - from[0]!) * (p[1]! - from[1]!) - (to[1]! - from[1]!) * (p[0]! - from[0]!);
		const next: number[][] = [];
		kept.forEach((p, k) => {
			const q = kept[(k + 1) % kept.length] as number[];
			const [sp, sq] = [side(p), side(q)];
			if (sp >= 0) next.push(p);
			if (sp * sq < 0) {
				const t = sp / (sp - sq);
				next.push([p[0]! + (q[0]! - p[0]!) * t, p[1]! + (q[1]! - p[1]!) * t]);
			}
		});
		kept = next;
	});
	return Math.abs(
		kept.reduce((sum, p, k) => {
			const q = kept[(k + 1) % kept.length] as number[];
			return sum + p[0]! * q[1]! - q[0]! * p[1]!;
		}, 0) / 2,
	);
}

/** The most area, in square meters, over which two faces of different colors lie at one depth. */
function largestFight({ positions, colors, uvs, indices }: Build): number {
	const planes = new Map<string, { color: string; corners: number[][] }[]>();
	for (let t = 0; t < indices.length; t += 3) {
		const [a, b, c] = [0, 1, 2].map((k) => {
			const v = indices[t + k] as number;
			return [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!];
		}) as [number[], number[], number[]];
		const [u, v] = [a.map((n, k) => b[k]! - n), a.map((n, k) => c[k]! - n)];
		const cross = [
			u[1]! * v[2]! - u[2]! * v[1]!,
			u[2]! * v[0]! - u[0]! * v[2]!,
			u[0]! * v[1]! - u[1]! * v[0]!,
		];
		const size = Math.hypot(...cross);
		if (size < 1e-6) continue;
		const normal = cross.map((n) => n / size);
		const reach = normal[0]! * a[0]! + normal[1]! * a[1]! + normal[2]! * a[2]!;
		const key = `${normal.map((n) => Math.round(n * 100))}|${Math.round(reach * 200)}`;
		// The face lies flat on the two axes that its normal leans on least.
		const flat = Math.abs(normal[0]!) > 0.9 ? [1, 2] : Math.abs(normal[2]!) > 0.9 ? [0, 1] : [0, 2];
		const corners = [a, b, c].map((p) => [p[flat[0]!]!, p[flat[1]!]!]);
		const [p, q, r] = corners as [number[], number[], number[]];
		if ((q[0]! - p[0]!) * (r[1]! - p[1]!) < (q[1]! - p[1]!) * (r[0]! - p[0]!)) corners.reverse();
		const at = indices[t] as number;
		const color = [
			colors[at * 3],
			colors[at * 3 + 1],
			colors[at * 3 + 2],
			uvs[at * 2] || uvs[at * 2 + 1] ? 'mapped' : '',
		].join();
		const plane = planes.get(key) ?? [];
		plane.push({ color, corners });
		planes.set(key, plane);
	}
	let largest = 0;
	for (const faces of planes.values())
		faces.forEach((face, i) => {
			for (const other of faces.slice(i + 1))
				if (other.color !== face.color)
					largest = Math.max(largest, sharedArea(face.corners, other.corners));
		});
	return largest;
}

describe('the models', () => {
	it('keep faces of different colors apart in depth, which would flicker as the camera moves', () => {
		const { stone } = church();
		const builds: Record<string, Build> = {
			keep: keep(),
			lighthouse: lighthouse(),
			church: stone,
			pavilion: pavilion().stone,
		};
		HOUSE_KINDS.forEach((kind, k) => {
			builds[`house ${k}`] = kind.walls;
			builds[`far house ${k}`] = kind.farWalls;
		});
		GARDEN_KINDS.forEach((kind, k) => {
			builds[`garden ${k}`] = kind.mesh;
		});
		for (const [name, mesh] of Object.entries(builds))
			expect(largestFight(mesh), name).toBeLessThan(0.25);
	});

	it('measures a fight: two boxes that share a top', () => {
		const mesh = { positions: [], colors: [], uvs: [], indices: [], mapped: false } as Build;
		box(mesh, 0, 0, 0, 2, 1, 2, [1, 1, 1]);
		box(mesh, 0, 0, 0, 2, 1, 2, [0, 0, 0]);
		expect(largestFight(mesh)).toBeGreaterThan(0.25);
	});
});

describe('the road network', () => {
	it('keeps every road under the through grade, with short stretches up to the research cap', () => {
		const bad: string[] = [];
		for (const { points, radius, half } of ROADS) {
			const grades = points.flatMap((a, k) => {
				const b = points[k + 2];
				return b ? [Math.abs(b.y - a.y) / (hypot(b.x - a.x, b.z - a.z) || 1)] : [];
			});
			let [stretch, total] = [0, 0];
			grades.forEach((grade, k) => {
				const a = points[k] as RoadPoint;
				if (grade > ACCESS_GRADE) bad.push(`${grade.toFixed(3)} at ${a.x | 0},${a.z | 0}`);
				stretch = grade > MAX_GRADE * GRADE_SLACK ? stretch + 3 : 0;
				if (stretch > 0) total += 3;
				if (stretch > MOST_ACCESS_RUN) bad.push(`${stretch} m at ${a.x | 0},${a.z | 0}`);
			});
			// A through road may not use the allowance at all, a hill road only for a share of its length.
			if (half === MAIN && total > 0) bad.push(`the coast road, ${total} m`);
			if (radius >= THROUGH_RADIUS && total > points.length * 3 * MOST_ACCESS_SHARE)
				bad.push(`${total} m of ${points.length * 3} m`);
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('keeps the ground that the viewer sees along each road under the grade', () => {
		const bad: string[] = [];
		for (const { points } of ROADS)
			for (let k = 0; k + 5 < points.length; k++) {
				const [a, b] = [points[k] as RoadPoint, points[k + 5] as RoadPoint];
				const run = hypot(b.x - a.x, b.z - a.z);
				const grade = Math.abs(groundHeight(b.x, b.z) - groundHeight(a.x, a.z)) / run;
				// One point over the road's own limit, for the terrain's cell.
				const steep = Math.abs(b.y - a.y) / run > MAX_GRADE * GRADE_SLACK;
				if (grade > (steep ? ACCESS_GRADE + 0.01 : GROUND_GRADE))
					bad.push(`${grade.toFixed(3)} at ${a.x | 0},${a.z | 0}`);
			}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('joins every road end to the middle of another road, on the same height', () => {
		const bad: string[] = [];
		for (const road of ROADS)
			for (const end of joints(road)) {
				const { d, other, at } = nearestOther(road, end.x, end.z);
				const p = other?.points[at] as RoadPoint;
				if (d > JOIN || Math.abs(p.y - end.y) > 0.6)
					bad.push(`${end.x | 0},${end.z | 0} off by ${d.toFixed(1)}`);
			}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('crosses no road, on any stretch, except where one ends on the other', () => {
		const bad: string[] = [];
		ROADS.forEach((road, r) => {
			for (const other of ROADS.slice(r + 1)) {
				const [ra, oa] = [road.points, other.points];
				for (let i = 0; i + 1 < ra.length; i++) {
					const [a, b] = [ra[i] as RoadPoint, ra[i + 1] as RoadPoint];
					for (let j = 0; j + 1 < oa.length; j++) {
						const [c, d] = [oa[j] as RoadPoint, oa[j + 1] as RoadPoint];
						if (Math.abs(a.x - c.x) + Math.abs(a.z - c.z) > 14) continue;
						if (side(a, b, c) * side(a, b, d) >= 0 || side(c, d, a) * side(c, d, b) >= 0) continue;
						const atEnd =
							joints(road).some((e) => hypot(e.x - c.x, e.z - c.z) < 5) ||
							joints(other).some((e) => hypot(e.x - a.x, e.z - a.z) < 5);
						if (!atEnd) bad.push(`${a.x | 0},${a.z | 0}`);
					}
				}
			}
		});
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('keeps the ground that a far block lifts through a road to a few pixels', () => {
		// A block of a cell draws past the distance where the cell shows the allowed error, so its lift
		// shows that error times the lift over the cell, at any distance.
		for (const cell of [7, 14, 28]) {
			const mesh = (x: number, z: number) => {
				const [i, j] = [Math.floor(x / cell), Math.floor(z / cell)];
				const [s, t] = [x / cell - i, z / cell - j];
				const at = (a: number, b: number) => groundHeight(a * cell, b * cell);
				return (
					(at(i, j) * (1 - s) + at(i + 1, j) * s) * (1 - t) +
					(at(i, j + 1) * (1 - s) + at(i + 1, j + 1) * s) * t
				);
			};
			let lift = 0;
			for (const { points, half } of ROADS)
				for (let k = 1; k + 1 < points.length; k += 2) {
					const [a, p, b] = [
						points[k - 1] as RoadPoint,
						points[k] as RoadPoint,
						points[k + 1] as RoadPoint,
					];
					const length = hypot(b.x - a.x, b.z - a.z) || 1;
					const [nx, nz] = [-(b.z - a.z) / length, (b.x - a.x) / length];
					for (const off of [half + 0.45, -half - 0.45, 0])
						lift = Math.max(lift, mesh(p.x + nx * off, p.z + nz * off) - p.y);
				}
			expect((lift * GROUND_ERROR.low) / cell, `the ${cell} m cell's lift`).toBeLessThan(
				MOST_LIFT_PIXELS,
			);
		}
	});

	it('never runs two roads side by side close together', () => {
		const bad: string[] = [];
		for (const road of ROADS) {
			const near = new Map<Road, number>();
			const { points } = road;
			for (let k = 0; k + 1 < points.length; k++) {
				const [p, q] = [points[k] as RoadPoint, points[k + 1] as RoadPoint];
				const { other, at, d } = nearestOther(road, p.x, p.z);
				if (!other || d >= TWIN_GAP) continue;
				// Close to the junction of two roads that meet there, the meeting is the junction test's.
				const joined = [...joints(road), ...joints(other)].some(
					(e) => hypot(e.x - p.x, e.z - p.z) < JOINT_SKIP,
				);
				if (joined) continue;
				const [a, b] = [
					other.points[Math.max(0, at - 1)] as RoadPoint,
					other.points[Math.min(other.points.length - 1, at + 1)] as RoadPoint,
				];
				const dot =
					((q.x - p.x) * (b.x - a.x) + (q.z - p.z) * (b.z - a.z)) /
					(hypot(q.x - p.x, q.z - p.z) * hypot(b.x - a.x, b.z - a.z) || 1);
				if (Math.abs(dot) < 0.87) continue;
				near.set(other, (near.get(other) ?? 0) + 3);
				if ((near.get(other) as number) === MOST_BESIDE + 3)
					bad.push(`${p.x | 0},${p.z | 0} ${d | 0} m apart`);
			}
		}
		// A road against its own lap, far along it, counts as two roads.
		for (const { points, end } of ROADS) {
			if (end === 'loop') continue;
			let beside = 0;
			for (let i = 0; i + 1 < points.length; i += 2) {
				const p = points[i] as RoadPoint;
				const near = points.some(
					(q, j) => Math.abs(j - i) * 3 > OWN_LAP && hypot(q.x - p.x, q.z - p.z) < TWIN_GAP,
				);
				beside = near ? beside + 6 : 0;
				if (beside > MOST_BESIDE) bad.push(`its own lap at ${p.x | 0},${p.z | 0}`);
			}
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('runs one street line from the quay past the church to the highest village', () => {
		const line = ROADS.filter((road) => road.half === SPINE || road.half === CLIMB);
		expect(line.length).toBe(2);
		const [lower, upper] = line as [Road, Road];
		const [foot, top] = [
			lower.points[lower.points.length - 1] as RoadPoint,
			upper.points[0] as RoadPoint,
		];
		expect(hypot(foot.x - top.x, foot.z - top.z), 'the street meets its climb').toBeLessThan(JOIN);
		const last = upper.points[upper.points.length - 1] as RoadPoint;
		const [vx, vz, , radius] = VILLAGES[0] as readonly [number, number, number, number];
		expect(hypot(last.x - vx, last.z - vz), 'the road reaches the village').toBeLessThan(
			radius * VILLAGE_REACH,
		);
		expect(last.y, 'it reaches about its height').toBeGreaterThanOrEqual(MAIN_ROAD_FLOOR);
		expect(last.y, 'it stops about its height').toBeLessThanOrEqual(MAIN_ROAD_MOST);
		expect(MAIN_ROAD_FLOOR).toBeLessThan(MAIN_ROAD_TOP);
	});

	it('climbs real stairs from each village to its tower, every tread above ground and clear', () => {
		const bad: string[] = [];
		STAIRS.forEach((stair, k) => {
			const [kx, kz, ky] = KEEPS[k] as readonly [number, number, number];
			const last = stair[stair.length - 1] as { x: number; y: number; z: number };
			if (hypot(last.x - kx, last.z - kz) > STAIR_END) bad.push(`stair ${k} ends short`);
			if (Math.abs(last.y - ky) > 1)
				bad.push(`stair ${k} ends ${(ky - last.y).toFixed(1)} m under its tower`);
			const treads = stairTreads(stair);
			const first = treads[0] as { x: number; z: number };
			let above = 0;
			treads.forEach((t, n) => {
				if (t.y >= groundHeight(t.x, t.z) - 0.02) above++;
				if (t.y - groundHeight(t.x, t.z) > STAIR_FLOAT)
					bad.push(`stair ${k} floats at ${t.x | 0},${t.z | 0}`);
				const before = treads[n - 1];
				if (before && t.y <= before.y) bad.push(`stair ${k} falls at ${t.x | 0},${t.z | 0}`);
				if (roadEdge(t.x, t.z) < -0.2 && hypot(t.x - first.x, t.z - first.z) > 8)
					bad.push(`stair ${k} on a road at ${t.x | 0},${t.z | 0}`);
				for (const lot of LOTS) {
					const [hw, hd] = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half;
					const [dx, dz] = [t.x - lot.x, t.z - lot.z];
					const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
					if (Math.abs(dx * c - dz * s) < hw && Math.abs(dx * s + dz * c) < hd)
						bad.push(`stair ${k} through a house at ${t.x | 0},${t.z | 0}`);
				}
			});
			if (above / treads.length < 0.9)
				bad.push(`stair ${k}: ${((100 * above) / treads.length) | 0}% of treads above ground`);
		});
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('reaches every road from the coast road', () => {
		const reached = new Set<Road>([ROADS[0] as Road]);
		for (let grew = true; grew; ) {
			grew = false;
			for (const road of ROADS) {
				if (reached.has(road)) continue;
				for (const end of joints(road)) {
					const { other, d } = nearestOther(road, end.x, end.z);
					if (other && d < JOIN && reached.has(other)) {
						reached.add(road);
						grew = true;
						break;
					}
				}
			}
		}
		expect(ROADS.length - reached.size, 'roads that the coast road cannot reach').toBe(0);
	});

	it('keeps roads on land and off the golf course', () => {
		for (const { points } of ROADS)
			for (const p of points) {
				expect(inland(p.x, p.z), `a road in the sea at ${p.x | 0}, ${p.z | 0}`).toBeGreaterThan(0);
				expect(
					golfShare(p.x, p.z),
					`a road on the golf course at ${p.x | 0}, ${p.z | 0}`,
				).toBeLessThan(0.5);
			}
	});
});

describe("the road network's shape", () => {
	it('has no curve tighter than its road allows, ends included', () => {
		const bad: string[] = [];
		for (const road of ROADS) {
			const radius = tightest(road.points);
			if (radius < road.radius * RADIUS_SLACK)
				bad.push(
					`${radius | 0} m on a ${road.radius} m road at ${(road.points[0] as RoadPoint).x | 0},${(road.points[0] as RoadPoint).z | 0}`,
				);
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('has no sharp corner between neighbouring stretches', () => {
		const bad: string[] = [];
		for (const { points } of ROADS)
			for (let k = 1; k + 1 < points.length; k++) {
				const [a, p, b] = [
					points[k - 1] as RoadPoint,
					points[k] as RoadPoint,
					points[k + 1] as RoadPoint,
				];
				const turn = Math.abs(
					Math.atan2(
						(p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x),
						(p.x - a.x) * (b.x - p.x) + (p.z - a.z) * (b.z - p.z),
					),
				);
				if (turn > (12 * Math.PI) / 180)
					bad.push(`${((turn * 180) / Math.PI) | 0} degrees at ${p.x | 0},${p.z | 0}`);
			}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('has no hairpin: no road turns 120 degrees within 60 m', () => {
		const bad: string[] = [];
		for (const { points } of ROADS)
			for (let k = 0; k + 21 < points.length; k++) {
				let sum = 0;
				for (let s = k + 1; s < k + 20; s++) {
					const [a, p, b] = [
						points[s - 1] as RoadPoint,
						points[s] as RoadPoint,
						points[s + 1] as RoadPoint,
					];
					sum += Math.atan2(
						(p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x),
						(p.x - a.x) * (b.x - p.x) + (p.z - a.z) * (b.z - p.z),
					);
				}
				if (Math.abs(sum) > (120 * Math.PI) / 180) {
					bad.push(`${(points[k] as RoadPoint).x | 0},${(points[k] as RoadPoint).z | 0}`);
					break;
				}
			}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('meets another road at a wide angle at every junction, 6 m and 15 m back', () => {
		const bad: string[] = [];
		for (const road of ROADS) {
			if (road.end === 'loop') continue;
			const { points } = road;
			const lines: RoadPoint[][] = [points];
			if (road.end === 'junction') lines.push([...points].reverse());
			for (const line of lines) {
				const end = line[0] as RoadPoint;
				const { other, at } = nearestOther(road, end.x, end.z);
				if (!other) continue;
				const [a, b] = [
					other.points[Math.max(0, at - 1)] as RoadPoint,
					other.points[Math.min(other.points.length - 1, at + 1)] as RoadPoint,
				];
				for (const back of [2, 5]) {
					const inner = line[back];
					if (!inner) continue;
					const dot =
						((end.x - inner.x) * (b.x - a.x) + (end.z - inner.z) * (b.z - a.z)) /
						(hypot(end.x - inner.x, end.z - inner.z) * hypot(b.x - a.x, b.z - a.z));
					if (Math.abs(dot) > SHALLOWEST)
						bad.push(
							`${end.x | 0},${end.z | 0} at ${back * 3} m: ${((Math.acos(Math.abs(dot)) * 180) / Math.PI) | 0} degrees`,
						);
				}
			}
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('keeps every two junctions apart', () => {
		const joins = ROADS.flatMap((road) =>
			joints(road).filter((end) =>
				ROADS.some(
					(other) =>
						other !== road && other.points.some((p) => hypot(p.x - end.x, p.z - end.z) < JOIN),
				),
			),
		);
		const bad: string[] = [];
		for (const [k, a] of joins.entries())
			for (const b of joins.slice(k + 1)) {
				const gap = hypot(a.x - b.x, a.z - b.z);
				// Two roads that meet at one place make one junction.
				if (gap > SAME_JUNCTION && gap < FEWEST_JUNCTION_METERS)
					bad.push(`${gap.toFixed(1)} m at ${a.x | 0},${a.z | 0}`);
			}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('keeps every two turning circles apart, and gives each enough houses', () => {
		const circles = ROADS.filter((road) => road.end === 'circle');
		const ends = circles.map((road) => road.points[road.points.length - 1] as RoadPoint);
		const bad: string[] = [];
		for (const [k, a] of ends.entries()) {
			for (const b of ends.slice(k + 1))
				if (hypot(a.x - b.x, a.z - b.z) < FEWEST_CIRCLE_METERS)
					bad.push(`close at ${a.x | 0},${a.z | 0}`);
			const served = LOTS.filter((lot) => lot.road === circles[k]).length;
			if (served < FEWEST_ON_CIRCLE) bad.push(`${served} houses at ${a.x | 0},${a.z | 0}`);
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('lets no house strip cross a terrace wall', () => {
		const bad: string[] = [];
		for (const lot of LOTS) {
			const way = wayOf(lot);
			if (!way) continue;
			const [from, to] = [way[0] as RoadPoint, way[way.length - 1] as RoadPoint];
			const [vx, vz] = [to.x - from.x, to.z - from.z];
			for (const wall of TERRACES) {
				const [ux, uz] = [wall.bx - wall.ax, wall.bz - wall.az];
				const cross = ux * vz - uz * vx;
				if (!cross) continue;
				const onWall = ((from.x - wall.ax) * vz - (from.z - wall.az) * vx) / cross;
				const onWay = ((from.x - wall.ax) * uz - (from.z - wall.az) * ux) / cross;
				if (onWall >= 0 && onWall <= 1 && onWay >= 0 && onWay <= 1)
					bad.push(`${lot.x | 0},${lot.z | 0}`);
			}
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('ends a road that joins nothing in a level circle that serves houses', () => {
		const bad: string[] = [];
		for (const road of ROADS) {
			if (road.end !== 'circle') continue;
			const last = road.points[road.points.length - 1] as RoadPoint;
			const served = LOTS.filter((lot) => lot.road === road).length;
			const joined = ROADS.some(
				(other) =>
					other !== road &&
					joints(other).some((end) =>
						road.points.some((p) => hypot(p.x - end.x, p.z - end.z) < JOIN),
					),
			);
			if (isLocal(road) && served < FEWEST_ON_LANE && !joined)
				bad.push(`${served} houses at ${last.x | 0},${last.z | 0}`);
			const radius = circleRadius(road.half);
			for (let a = 0; a < 6.28; a += 0.5) {
				const g = groundHeight(last.x + Math.cos(a) * radius, last.z + Math.sin(a) * radius);
				if (Math.abs(g - last.y) > 0.7) {
					bad.push(
						`a disc ${(g - last.y).toFixed(1)} m off the ground at ${last.x | 0},${last.z | 0}`,
					);
					break;
				}
			}
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	for (const [preset, samples] of [
		['high', 1024],
		['low', 512],
	] as const)
		it(`keeps the ground from rising through a road's surface and its pale edge on the ${preset} preset`, () => {
			// Sampled as a terrain block of the preset samples the ground, with its long cells.
			const cell = 1800 / samples;
			const mesh = (x: number, z: number) => {
				const [i, j] = [Math.floor(x / cell), Math.floor(z / cell)];
				const [s, t] = [x / cell - i, z / cell - j];
				const at = (a: number, b: number) => groundHeight(a * cell, b * cell);
				return (
					(at(i, j) * (1 - s) + at(i + 1, j) * s) * (1 - t) +
					(at(i, j + 1) * (1 - s) + at(i + 1, j + 1) * s) * t
				);
			};
			const bad: string[] = [];
			for (const { points, half } of ROADS)
				for (let k = 1; k + 1 < points.length; k += 2) {
					const [a, p, b] = [
						points[k - 1] as RoadPoint,
						points[k] as RoadPoint,
						points[k + 1] as RoadPoint,
					];
					const length = hypot(b.x - a.x, b.z - a.z) || 1;
					const [nx, nz] = [-(b.z - a.z) / length, (b.x - a.x) / length];
					for (const off of [half + 0.45, -half - 0.45, 0])
						if (mesh(p.x + nx * off, p.z + nz * off) > p.y + 0.28)
							bad.push(
								`${(mesh(p.x + nx * off, p.z + nz * off) - p.y).toFixed(2)} at ${p.x | 0},${p.z | 0}`,
							);
				}
			expect(bad.length, failures(bad)).toBe(0);
		});

	it('leaves no wall across a road, and no short stub of wall', () => {
		const bad: string[] = [];
		for (const run of stoneWalls().stretches) {
			if (run.length < 6) bad.push(`a stub at ${(run[0] as { x: number }).x | 0}`);
			for (const p of run)
				if (roadEdge(p.x, p.z) < -0.2) bad.push(`on a road at ${p.x | 0},${p.z | 0}`);
		}
		expect(bad.length, failures(bad)).toBe(0);
		expect(TERRACES.filter((w) => roadEdge(w.ax, w.az) < 0).length, 'terrace walls on a road').toBe(
			0,
		);
	});
});

describe("the network's levels", () => {
	it('has each lane serve houses, unless other roads join it', () => {
		const bad: string[] = [];
		for (const road of ROADS) {
			if (!isLocal(road)) continue;
			const served = LOTS.filter((lot) => lot.road === road).length;
			const joined = ROADS.some(
				(other) =>
					other !== road &&
					joints(other).some((end) =>
						road.points.some((p) => hypot(p.x - end.x, p.z - end.z) < JOIN),
					),
			);
			if (served < FEWEST_ON_LANE && !joined)
				bad.push(
					`${served} at ${(road.points[0] as RoadPoint).x | 0},${(road.points[0] as RoadPoint).z | 0}`,
				);
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('keeps most country houses off the through roads', () => {
		const country = LOTS.filter((lot) => lot.garden >= 0);
		const through = country.filter(
			({ road }) => road.radius >= THROUGH_RADIUS && road.half > LANE,
		).length;
		expect(through / country.length).toBeLessThanOrEqual(MOST_ON_THROUGH);
	});

	it('holds the lanes level along the contours', () => {
		let [level, all] = [0, 0];
		for (const road of ROADS) {
			if (!isLocal(road)) continue;
			const { points } = road;
			// A lane may climb as it leaves its road and as it joins another.
			for (let k = 14; k + 19 < points.length; k++) {
				const [a, b] = [points[k] as RoadPoint, points[k + 5] as RoadPoint];
				all++;
				if (Math.abs(b.y - a.y) / hypot(b.x - a.x, b.z - a.z) < 0.03) level++;
			}
		}
		expect(level / all, 'the share of lanes under 3%').toBeGreaterThan(0.6);
	});
});

const cornersOf = (lot: Lot) => {
	const [hw, hd] = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half;
	const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
	return [
		[hw, hd],
		[-hw, hd],
		[hw, -hd],
		[-hw, -hd],
	].map(
		([u, v]) =>
			[
				lot.x + (u as number) * c + (v as number) * s,
				lot.z - (u as number) * s + (v as number) * c,
			] as const,
	);
};

describe('the houses', () => {
	it('are many, in the town, along the lanes and on each hilltop', () => {
		expect(LOTS.length).toBeGreaterThanOrEqual(LEAST_HOUSES);
		expect(LOTS.filter((lot) => lot.garden >= 0).length, 'country houses').toBeGreaterThan(200);
		for (const [x, z, , radius] of VILLAGES) {
			const village = LOTS.filter((lot) => hypot(lot.x - x, lot.z - z) < radius * VILLAGE_REACH);
			expect(village.length, `the village at ${x}, ${z}`).toBeGreaterThanOrEqual(25);
			expect(village.length, `the village at ${x}, ${z}`).toBeLessThanOrEqual(50);
		}
	});

	it('each have a graded drive from a road, close by', () => {
		const bad: string[] = [];
		for (const lot of LOTS) {
			const hd = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half[1];
			const run = hypot(lot.x - lot.gate.x, lot.z - lot.gate.z) - hd;
			if (run > 26) bad.push(`a ${run | 0} m drive`);
			const grade = Math.abs(lot.y - lot.gate.y) / Math.max(run, 1);
			if (grade > STEEPEST_DRIVE * 1.02)
				bad.push(`${grade.toFixed(2)} at ${lot.x | 0},${lot.z | 0}`);
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('lay each drive strip on its ground', () => {
		const bad: string[] = [];
		for (const lot of LOTS) {
			if (lot.garden < 0) continue;
			const hd = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half[1];
			const [fx, fz] = [lot.x + Math.sin(lot.yaw) * hd, lot.z + Math.cos(lot.yaw) * hd];
			for (let t = 0.2; t < 1; t += 0.2) {
				const [x, z] = [lot.gate.x + (fx - lot.gate.x) * t, lot.gate.z + (fz - lot.gate.z) * t];
				const off = lot.gate.y + (lot.y - lot.gate.y) * t - groundHeight(x, z);
				if (off < -STRIP_BURIED || off > STRIP_RAISED)
					bad.push(`${off.toFixed(2)} at ${x | 0},${z | 0}`);
			}
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('take no drive across another road', () => {
		const bad: string[] = [];
		for (const lot of LOTS) {
			const run = hypot(lot.x - lot.gate.x, lot.z - lot.gate.z);
			for (let t = (lot.road.half + 1.5) / run; t < 0.95; t += 0.1) {
				const [x, z] = [
					lot.gate.x + (lot.x - lot.gate.x) * t,
					lot.gate.z + (lot.z - lot.gate.z) * t,
				];
				if (roadEdge(x, z) < -0.3) {
					bad.push(`${x | 0},${z | 0}`);
					break;
				}
			}
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('stand clear of every road, on their own ground', () => {
		const bad: string[] = [];
		for (const lot of LOTS)
			for (const [x, z] of cornersOf(lot)) {
				if (roadEdge(x, z) < 0) bad.push(`on a road at ${x | 0},${z | 0}`);
				if (Math.abs(groundHeight(x, z) - lot.y) > MOST_OFF_GROUND * 1.2)
					bad.push(`${(groundHeight(x, z) - lot.y).toFixed(1)} m off at ${x | 0},${z | 0}`);
			}
		expect(bad.length, failures(bad)).toBe(0);
		for (const lot of LOTS)
			for (const [px, pz, r] of PARKS) expect(hypot(lot.x - px, lot.z - pz)).toBeGreaterThan(r);
	});

	it('stand on land and off the golf course', () => {
		for (const lot of LOTS) {
			expect(inland(lot.x, lot.z)).toBeGreaterThan(8);
			expect(golfShare(lot.x, lot.z)).toBeLessThan(0.2);
		}
	});
});

describe('the trees', () => {
	it('stands no trunk on a terrace wall', () => {
		const bad = TREE_SPOTS.filter(({ x, z }) =>
			TERRACES.some((w) => {
				const [dx, dz] = [w.bx - w.ax, w.bz - w.az];
				const t = Math.max(
					0,
					Math.min(1, ((x - w.ax) * dx + (z - w.az) * dz) / (dx * dx + dz * dz || 1)),
				);
				return hypot(x - w.ax - dx * t, z - w.az - dz * t) < 0.5;
			}),
		);
		expect(bad.length).toBe(0);
	});

	it("nest each preset's trees among those of the next preset up", () => {
		for (const spots of [TREE_SPOTS, FILL_SPOTS]) {
			let lighter = new Set<TreeSpot>();
			for (const share of [0.3, 0.55, 0.8, 1]) {
				const kept = new Set(standing(spots, share));
				for (const spot of lighter) expect(kept.has(spot)).toBe(true);
				expect(kept.size).toBeGreaterThanOrEqual(lighter.size);
				lighter = kept;
			}
		}
	});
});

describe('what the search does not lay', () => {
	it('floats every boat over water', () => {
		const bad = MOORINGS.flatMap(([x, z]) =>
			groundHeight(x, z) > -BOAT_WATER
				? [`${groundHeight(x, z).toFixed(1)} at ${x | 0},${z | 0}`]
				: [],
		);
		expect(bad.length, failures(bad)).toBe(0);
		expect(MOORINGS.length).toBeGreaterThan(20);
		const aground = MOORINGS.flatMap(([x, z, yaw]) =>
			hullDepth(x, z, yaw) < HULL_WATER ? [`${x | 0},${z | 0}`] : [],
		);
		expect(aground.length, failures(aground)).toBe(0);
	});

	it('ends every road in a junction, a loop or a turning circle', () => {
		const bad = ROADS.filter(({ end }) => !['junction', 'loop', 'circle'].includes(end)).map(
			({ points }) => `${(points[points.length - 1] as RoadPoint).x | 0}`,
		);
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('starts each stair at its street', () => {
		STAIRS.forEach((stair, k) => {
			const start = stair[0] as { x: number; z: number };
			expect(roadEdge(start.x, start.z), `stair ${k}`).toBeLessThan(STAIR_FROM_ROAD);
		});
	});

	it('draws a strip to every house set back from its road, clear of houses and walls', () => {
		const walls = stoneWalls();
		const pieces = walls.stretches.flatMap((stretch) =>
			stretch.flatMap((p, k) => (k % 2 ? [[stretch[k - 1], p] as const] : [])),
		);
		const bad: string[] = [];
		for (const lot of LOTS) {
			const door = doorOf(lot);
			const way = wayOf(lot);
			if (!way) {
				if (roadEdge(door.x, door.z) > HOUSE_ON_ROAD)
					bad.push(`no strip ${lot.x | 0},${lot.z | 0}`);
				continue;
			}
			const [from, to] = [way[0] as RoadPoint, way[way.length - 1] as RoadPoint];
			if (roadEdge(from.x, from.z) > 0.6 && lot.road.end !== 'path')
				bad.push(`off the road ${lot.x | 0},${lot.z | 0}`);
			if (hypot(to.x - door.x, to.z - door.z) > 0.01)
				bad.push(`off the door ${lot.x | 0},${lot.z | 0}`);
			const length = hypot(to.x - from.x, to.z - from.z);
			const near = LOTS.filter(
				(other) =>
					other !== lot && Math.abs(other.x - to.x) + Math.abs(other.z - to.z) < length + 26,
			);
			for (let t = 0; t <= length; t += 0.5) {
				const [x, z] = [
					from.x + ((to.x - from.x) * t) / length,
					from.z + ((to.z - from.z) * t) / length,
				];
				for (const other of near) {
					const [hw, hd] = (HOUSE_KINDS[other.kind] as (typeof HOUSE_KINDS)[number]).half;
					const [c, s] = [Math.cos(other.yaw), Math.sin(other.yaw)];
					const [ox, oz] = [x - other.x, z - other.z];
					if (
						Math.abs(ox * c - oz * s) < hw + WAY_HALF &&
						Math.abs(ox * s + oz * c) < hd + WAY_HALF
					) {
						bad.push(`through a house ${lot.x | 0},${lot.z | 0}`);
						t = length;
						break;
					}
				}
			}
			for (const [a, b] of pieces) {
				if (!a || Math.abs(a.x - from.x) + Math.abs(a.z - from.z) > length + 20) continue;
				const [ux, uz] = [b.x - a.x, b.z - a.z];
				const [vx, vz] = [to.x - from.x, to.z - from.z];
				const cross = ux * vz - uz * vx;
				if (!cross) continue;
				const s = ((from.x - a.x) * vz - (from.z - a.z) * vx) / cross;
				const r = ((from.x - a.x) * uz - (from.z - a.z) * ux) / cross;
				if (s >= 0 && s <= 1 && r >= 0 && r <= 1)
					bad.push(`across a wall ${lot.x | 0},${lot.z | 0}`);
			}
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('stands no parasol on or beside a road', () => {
		const bad = parasolSpots().filter((spot) => roadEdge(spot.x, spot.z) < 2);
		expect(bad.length, failures(bad.map((s) => `${s.x | 0},${s.z | 0}`))).toBe(0);
	});

	it('leaves no short piece of terrace wall standing alone', () => {
		const ends = new Map<string, number[]>();
		TERRACES.forEach(({ ax, ay, az, bx, bz }, k) => {
			for (const [x, z] of [
				[ax, az],
				[bx, bz],
			] as const) {
				const key = `${Math.round(x * 2)},${Math.round(z * 2)},${Math.round(ay * 10)}`;
				ends.set(key, [...(ends.get(key) ?? []), k]);
			}
		});
		const seen = new Uint8Array(TERRACES.length);
		const short: string[] = [];
		TERRACES.forEach((_, first) => {
			if (seen[first]) return;
			let length = 0;
			const stack = [first];
			seen[first] = 1;
			while (stack.length > 0) {
				const { ax, ay, az, bx, bz } = TERRACES[stack.pop() as number] as (typeof TERRACES)[number];
				length += hypot(bx - ax, bz - az);
				for (const [x, z] of [
					[ax, az],
					[bx, bz],
				] as const)
					for (const k of ends.get(
						`${Math.round(x * 2)},${Math.round(z * 2)},${Math.round(ay * 10)}`,
					) ?? [])
						if (!seen[k]) {
							seen[k] = 1;
							stack.push(k);
						}
			}
			if (length < 12) short.push(`${(TERRACES[first] as { ax: number }).ax | 0}`);
		});
		expect(short.length, failures(short)).toBe(0);
	});

	it('gives every house a clear way from its door to its road', () => {
		const bad: string[] = [];
		for (const lot of LOTS) {
			const hd = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half[1];
			const [fx, fz] = [
				lot.x + Math.sin(lot.yaw) * (hd + 0.2),
				lot.z + Math.cos(lot.yaw) * (hd + 0.2),
			];
			const [dx, dz] = [lot.gate.x - fx, lot.gate.z - fz];
			const length = hypot(dx, dz);
			for (const other of LOTS) {
				if (other === lot || Math.abs(other.x - fx) + Math.abs(other.z - fz) > length + 24)
					continue;
				const [hw, oh] = (HOUSE_KINDS[other.kind] as (typeof HOUSE_KINDS)[number]).half;
				const [c, s] = [Math.cos(other.yaw), Math.sin(other.yaw)];
				for (let t = 0; t <= length; t += 0.5) {
					const [ox, oz] = [fx + (dx * t) / length - other.x, fz + (dz * t) / length - other.z];
					if (Math.abs(ox * c - oz * s) < hw && Math.abs(ox * s + oz * c) < oh) {
						bad.push(`${lot.x | 0},${lot.z | 0}`);
						t = length;
					}
				}
			}
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('stands no house on the sand', () => {
		const bad = LOTS.flatMap((lot) =>
			[[lot.x, lot.z] as const, ...cornersOf(lot)].some(([x, z]) => sandAt(x, z) > MOST_SAND)
				? [`${lot.x | 0},${lot.z | 0}`]
				: [],
		);
		expect(bad.length, failures(bad)).toBe(0);
	});
});

describe('the plan of land, roads and houses', () => {
	it('closes the coast road on itself', () => {
		const ring = ROADS.find((road) => road.end === 'loop') as Road;
		const [first, last] = [
			ring.points[0] as RoadPoint,
			ring.points[ring.points.length - 1] as RoadPoint,
		];
		expect(hypot(first.x - last.x, first.z - last.z)).toBeLessThan(1);
	});

	it('holds as much road as the island needs', () => {
		const length = ROADS.reduce((sum, road) => sum + road.points.length * 3, 0);
		expect(length).toBeGreaterThan(12000);
	});

	it('sweeps no road more than one lap around a summit', () => {
		const bad: string[] = [];
		for (const [sx, sz] of SUMMITS)
			for (const { points, end } of ROADS) {
				if (end === 'loop') continue;
				let [turned, most, least] = [0, 0, 0];
				for (let k = 0; k + 1 < points.length; k++) {
					const [p, q] = [points[k] as RoadPoint, points[k + 1] as RoadPoint];
					const a = Math.atan2(p.z - sz, p.x - sx);
					const b = Math.atan2(q.z - sz, q.x - sx);
					if (hypot(p.x - sx, p.z - sz) > HILL_REACH) continue;
					turned += Math.atan2(Math.sin(b - a), Math.cos(b - a));
					most = Math.max(most, turned);
					least = Math.min(least, turned);
				}
				if (most - least > Math.PI * 2)
					bad.push(`${((most - least) / Math.PI / 2).toFixed(2)} laps at ${sx},${sz}`);
			}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('leaves room between the laps of a road for a bank, whatever the height between them', () => {
		const bad: string[] = [];
		for (const { points, half, end } of ROADS) {
			if (points.length < 60 || end === 'loop') continue;
			for (let i = 0; i < points.length; i += 4)
				for (let j = i + 40; j < points.length; j += 2) {
					const [a, b] = [points[i] as RoadPoint, points[j] as RoadPoint];
					const need = Math.abs(a.y - b.y) / LAP_BANK + 2 * half + LAP_WIDTH;
					const d = hypot(a.x - b.x, a.z - b.z);
					// Two points that near along the road are one bend, not two laps.
					if (d < need && d < (j - i) * 3 * 0.5) {
						bad.push(
							`${d | 0} m at ${a.x | 0},${a.z | 0}, ${Math.abs(a.y - b.y) | 0} m apart in height`,
						);
						break;
					}
				}
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it("raises no road or plot face past its limit, where the land's own form is not that steep", () => {
		const bad: string[] = [];
		let faces = 0;
		const step = (h: (x: number, z: number) => number, x: number, z: number) =>
			Math.max(Math.abs(h(x + FACE_RUN, z) - h(x, z)), Math.abs(h(x, z + FACE_RUN) - h(x, z)));
		for (let x = -800; x < 800; x += FACE_RUN)
			for (let z = -640; z < 460; z += FACE_RUN) {
				if (inland(x, z) < 0) continue;
				// The form's own step is read with a margin, since the ground's grid samples it a little differently.
				if (step(formHeight, x, z) > FACE_RISE * 0.8) continue;
				const rise = step(groundHeight, x, z);
				if (rise > FACE_RISE) faces++;
				if (rise >= WORST_FACE) bad.push(`${rise.toFixed(1)} m at ${x},${z}`);
			}
		expect(bad.length, `${faces} faces over ${FACE_RISE} m; ${failures(bad)}`).toBe(0);
	});

	it('holds every road close to the land', () => {
		const bad: string[] = [];
		for (const { points } of ROADS)
			for (const p of points) {
				const off = formHeight(p.x, p.z) - p.y;
				if (off <= MOST_ROAD_CUT && off >= -MOST_ROAD_FILL) continue;
				bad.push(`${off.toFixed(1)} m at ${p.x | 0},${p.z | 0}`);
			}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('keeps the final ground above 40 m gentle, with no staircase of walls', () => {
		let [above, steep] = [0, 0];
		const slopes: number[] = [];
		for (let x = -800; x < 800; x += 4)
			for (let z = -800; z < 500; z += 4) {
				if (groundHeight(x, z) < 40) continue;
				const fall =
					hypot(
						groundHeight(x + 2, z) - groundHeight(x - 2, z),
						groundHeight(x, z + 2) - groundHeight(x, z - 2),
					) / 4;
				above++;
				slopes.push(fall);
				if (fall > 1) steep++;
			}
		expect(steep / above, 'the share of final ground over 1:1').toBeLessThanOrEqual(MOST_STEEP);
		slopes.sort((a, b) => a - b);
		const [low, high] = [
			slopes[Math.floor(above * 0.2)] as number,
			slopes[Math.floor(above * 0.8)] as number,
		];
		expect(high - low, 'how much the slope varies').toBeGreaterThan(0.2);
	});

	it('stands hundreds of houses on the faces the pictures show, thinning up to the crest', () => {
		const inVillage = (lot: { x: number; z: number }) =>
			VILLAGES.some(([x, z, , radius]) => hypot(lot.x - x, lot.z - z) < radius * VILLAGE_REACH);
		const hillside = LOTS.filter((lot) => lot.y >= HILLSIDE_FROM && !inVillage(lot));
		const north = hillside.filter((lot) => northOfRidge(lot.x, lot.z)).length;
		expect(hillside.length, 'hillside houses').toBeGreaterThanOrEqual(HILLSIDE_HOUSES);
		expect(hillside.length - north, 'on the south, west and east faces').toBeGreaterThanOrEqual(
			FACE_HOUSES,
		);
		expect(north, 'north of the ridge').toBeLessThanOrEqual(NORTH_HOUSES);
		const count = (from: number, to: number) =>
			hillside.filter((lot) => lot.y >= from && lot.y < to).length;
		// Bands of 20 m, so that a hole cannot hide in a wider one.
		for (const from of [40, 60, 80, 100])
			expect(count(from, from + 20), `houses from ${from} m`).toBeGreaterThan(5);
		expect(count(40, 80), 'most stand low').toBeGreaterThan(count(80, 120));
		expect(count(80, 120), 'fewer stand higher').toBeGreaterThan(count(120, 200));
	});

	it('varies its plots and its spacing, so no house is stamped', () => {
		const country = LOTS.filter((lot) => lot.garden >= 0 && lot.y >= HILLSIDE_FROM);
		const sizes = new Map<number, number>();
		for (const lot of country) sizes.set(lot.garden, (sizes.get(lot.garden) ?? 0) + 1);
		expect(sizes.size, 'plot sizes').toBeGreaterThanOrEqual(LEAST_PLOT_SIZES);
		expect(Math.max(...sizes.values()) / country.length, 'the commonest plot').toBeLessThan(0.5);
		const gaps = new Map<number, number>();
		let all = 0;
		for (const road of ROADS) {
			const along = LOTS.filter((lot) => lot.road === road && lot.garden >= 0)
				.map((lot) => road.points.indexOf(lot.gate))
				.sort((a, b) => a - b);
			for (let k = 0; k + 1 < along.length; k++) {
				const gap = ((along[k + 1] as number) - (along[k] as number)) * 3;
				gaps.set(gap, (gaps.get(gap) ?? 0) + 1);
				all++;
			}
		}
		expect(Math.max(...gaps.values()) / all, 'the commonest gap').toBeLessThanOrEqual(
			MOST_GAP_SHARE,
		);
	});

	it('keeps lanes short', () => {
		// The authored tiers count, and they are lanes in all but their drawn line.
		const long = ROADS.filter(
			(road) =>
				road.end !== 'loop' &&
				(road.half === LANE || road.half === SIDE_LANE) &&
				road.points.length * 3 > LONGEST_LANE,
		);
		expect(long.length).toBe(0);
	});

	it('clamps each village around its tower, up to the crest', () => {
		VILLAGES.forEach(([x, z, , radius], k) => {
			const [kx, kz, ky] = KEEPS[k] as readonly [number, number, number];
			const village = LOTS.filter((lot) => hypot(lot.x - x, lot.z - z) < radius * VILLAGE_REACH);
			// A house stands as near as its nearest wall, which is what the eye sees.
			const near = Math.min(
				...village.flatMap((lot) => cornersOf(lot).map(([cx, cz]) => hypot(cx - kx, cz - kz))),
			);
			const high = Math.max(...village.map((lot) => lot.y));
			expect(near, `the nearest house to the tower at ${x}, ${z}`).toBeLessThan(TOWER_REACH);
			expect(ky - high, `the highest house under the tower at ${x}, ${z}`).toBeLessThan(TOWER_RISE);
		});
	});

	it('drives from the quay to the hillside houses by a sensible way', () => {
		// The roads as a graph of their points, joined where one road's end lies on another.
		const start = ROADS.find((road) => road.half === STREET + 0.5) as Road;
		const quay = start.points[Math.floor(start.points.length / 2)] as RoadPoint;
		const nodes: RoadPoint[] = [];
		const index = new Map<RoadPoint, number>();
		for (const { points } of ROADS)
			for (const p of points) {
				index.set(p, nodes.length);
				nodes.push(p);
			}
		const links: [number, number][][] = nodes.map(() => []);
		const link = (a: RoadPoint, b: RoadPoint) => {
			const [i, j] = [index.get(a) as number, index.get(b) as number];
			const d = hypot(a.x - b.x, a.z - b.z);
			(links[i] as [number, number][]).push([j, d]);
			(links[j] as [number, number][]).push([i, d]);
		};
		for (const road of ROADS) {
			road.points.forEach((p, k) => {
				const q = road.points[k + 1];
				if (q) link(p, q);
			});
			for (const end of [
				road.points[0] as RoadPoint,
				road.points[road.points.length - 1] as RoadPoint,
			]) {
				const { other, at, d } = nearestOther(road, end.x, end.z);
				if (other && d < 8) link(end, other.points[at] as RoadPoint);
			}
		}
		const best = new Float64Array(nodes.length).fill(Number.POSITIVE_INFINITY);
		best[index.get(quay) as number] = 0;
		const open = [index.get(quay) as number];
		while (open.length > 0) {
			const at = open.pop() as number;
			for (const [to, d] of links[at] as [number, number][])
				if ((best[at] as number) + d < (best[to] as number)) {
					best[to] = (best[at] as number) + d;
					open.push(to);
				}
		}
		// A house's height alone asks a length of road, however direct, at the through roads' grade.
		const ratios = LOTS.filter((lot) => lot.y >= HILLSIDE_FROM).map(
			(lot) =>
				(best[index.get(lot.gate) as number] as number) /
				Math.max(hypot(lot.x - quay.x, lot.z - quay.z), lot.y / MAX_GRADE),
		);
		// A house this far from the quay must not lie at the end of a drive many times as long.
		const named = LOTS.filter((lot) => {
			const straight = hypot(lot.x - quay.x, lot.z - quay.z);
			return lot.y >= HILLSIDE_FROM && Math.abs(straight - NAMED_DRIVE) < NAMED_DRIVE_REACH;
		});
		expect(named.length, 'the houses that stand as far as the named one').toBeGreaterThan(0);
		for (const lot of named)
			expect(
				(best[index.get(lot.gate) as number] as number) / hypot(lot.x - quay.x, lot.z - quay.z),
				`the drive to ${lot.x | 0}, ${lot.z | 0}`,
			).toBeLessThan(MOST_NAMED_DRIVE);
		ratios.sort((a, b) => a - b);
		expect(
			ratios[Math.floor(ratios.length / 2)] as number,
			'the median drive against straight',
		).toBeLessThan(MOST_DRIVE_MEDIAN);
		expect(ratios[Math.floor(ratios.length * 0.9)] as number, 'the 90th percentile').toBeLessThan(
			MOST_DRIVE_P90,
		);
	});

	it('hangs each road from a road of its own rank or higher', () => {
		const bad: string[] = [];
		for (const road of ROADS) {
			if (road.end === 'loop' || road.radius < THROUGH_RADIUS || road.half <= LANE) continue;
			const first = road.points[0] as RoadPoint;
			const { other } = nearestOther(road, first.x, first.z);
			if (other && other.half < road.half && other.half !== MAIN)
				bad.push(`${first.x | 0},${first.z | 0}`);
		}
		expect(bad.length, failures(bad)).toBe(0);
	});

	it('leaves room for a bank between any two roads', () => {
		let tight = 0;
		const worst: string[] = [];
		ROADS.forEach((road, a) => {
			for (let k = 0; k < road.points.length; k += 2) {
				const p = road.points[k] as RoadPoint;
				for (let b = a + 1; b < ROADS.length; b++) {
					const other = ROADS[b] as Road;
					let hit = false;
					for (const q of other.points) {
						const d = hypot(p.x - q.x, p.z - q.z);
						const shoulders = road.half + other.half + LAP_WIDTH;
						// Roads that meet at a junction need no bank between them there.
						if (d > TWIN_GAP * 1.3 && d - shoulders < Math.abs(p.y - q.y) / LAP_BANK && d < 90)
							hit = true;
					}
					if (hit) {
						tight += 6;
						if (worst.length < 8) worst.push(`${p.x | 0},${p.z | 0}`);
						break;
					}
				}
			}
		});
		expect(tight, `meters of road with no room for a bank: ${worst.join('; ')}`).toBeLessThan(
			MOST_TIGHT,
		);
	});

	it('keeps every tree of a lower quality at a higher one', () => {
		const at = (share: number) => new Set(standing(TREE_SPOTS, share));
		const shares = [0.3, 0.55, 0.8, 1];
		for (let k = 1; k < shares.length; k++) {
			const higher = at(shares[k] as number);
			for (const spot of at(shares[k - 1] as number)) expect(higher.has(spot)).toBe(true);
		}
		expect(at(1).size).toBe(TREE_SPOTS.length);
		for (const share of shares)
			expect(Math.abs(at(share).size / TREE_SPOTS.length - share)).toBeLessThan(0.02);
	});

	it('woods the knob under each tower', () => {
		for (const [vx, vz, , radius] of VILLAGES) {
			const trees = TREE_SPOTS.filter((t) => {
				const r = Math.hypot(t.x - vx, t.z - vz);
				return r > 11 && r < radius * 0.8;
			});
			// At least one tree in each patch of about this many square meters.
			expect(trees.length).toBeGreaterThan((Math.PI * (radius * 0.8) ** 2) / 50);
		}
	});

	it('stands no house on a named outcrop', () => {
		const bad = LOTS.filter((lot) => onOutcrop(lot.x, lot.z)).map(
			(lot) => `${lot.x | 0},${lot.z | 0}`,
		);
		expect(bad.length, failures(bad)).toBe(0);
		expect(OUTCROPS.length).toBeGreaterThan(2);
	});

	it("holds a road's deep cut with a stone wall that stands in it", () => {
		const { retaining } = stoneWalls();
		expect(retaining.every((wall) => wall.high <= MOST_RETAINING)).toBe(true);
		// Every stretch of wall that stands has a run of its own, and is no stub.
		const runs = retainingRuns(retaining);
		expect(runs.filter((run) => run < SHORTEST_WALL_RUN).length, 'stubs of wall').toBe(0);
		// A road deep under the land's form with ground standing over it holds a wall. Where a plot's pad or a
		// bank has left nothing to retain, no wall stands.
		let [deep, held] = [0, 0];
		for (const { points, half } of ROADS)
			points.forEach((p, k) => {
				if (formHeight(p.x, p.z) - p.y <= DEEP_CUT) return;
				const q = points[Math.min(points.length - 1, k + 1)] as RoadPoint;
				const a = points[Math.max(0, k - 1)] as RoadPoint;
				const length = hypot(q.x - a.x, q.z - a.z) || 1;
				const [nx, nz] = [-(q.z - a.z) / length, (q.x - a.x) / length];
				const off = half + 5;
				const behind = Math.max(
					groundHeight(p.x + nx * off, p.z + nz * off),
					groundHeight(p.x - nx * off, p.z - nz * off),
				);
				if (behind - p.y < RETAINS) return;
				deep++;
				if (retaining.some((wall) => hypot(wall.x - p.x, wall.z - p.z) < WALL_REACH)) held++;
			});
		expect(held / Math.max(deep, 1), 'the share of deep cut with a wall').toBeGreaterThan(0.9);
		// A wall retains: its top stands no higher than the ground just behind it, by a limit.
		const bad = retaining.filter(({ x, z, top }) => {
			const near = retaining.find((o) => o.x !== x && hypot(o.x - x, o.z - z) < 8);
			if (!near) return false;
			const [dx, dz] = [near.z - z, x - near.x];
			const length = hypot(dx, dz) || 1;
			const behind = [1.5, -1.5].map((off) =>
				groundHeight(x + (dx / length) * off, z + (dz / length) * off),
			);
			return top - Math.max(...(behind as [number, number])) > WALL_TOP_OFF;
		});
		expect(
			bad.length / Math.max(retaining.length, 1),
			'the share of wall standing proud of its ground',
		).toBeLessThan(0.1);
	});

	it('bends the long quay street no tighter than its own limit', () => {
		const quay = ROADS.find((road) => road.half === STREET + 0.5) as Road;
		expect(tightest(quay.points)).toBeGreaterThan(QUAY_RADIUS * RADIUS_SLACK);
	});

	it('leaves no house without a neighbour, or far off the land', () => {
		const bad: string[] = [];
		for (const lot of LOTS) {
			if (Math.abs(lot.y - formHeight(lot.x, lot.z)) > MOST_OFF_FORM)
				bad.push(
					`a pad ${(lot.y - formHeight(lot.x, lot.z)).toFixed(1)} m off at ${lot.x | 0},${lot.z | 0}`,
				);
			if (
				!LOTS.some((other) => other !== lot && hypot(other.x - lot.x, other.z - lot.z) < NEIGHBOUR)
			)
				bad.push(`a stray at ${lot.x | 0},${lot.z | 0}`);
		}
		expect(bad.length, failures(bad)).toBe(0);
	});
});

describe('the ground and the trees', () => {
	it('cuts and fills leave no more ground over the steepest bank than the land has', () => {
		let [natural, final] = [0, 0];
		const step = 4;
		for (let x = -760; x < 760; x += step)
			for (let z = -520; z < 460; z += step) {
				const fall = (h: (a: number, b: number) => number) =>
					hypot(h(x + 2, z) - h(x - 2, z), h(x, z + 2) - h(x, z - 2)) / 4;
				if (fall(naturalHeight) > 2) natural++;
				if (fall(groundHeight) > 2) final++;
			}
		expect(final, `${final} samples against the land's own ${natural}`).toBeLessThan(
			natural * 1.5 + 120,
		);
	});

	it('hold the hills as tall as the pictures ask', () => {
		const [main, second, third] = SUMMITS as unknown as [
			readonly number[],
			readonly number[],
			readonly number[],
		];
		// The main summit stands high enough for the road's length to reach its village at its grade.
		expect(main[2]).toBeGreaterThanOrEqual(190);
		for (const [x, z, top] of SUMMITS)
			expect(
				top - groundHeight(x, z),
				`the ground at ${x}, ${z} stands at its summit's height`,
			).toBeLessThan(4);
		expect(second[2]).toBeGreaterThan(150);
		expect(third[2]).toBeGreaterThan(90);
	});

	it('stand trees on land, off the roads, houses and drives', () => {
		expect(TREE_SPOTS.length).toBeGreaterThan(8000);
		const bad: string[] = [];
		const lots = LOTS.map((lot) => ({ lot, corners: cornersOf(lot) }));
		for (const spot of TREE_SPOTS) {
			if (inland(spot.x, spot.z) <= 0 || roadEdge(spot.x, spot.z) < 1)
				bad.push(`road or sea at ${spot.x | 0},${spot.z | 0}`);
			for (const { lot } of lots) {
				if (Math.abs(lot.x - spot.x) + Math.abs(lot.z - spot.z) > 30) continue;
				const [hw, hd] = (HOUSE_KINDS[lot.kind] as (typeof HOUSE_KINDS)[number]).half;
				const [dx, dz] = [spot.x - lot.x, spot.z - lot.z];
				const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
				const [u, v] = [dx * c - dz * s, dx * s + dz * c];
				if (Math.abs(u) < hw && Math.abs(v) < hd)
					bad.push(`in a house at ${spot.x | 0},${spot.z | 0}`);
			}
		}
		expect(bad.length, failures(bad)).toBe(0);
	});
});
