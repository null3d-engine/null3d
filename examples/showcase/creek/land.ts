// The creek's land: the flat top of a round cliff that stands in a sea of cloud. A creek crosses it
// from rim to rim, fed by a spring pool near the middle, and runs out both ways to a lip at each end,
// where it leaves over the edge. Behind the creek lies a band of raked gravel with moss islands in
// it, and behind that a hill rises to the terrace that the statue stands on. Moss covers the rest.
// Everything that stands on the ground asks this module for its height, so the stones, the water
// and the walls meet the ground where it is.
import { type MeshArrays, math, type SketchContext } from '@null3d/engine';
import { Noise, type TexelSample, terrain, terrainEdge, textureSet } from '../../lib/procedural';

/** The height of the water's surface. */
export const WATER = 0;
/**
 * The layer of what the camera draws and the water's reflection leaves out: the pebbles and the
 * floating leaves, which lie under or on the water's plane.
 */
export const UNREFLECTED_LAYER = 2;
/** The mean radius of the cliff's top, in meters. */
export const RIM = 26;
/** The height of the cloud sea's highest tops, in meters: about twelve meters under the rim. */
export const CLOUD_TOP = -10.5;
/**
 * How far past the rim the walls' crags and ledges can stand at the heights the camera reaches past
 * the rim, in meters, with a margin.
 */
export const WALL_REACH = 3;
/**
 * How far above the water's level the camera keeps past the rim, in meters. The water's view from
 * under its surface turns on from the camera's height alone, so past the rim, where no water lies,
 * the camera never sinks to the water's level; this also keeps it well above the cloud's tops.
 */
export const OVER_WATER = 0.5;
/**
 * Where the creek leaves the rim: the x of each lip, west and east. The rim runs straight across
 * the creek there, square to its line, so the water ends on one clean edge.
 */
export const LIPS = { west: -20.3, east: 20 } as const;
/**
 * A bay in the rim beside the west lip, on the side toward the opening view: its bearing, its depth
 * and its half width in radians. It keeps the near wall from hiding the west fall from the concept's
 * camera, so the fall shows in profile, as in the concept picture.
 */
const WEST_BAY = { bearing: (121 * Math.PI) / 180, depth: 2.5, width: 0.22 } as const;
/**
 * A headland of rock just past the west lip, as the concept picture has at its left fall's back: from
 * the opening view it stands behind the upper half of that fall, so the white water shows against
 * dark rock instead of mist. Its bearing, how far it reaches past the rim, and its half width in
 * radians.
 */
const HEADLAND = { bearing: (152 * Math.PI) / 180, reach: 3.5, width: 0.1 } as const;
/** How far the rim's straight edge at a lip reaches past the creek's banks, in meters. */
const LIP_MARGIN = 0.1;
/** The spring pool near the middle that feeds the creek: its x and how far along it widens. */
export const POOL = { x: -2, length: 2.8, widening: 1.2, depth: 0.45 } as const;
/**
 * The terrace that the statue stands on: its middle, the radius of its flat top, how far its slopes
 * reach, and its height over the water. A ridge runs down from it toward the creek, which the steps
 * climb.
 */
export const TERRACE = { x: 9, z: -16, top: 5.4, slope: 8, height: 4.6 } as const;
/** The ridge's foot near the creek's far bank, and its half width at the foot, in meters. */
const RIDGE = { x: 10.3, z: 9, half: 3.5 } as const;

const noise = new Noise(11);
const rimNoise = new Noise(13);
const { smoothstep } = math;

/** The angle from `a` to `b`, from -π to π. */
const turn = (a: number, b: number) => {
	const d = (b - a) % (2 * Math.PI);
	return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d;
};

/**
 * A smooth line through points in order of x: its z and its slope at any x, a cubic between each
 * pair whose slopes run from neighbour to neighbour, and straight on past the ends.
 */
