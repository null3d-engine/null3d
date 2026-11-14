// The flight of the hover car that the user drives in Skyway's Manual mode. W and S speed it up and
// slow it down, A and D turn it, and R and F climb and sink. It flies through the air between the
// towers: each tower is a box, and a car that flies into one slides along its face or lands on its
// roof. The streets, the city's edge and the sky's ceiling bound it too.
//
// The chase camera reads the same boxes. A tower that stands between the car and the camera pulls
// the camera in along the user's own view, easing the pull and the distance it heads for; a tower
// that no distance clears swings it round to a side, and the swing eases as the pull does. A turn
// that would put the camera in a tower is refused, so the camera stops at the last place it could
// stand instead of sliding along the face, and the turn returns once the way is clear.
//
// All of it is plain numbers, apart from the scene, so the unit test drives it frame by frame.
import { cityBuildings, HALF, PITCH } from './layout';

/** How the car flies: its speeds in meters per second, and how fast they change. */
export const FLIGHT = {
	/** The top speed forward and in reverse. */
	top: 60,
	reverse: 12,
	/** How fast W gains speed, how fast S sheds it, and how fast the car coasts to a stop. */
	accelerate: 16,
	brake: 34,
	coast: 7,
	/** How fast the car turns at speed, in radians per second, and the share it keeps when still. */
	turn: 1.15,
	hover: 0.4,
	/** The speed at which the car turns at its full rate. */
	turnSpeed: 20,
	/** How fast R and F climb and sink, and how quickly the climb follows the keys. */
	climb: 14,
	climbRate: 4,
} as const;

/** How far the car keeps from a tower's face and from its roof, in meters. */
export const CLEARANCE = 3;
/** The lowest and the highest the car flies, in meters above the street. */
export const FLOOR = 5;
export const CEILING = 260;
/** How far from the city's middle the car may go, along either street axis, in meters. */
export const EDGE = HALF + PITCH;

/** The car's flight now. `yaw` turns its nose from +Z towards +X. */
export interface Flight {
	x: number;
	y: number;
	z: number;
	yaw: number;
	/** The speed along the nose, negative in reverse. */
	speed: number;
	/** The speed upward. */
	climb: number;
	/** The rate of turn this frame, which banks the car. */
	turning: number;
}

/** The keys' wishes for one frame, each from -1 to 1. */
export interface Stick {
	/** Forward from W, back from S. */
	throttle: number;
	/** Left from A, right from D. */
	steer: number;
	/** Up from R, down from F. */
	lift: number;
}

/** The towers as boxes: five numbers each, its middle's x and z, its half sides and its height. */
export type Towers = Float32Array;

/**
 * The chase camera's place behind the car, as the user set it: the angle to either side of the
 * car's tail, the tilt and the distance. A turn must keep that place clear of the towers.
 */
export interface ChaseView {
	/** The user's angle off the car's tail, in radians. */
	turn: number;
	/** The camera's tilt above the car, in radians. */
	tilt: number;
	/** The camera's distance from the car, in meters. */
	distance: number;
}

/** The towers of the city plan, as the flight reads them. */
export function cityTowers(): Towers {
	const buildings = cityBuildings();
	const towers = new Float32Array(buildings.length * 5);
	buildings.forEach((building, k) => {
		towers.set(
			[building.x, building.z, building.width / 2, building.depth / 2, building.height],
			k * 5,
		);
	});
	return towers;
}

/** Moves `value` towards `goal` by at most `step`. */
const approach = (value: number, goal: number, step: number): number =>
	value < goal ? Math.min(goal, value + step) : Math.max(goal, value - step);

/**
 * True when the camera can stand at the user's own distance along `angle` without entering a
 * tower. Each tower's box is grown by `clearance`, as the camera's keep-out grows it, so a place
 * that this refuses is one the keep-out would move.
 */
function standable(
	atX: number,
	atY: number,
	atZ: number,
	angle: number,
	level: number,
	rise: number,
	distance: number,
	towers: Towers,
): boolean {
	const x = atX + Math.sin(angle) * level * distance;
	const y = atY + rise * distance;
	const z = atZ + Math.cos(angle) * level * distance;
	for (let k = 0; k < towers.length; k += 5) {
		if (y >= (towers[k + 4] as number) + CLEARANCE) continue;
		if (Math.abs(x - (towers[k] as number)) >= (towers[k + 2] as number) + CLEARANCE) continue;
		if (Math.abs(z - (towers[k + 1] as number)) >= (towers[k + 3] as number) + CLEARANCE) continue;
		return false;
	}
	return true;
}

