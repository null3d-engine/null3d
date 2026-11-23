// The island's crows: fifty birds that perch, launch, fly across the island and land on another
// perch, each on its own clock, so the flock never moves as one. Perches are roof ridges of the town
// plan's houses, the keeps' battlements, the parks' gazebos, walls and lamps, the street lamps, the
// square's fountain, the harbour's breakwater and the moored boats' bows. One bird to a perch, by a
// landing claim. While the town's lamps are lit the flock roosts, and nothing flies.
//
// The owner's startle: crows scatter only when the camera itself comes within a few meters. Inside
// that range the nearest perched birds launch after a short fuse, and the rest stay put. The
// cinematic route keeps its distance, so the flock flies only its own errands for the whole route.
//
// The birds draw as one code-made form of about forty triangles: a body, head, beak and tail in one
// mesh, and each wing its own mesh so it turns at the shoulder. Three dynamic batches, so the wings
// beat in bursts and glide between, and the bodies bank into their turns. The birds cast no shadows.
import { type Camera, type MeshArrays, quat, type SketchContext } from '@null3d/engine';
import { random } from '../../lib/procedural';
import { TOWN, townShare, VILLAGES } from './island';
import { HOUSE_KINDS } from './kit';
import { FILL_SPOTS, KEEPS, LOTS, type Lot, ROADS, SQUARE, TREE_SPOTS } from './plan';
import { LANE } from './routes';
import { MOORINGS, parkPlans, squareFloor } from './town';

/** The birds that fly unless the page asks for another count. */
export const BIRD_COUNT = 50;
/** The town's lamps' share, from 0 by day to 1 at night, at which the flock roosts. */
export const ROOST_LAMPS = 0.5;
/** The nearest that two perches stand, and the nearest that a perch stands to a tree spot, in meters. */
export const PERCH_GAP = 6;
export const PERCH_TREE_CLEAR = 6;
/** The birds that one house roof may offer, and the roofs that the plan's lots are sampled for. */
const BIRD_ROOFS = 120;
/**
 * The camera distance inside which the perched birds scatter, the seconds between the camera's
 * arrival and their launch, and how many of the nearest birds go.
 */
export const STARTLE_RANGE = 6;
export const STARTLE_FUSE = 0.2;
export const STARTLE_BIRDS = 3;
/**
 * The distance at which a bird draws at its own size, and the most that distance grows it. A crow is
 * about half a meter long and a meter across the wings, which two hundred meters away is three
 * pixels: it would read as a speck, so the drawn bird grows with the distance and holds about
 * fifteen pixels at any range the route shows the island from, while a bird close up keeps its own
 * size.
 */
const BIRD_SIZE_FROM = 35;
const BIRD_SIZE_MOST = 6;
/** The drawn size of a bird seen from `distance` meters. */
const birdSize = (distance: number): number =>
	Math.min(BIRD_SIZE_MOST, Math.max(1, distance / BIRD_SIZE_FROM));
/** The seconds that a perch visit lasts, at least and at most, and the same for a flight. */
const PERCH_SECONDS = [6, 40] as const;
const FLIGHT_SECONDS = [3, 10] as const;
/** The height above the higher perch that a flight crosses the island at, at least and at most. */
const CRUISE_HEIGHT = [5, 25] as const;

/** A place where a crow may stand: its point in the world and the way it faces, in radians about +y. */
export interface Perch {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly yaw: number;
}

/** What the flock needs to know of the world each frame. */
export interface FlockWorld {
	/** True while the town's lamps are lit: nothing leaves its perch, and a flight in the air lands. */
	readonly night: boolean;
	/** The camera's place, for the startle; left out for no startle at all. */
	readonly camera?: readonly [number, number, number];
}

/** One crow, as the flock holds it and as the drawing reads it. */
export interface Crow {
	/** The perch it stands on, or the one it flies to. */
	perch: number;
	perched: boolean;
	x: number;
	y: number;
	z: number;
	yaw: number;
	pitch: number;
	roll: number;
	/** The wings' angle, from a glide's small lift to a beat's full rise. */
	wing: number;
	/** The seconds until this perched bird launches, or the flight's share, from 0 to 1, in the air. */
	timer: number;
}

