// The hover car's flight in Skyway's Manual mode: the keys speed it up, turn it and climb it, and
// the towers, the street, the sky's ceiling and the city's edge keep it in the air between them.
import { expect, test } from 'bun:test';
import {
	CEILING,
	CLEARANCE,
	cityTowers,
	clearSight,
	EDGE,
	FLIGHT,
	FLOOR,
	type Flight,
	fly,
	keepOut,
	type Stick,
} from './drive';

const FRAME = 1 / 60;
/** One tower, 20 m square and 100 m tall, round the origin. */
const TOWER = new Float32Array([0, 0, 10, 10, 100]);
const NONE = new Float32Array(0);

const flight = (over: Partial<Flight> = {}): Flight => ({
	x: 0,
	y: 50,
	z: 0,
	yaw: 0,
	speed: 0,
	climb: 0,
	turning: 0,
	...over,
});
const stick = (over: Partial<Stick> = {}): Stick => ({ throttle: 0, steer: 0, lift: 0, ...over });

/** Flies `seconds` of frames. */
function run(f: Flight, s: Stick, seconds: number, towers = NONE): void {
	for (let k = 0; k < Math.round(seconds / FRAME); k++) fly(f, s, FRAME, towers);
}

test('W gains speed up to the top speed, along the nose', () => {
	const f = flight({ yaw: Math.PI / 2 });
	run(f, stick({ throttle: 1 }), 10);
	expect(f.speed).toBeCloseTo(FLIGHT.top, 5);
	expect(f.x).toBeGreaterThan(300);
	expect(Math.abs(f.z)).toBeLessThan(1e-6);
});

test('S brakes to a stop, then reverses slowly', () => {
	const f = flight({ speed: 40 });
	run(f, stick({ throttle: -1 }), 1);
	expect(f.speed).toBeCloseTo(6, 5);
	run(f, stick({ throttle: -1 }), 3);
	expect(f.speed).toBeCloseTo(-FLIGHT.reverse, 5);
});

test('with no key the car coasts to a hover', () => {
	const f = flight({ speed: 21 });
	run(f, stick(), 4);
	expect(f.speed).toBe(0);
});

test('A turns the nose left and D turns it right, slowly while still', () => {
	const left = flight({ speed: 30 });
	run(left, stick({ steer: 1 }), 1);
	expect(left.yaw).toBeCloseTo(FLIGHT.turn, 5);
	const still = flight();
	run(still, stick({ steer: -1 }), 1);
	expect(still.yaw).toBeCloseTo(-FLIGHT.turn * FLIGHT.hover, 5);
});

test('R climbs and F sinks, never below the floor or above the ceiling', () => {
	const up = flight({ y: CEILING - 5 });
	run(up, stick({ lift: 1 }), 5);
	expect(up.y).toBe(CEILING);
	const down = flight({ y: FLOOR + 5 });
	run(down, stick({ lift: -1 }), 5);
	expect(down.y).toBe(FLOOR);
});

test('a car that flies into a wall stops against it and slides along it', () => {
	// Heading +x with a little +z, toward the tower's west face.
	const f = flight({ x: -30, z: 0, yaw: Math.PI / 2 - 0.3, speed: 30 });
	run(f, stick({ throttle: 1 }), 3, TOWER);
	expect(f.x).toBeLessThanOrEqual(-10 - CLEARANCE + 1e-4);
	expect(f.z).toBeGreaterThan(0);
	expect(f.speed).toBeLessThan(30);
});

test('a car that sinks onto a roof lands on it', () => {
	const f = flight({ x: 0, z: 0, y: 110 });
	run(f, stick({ lift: -1 }), 3, TOWER);
	expect(f.y).toBeCloseTo(100 + CLEARANCE, 5);
});

test('the car stays inside the city', () => {
	const f = flight({ x: EDGE - 10, yaw: Math.PI / 2 });
	run(f, stick({ throttle: 1 }), 5);
	expect(f.x).toBe(EDGE);
});

test('the city plan gives every tower as a box', () => {
	const towers = cityTowers();
	expect(towers.length % 5).toBe(0);
	expect(towers.length / 5).toBeGreaterThan(500);
	for (let k = 0; k < towers.length; k += 5) {
		expect(towers[k + 2]).toBeGreaterThan(0);
		expect(towers[k + 4]).toBeGreaterThan(0);
	}
});