/** True when the chase camera can stand behind a car at `yaw`, at the user's own view. */
function standsBehind(flight: Flight, yaw: number, view: ChaseView, towers: Towers): boolean {
	return standable(
		flight.x,
		flight.y,
		flight.z,
		yaw + Math.PI + view.turn,
		Math.cos(view.tilt),
		Math.sin(view.tilt),
		view.distance,
		towers,
	);
}

/**
 * Flies the car one frame of `dt` seconds on the keys' wishes, then keeps it out of the towers.
 * A turn that would put the chase camera in a tower is refused, so the car keeps its heading and
 * the camera stays behind it instead of being pushed along the face. `view` is the chase camera's
 * place that the turn must keep clear; without it, the car turns freely.
 */
export function fly(
	flight: Flight,
	stick: Stick,
	dt: number,
	towers: Towers,
	view?: ChaseView,
): void {
	// The throttle gains speed toward its top, a reverse wish brakes first, and no wish coasts.
	if (stick.throttle > 0) {
		const rate = flight.speed < 0 ? FLIGHT.brake : FLIGHT.accelerate;
		flight.speed = approach(flight.speed, FLIGHT.top, rate * stick.throttle * dt);
	} else if (stick.throttle < 0) {
		const rate = flight.speed > 0 ? FLIGHT.brake : FLIGHT.accelerate;
		flight.speed = approach(flight.speed, -FLIGHT.reverse, -rate * stick.throttle * dt);
	} else {
		flight.speed = approach(flight.speed, 0, FLIGHT.coast * dt);
	}
	// A hover car turns on the spot, slowly, and at its full rate once it has some speed. In reverse
	// the nose swings the other way, as a car's does.
	const grip =
		FLIGHT.hover + (1 - FLIGHT.hover) * Math.min(1, Math.abs(flight.speed) / FLIGHT.turnSpeed);
	flight.turning = stick.steer * FLIGHT.turn * grip * (flight.speed < 0 ? -1 : 1);
	const yaw = flight.yaw + flight.turning * dt;
	// The car keeps its heading while the turn would put the chase camera in a tower, and the bank
	// follows the turn that happened, so a refused turn banks nothing.
	if (view !== undefined && !standsBehind(flight, yaw, view, towers)) flight.turning = 0;
	else flight.yaw = yaw;
	flight.climb += (stick.lift * FLIGHT.climb - flight.climb) * Math.min(1, FLIGHT.climbRate * dt);
	flight.x += Math.sin(flight.yaw) * flight.speed * dt;
	flight.z += Math.cos(flight.yaw) * flight.speed * dt;
	flight.y += flight.climb * dt;
	keepOut(flight, towers);
}

/** The chase camera's place behind and above the car, how far ahead of the car it looks and the
 * lift of that look, all in meters. */
export const CHASE = { behind: 13, above: 4.4, ahead: 22, lift: 1.4 } as const;
/** The chase camera's tilt above the car, and its usual distance from it. */
export const CHASE_TILT = Math.atan2(CHASE.above, CHASE.behind);
export const CHASE_DISTANCE = Math.hypot(CHASE.behind, CHASE.above);

/** The least distance a pulled-in chase camera keeps from the point it looks at, in meters. */
const SIGHT_NEAREST = 2;
/** The nearest a pulled-in chase camera comes to the car, in meters, so the car cannot fill the
 * frame. The car is a little under five meters long, which keeps it under half the frame's width
 * from the side. */
export const SIGHT_MIN = 10;
/** How low above the car the camera sits when it has pulled all the way in, in meters. */
const SIGHT_LOW = 1.6;
/**
 * The distance at which the low pulled-in height gives way to the usual one, in meters. It sits
 * just past the standoff, so a pulled-in camera looks just past the car, and one at its usual
 * distance looks down the road as it always did.
 */