/** The flock: its birds, and the step that moves them. */
export interface Flock {
	readonly birds: readonly Crow[];
	readonly perches: readonly Perch[];
	step(dt: number, world: FlockWorld): void;
}

/** A perch's y, and the angle a ridge faces along, from a roof build. */
function ridge(roof: { positions: number[] }): { x: number; y: number; z: number; yaw: number } {
	const { positions } = roof;
	let top = Number.NEGATIVE_INFINITY;
	for (let k = 1; k < positions.length; k += 3) top = Math.max(top, positions[k] as number);
	let [sx, sz, n] = [0, 0, 0];
	let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
	for (let k = 0; k < positions.length; k += 3) {
		const [x, y, z] = [
			positions[k] as number,
			positions[k + 1] as number,
			positions[k + 2] as number,
		];
		if (y < top - 0.06) continue;
		sx += x;
		sz += z;
		n++;
		minX = Math.min(minX, x);
		maxX = Math.max(maxX, x);
		minZ = Math.min(minZ, z);
		maxZ = Math.max(maxZ, z);
	}
	// The bird faces along the ridge, so a row of crows reads as a row and not as a fence of profiles.
	const yaw = maxX - minX >= maxZ - minZ ? Math.PI / 2 : 0;
	return { x: sx / n, y: top, z: sz / n, yaw };
}

/** Every house kind's roof ridge, in the house's own frame. */
const RIDGES = HOUSE_KINDS.map((kind) => ridge(kind.roof));

/** The turns that a house's own frame gives its roof ridge, and the ridge's point. */
function placedOnLot(
	lot: { x: number; y: number; z: number; yaw: number; kind: number },
	at: { x: number; y: number; z: number; yaw: number },
): Perch {
	const [c, s] = [Math.cos(lot.yaw), Math.sin(lot.yaw)];
	return {
		x: lot.x + at.x * c + at.z * s,
		y: lot.y + at.y,
		z: lot.z - at.x * s + at.z * c,
		yaw: lot.yaw + at.yaw,
	};
}

/** The settlements whose roofs the plan's lots are sampled for: the three hilltop villages and the town. */
const SETTLEMENTS = [...VILLAGES.map(([x, z, , radius]) => ({ x, z, radius })), TOWN];

/** A grid of tree spots, so a perch's clearance reads only the trees around it. */
function treeGrid() {
	const cell = PERCH_TREE_CLEAR;
	const grid = new Map<string, [number, number][]>();
	for (const tree of [...TREE_SPOTS, ...FILL_SPOTS]) {
		const key = `${Math.floor(tree.x / cell)},${Math.floor(tree.z / cell)}`;
		const list = grid.get(key);
		if (list) list.push([tree.x, tree.z]);
		else grid.set(key, [[tree.x, tree.z]]);
	}
	return (x: number, z: number): boolean => {
		const [i, j] = [Math.floor(x / cell), Math.floor(z / cell)];
		for (let a = -1; a <= 1; a++)
			for (let b = -1; b <= 1; b++)
				for (const [tx, tz] of grid.get(`${i + a},${j + b}`) ?? [])
					if ((tx - x) ** 2 + (tz - z) ** 2 < PERCH_TREE_CLEAR ** 2) return false;
		return true;
	};
}

/**
 * The island's perches: about a hundred and twenty house roof ridges, sampled so every settlement
 * has its own; the keeps' battlements and tower tops; the parks' gazebos, lookout walls and lamps;
 * the town's street lamps; the square's fountain rim; the harbour's breakwater and the bows of the
 * moored boats. Each stands at least six meters from the plan's trees and from every other perch.
 */