function smoothLine(points: readonly (readonly [number, number])[]): {
	at(x: number): number;
	slope(x: number): number;
} {
	const n = points.length;
	const xs = points.map(([x]) => x);
	const zs = points.map(([, z]) => z);
	const tangents = points.map((_, k) => {
		const a = Math.max(0, k - 1);
		const b = Math.min(n - 1, k + 1);
		return ((zs[b] as number) - (zs[a] as number)) / ((xs[b] as number) - (xs[a] as number));
	});
	const piece = (x: number) => {
		let k = 0;
		while (k < n - 2 && x > (xs[k + 1] as number)) k++;
		const h = (xs[k + 1] as number) - (xs[k] as number);
		return { k, h, t: (x - (xs[k] as number)) / h };
	};
	return {
		at(x) {
			if (x <= (xs[0] as number))
				return (zs[0] as number) + (tangents[0] as number) * (x - (xs[0] as number));
			if (x >= (xs[n - 1] as number))
				return (zs[n - 1] as number) + (tangents[n - 1] as number) * (x - (xs[n - 1] as number));
			const { k, h, t } = piece(x);
			const [t2, t3] = [t * t, t * t * t];
			return (
				(2 * t3 - 3 * t2 + 1) * (zs[k] as number) +
				(t3 - 2 * t2 + t) * h * (tangents[k] as number) +
				(-2 * t3 + 3 * t2) * (zs[k + 1] as number) +
				(t3 - t2) * h * (tangents[k + 1] as number)
			);
		},
		slope(x) {
			if (x <= (xs[0] as number)) return tangents[0] as number;
			if (x >= (xs[n - 1] as number)) return tangents[n - 1] as number;
			const { k, h, t } = piece(x);
			const t2 = t * t;
			return (
				((6 * t2 - 6 * t) * (zs[k] as number)) / h +
				(3 * t2 - 4 * t + 1) * (tangents[k] as number) +
				((-6 * t2 + 6 * t) * (zs[k + 1] as number)) / h +
				(3 * t2 - 2 * t) * (tangents[k + 1] as number)
			);
		},
	};
}

/**
 * The creek's middle line: a gentle S from the west lip to the east lip, which passes in front of
 * the garden's middle, as the concept picture lays it. Near each lip it turns out toward the rim:
 * at the east lip along the rim's radius, and at the west lip a little toward the opening view, so
 * its fall drops past the cliff's edge as the concept picture's left fall does.
 */
const creekLine = smoothLine([
	[-20.3, 16],
	[-19.2, 14.45],
	[-15, 13.9],
	[-7, 13.4],
	[1, 13.8],
	[8, 14.4],
	[14, 14.6],
	[18.2, 15],
	[20, 16.4],
]);

/** The z of the creek's middle at x. */
export const streamZ = (x: number) => creekLine.at(x);

/** The slope across the creek of its middle line at x: how far the current turns from +x. */
export const streamSlope = (x: number) => creekLine.slope(x);

/** The pool's share of the creek at x, from 0 away from it to 1 at the spring. */
const poolShare = (x: number) => Math.exp(-(((x - POOL.x) / POOL.length) ** 2));

/** The half width of the water at x, at its surface: wider in the pool, and toward the east. */
export const streamHalf = (x: number) =>
	(2.72 +
		0.22 * Math.sin(x * 0.27 + 1.3) +
		0.3 * smoothstep(x, -4, 16) +
		POOL.widening * poolShare(x)) *
	(1 - lipNarrowing(x));

/**
 * How the creek narrows before each lip, between rock shoulders, as the concept's does where it
 * piles up white and drops: the share of its width it loses at the west lip and at the east, and
 * over how many meters. The west fall, seen in profile from the opening view, keeps more of its
 * width than the east one, which faces the camera.
 */
const LIP_NARROW = { west: 0.5, east: 0.58, from: 0.6, to: 4.5 } as const;

/** The share of the creek's width that it has lost at x, by its nearness to either lip. */
function lipNarrowing(x: number): number {
	const near = (reach: number) => 1 - smoothstep(reach, LIP_NARROW.from, LIP_NARROW.to);
	return LIP_NARROW.west * near(x - LIPS.west) + LIP_NARROW.east * near(LIPS.east - x);
}

/** How far a point lies from the creek's middle, in half widths: 1 at the water's edge. */
export const fromStream = (x: number, z: number) => Math.abs(z - streamZ(x)) / streamHalf(x);

/** How fast the current runs along the creek's middle line where it runs freely, in meters a second. */
export const FLOW = 0.5;

/**
 * The creek's depth under its middle line at x, in meters: a deeper pool at the spring, a steady
 * run each way, sills where the water quickens, and a shallow lip at each end.
 */
export function channelDepth(x: number): number {
	const sills =
		0.3 * Math.exp(-(((x + 11.5) / 1.1) ** 2)) + 0.28 * Math.exp(-(((x - 15.5) / 1) ** 2));
	const lip =
		0.5 * smoothstep(x, LIPS.east - 3, LIPS.east) +
		0.5 * smoothstep(-x, -LIPS.west - 3, -LIPS.west);
	return 0.62 + POOL.depth * poolShare(x) - sills - lip;
}

/** The depth of the creek's water at a point, in meters: its middle's depth, shoaling to the banks. */
export const streamDepth = (x: number, z: number) =>
	channelDepth(x) * (1 - smoothstep(fromStream(x, z), 0.72, 1.32));

/**
 * The creek's current at a point, as a velocity in meters a second along its middle line. It runs
 * out of the pool both ways: still at the spring, gathering speed away from it, and quicker over
 * the sills and toward each lip, where the water is shallow.
 */