const SIGHT_CLOSE = SIGHT_MIN + 1;
/** The widest swing to either side of the car's tail that tries to find a clear view, in radians. */
const SIGHT_SWING = Math.PI / 2;
/** How far apart the swings sit, in radians. */
const SIGHT_STEP = Math.PI / 18;
/** How long the way must stay clear before the camera eases back out, in seconds. */
const SIGHT_DWELL = 0.25;
/** How fast the pull, the distance it heads for and the side swing ease, per second. Every
 * direction takes the same rate, so the camera leaves as smoothly as it arrived. */
const SIGHT_EASE = 4;
/** How near the eased values must come to their goals before they take them outright, so the
 * camera returns exactly to the user's distance and side. */
const SIGHT_SNAP = 1e-3;

/**
 * Where along a line the first tower that crosses it begins, as a share from 0 to 1, or 1 when no
 * tower crosses it. `dx`, `dy` and `dz` reach from the line's start to its end, and each box is
 * grown by `clearance`.
 */
function entryShare(
	fromX: number,
	fromY: number,
	fromZ: number,
	dx: number,
	dy: number,
	dz: number,
	towers: Towers,
	clearance: number,
): number {
	/** Where along the line the nearest box that crosses it starts, from 0 to 1. */
	let entry = 1;
	for (let k = 0; k < towers.length; k += 5) {
		const minX = (towers[k] as number) - (towers[k + 2] as number) - clearance;
		const maxX = (towers[k] as number) + (towers[k + 2] as number) + clearance;
		const minZ = (towers[k + 1] as number) - (towers[k + 3] as number) - clearance;
		const maxZ = (towers[k + 1] as number) + (towers[k + 3] as number) + clearance;
		const maxY = (towers[k + 4] as number) + clearance;
		// The segment against the box's three slabs. It enters where the last slab's near side
		// begins and leaves where the first far side ends, so it crosses only when near <= far.
		let near = 0;
		let far = 1;
		if (Math.abs(dx) < 1e-9) {
			if (fromX < minX || fromX > maxX) continue;
		} else {
			let t1 = (minX - fromX) / dx;
			let t2 = (maxX - fromX) / dx;
			if (t1 > t2) [t1, t2] = [t2, t1];
			near = Math.max(near, t1);
			far = Math.min(far, t2);
			if (near > far) continue;
		}
		// The box rises from the ground to its top.
		if (Math.abs(dy) < 1e-9) {
			if (fromY < -clearance || fromY > maxY) continue;
		} else {
			let t1 = (-clearance - fromY) / dy;
			let t2 = (maxY - fromY) / dy;
			if (t1 > t2) [t1, t2] = [t2, t1];
			near = Math.max(near, t1);
			far = Math.min(far, t2);
			if (near > far) continue;
		}
		if (Math.abs(dz) < 1e-9) {
			if (fromZ < minZ || fromZ > maxZ) continue;
		} else {
			let t1 = (minZ - fromZ) / dz;
			let t2 = (maxZ - fromZ) / dz;
			if (t1 > t2) [t1, t2] = [t2, t1];
			near = Math.max(near, t1);
			far = Math.min(far, t2);
			if (near > far) continue;
		}
		// The point is outside the box, so an entry ahead of it is a tower in the way.
		if (near > 0 && near < entry) entry = near;
	}
	return entry;
}

/**
 * How far along a ray the first tower that crosses it begins, in meters, up to `reach`: `reach`
 * when the way is clear. The ray starts at (fromX, fromY, fromZ) and runs along the unit direction
 * (dirX, dirY, dirZ), and each box is grown by `clearance`.
 */
function entryDistance(
	fromX: number,
	fromY: number,
	fromZ: number,
	dirX: number,
	dirY: number,
	dirZ: number,
	reach: number,
	towers: Towers,
	clearance: number,
): number {
	if (reach <= 0) return reach;
	return (
		entryShare(fromX, fromY, fromZ, dirX * reach, dirY * reach, dirZ * reach, towers, clearance) *
		reach
	);
}

/**
 * Moves `flight` to the nearest place before a tower that stands between it and the point
 * (fromX, fromY, fromZ), so the tower cannot hide that point. `towers` holds the boxes that
 * `keepOut` reads. Each box is grown by `clearance`, so the camera stops that far before a wall,
 * and it keeps at least two meters from the point so the near plane never clips a body there.
 * Returns true when a tower stood in the way and the place moved.
 */