export function islandPerches(): Perch[] {
	const perches: Perch[] = [];
	const clearOfTrees = treeGrid();
	const add = (perch: Perch): boolean => {
		if (!clearOfTrees(perch.x, perch.z)) return false;
		for (const other of perches)
			if ((other.x - perch.x) ** 2 + (other.z - perch.z) ** 2 < PERCH_GAP ** 2) return false;
		perches.push(perch);
		return true;
	};
	// The lots, grouped by the settlement they stand in, so a sample of each fills the villages in turn.
	const groups: Lot[][] = SETTLEMENTS.map(() => []);
	for (const lot of LOTS) {
		let nearest = 0;
		let best = Infinity;
		SETTLEMENTS.forEach((place, k) => {
			const distance = (lot.x - place.x) ** 2 + (lot.z - place.z) ** 2;
			if (distance < best) {
				best = distance;
				nearest = k;
			}
		});
		groups[nearest]?.push(lot);
	}
	const next = random(19710);
	for (const group of groups) {
		for (let k = group.length - 1; k > 0; k--) {
			const j = Math.floor(next() * (k + 1));
			[group[k], group[j]] = [group[j] as Lot, group[k] as Lot];
		}
	}
	let taken = 0;
	for (let round = 0; taken < BIRD_ROOFS; round++) {
		let any = false;
		for (const group of groups) {
			const lot = group[round];
			if (!lot) continue;
			any = true;
			const at = RIDGES[lot.kind];
			if (!at) continue;
			if (add(placedOnLot(lot, at))) taken++;
			if (taken >= BIRD_ROOFS) break;
		}
		if (!any) break;
	}
	// The keeps: the battlements' corner merlons and the tower's top floor, from the keep's own form.
	for (const [kx, kz, ky] of KEEPS)
		for (const [ox, oz] of [
			[4, 5.1],
			[-4, 5.1],
			[4, -5.1],
			[-4, -5.1],
		] as const)
			add({ x: kx + ox, y: ky + 23.1, z: kz + oz, yaw: Math.atan2(-ox, -oz) });
	for (const [kx, kz, ky] of KEEPS) add({ x: kx, y: ky + 22.1, z: kz, yaw: 0 });
	// The parks: each gazebo's finial, a few places on its lookout wall, and its lamp heads.
	for (const plan of parkPlans()) {
		add({ x: plan.gazebo.x, y: plan.gazebo.y + 7.3, z: plan.gazebo.z, yaw: 0.4 });
		for (const [k, stretch] of plan.wall.entries()) {
			if (k % 2 !== 0) continue;
			const { a, b } = stretch;
			add({
				x: (a.x + b.x) / 2,
				y: (a.y + b.y) / 2 + 0.75,
				z: (a.z + b.z) / 2,
				yaw: Math.atan2(b.x - a.x, b.z - a.z),
			});
		}
		for (const [k, lamp] of plan.lamps.entries())
			if (k % 3 === 0) add({ x: lamp.x, y: lamp.y + 4.2, z: lamp.z, yaw: 0 });
	}
	// The street lamps, as the town's own lamps stand: on the shoulder of every road through the town.
	for (const { points, half } of ROADS) {
		if (half < LANE) continue;
		for (let k = 14; k < points.length; k += 14) {
			const p = points[k];
			const q = points[k - 1];
			if (!p || !q || townShare(p.x, p.z) < 0.5 || Math.hypot(p.x - TOWN.x, p.z - TOWN.z) > 260)
				continue;
			const length = Math.hypot(p.x - q.x, p.z - q.z) || 1;
			add({
				x: p.x - ((p.z - q.z) / length) * (half + 0.5),
				y: p.y + 3.75,
				z: p.z + ((p.x - q.x) / length) * (half + 0.5),
				yaw: Math.atan2(p.x - q.x, p.z - q.z),
			});
		}
	}
	// The square's fountain: four places on the stone rim of its basin.
	const floor = squareFloor();
	for (let k = 0; k < 4; k++) {
		const a = (k / 4) * Math.PI * 2 + 0.6;
		add({
			x: SQUARE.x + Math.cos(a) * 5.4,
			y: floor.top + 1.05,
			z: SQUARE.z + Math.sin(a) * 5.4,
			yaw: a + Math.PI,
		});
	}
	// The breakwater's paved top, along its curve, and the bows of the moored boats.
	for (const t of [0.2, 0.42, 0.66, 0.88]) {
		const x = -250 + (-82 + 250) * t;
		const z = 392 + (424 - 392) * t + Math.sin(t * Math.PI) * 20;
		add({ x, y: 1.9, z, yaw: Math.atan2(168, 32) });
	}
	for (const [k, [bx, bz, yaw]] of MOORINGS.entries()) {
		if (k % 3 !== 1) continue;
		add({ x: bx + Math.sin(yaw) * 6, y: 1.5, z: bz + Math.cos(yaw) * 6, yaw: yaw + Math.PI });
	}
	return perches;
}