export function streamCurrent(x: number, _z = 0): readonly [number, number] {
	const away = x - POOL.x;
	const speed =
		Math.sign(away) *
		FLOW *
		smoothstep(Math.abs(away), 0, POOL.length * 2.2) *
		Math.min(2.4, 0.62 / Math.max(0.2, channelDepth(x)));
	const length = Math.hypot(1, streamSlope(x));
	return [speed / length, (speed * streamSlope(x)) / length];
}

/**
 * The radius of the rim at a bearing, in meters: a rounded outline with scallops, promontories and
 * notches, which runs straight across the creek at each lip. The bearing turns from +x toward +z.
 */
export function rimRadius(bearing: number): number {
	const c = Math.cos(bearing);
	const s = Math.sin(bearing);
	let r =
		RIM * (1 + 0.05 * rimNoise.fbm2(c * 1.2 + 4, s * 1.2 + 4, 2)) +
		0.9 * rimNoise.value2(c * 4 + 9, s * 4 + 9) +
		0.35 * rimNoise.value2(c * 11 + 2, s * 11 + 2) -
		WEST_BAY.depth * Math.exp(-((turn(WEST_BAY.bearing, bearing) / WEST_BAY.width) ** 2)) +
		HEADLAND.reach * Math.exp(-((turn(HEADLAND.bearing, bearing) / HEADLAND.width) ** 2));
	for (const x of [LIPS.west, LIPS.east]) {
		// The lip's edge: the line through the creek's middle at the lip, square to its course.
		const z = streamZ(x);
		const along = Math.hypot(1, streamSlope(x));
		const [nx, nz] = [1 / along, streamSlope(x) / along];
		const facing = c * nx + s * nz;
		const reach = (x * nx + z * nz) / facing;
		const width = (streamHalf(x) + LIP_MARGIN) / Math.abs(x);
		const share = 1 - smoothstep(Math.abs(turn(Math.atan2(z, x), bearing)), width, width + 0.05);
		if (share > 0 && reach > 0) r += (reach - r) * share;
	}
	return r;
}

/** The band of raked gravel behind the creek: where it starts and ends along x, and its height. */
export const GRAVEL = { from: -15, to: 8, height: 0.62 } as const;

/** The gravel band's middle line: an S from behind the west bank to the foot of the hill. */
const gravelLine = smoothLine([
	[-15, 3.2],
	[-7.5, 5.8],
	[-1, 6.6],
	[4, 5.4],
	[8, 6.2],
]);

/** The gravel band's half width at x: broadest in its middle. */
const gravelHalf = (x: number) =>
	2.2 + 0.7 * Math.sin(((x - GRAVEL.from) / (GRAVEL.to - GRAVEL.from)) * Math.PI);

/**
 * The moss islands that rise out of the gravel, and the stones that stand in it, each a circle on
 * the ground: its middle, its radius and, for an island, its height. The raked lines ring them.
 */
export const ISLANDS: readonly { x: number; z: number; r: number; h: number }[] = [
	{ x: -8.7, z: 3.3, r: 1.9, h: 0.5 },
	{ x: -12.4, z: 4.7, r: 0.8, h: 0.25 },
	{ x: -3.4, z: 7.8, r: 1.0, h: 0.3 },
	{ x: 1.9, z: 5.1, r: 1.3, h: 0.38 },
	{ x: 6.2, z: 7.3, r: 0.9, h: 0.28 },
];

/** A point's place in the gravel band: its signed distance across the band, and from its edge. */
export function gravelPlace(x: number, z: number): { across: number; edge: number } {
	const cx = Math.min(GRAVEL.to, Math.max(GRAVEL.from, x));
	const tilt = Math.hypot(1, gravelLine.slope(cx));
	const across = (z - gravelLine.at(cx)) / tilt;
	// Past either end the distance runs from the end's middle, which rounds the caps.
	const beyond = x - cx;
	const reach = Math.hypot(beyond, across);
	return { across, edge: reach - gravelHalf(cx) };
}

/** How far a point lies from the nearest island's rim, in meters: below zero inside one. */
export function islandDistance(x: number, z: number): number {
	let nearest = Number.POSITIVE_INFINITY;
	for (const island of ISLANDS)
		nearest = Math.min(nearest, Math.hypot(x - island.x, z - island.z) - island.r);
	return nearest;
}

/** A smooth maximum of two heights, which blends them over `k` meters where they meet. */
const smoothMax = (a: number, b: number, k: number) => {
	const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (a - b)) / k));
	return b + (a - b) * h + k * h * (1 - h);
};

/**
 * The hill that rises to the terrace, with rocky shoulders on its slopes, and the ridge that runs
 * down from it to the creek's far bank, which the steps climb.
 */
