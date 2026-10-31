// The hover car's flight in Skyway's Manual mode: the keys speed it up, turn it and climb it, and
// the towers, the street, the sky's ceiling and the city's edge keep it in the air between them.
import { expect, test } from 'bun:test';
import {
	CEILING,
	CLEARANCE,
	cityTowers,
	EDGE,
	FLIGHT,
	FLOOR,
	type Flight,
	fly,
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