/** The share of a flight over which the bank samples the turn, a sixtieth of the flight's time. */
const TURN_STEP = 1 / 60;

/** A cubic's four control points, a point each. */
type Cubic = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
];

/** The cubic's point at `t`, and its velocity, written into the arrays. */
function flightPoint(
	[c0x, c0y, c0z, c1x, c1y, c1z, c2x, c2y, c2z, c3x, c3y, c3z]: Cubic,
	t: number,
	out: number[],
): void {
	const u = 1 - t;
	const [u2, u3, t2, t3] = [u * u, u * u * u, t * t, t * t * t];
	out[0] = u3 * c0x + 3 * u2 * t * c1x + 3 * u * t2 * c2x + t3 * c3x;
	out[1] = u3 * c0y + 3 * u2 * t * c1y + 3 * u * t2 * c2y + t3 * c3y;
	out[2] = u3 * c0z + 3 * u2 * t * c1z + 3 * u * t2 * c2z + t3 * c3z;
	out[3] = 3 * u2 * (c1x - c0x) + 6 * u * t * (c2x - c1x) + 3 * t2 * (c3x - c2x);
	out[4] = 3 * u2 * (c1y - c0y) + 6 * u * t * (c2y - c1y) + 3 * t2 * (c3y - c2y);
	out[5] = 3 * u2 * (c1z - c0z) + 6 * u * t * (c2z - c1z) + 3 * t2 * (c3z - c2z);
}

/** A flight: its four control points, its duration and where it lands. */
interface Flight {
	readonly path: Cubic;
	readonly seconds: number;
	readonly to: number;
	beat: number;
	readonly beatRate: number;
}

/**
 * Makes the flock that stands on `perches`. Each bird starts on a perch of its own and moves on its
 * own clock; `step` runs the flock by one frame's time.
 */