function hill(x: number, z: number): number {
	const rough = 0.6 * noise.fbm2(x * 0.35 + 21, z * 0.35, 3);
	const reach = Math.hypot(x - TERRACE.x, z - TERRACE.z);
	const fall = smoothstep(reach + rough, TERRACE.top, TERRACE.top + TERRACE.slope);
	const mound = 0.2 + (TERRACE.height - 0.2) * (1 - fall * fall * (3 - 2 * fall));
	// The ridge: its spine falls from the terrace's edge to its foot, and its sides fall away.
	const [ax, az] = [TERRACE.x, TERRACE.z + TERRACE.top];
	const [dx, dz] = [RIDGE.x - ax, RIDGE.z - az];
	const along = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
	const across = Math.hypot(x - (ax + dx * along), z - (az + dz * along));
	const spine = TERRACE.height - 0.3 - (TERRACE.height - 1.1) * along ** 0.85;
	const side = smoothstep(
		across + rough,
		RIDGE.half * (1.4 - 0.6 * along),
		RIDGE.half * (3.2 - 1.4 * along),
	);
	const ridge = 0.2 + (spine - 0.2) * (1 - side);
	return Math.max(mound, ridge);
}

/** The height of the dry land at a point, before the creek's channel cuts it. */
/**
 * The level landing on the ridge where the gate stands with a lantern on each side, between the
 * lower and upper flights of steps: its middle, its level radius, wide enough for both lanterns'
 * feet, and the meters over which it blends into the slope.
 */
export const LANDING = { x: 11.2, z: 2.5, radius: 5, blend: 1.8 } as const;
/** The landing's height: the slope's own height at its middle, found once. */
let landingHeight: number | undefined;

/**
 * The flights of steps from the creek's far bank up to the statue, about 30 steps as the concept
 * picture has them: a lower flight on a diagonal from the bank to the gate's front; behind the gate a
 * few steps that turn the route; and two flights straight down from the statue, the top one cut
 * into the rock ledge under it, with a short level rest between them, which leave the statue along its own facing, off the gate's line, so the route
 * bends back to the gate. The lower flight's foot on the bank; the steps' half width; how far the
 * steps run from the landing's middle to the gate's front and to its back; how far the statue's
 * flights reach from its middle before the turn; the steps in each flight, from the bottom; the
 * rest's length; and how far the ground beside the steps keeps their level before it blends back
 * into the slope, in meters.
 */
export const STAIRS = {
	foot: [9.4, 10.6],
	half: 1,
	gate: 3.24,
	reach: 13.4,
	steps: [11, 3, 7, 9],
	rest: 1.2,
	keep: 0.5,
	blend: 1.4,
} as const;

/**
 * The turn of the statue's facing to its own right from the line down the ridge to the gate, in
 * radians: it faces the camera from about 20 degrees off its line, as the concept's does, and its
 * flights leave it along that facing.
 */
export const STATUE_TURN = (15 * Math.PI) / 180;

/**
 * The ledge of rock under the statue's slab: its half length across the statue and half width along
 * its facing, in meters, a little past the slab's own; how far its flat top stands over the terrace;
 * how far its foot reaches below the lowest ground under it; how much its outline wanders, as a
 * share; how many points its outline has; and how far into it the top flight's last steps cut.
 */
export const LEDGE = {
	long: 4.5,
	wide: 3,
	rise: 0.4,
	foot: 0.35,
	rough: 0.06,
	points: 48,
	cut: 0.15,
} as const;

let ledgeLevel: number | undefined;

/** The height of the ledge's flat top: the terrace's own height and the ledge's rise. */
export function ledgeTop(): number {
	ledgeLevel ??= slopeHeight(TERRACE.x, TERRACE.z) + LEDGE.rise;
	return ledgeLevel;
}

/** The statue's facing, as a turn about y from +z: down its flights, off the gate's line. */
export const statueYaw = () =>
	Math.atan2(LANDING.x - TERRACE.x, LANDING.z - TERRACE.z) - STATUE_TURN;

/** One flight of steps: where it starts and ends on the ground, its height at each end and its steps. */
export interface Flight {
	readonly from: readonly [number, number];
	readonly to: readonly [number, number];
	readonly low: number;
	readonly high: number;
	readonly steps: number;
}

let flightList: readonly Flight[] | undefined;

/**
 * The four flights, found once: their ends from the landing, the gate's line and the statue's
 * facing, their heights from the slope and an even rise.
 */
