// The flight of the hover car that the user drives in Skyway's Manual mode. W and S speed it up and
// slow it down, A and D turn it, and R and F climb and sink. It flies through the air between the
// towers: each tower is a box, and a car that flies into one slides along its face or lands on its
// roof. The streets, the city's edge and the sky's ceiling bound it too.
//
// The flight is plain numbers, apart from the scene, so the unit test drives it frame by frame.
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

/** Flies the car one frame of `dt` seconds on the keys' wishes, then keeps it out of the towers. */
export function fly(flight: Flight, stick: Stick, dt: number, towers: Towers): void {
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
	flight.yaw += flight.turning * dt;
	flight.climb += (stick.lift * FLIGHT.climb - flight.climb) * Math.min(1, FLIGHT.climbRate * dt);
	flight.x += Math.sin(flight.yaw) * flight.speed * dt;
	flight.z += Math.cos(flight.yaw) * flight.speed * dt;
	flight.y += flight.climb * dt;
	keepOut(flight, towers);
}

/** The least distance a pulled-in chase camera keeps from the point it looks at, in meters. */
const SIGHT_NEAREST = 2;

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
	/** Where along the segment from the point to the camera the nearest box starts, from 0 to 1. */
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