export function createFlock(perches: readonly Perch[], count = BIRD_COUNT, seed = 7349): Flock {
	if (perches.length === 0) return { birds: [], perches, step() {} };
	const next = random(seed);
	const birds: Crow[] = [];
	/** The bird that holds each perch, as its index plus one, or 0 for a free perch. */
	const claimed = new Int32Array(perches.length);
	const flights = new Map<number, Flight>();
	const seconds = (span: readonly [number, number]) => span[0] + next() * (span[1] - span[0]);
	const claim = (perch: number, bird: number): void => {
		claimed[perch] = bird + 1;
	};
	const free = (not: number): number => {
		const start = Math.floor(next() * perches.length);
		for (let k = 0; k < perches.length; k++) {
			const at = (start + k) % perches.length;
			if (at !== not && claimed[at] === 0) return at;
		}
		return -1;
	};
	birds.length = 0;
	// The perches are shuffled, so a flock smaller than the list stands on every kind of perch: roofs,
	// keeps, lamps, the fountain, the breakwater and the boats. The rest stay free to fly to.
	const order = perches.map((_, k) => k);
	for (let k = order.length - 1; k > 0; k--) {
		const j = Math.floor(next() * (k + 1));
		[order[k], order[j]] = [order[j] as number, order[k] as number];
	}
	for (let k = 0; k < Math.min(count, perches.length); k++) {
		const perch = order[k] as number;
		const at = perches[perch] as Perch;
		claim(perch, k);
		birds.push({
			perch,
			perched: true,
			x: at.x,
			y: at.y,
			z: at.z,
			yaw: at.yaw,
			pitch: 0,
			roll: 0,
			wing: 0.1,
			timer: seconds(PERCH_SECONDS),
		});
	}
	/** Lifts a bird from its perch: it gives the perch up and takes the one it flies to. */
	const launch = (bird: Crow, index: number): void => {
		const target = free(bird.perch);
		if (target < 0) {
			bird.timer = seconds(PERCH_SECONDS);
			return;
		}
		const from = perches[bird.perch] as Perch;
		const to = perches[target] as Perch;
		claimed[bird.perch] = 0;
		claim(target, index);
		bird.perch = target;
		bird.perched = false;
		bird.timer = 0;
		const [dx, dz] = [to.x - from.x, to.z - from.z];
		const span = Math.hypot(dx, dz) || 1;
		const bow = (next() * 2 - 1) * (8 + next() * 16);
		const cruise = Math.max(from.y, to.y) + seconds(CRUISE_HEIGHT);
		// The cubic's middle sits at the cruise height when both inner points share it.
		const inner = (8 * cruise - from.y - to.y) / 6;
		const [px, pz] = [-dz / span, dx / span];
		flights.set(index, {
			path: [
				from.x,
				from.y + 0.05,
				from.z,
				from.x + px * bow * 0.4,
				inner,
				from.z + pz * bow * 0.4,
				to.x + px * bow * 0.7,
				inner,
				to.z + pz * bow * 0.7,
				to.x,
				to.y + 0.05,
				to.z,
			],
			seconds: seconds(FLIGHT_SECONDS),
			to: target,
			beat: next() * 12,
			beatRate: 5 + next() * 2,
		});
	};
	const point = [0, 0, 0, 0, 0, 0];
	const step = (dt: number, world: FlockWorld): void => {
		// The startle: the nearest perched birds inside the camera's range light their fuse, once.
		if (!world.night && world.camera) {
			const [cx, cy, cz] = world.camera;
			const near: { bird: number; distance: number }[] = [];
			for (const [k, bird] of birds.entries())
				if (bird.perched) {
					const distance = Math.hypot(bird.x - cx, bird.y - cy, bird.z - cz);
					if (distance <= STARTLE_RANGE) near.push({ bird: k, distance });
				}
			near.sort((a, b) => a.distance - b.distance);
			for (const { bird } of near.slice(0, STARTLE_BIRDS)) {
				const crow = birds[bird] as Crow;
				if (crow.timer > 0) crow.timer = -STARTLE_FUSE;
			}
		}
		for (const [k, bird] of birds.entries()) {
			if (bird.perched) {
				// A negative timer counts the startle's fuse down; at night no clock runs at all.
				if (bird.timer < 0) {
					if (world.night) continue;
					bird.timer += dt;
					if (bird.timer >= 0) launch(bird, k);
					continue;
				}
				if (world.night) continue;
				bird.timer -= dt;
				if (bird.timer <= 0) launch(bird, k);
				continue;
			}
			const flight = flights.get(k) as Flight;
			bird.timer += dt / flight.seconds;
			const t = Math.min(1, bird.timer);
			flightPoint(flight.path, t, point);
			bird.x = point[0] as number;
			bird.y = point[1] as number;
			bird.z = point[2] as number;
			const [vx, vy, vz] = [point[3] as number, point[4] as number, point[5] as number];
			const across = Math.hypot(vx, vz) || 1;
			bird.yaw = Math.atan2(vx, vz);
			bird.pitch = Math.atan2(vy, across);
			// The bank follows the turn: the sideways change of the heading over a short step.
			flightPoint(flight.path, Math.min(1, t + TURN_STEP), point);
			const laterYaw = Math.atan2(point[3] as number, point[5] as number);
			let turn = laterYaw - bird.yaw;
			if (turn > Math.PI) turn -= Math.PI * 2;
			else if (turn < -Math.PI) turn += Math.PI * 2;
			bird.roll = Math.max(-0.6, Math.min(0.6, (-turn / TURN_STEP) * 0.12));
			// The wings beat in bursts and hold a glide between them.
			flight.beat += dt * flight.beatRate * Math.PI * 2;
			const beating = Math.floor(flight.beat / (Math.PI * 2)) % 4 < 3;
			bird.wing = beating ? 0.1 + Math.abs(Math.sin(flight.beat)) * 0.75 : 0.12;
			if (t >= 1) {
				const to = perches[flight.to] as Perch;
				bird.x = to.x;
				bird.y = to.y;
				bird.z = to.z;
				bird.yaw = to.yaw;
				bird.pitch = 0;
				bird.roll = 0;
				bird.wing = 0.1;
				bird.perched = true;
				bird.timer = seconds(PERCH_SECONDS);
				flights.delete(k);
			}
		}
	};
	return { birds, perches, step };
}