export function flights(): readonly Flight[] {
	if (flightList) return flightList;
	const length = Math.hypot(LANDING.x - TERRACE.x, LANDING.z - TERRACE.z);
	// The gate's line, from the landing's middle up the ridge toward the statue.
	const [ax, az] = [(TERRACE.x - LANDING.x) / length, (TERRACE.z - LANDING.z) / length];
	const front: [number, number] = [LANDING.x - ax * STAIRS.gate, LANDING.z - az * STAIRS.gate];
	const back: [number, number] = [LANDING.x + ax * STAIRS.gate, LANDING.z + az * STAIRS.gate];
	// The statue's flights, along its facing from its middle out to the turn.
	const yaw = statueYaw();
	const [fx, fz] = [Math.sin(yaw), Math.cos(yaw)];
	const down = (d: number): [number, number] => [TERRACE.x + fx * d, TERRACE.z + fz * d];
	// The top flight climbs past the terrace's edge and cuts into the ledge's front, up to its top.
	const head = LEDGE.wide - LEDGE.cut;
	const middle = (STAIRS.reach + head) / 2;
	landingHeight ??= slopeHeight(LANDING.x, LANDING.z);
	const top = ledgeTop();
	const [lower, turn, first, second] = STAIRS.steps;
	const rise = (top - landingHeight) / (turn + first + second);
	const turned = landingHeight + rise * turn;
	const rest = turned + rise * first;
	flightList = [
		{
			from: STAIRS.foot,
			to: front,
			low: slopeHeight(STAIRS.foot[0], STAIRS.foot[1]),
			high: landingHeight,
			steps: lower,
		},
		{ from: back, to: down(STAIRS.reach), low: landingHeight, high: turned, steps: turn },
		{
			from: down(STAIRS.reach),
			to: down(middle + STAIRS.rest / 2),
			low: turned,
			high: rest,
			steps: first,
		},
		{ from: down(middle - STAIRS.rest / 2), to: down(head), low: rest, high: top, steps: second },
	];
	return flightList;
}

/** How far a point lies in the band of bright moss beside a flight of steps, from 0 to 1. */
function stairBand(x: number, z: number): number {
	let band = 0;
	for (const flight of flights()) {
		const { t, side } = alongFlight(flight, x, z);
		if (t < -0.03 || t > 1.03) continue;
		const inside = smoothstep(side, STAIRS.half - 0.1, STAIRS.half + 0.05);
		const outside =
			1 - smoothstep(side, STAIRS.half + STAIRS.keep - 0.1, STAIRS.half + STAIRS.keep + 0.15);
		band = Math.max(band, inside * outside);
	}
	return band;
}

/** How far along a flight a point lies, from 0 at its foot to 1 at its head, and how far to its side. */
export function alongFlight(flight: Flight, x: number, z: number): { t: number; side: number } {
	const [dx, dz] = [flight.to[0] - flight.from[0], flight.to[1] - flight.from[1]];
	const length = Math.hypot(dx, dz);
	const [px, pz] = [x - flight.from[0], z - flight.from[1]];
	return { t: (px * dx + pz * dz) / (length * length), side: Math.abs(px * dz - pz * dx) / length };
}

/** The height of the land, apart from the creek's channel, with the landing and the flights laid. */
function landHeight(x: number, z: number): number {
	let height = slopeHeight(x, z);
	const level =
		1 -
		smoothstep(
			Math.hypot(x - LANDING.x, z - LANDING.z),
			LANDING.radius,
			LANDING.radius + LANDING.blend,
		);
	if (level > 0) {
		landingHeight ??= slopeHeight(LANDING.x, LANDING.z);
		height += (landingHeight - height) * level;
	}
	// Under each flight the ground runs as an even ramp from its foot to its head, which the steps
	// sit on, and it blends back into the slope beside it and past its ends. Where two flights meet
	// at a turn, each holds the ground beside it, so every tread stays above its ground and every
	// slab's body below it.
	let ramp: { height: number; share: number; beside: boolean; side: number } | undefined;
	for (const flight of flights()) {
		const { t, side } = alongFlight(flight, x, z);
		const length = Math.hypot(flight.to[0] - flight.from[0], flight.to[1] - flight.from[1]);
		const past = Math.max(-t, t - 1, 0) * length;
		const keep = STAIRS.half + STAIRS.keep;
		const share =
			(1 - smoothstep(side, keep, keep + STAIRS.blend)) * (1 - smoothstep(past, 0, STAIRS.blend));
		if (share <= 0) continue;
		const level = flight.low + (flight.high - flight.low) * Math.min(Math.max(t, 0), 1);
		// A flight that the point lies beside holds it over one that the point lies past, and of two
		// that it lies beside, the one whose line it lies nearer.
		const beside = t >= 0 && t <= 1;
		const better =
			!ramp ||
			(beside && !ramp.beside) ||
			(beside === ramp.beside && (beside ? side < ramp.side : share > ramp.share));
		if (better) ramp = { height: level, share, beside, side };
	}
	if (ramp) height += (ramp.height - height) * ramp.share;
	return height;
}