export function clearSight(
	fromX: number,
	fromY: number,
	fromZ: number,
	flight: Flight,
	towers: Towers,
	clearance: number,
): boolean {
	const dx = flight.x - fromX;
	const dy = flight.y - fromY;
	const dz = flight.z - fromZ;
	const length = Math.hypot(dx, dy, dz);
	if (length <= SIGHT_NEAREST) return false;
	const entry = entryShare(fromX, fromY, fromZ, dx, dy, dz, towers, clearance);
	if (entry >= 1) return false;
	const t = Math.max(entry, SIGHT_NEAREST / length);
	// The camera keeps its height as it pulls in, so it looks down at the point from above a car's
	// roof rather than entering the car's own body. Its new place is in front of the box across,
	// where the line to the point stays out of it.
	flight.x = fromX + dx * t;
	flight.z = fromZ + dz * t;
	return true;
}

/**
 * Keeps the car out of every tower, above the street, under the ceiling and inside the city. A car
 * inside a tower's box, widened by the clearance, leaves by the nearest face: a wall stops the
 * speed that ran into it, and a roof lands it. Returns true when a tower or a bound moved it.
 */
export function keepOut(flight: Flight, towers: Towers): boolean {
	let moved = false;
	for (let k = 0; k < towers.length; k += 5) {
		const top = (towers[k + 4] as number) + CLEARANCE;
		if (flight.y >= top) continue;
		const dx = flight.x - (towers[k] as number);
		const dz = flight.z - (towers[k + 1] as number);
		const reachX = (towers[k + 2] as number) + CLEARANCE;
		const reachZ = (towers[k + 3] as number) + CLEARANCE;
		if (Math.abs(dx) >= reachX || Math.abs(dz) >= reachZ) continue;
		const outX = reachX - Math.abs(dx);
		const outZ = reachZ - Math.abs(dz);
		const outY = top - flight.y;
		moved = true;
		if (outY <= outX && outY <= outZ) {
			flight.y = top;
			flight.climb = Math.max(0, flight.climb);
		} else if (outX <= outZ) {
			flight.x += Math.sign(dx || 1) * outX;
			flight.speed *= Math.abs(Math.cos(flight.yaw));
		} else {
			flight.z += Math.sign(dz || 1) * outZ;
			flight.speed *= Math.abs(Math.sin(flight.yaw));
		}
	}
	const y = Math.min(CEILING, Math.max(FLOOR, flight.y));
	const x = Math.min(EDGE, Math.max(-EDGE, flight.x));
	const z = Math.min(EDGE, Math.max(-EDGE, flight.z));
	if (y !== flight.y || x !== flight.x || z !== flight.z) {
		if (y !== flight.y) flight.climb = 0;
		flight.x = x;
		flight.y = y;
		flight.z = z;
		moved = true;
	}
	return moved;
}

/** What the chase camera remembers from one frame to the next while it works to see the car. */
export interface Sight {
	/** How far the camera has eased from the user's distance toward the nearest clear one, 0 to 1. */
	pull: number;
	/** The distance the pull heads for, eased at the pull's rate. It is held while the pull
	 * releases, so a tower's edge that crosses back and forth does not flicker the distance. */
	want: number;
	/** The seconds since a tower last stood between the car and its usual place. */
	clear: number;
	/** The angle the camera holds to either side of the user's view, in radians, and the angle it
	 * eases toward. */
	swing: number;
	goal: number;
	/** The distance the camera took from the car this frame, which is the user's own distance once
	 * the way is clear. */
	radius: number;
	/** The angle off the car's tail that the camera uses, in radians, which a tower can refuse to
	 * let it leave. `NaN` until the first frame takes the user's own angle. */
	angle: number;
	/** True while a tower refuses the user's turn, so the camera keeps the last angle it could
	 * stand at, and the turn eases back once the way is clear. */
	held: boolean;
}

/** Starts a sight with the camera at the user's own distance and the car in view. */
export function createSight(distance: number): Sight {
	return {
		pull: 0,
		want: distance,
		clear: Infinity,
		swing: 0,
		goal: 0,
		radius: distance,
		angle: Number.NaN,
		held: false,
	};
}

/**
 * How far along the view at `angle` the car first comes into sight, in meters. It measures the
 * boxes that the camera keeps out of, so the distance it gives is the one the camera can stand at
 * without a tower pushing it aside.
 */