/** The distance between two places. */
const apart = (a: { x: number; y: number; z: number }, b: readonly number[]): number =>
	Math.hypot(a.x - (b[0] as number), a.y - (b[1] as number), a.z - (b[2] as number));

/** True when the segment from a place to another crosses any tower's box, grown by `clearance`. */
function sightBlocked(
	from: readonly number[],
	to: { x: number; y: number; z: number },
	towers: Float32Array,
	clearance: number,
): boolean {
	const [dx, dy, dz] = [
		to.x - (from[0] as number),
		to.y - (from[1] as number),
		to.z - (from[2] as number),
	];
	for (let k = 0; k < towers.length; k += 5) {
		const [cx, cz, hx, hz, top] = [
			towers[k] as number,
			towers[k + 1] as number,
			towers[k + 2] as number,
			towers[k + 3] as number,
			towers[k + 4] as number,
		];
		const slabs: readonly [number, number, number, number][] = [
			[from[0] as number, dx, cx - hx - clearance, cx + hx + clearance],
			[from[1] as number, dy, -clearance, top + clearance],
			[from[2] as number, dz, cz - hz - clearance, cz + hz + clearance],
		];
		let near = 0;
		let far = 1;
		let hits = true;
		for (const [origin, step, low, high] of slabs) {
			if (Math.abs(step) < 1e-9) {
				if (origin < low || origin > high) {
					hits = false;
					break;
				}
				continue;
			}
			let t1 = (low - origin) / step;
			let t2 = (high - origin) / step;
			if (t1 > t2) [t1, t2] = [t2, t1];
			near = Math.max(near, t1);
			far = Math.min(far, t2);
			if (near > far) {
				hits = false;
				break;
			}
		}
		if (hits && near > 0 && near < 1) return true;
	}
	return false;
}

test('a tower in the line of sight pulls the chase camera before it', () => {
	// A small tower at the origin, with the car just past it and the camera behind, so the tower
	// stands between them while the camera itself is outside the tower.
	const towers = new Float32Array([0, 0, 2, 2, 100]);
	const car = [0, 50, 10];
	const camera: Flight = { x: 0, y: 54, z: -6, yaw: 0, speed: 0, climb: 0, turning: 0 };
	// The old camera keeps itself out of the tower: it is outside it. The tower still hides the car.
	expect(keepOut(camera, towers)).toBe(false);
	expect(sightBlocked(car, camera, towers, 0.6)).toBe(true);
	// The pull-in places the camera at the near side of the tower's grown box, before it.
	expect(
		clearSight(car[0] as number, car[1] as number, car[2] as number, camera, towers, 0.6),
	).toBe(true);
	expect(camera.z).toBeCloseTo(2.6, 5);
	expect(camera.x).toBeCloseTo(0, 5);
	expect(apart(camera, car)).toBeGreaterThan(2);
	expect(sightBlocked(car, camera, towers, 0.6)).toBe(false);
	// With the line of sight clear, a second call leaves the camera where it is.
	const place = { ...camera };
	expect(
		clearSight(car[0] as number, car[1] as number, car[2] as number, camera, towers, 0.6),
	).toBe(false);
	expect(camera).toEqual(place);
});

test('a clear line of sight leaves the camera alone', () => {
	const towers = new Float32Array([0, 0, 2, 2, 100]);
	const camera: Flight = { x: 0, y: 54, z: 17, yaw: 0, speed: 0, climb: 0, turning: 0 };
	// The car ahead of the tower, the camera behind it, so the tower is not between them.
	const place = { ...camera };
	expect(clearSight(0, 50, 30, camera, towers, 0.6)).toBe(false);
	expect(camera).toEqual(place);
});

test('the pull keeps two meters from the point it looks at', () => {
	// A tower whose grown box starts less than two meters from the point: the camera stops at the
	// near limit rather than closer, so the near plane never clips the body.
	const towers = new Float32Array([0, 0, 2, 2, 100]);
	const camera: Flight = { x: 0, y: 50, z: 0.5, yaw: 0, speed: 0, climb: 0, turning: 0 };
	expect(clearSight(0, 50, 3, camera, towers, 0.6)).toBe(true);
	expect(apart(camera, [0, 50, 3])).toBeCloseTo(2, 5);
});