/** The height of the land, apart from the creek's channel and the landing. */
function slopeHeight(x: number, z: number): number {
	const d = fromStream(x, z);
	const across = Math.abs(z - streamZ(x));
	const rolling = 0.22 * noise.fbm2(x * 0.16 + 3, z * 0.16, 4) * smoothstep(d, 1.4, 3);
	const mounds =
		0.75 * Math.max(0, noise.fbm2(x * 0.09 + 7, z * 0.09, 3)) * smoothstep(across, 4, 8);
	const back = 0.7 * smoothstep(-z, -8, 16);
	let top = 0.48 + 0.42 * smoothstep(d, 1.1, 2.6) + rolling + mounds + back;
	top = smoothMax(top, hill(x, z), 1.2);
	// The gravel lies level, with the moss islands rising out of it as smooth mounds.
	const { edge } = gravelPlace(x, z);
	const gravel = 1 - smoothstep(edge, -0.2, 1.2);
	let level = GRAVEL.height;
	for (const island of ISLANDS) {
		const t =
			1 - smoothstep(Math.hypot(x - island.x, z - island.z), island.r * 0.2, island.r + 0.3);
		level += island.h * t * t * (3 - 2 * t);
	}
	return top + (level - top) * gravel;
}

/** The height of the ground at a point, on the cliff's top. */
export function groundHeight(x: number, z: number): number {
	const d = fromStream(x, z);
	const cobbles = 0.07 * noise.fbm2(x * 0.9, z * 0.9, 3);
	const bed = -channelDepth(x) + cobbles;
	const top = landHeight(x, z);
	const ground = bed + (top - bed) * smoothstep(d, 0.72, 1.32);
	return ground + Math.max(0, lipSill(x, z) - ground);
}

/**
 * The broken rock along each lip's very edge: a sill whose height wanders across the water, so in
 * places it stands out of the water and in others the water runs over it. The water's end at the
 * lip then shows only in short pieces between rocks, as the concept picture's uneven rims do. The
 * sill's band in meters back from the edge, its height at the water's level and how far it wanders,
 * and how many rocks it has to the meter across.
 */
const LIP_SILL = { band: [0.3, 0.75], level: 0.02, wander: 0.5, rocks: 2.2 } as const;

/** The sill's height at a point, or far below the ground away from the lips. */
function lipSill(x: number, z: number): number {
	let height = -Infinity;
	for (const lip of [LIPS.west, LIPS.east]) {
		const along = Math.hypot(1, streamSlope(lip));
		const [nx, nz] = [Math.sign(lip) / along, (Math.sign(lip) * streamSlope(lip)) / along];
		const [dx, dz] = [x - lip, z - streamZ(lip)];
		// How far back from the lip's line the point lies, and how far across the creek.
		const back = -(dx * nx + dz * nz);
		const across = dx * nz - dz * nx;
		if (back < 0 || back > LIP_SILL.band[1] || Math.abs(across) > streamHalf(lip) * 1.1) continue;
		const share = 1 - smoothstep(back, LIP_SILL.band[0], LIP_SILL.band[1]);
		const jag = noise.fbm2(across * LIP_SILL.rocks + lip, back * 3 + lip * 0.37, 2);
		height = Math.max(height, LIP_SILL.level + LIP_SILL.wander * jag - (1 - share) * 0.6);
	}
	return height;
}

/** The bearing of a point about the cliff's middle, from +x toward +z. */
export const bearingOf = (x: number, z: number) => Math.atan2(z, x);

/** True for a point on the cliff's top, inside its rim. */
export const onTop = (x: number, z: number) => Math.hypot(x, z) < rimRadius(bearingOf(x, z));

/**
 * The lowest that the camera may stand at a point, before its clearance: the ground over the cliff,
 * which lets it dip under the creek down to the bed; and past the rim, above the water's level and
 * the ground close round the walls, so it never enters the rock and never sees the water's view
 * from under its surface where there is no water, high over the cloud's tops.
 */
export function cameraFloor(x: number, z: number): number {
	const reach = Math.hypot(x, z) - rimRadius(bearingOf(x, z));
	if (reach < 0) return groundHeight(x, z);
	const past = WATER + OVER_WATER;
	return reach < WALL_REACH ? Math.max(groundHeight(x, z), past) : past;
}

/** Linear colors of the ground: yellow-olive moss, its darker green and brown patches, soil and rock. */
const MOSS = [0.17, 0.135, 0.035];
const MOSS_DARK = [0.075, 0.075, 0.03];
const MOSS_BROWN = [0.12, 0.085, 0.035];
/** The bright olive moss in the band beside each flight of steps, between the slabs and the walls. */
const MOSS_BRIGHT = [0.2, 0.175, 0.036];
const BED = [0.42, 0.385, 0.315];
const MUD = [0.06, 0.05, 0.035];
const STONE = [0.075, 0.065, 0.052];