function viewDistance(
	atX: number,
	atY: number,
	atZ: number,
	angle: number,
	level: number,
	rise: number,
	distance: number,
	towers: Towers,
): number {
	return entryDistance(
		atX,
		atY,
		atZ,
		Math.sin(angle) * level,
		rise,
		Math.cos(angle) * level,
		distance,
		towers,
		CLEARANCE,
	);
}

/**
 * The angle to either side of the user's view that first sees the car at the user's distance, from
 * the nearer side outward, or 0 when no side within the widest swing sees it.
 */
function findSide(
	atX: number,
	atY: number,
	atZ: number,
	around: number,
	level: number,
	rise: number,
	distance: number,
	towers: Towers,
): number {
	for (let step = SIGHT_STEP; step <= SIGHT_SWING + 1e-9; step += SIGHT_STEP) {
		if (viewDistance(atX, atY, atZ, around + step, level, rise, distance, towers) >= distance)
			return step;
		if (viewDistance(atX, atY, atZ, around - step, level, rise, distance, towers) >= distance)
			return -step;
	}
	return 0;
}

/** Keeps a placed camera at the standoff from the car, where the towers leave room. */
function clampStandoff(eye: Flight, atX: number, atY: number, atZ: number): void {
	const dx = eye.x - atX;
	const dy = eye.y - atY;
	const dz = eye.z - atZ;
	const away = Math.hypot(dx, dy, dz);
	if (away < SIGHT_MIN && away > 1e-3) {
		const out = SIGHT_MIN / away;
		eye.x = atX + dx * out;
		eye.y = atY + dy * out;
		eye.z = atZ + dz * out;
	}
}

/**
 * Aims the chase camera for one frame of `dt` seconds. The user's view is their angle round the car
 * from its tail, `around`, its tilt and its distance, and `tail` is the direction behind the car,
 * which carries the camera with the car's own heading. A tower between the car and the place those
 * pick pulls the camera in along the view, and the way back out takes the same easing, after a
 * dwell, so an edge that crosses back and forth does not flicker the distance. The pull starts
 * after the line is already blocked and covers about two thirds of the gap in a quarter second,
 * so at the usual distance a new tower can hide the car for about half a second. That is the
 * trade of having no look-ahead: the motion is smooth, but the car is briefly out of sight.
 * A tower that stands nearer than the standoff, which no distance clears, makes the camera ease
 * round to a side that sees the car, and it holds that side until the user's own view clears.
 *
 * A turn that would put the camera in a tower is refused: the camera keeps the last angle it could
 * stand at, so it stops against the face instead of sliding along it, and the turn eases back to
 * the user's own view once the way is clear.
 *
 * The height and the look return to their usual ones over the larger of the usual chase distance
 * and the user's own distance. Writes the place the camera heads for into `out`, and returns how
 * much of the usual chase look remains, from 0 pulled in to 1 at the user's distance.
 */
