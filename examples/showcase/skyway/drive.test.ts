// The hover car's flight in Skyway's Manual mode: the keys speed it up, turn it and climb it, and
// the towers, the street, the sky's ceiling and the city's edge keep it in the air between them.
import { expect, test } from 'bun:test';
import {
	CEILING,
	CHASE_DISTANCE,
	CHASE_TILT,
	type ChaseView,
	CLEARANCE,
	cityTowers,
	clearSight,
	createSight,
	EDGE,
	FLIGHT,
	FLOOR,
	type Flight,
	fly,
	keepOut,
	SIGHT_MIN,
	type Sight,
	type Stick,
	settleSight,
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

/** The angle behind a car that heads +z. */
const BEHIND = Math.PI;

/** Settles the camera of a still car for `frames` frames and returns the place it heads for. */
function settle(
	sight: Sight,
	aim: Flight,
	towers: Float32Array,
	frames: number,
	car: Flight = flight(),
): Flight {
	for (let k = 0; k < frames; k++)
		settleSight(
			sight,
			car.x,
			car.y,
			car.z,
			BEHIND,
			BEHIND,
			CHASE_TILT,
			CHASE_DISTANCE,
			towers,
			FRAME,
			aim,
		);
	return aim;
}

/** A tower that stands between the still car and its usual place, past the standoff. */
const IN_THE_WAY = new Float32Array([0, -15, 1.4, 1.4, 100]);
/** The distance at which the camera stands before it: the tower's near face, its own margin in. */
const CLEAR_AT = (15 - 1.4 - CLEARANCE) / Math.cos(CHASE_TILT);

test('a blocked view eases the camera in over several frames', () => {
	const sight = createSight(CHASE_DISTANCE);
	const aim: Flight = { ...flight() };
	settle(sight, aim, IN_THE_WAY, 1);
	// One frame moves the camera a fraction of the way, not all of it.
	expect(sight.radius).toBeGreaterThan(CHASE_DISTANCE - 0.5);
	settle(sight, aim, IN_THE_WAY, 10);
	expect(sight.radius).toBeGreaterThan(CLEAR_AT + 0.5);
	expect(sight.radius).toBeLessThan(CHASE_DISTANCE - 0.5);
	settle(sight, aim, IN_THE_WAY, 150);
	expect(sight.radius).toBeCloseTo(CLEAR_AT, 3);
	// The camera stands at the standoff or beyond, and looks past the tower.
	expect(apart(aim, [0, 50, 0])).toBeGreaterThanOrEqual(SIGHT_MIN);
	expect(sightBlocked([0, 50, 0], aim, IN_THE_WAY, 0.6)).toBe(false);
});

test('the camera returns to the user’s exact chase distance once clear', () => {
	const sight = createSight(CHASE_DISTANCE);
	const aim: Flight = { ...flight() };
	settle(sight, aim, IN_THE_WAY, 180);
	expect(sight.radius).toBeCloseTo(CLEAR_AT, 3);
	settle(sight, aim, NONE, 180);
	expect(sight.radius).toBe(CHASE_DISTANCE);
	expect(sight.pull).toBe(0);
	expect(sight.swing).toBe(0);
	// The placed camera sits at that distance too.
	expect(apart(aim, [0, 50, 0])).toBeCloseTo(CHASE_DISTANCE, 6);
});

test('a tower edge that crosses back and forth does not pump the distance', () => {
	const sight = createSight(CHASE_DISTANCE);
	const aim: Flight = { ...flight() };
	settle(sight, aim, IN_THE_WAY, 180);
	let last = sight.radius;
	let most = 0;
	// The tower appears and disappears on alternate frames, as a tower's edge does when the car
	// turns along it. The dwell holds the pull and the distance it heads for, so neither pumps.
	for (let k = 0; k < 120; k++) {
		settle(sight, aim, k % 2 === 0 ? NONE : IN_THE_WAY, 1);
		most = Math.max(most, Math.abs(sight.radius - last));
		last = sight.radius;
	}
	expect(most).toBeLessThan(0.01);
	expect(sight.pull).toBe(1);
});

/** The speed of the car in the tower swap, and the user's zoom there. */
const SPEED = 10;
const ZOOM = 50;
/**
 * Two towers that stand in the same line behind the car, at very different distances. They are
 * wide, so the car's sideways travel keeps its view across both while the blocker changes.
 */
const NEAR_TOWER = new Float32Array([0, -20, 80, 1.4, 100]);
const FAR_TOWER = new Float32Array([0, -40, 80, 1.4, 100]);

test('a changed tower moves the distance no faster than the pull', () => {
	// The car flies across its view, so the camera keeps moving while the blocker changes: the
	// owner's steady turn, where one tower's face gives way to another's.
	const car = flight();
	const sight = createSight(ZOOM);
	const aim: Flight = { ...flight() };
	const step = (towers: Float32Array, frames: number): void => {
		for (let k = 0; k < frames; k++) {
			car.x += SPEED * FRAME;
			settleSight(sight, car.x, car.y, car.z, BEHIND, BEHIND, CHASE_TILT, ZOOM, towers, FRAME, aim);
		}
	};
	// The pull reaches the end of its travel behind the near tower.
	step(NEAR_TOWER, 240);
	expect(sight.pull).toBe(1);
	const before = sight.radius;
	let was = { x: aim.x, y: aim.y, z: aim.z };
	let last = sight.radius;
	let mostPlace = 0;
	let mostDistance = 0;
	for (let k = 0; k < 120; k++) {
		step(FAR_TOWER, 1);
		mostPlace = Math.max(mostPlace, apart(aim, [was.x, was.y, was.z]));
		mostDistance = Math.max(mostDistance, Math.abs(sight.radius - last));
		was = { x: aim.x, y: aim.y, z: aim.z };
		last = sight.radius;
	}
	// The blocker changed for one about 21 m farther off, and the camera did reach it.
	expect(sight.radius).toBeGreaterThan(before + 15);
	// Both the pull and the distance it heads for ease at the same rate, so one frame covers at
	// most about a fifteenth of that gap: the distance steps under 1.45 m, and the car's own
	// travel puts the camera's place under 1.6 m away from where it was.
	expect(mostDistance).toBeLessThan(1.45);
	expect(mostPlace).toBeLessThan(1.6);
});

/**
 * A tower that stands inside the standoff behind the car, so the camera must swing to a side. It
 * stands straight behind, so the swing's arc carries the camera clear of it and the keep-out does
 * not move the camera while the swing runs.
 */
const INSIDE = new Float32Array([0, -8, 4, 4, 100]);
/** How fast the car creeps forward while the swing runs, in meters per second. */
const CREEP = 1;

test('a side swing at a wide zoom does not drop the camera', () => {
	// The camera sits at the user's own zoom, seeing the car, and then a tower inside the standoff
	// starts a side swing. The height blend must reach the user's own height at that distance, or
	// the aim drops by the height of the zoom in a single frame as the swing shortens the blend.
	const car = flight();
	const sight = createSight(ZOOM);
	const aim: Flight = { ...flight() };
	const step = (towers: Float32Array, frames: number): void => {
		for (let k = 0; k < frames; k++) {
			// The car creeps forward, so the tower stays inside the standoff for the whole swing.
			car.z += CREEP * FRAME;
			settleSight(sight, car.x, car.y, car.z, BEHIND, BEHIND, CHASE_TILT, ZOOM, towers, FRAME, aim);
		}
	};
	step(NONE, 30);
	let was = { x: aim.x, y: aim.y, z: aim.z };
	let most = 0;
	for (let k = 0; k < 180; k++) {
		step(INSIDE, 1);
		most = Math.max(most, apart(aim, [was.x, was.y, was.z]));
		was = { x: aim.x, y: aim.y, z: aim.z };
	}
	expect(Math.abs(sight.swing)).toBeGreaterThan(0.5);
	// The swing itself covers about four metres of arc in its first frame at this zoom. The height
	// must add well under a metre to that, not twelve.
	expect(most).toBeLessThan(6);
});

test('a tower dead behind the car finds a side that sees it', () => {
	// The tower stands inside the standoff, so no distance along the view behind the car sees it.
	const towers = new Float32Array([0, -8, 4, 4, 100]);
	const sight = createSight(CHASE_DISTANCE);
	const aim: Flight = { ...flight() };
	settle(sight, aim, towers, 1);
	expect(sight.goal).not.toBe(0);
	// The camera eases round rather than taking the side in a single frame.
	expect(Math.abs(sight.swing)).toBeLessThan(Math.abs(sight.goal) / 2);
	settle(sight, aim, towers, 120);
	expect(sight.swing).toBeCloseTo(sight.goal, 6);
	expect(sightBlocked([0, 50, 0], aim, towers, 0.6)).toBe(false);
	expect(apart(aim, [0, 50, 0])).toBeGreaterThanOrEqual(SIGHT_MIN);
});

/**
 * A tower that the camera's own turn swings into: it stands west of the car, which flies north
 * along it seven meters clear.
 */
const BESIDE = new Float32Array([0, 0, 20, 90, 100]);
const BESIDE_X = 20 + CLEARANCE + 7;
/** How fast the drag turns the camera, in radians per second, and how fast the car flies, in
 * meters per second. */
const DRAG = 0.6;
const LAPSE = 20;

test('a turn that would put the camera in a tower is refused until the way is clear', () => {
	const car = flight({ x: BESIDE_X, y: 50, z: 0, speed: LAPSE });
	const sight = createSight(CHASE_DISTANCE);
	const aim: Flight = { ...flight() };
	let turn = 0;
	/** Flies the car one frame and turns the camera's view by `drag` radians. */
	const step = (drag: number): void => {
		turn += drag;
		car.z += LAPSE * FRAME;
		settleSight(
			sight,
			car.x,
			car.y,
			car.z,
			BEHIND + turn,
			BEHIND,
			CHASE_TILT,
			CHASE_DISTANCE,
			BESIDE,
			FRAME,
			aim,
		);
		// The camera stands clear of the tower on every frame: the keep-out moves nothing.
		expect(keepOut({ ...aim }, BESIDE)).toBe(false);
	};
	for (let k = 0; k < 60; k++) step(0);
	const behind = { x: aim.x - car.x, z: aim.z - car.z };
	// The drag swings the camera toward the tower, and the camera follows while it can stand there.
	for (let k = 0; k < 80; k++) step(DRAG * FRAME);
	expect(aim.x - car.x).toBeLessThan(behind.x - 1);
	// The camera meets the tower's face. The drag keeps turning, but the camera keeps the angle it
	// could last stand at: its place round the car stops changing.
	const met = { x: aim.x - car.x, z: aim.z - car.z };
	let most = 0;
	for (let k = 0; k < 90; k++) {
		step(DRAG * FRAME);
		most = Math.max(most, Math.hypot(aim.x - car.x - met.x, aim.z - car.z - met.z));
	}
	expect(most).toBeLessThan(1e-6);
	// The camera stopped clear of the tower, rather than in it or sliding along it.
	expect(aim.x).toBeGreaterThanOrEqual(20 + CLEARANCE - 1e-6);
	expect(apart(aim, [car.x, car.y, car.z])).toBeGreaterThanOrEqual(SIGHT_MIN);
	// The car flies past the tower, and the user lets go. The camera eases back to the view the
	// user asked for, and never steps more than a metre and a half a frame on the way.
	let was = { x: aim.x - car.x, z: aim.z - car.z };
	let fastest = 0;
	for (let k = 0; k < 240; k++) {
		step(0);
		fastest = Math.max(fastest, Math.hypot(aim.x - car.x - was.x, aim.z - car.z - was.z));
		was = { x: aim.x - car.x, z: aim.z - car.z };
	}
	expect(fastest).toBeGreaterThan(0);
	expect(fastest).toBeLessThan(1.5);
	// The camera sits where the user's own turn asked, at the user's own distance.
	expect(apart(aim, [car.x, car.y, car.z])).toBeCloseTo(CHASE_DISTANCE, 3);
	expect(aim.x - car.x).toBeCloseTo(
		Math.sin(BEHIND + turn) * Math.cos(CHASE_TILT) * CHASE_DISTANCE,
		3,
	);
});

test('the camera stays behind the car as the car turns', () => {
	const car = flight({ x: 0, y: 50, z: 0, speed: LAPSE });
	const view: ChaseView = { turn: 0, tilt: CHASE_TILT, distance: CHASE_DISTANCE };
	const sight = createSight(CHASE_DISTANCE);
	const aim: Flight = { ...flight() };
	const keys = stick({ throttle: 1, steer: 1 });
	// The car turns where no tower stands, so the turn is free.
	for (let k = 0; k < 60; k++) {
		fly(car, keys, FRAME, NONE, view);
		settleSight(
			sight,
			car.x,
			car.y,
			car.z,
			car.yaw + BEHIND,
			car.yaw + BEHIND,
			view.tilt,
			view.distance,
			NONE,
			FRAME,
			aim,
		);
	}
	expect(car.yaw).toBeGreaterThan(0.4);
	// The camera sits behind the car's own heading, not on a heading of its own.
	const bearing = Math.atan2(aim.x - car.x, aim.z - car.z) - car.yaw - BEHIND;
	expect(Math.atan2(Math.sin(bearing), Math.cos(bearing))).toBeCloseTo(0, 6);
});

test('a turn that would put the camera in a tower is refused by the car', () => {
	const car = flight({ x: BESIDE_X, y: 50, z: 0, speed: LAPSE });
	const view: ChaseView = { turn: 0.62, tilt: CHASE_TILT, distance: CHASE_DISTANCE };
	const keys = stick({ throttle: 1, steer: 1 });
	/** Flies the car one frame with the keys held. */
	const step = (): void => fly(car, keys, FRAME, BESIDE, view);
	// The drag holds the camera against the tower, and the keys ask the car to turn.
	for (let k = 0; k < 30; k++) step();
	const yaw = car.yaw;
	const z = car.z;
	for (let k = 0; k < 90; k++) {
		step();
		expect(car.yaw).toBe(yaw);
	}
	// The car keeps flying while its turn is refused.
	expect(car.z).toBeGreaterThan(z + 20);
	// The car passes the tower, and the turn applies again.
	const cleared = car.z;
	for (let k = 0; k < 180; k++) step();
	expect(car.z).toBeGreaterThan(cleared + 20);
	expect(car.yaw).toBeGreaterThan(yaw + 0.2);
});