/** The ground's color at a point, from its height and its slope, with patches from noise. */
function groundColor(x: number, z: number, y: number, slope: number, out: number[]): void {
	const wet = 1 - smoothstep(y, WATER - 0.04, WATER + 0.16);
	const under = 1 - smoothstep(y, WATER - 0.25, WATER - 0.06);
	const dark = smoothstep(noise.fbm2(x * 0.11 + 9, z * 0.11, 3), 0.02, 0.32);
	const brown = smoothstep(noise.fbm2(x * 0.19, z * 0.19 + 9, 3), 0.12, 0.38);
	// The rim's very edge is wet dark rock, the lip's shoulders among it, so no pale band of bed or
	// mud runs along the cliff's edge.
	const edge = 1 - smoothstep(rimRadius(bearingOf(x, z)) - Math.hypot(x, z), 0.15, 0.8);
	const rocky = Math.max(smoothstep(slope, 0.85, 1.4), edge);
	const shade = 0.88 + 0.24 * noise.value2(x * 1.7, z * 1.7);
	const band = stairBand(x, z);
	// The bed's cobbles: pale stones with darker gaps and darker stones among them, which show
	// through the clear water.
	const cobble =
		0.72 +
		0.38 * smoothstep(noise.value2(x * 3.2 + 41, z * 3.2), -0.2, 0.25) -
		0.25 * smoothstep(noise.value2(x * 1.4 + 13, z * 1.4 + 5), 0.35, 0.6);
	for (let c = 0; c < 3; c++) {
		const moss = (MOSS[c] as number) + ((MOSS_DARK[c] as number) - (MOSS[c] as number)) * dark;
		const patchy = moss + ((MOSS_BROWN[c] as number) - moss) * brown * 0.7;
		const bright = patchy + ((MOSS_BRIGHT[c] as number) - patchy) * band;
		const shore = bright + ((MUD[c] as number) - bright) * wet;
		const ground = shore + ((BED[c] as number) * cobble - shore) * under;
		out[c] = (ground + ((STONE[c] as number) - ground) * rocky) * shade;
	}
}

/**
 * The texel of the ground's detail: a soft velvet of moss with fine grit, in a near-white tone,
 * which the ground's colors tint. It tiles over a period of whole noise cells.
 */
function groundTexel(u: number, v: number, out: TexelSample): void {
	const clumps = noise.fbm2(u * 16, v * 16, 5, 16);
	const grit = noise.fbm2(u * 48, v * 48, 2, 48);
	const stone = smoothstep(grit, 0.28, 0.48);
	out.height = clumps * 5 + stone * 1.5;
	const tone = 0.82 + 0.22 * clumps + 0.06 * stone;
	out.r = tone;
	out.g = tone * 0.98;
	out.b = tone * 0.93;
	out.roughness = 0.92 - 0.3 * stone;
	out.occlusion = 0.78 + 0.22 * smoothstep(clumps, -0.3, 0.2);
}

/** The meters that one repeat of the ground's detail covers. */
const TILE = 1.6;

/**
 * The raked lines of the gravel: the meters between two lines, how many closed rings run around
 * each island, and the texels of the map that steers them, one map over the band's box.
 */
const RAKE = { spacing: 0.17, rings: 9, texels: 512 } as const;
/** The box of the rake map on the ground: its corner and its size, in meters. */
const RAKE_BOX = { x: GRAVEL.from - 4, z: 4.5, size: GRAVEL.to - GRAVEL.from + 8 } as const;

/**
 * The map that steers the raked lines, over the gravel band's box: in red the distance from the
 * nearest island's rim, which the rings follow, in green the gravel's share of the ground, in blue
 * the distance across the band, which the long sweeps follow, and in alpha where the rings run.
 * Each phase is a smooth distance, so the map can be coarse and the shader draws the lines sharp.
 */
function rakeMap(textures: SketchContext['textures']) {
	const n = RAKE.texels;
	const data = new Float32Array(n * n * 4);
	const ringReach = RAKE.rings * RAKE.spacing;
	for (let j = 0; j < n; j++)
		for (let i = 0; i < n; i++) {
			const x = RAKE_BOX.x + ((i + 0.5) / n) * RAKE_BOX.size;
			// Rows run from the bottom up, toward -z.
			const z = RAKE_BOX.z + RAKE_BOX.size / 2 - ((j + 0.5) / n) * RAKE_BOX.size;
			const { across, edge } = gravelPlace(x, z);
			const ring = islandDistance(x, z);
			const k = (j * n + i) * 4;
			data[k] = Math.max(0, ring);
			data[k + 1] = (1 - smoothstep(edge, -0.03, 0.03)) * smoothstep(ring, -0.03, 0.03);
			data[k + 2] = across;
			data[k + 3] = ring < ringReach ? 1 : 0;
		}
	return textures.fromData({
		width: n,
		height: n,
		data,
		format: 'rgba16float',
		wrap: 'clamp',
	});
}

/**
 * The ground's surface: the detail maps tinted by the ground's colors, and the raked gravel where
 * the rake map lays it, with its lines lit as small ridges and grooves.
 */