/** One face of the crow's form, with its color and its four corners. */
function face(
	positions: number[],
	colors: number[],
	indices: number[],
	corners: readonly (readonly [number, number, number])[],
	tone: number,
): void {
	const base = positions.length / 3;
	for (const [x, y, z] of corners) {
		positions.push(x, y, z);
		colors.push(tone, tone, tone * 1.1);
	}
	indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** The crow's body, head, beak and tail: about twenty triangles in one form. */
function crowBody(): MeshArrays {
	const positions: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	const box = (
		[x0, y0, z0]: readonly [number, number, number],
		[x1, y1, z1]: readonly [number, number, number],
		tone: number,
	) => {
		const p = (x: number, y: number, z: number) => [x, y, z] as const;
		const [a, b, c, d, e, f, g, h] = [
			p(x0, y0, z0),
			p(x1, y0, z0),
			p(x1, y1, z0),
			p(x0, y1, z0),
			p(x0, y0, z1),
			p(x1, y0, z1),
			p(x1, y1, z1),
			p(x0, y1, z1),
		];
		face(positions, colors, indices, [e, f, g, h], tone);
		face(positions, colors, indices, [b, a, d, c], tone);
		face(positions, colors, indices, [a, e, h, d], tone);
		face(positions, colors, indices, [f, b, c, g], tone);
		face(positions, colors, indices, [d, h, g, c], tone);
		face(positions, colors, indices, [a, b, f, e], tone);
	};
	// The body tapers toward the tail, and the head sits over its front, with a stub of a beak.
	box([-0.055, -0.05, -0.2], [0.055, 0.05, 0.14], 0.03);
	box([-0.035, 0.02, 0.12], [0.035, 0.09, 0.2], 0.028);
	face(
		positions,
		colors,
		indices,
		[
			[-0.012, 0.045, 0.2],
			[0.012, 0.045, 0.2],
			[0.012, 0.06, 0.27],
			[-0.012, 0.06, 0.27],
		],
		0.05,
	);
	// The tail is a flat plate that widens behind the body.
	face(
		positions,
		colors,
		indices,
		[
			[-0.045, 0.005, -0.2],
			[0.045, 0.005, -0.2],
			[0.1, 0.02, -0.38],
			[-0.1, 0.02, -0.38],
		],
		0.04,
	);
	return { positions, colors, indices, computeNormals: true, levels: false };
}

/** One wing's form, from its shoulder at the origin out to its tip, on the side `side`. */
function crowWing(side: 1 | -1): MeshArrays {
	const positions: number[] = [];
	const colors: number[] = [];
	const indices: number[] = [];
	const [root, mid] = [
		[0, 0.09],
		[0.2, 0.075],
	] as const;
	const at = (x: number, back: number, front: number, tone: number) =>
		face(
			positions,
			colors,
			indices,
			[
				[side * x, 0.01, -back],
				[side * x, 0.01, front],
				[side * x, 0.02, front],
				[side * x, 0.02, -back],
			],
			tone,
		);
	at(root[0], root[1], 0.07, 0.032);
	at(mid[0], mid[1], 0.04, 0.03);
	// The tip is a short point beyond the middle panel.
	face(
		positions,
		colors,
		indices,
		[
			[side * 0.2, 0.02, -0.075],
			[side * 0.2, 0.02, 0.075],
			[side * 0.36, 0.03, 0.05],
			[side * 0.36, 0.03, -0.02],
		],
		0.036,
	);
	return { positions, colors, indices, computeNormals: true, levels: false };
}

/** What the page gives the crows. */
export interface BirdOptions {
	/** How many birds fly. The default is `BIRD_COUNT`, and more birds than perches are left out. */
	readonly count?: number;
	/** True while the town's lamps are lit, so the flock roosts. The default is never. */
	readonly night?: () => boolean;
	/** The seed of the flock's clocks and flights. The default gives the same flock on every load. */
	readonly seed?: number;
}

/** The crows, and the call that moves them each frame. */
export interface Birds {
	/** True when the page asked for no birds, and the scene then draws and steps nothing. */
	readonly empty: boolean;
	update(): void;
}

/**
 * Stands the island's crows: their perches, their clocks, their three batches, and the call that
 * moves them. Call `update` once a frame, after the camera has moved.
 */
export function createBirds(ctx: SketchContext, camera: Camera, options: BirdOptions = {}): Birds {
	const count = options.count ?? BIRD_COUNT;
	if (!(count > 0)) return { empty: true, update() {} };
	const flock = createFlock(islandPerches(), count, options.seed);
	if (flock.birds.length === 0) return { empty: true, update() {} };
	const { scene, geometry, materials } = ctx;
	const material = materials.standard({
		vertexColors: true,
		roughness: 0.45,
		metalness: 0.15,
		// A wing is a thin plate, and the bird's underside shows as it banks.
		doubleSided: true,
	});
	const bodies = scene.createInstances(geometry.fromArrays(crowBody()), flock.birds.length, {
		material,
		dynamic: true,
		castShadows: false,
		receiveShadows: false,
	});
	const left = scene.createInstances(geometry.fromArrays(crowWing(-1)), flock.birds.length, {
		material,
		dynamic: true,
		castShadows: false,
		receiveShadows: false,
	});
	const right = scene.createInstances(geometry.fromArrays(crowWing(1)), flock.birds.length, {
		material,
		dynamic: true,
		castShadows: false,
		receiveShadows: false,
	});
	for (const batch of [bodies, left, right]) {
		for (let k = 0; k < flock.birds.length; k++) {
			batch.scales.set([1, 1, 1], k * 3);
			batch.positions.set([0, -1000, 0], k * 3);
		}
		batch.markDirty();
	}
	const bodyTurn = quat.create();
	const wingTurn = quat.create();
	const flapTurn = quat.create();
	const eye: [number, number, number] = [0, 0, 0];
	/** The camera's place, which the startle measures against and the drawn size follows. */
	const cameraAt = (): [number, number, number] => {
		camera.getPosition(eye);
		return [eye[0], eye[1], eye[2]];
	};
	/** One row's turn and size, from the bird's angles, the wing's beat and its distance. */
	const write = (
		batch: typeof bodies,
		row: number,
		crow: Crow,
		side: -1 | 0 | 1,
		size: number,
	): void => {
		quat.fromEuler(bodyTurn, crow.pitch, crow.yaw, crow.roll, 'YXZ');
		let [x, y, z] = [crow.x, crow.y, crow.z];
		if (side !== 0) {
			// The wing turns at its shoulder: the offset rides the body, and the flap rides the wing.
			const [ox, oy, oz] = [side * 0.05, 0.02, 0.02];
			const [c, s] = [Math.cos(crow.yaw), Math.sin(crow.yaw)];
			x += ox * c + oz * s;
			z += -ox * s + oz * c;
			y += oy;
			quat.set(flapTurn, 0, 0, Math.sin((side * crow.wing) / 2), Math.cos((side * crow.wing) / 2));
			quat.multiply(wingTurn, bodyTurn, flapTurn);
			batch.rotations.set(wingTurn, row * 4);
		} else batch.rotations.set(bodyTurn, row * 4);
		batch.positions.set([x, y, z], row * 3);
		batch.scales.set([size, size, size], row * 3);
	};
	return {
		empty: false,
		update() {
			const night = options.night?.() ?? false;
			const at = cameraAt();
			flock.step(ctx.time.dt, { night, camera: at });
			const [cx, cy, cz] = at;
			for (const [row, crow] of flock.birds.entries()) {
				const size = birdSize(Math.hypot(crow.x - cx, crow.y - cy, crow.z - cz));
				write(bodies, row, crow, 0, size);
				write(left, row, crow, -1, size);
				write(right, row, crow, 1, size);
			}
			bodies.markDirty();
			left.markDirty();
			right.markDirty();
		},
	};
}