export function settleSight(
	sight: Sight,
	atX: number,
	atY: number,
	atZ: number,
	around: number,
	tail: number,
	tilt: number,
	distance: number,
	towers: Towers,
	dt: number,
	out: Flight,
): number {
	const level = Math.cos(tilt);
	const rise = Math.sin(tilt);
	// The user's own turn off the car's tail. The camera takes it at once while it can stand there.
	// A turn it cannot stand at is refused: the camera keeps the last angle that it could, so the
	// car's own heading still carries it, and once the way is clear it eases back to the user's own
	// turn, so the turn returns rather than jumps.
	const wish = around - tail;
	// The first frame has no last angle to keep, so it takes the user's own turn where it can stand,
	// and the view straight behind the car where it cannot.
	if (Number.isNaN(sight.angle))
		sight.angle = standable(atX, atY, atZ, around, level, rise, distance, towers) ? wish : 0;
	else if (!sight.held) {
		if (standable(atX, atY, atZ, around, level, rise, distance, towers)) sight.angle = wish;
		else sight.held = true;
	} else if (standable(atX, atY, atZ, around, level, rise, distance, towers)) {
		// The way is clear at the user's own turn again. The camera eases toward it, and takes no
		// step that a tower refuses, so a way that clears on one side returns without a jump.
		const gap = Math.atan2(Math.sin(wish - sight.angle), Math.cos(wish - sight.angle));
		if (Math.abs(gap) < SIGHT_SNAP) {
			sight.angle = wish;
			sight.held = false;
		} else {
			const next = sight.angle + gap * (1 - Math.exp(-SIGHT_EASE * dt));
			if (standable(atX, atY, atZ, tail + next, level, rise, distance, towers)) sight.angle = next;
		}
	}
	const view = tail + sight.angle;
	// A span that stopped short of the camera would drop it by the height of a wide zoom in a
	// single frame when a side swing shortens the blend, so it reaches the user's own distance.
	const far = Math.max(CHASE_DISTANCE, distance);
	// The pull follows whether a tower stands between the car and the user's usual place, not
	// whether one stands between the car and the camera that the pull itself has moved, so the
	// pull does not release as soon as its own motion clears the line.
	const own = viewDistance(atX, atY, atZ, view, level, rise, distance, towers);
	const blocked = own < distance;

	// The pull rises while a tower stands in the way, and falls only once the way has stayed clear
	// for the dwell, so a tower's edge that crosses back and forth does not flicker it.
	sight.clear = blocked ? 0 : sight.clear + dt;
	const target = blocked || sight.clear < SIGHT_DWELL ? 1 : 0;
	sight.pull += (target - sight.pull) * (1 - Math.exp(-SIGHT_EASE * dt));
	if (Math.abs(sight.pull - target) < SIGHT_SNAP) sight.pull = target;

	// A side is needed only when the tower stands inside the standoff, so no distance along the
	// user's view clears the car. It is held until the user's own view clears again.
	const wantSide = sight.goal === 0 ? blocked && own < SIGHT_MIN : blocked;
	if (wantSide) {
		const sideView =
			sight.goal === 0
				? 0
				: viewDistance(atX, atY, atZ, view + sight.goal, level, rise, distance, towers);
		if (sight.goal === 0 || sideView < distance)
			sight.goal = findSide(atX, atY, atZ, view, level, rise, distance, towers);
	} else sight.goal = 0;
	sight.swing += (sight.goal - sight.swing) * (1 - Math.exp(-SIGHT_EASE * dt));
	if (Math.abs(sight.goal - sight.swing) < SIGHT_SNAP) sight.swing = sight.goal;

	// The distance along the camera's own heading where the way first clears. While the pull
	// releases, the distance it heads for is held, so a tower that flickers at an edge cannot make
	// the camera pulse. A side, once it sees the car, gives the user's own distance back.
	const angle = view + sight.swing;
	const entry = viewDistance(atX, atY, atZ, angle, level, rise, distance, towers);
	const clear = entry >= distance;
	let want: number;
	if (!clear) want = Math.max(SIGHT_MIN, entry);
	else if (sight.goal !== 0 || sight.pull <= SIGHT_SNAP) want = distance;
	else want = sight.want;
	// The distance it heads for eases at the pull's own rate too. A tower's near face can jump
	// when a turn brings another tower's face into the line, and setting the distance straight
	// would move the camera as far in one frame as the two faces differ.
	sight.want += (want - sight.want) * (1 - Math.exp(-SIGHT_EASE * dt));
	if (Math.abs(want - sight.want) < SIGHT_SNAP) sight.want = want;
	// A released pull forgets the last tower, so the next one starts from the user's own distance,
	// and the pull never runs past the zoom the user set.
	if (sight.pull === 0) sight.want = distance;
	else if (sight.want > distance) sight.want = distance;
	const radius = distance + (sight.want - distance) * sight.pull;
	sight.radius = radius;

	const closeness =
		Math.min(1, Math.max(0, (radius - SIGHT_CLOSE) / Math.max(far - SIGHT_CLOSE, 1e-3))) *
		Math.max(0, 1 - Math.abs(sight.swing) / SIGHT_SWING);
	out.x = atX + Math.sin(angle) * level * radius;
	out.z = atZ + Math.cos(angle) * level * radius;
	// The camera sits low as it closes on the car, so it looks just past it rather than down at its
	// roof, and its height blends back to the user's as the distance does.
	out.y = atY + (closeness < 1 ? SIGHT_LOW + (rise * far - SIGHT_LOW) * closeness : rise * radius);
	// A tower and the standoff can disagree about where the camera may stand: the tower wins, so the
	// camera never ends up inside a wall.
	keepOut(out, towers);
	if (sight.pull > 0 || sight.swing !== 0) clampStandoff(out, atX, atY, atZ);
	keepOut(out, towers);
	return closeness;
}