const groundWgsl = /* wgsl */ `
struct Uniforms { gravel: vec3f, spacing: f32, box: vec4f, tile: f32 }

var detail: texture_2d<f32>;
var detailNormal: texture_2d<f32>;
var detailOrm: texture_2d<f32>;
var rake: texture_2d<f32>;

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let uv = input.worldPosition.xz / material.tile * vec2f(1.0, -1.0);
    let tint = textureSample(detail, detailSampler, uv).rgb;
    let orm = textureSample(detailOrm, detailOrmSampler, uv);
    let bump = textureSample(detailNormal, detailNormalSampler, uv).xyz * 2.0 - 1.0;
    let rakeUv = (input.worldPosition.xz - material.box.xy) / material.box.zw + vec2f(0.0, 0.5);
    let map = textureSample(rake, rakeSampler, vec2f(rakeUv.x, 1.0 - rakeUv.y));
    // The lines: rings round the islands, and sweeps along the band elsewhere.
    let phase = select(map.b, map.r, map.a > 0.5);
    let wave = cos(phase / material.spacing * 6.2831853);
    let slope = -sin(phase / material.spacing * 6.2831853) * 6.2831853 / material.spacing;
    // The phase's gradient on the ground, from its change across the pixel, gives the lines' tilt.
    let dp = vec2f(dpdx(phase), dpdy(phase));
    let dwx = dpdx(input.worldPosition.xz);
    let dwy = dpdy(input.worldPosition.xz);
    let det = dwx.x * dwy.y - dwx.y * dwy.x;
    let solved = select(vec2f(0.0), vec2f(dp.x * dwy.y - dp.y * dwx.y, dp.y * dwx.x - dp.x * dwy.x) / det, abs(det) > 1e-10);
    // Each phase is a distance, so its gradient is a unit; a jump between two phases is not.
    let grad = solved / max(1.0, length(solved));
    // Lines finer than a pixel fade, so the gravel never shimmers.
    let seen = 1.0 - smoothstep(0.3, 0.7, fwidth(phase) / material.spacing);
    let gravel = map.g;
    let n = normalize(input.normal);
    let tangent = normalize(vec3f(1.0, 0.0, 0.0) - n * n.x);
    let bitangent = cross(n, tangent);
    let detailed = normalize(tangent * bump.x + bitangent * bump.y + n * bump.z);
    let ridge = 0.02 * seen * gravel * slope;
    s.normal = normalize(detailed - vec3f(grad.x, 0.0, grad.y) * ridge);
    let groove = 1.0 - 0.2 * seen * (0.5 - 0.5 * wave);
    s.baseColor = mix(s.baseColor * tint, material.gravel * mix(1.0, tint.r, 0.5) * groove, gravel);
    s.roughness = mix(orm.g, 0.95, gravel);
    s.occlusion = orm.r;
    return s;
}
`;

/** The cliff's top: the vertices of its rim in order, which the walls hang from. */
export interface Land {
	/** The rim's vertices, x, y and z, in order up the bearings: where the walls hang from. */
	readonly rim: Float32Array;
}

/** The ground's arrays at a detail of `quads`, and its rim's vertices in order up the bearings. */
export function landArrays(quads: number): { arrays: MeshArrays; rim: Float32Array } {
	const arrays = terrain({
		size: RIM * 2,
		quads,
		tile: TILE,
		height: groundHeight,
		color: groundColor,
		outline: rimRadius,
	});
	const positions = arrays.positions as Float32Array;
	const edge = terrainEdge(quads);
	const rim = new Float32Array(edge.length * 3);
	edge.forEach((v, k) => {
		rim.set(positions.subarray(v * 3, v * 3 + 3), k * 3);
	});
	return { arrays, rim };
}

/** Makes the ground's mesh, whose detail grows with the preset, and its material. */
export function createLand(
	{ scene, geometry, materials, textures }: SketchContext,
	quads: number,
	textureSize: number,
): Land {
	const maps = textureSet(textures, textureSize, groundTexel);
	const { arrays, rim } = landArrays(quads);
	scene.createMesh({
		mesh: geometry.fromArrays(arrays),
		material: materials.shader({
			wgsl: groundWgsl,
			vertexColors: true,
			roughness: 1,
			uniforms: {
				gravel: [0.52, 0.42, 0.32],
				spacing: RAKE.spacing,
				box: [RAKE_BOX.x, RAKE_BOX.z, RAKE_BOX.size, RAKE_BOX.size],
				tile: TILE,
			},
			textures: {
				detail: maps.map,
				detailNormal: maps.normalMap,
				detailOrm: maps.metalnessRoughnessMap,
				rake: rakeMap(textures),
			},
		}),
		receiveShadows: true,
		castShadows: true,
	});
	return { rim };
}
