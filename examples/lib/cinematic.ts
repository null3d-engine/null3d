// A cinematic camera for the showcase scenes. In Auto, the camera follows a route of shots on a loop
// and shows the scene's best views; in Manual, the user flies the camera with the keyboard and the
// pointer, or with a finger on a touch screen, or drives the scene's vehicle where the scene has
// one. The `c` key toggles the two. The current mode and the
// scene's controls go to the page as a `hud` message, since a sketch runs in a worker and cannot
// touch the page. The camera group of the controls is a row of buttons, so a touch screen, which has
// no `c` key, can switch the mode too.
//
// Switching Auto to Manual is instant: the route's motion stops at once, and the user takes the
// camera exactly where it is, holding that pose, with the controls taking their view from it.
// Switching Manual back to Auto does not snap: the camera finds the nearest point of the route,
// then glides to it over a short interval, easing in and out, and the route carries on from there.
//
// Every key of a showcase scene lives in one table here: the camera's own keys, the keys that the
// page's controls answer, and any key that a scene adds. A scene adds its keys through
// `createCinematic`, which refuses a key that is already taken, so one key never does two things.
// The owner keeps the shortcuts basic: only the camera and the controls have one (D-171).
//
// The route is a function of the sketch time, so a held frame (the image tests' `?hold`) lands on a
// fixed pose and never drifts. A scene whose held frame must not change puts the pose of that frame
// in the route's first shot and holds it still. Consecutive shots must differ: two shots at the same
// pose would stand the camera still for both, which reads as a stall.
import { createOrbitControls } from '@null3d/controls';
import {
	type PerspectiveCamera,
	quat,
	type SketchContext,
	type Vec3Like,
	vec3,
} from '@null3d/engine';
import { createClearance } from './clearance';
import { CAMERA_OPTIONS, type HudGroup, radioGroup } from './controls';

/** One shot of a route: where the camera stands, what it looks at, and how long the shot lasts. */
export interface Shot {
	/** The camera's position, in meters. */
	position: readonly [number, number, number];
	/** The point that the camera looks at, in meters. */
	target: readonly [number, number, number];
	/** How long the shot lasts, in seconds. The loop's length is the sum of its shots. */
	seconds: number;
	/**
	 * `'hold'` keeps the camera still for the shot, and `'ease'` moves it toward the next shot's
	 * pose over the shot, so the route flows. The default is `'ease'`.
	 */
	move?: 'hold' | 'ease';
	/**
	 * True lets the shot pass through an object on purpose, to reveal what is inside it. The
	 * clearance guard holds every other shot out of the scene's geometry. The default is false.
	 */
	through?: boolean;
}

/** One key of a showcase scene: the key's code, as the engine's input names it, and what it does. */
export interface SceneKey {
	code: string;
	/** What the key does, for the help and for the error that names a clash. */
	does: string;
}

/** A key that a scene adds: it runs its action on the frame that the key goes down. */
export interface SceneAction extends SceneKey {
	press(): void;
}

/** The keys that the camera reads. W, S, A and D pan the Manual camera, and R and F raise it. */
const KEY = {
	mode: 'KeyC',
	forward: 'KeyW',
	back: 'KeyS',
	left: 'KeyA',
	right: 'KeyD',
	rise: 'KeyR',
	fall: 'KeyF',
} as const;

/** The keys of the Manual camera, which a scene that the user drives replaces with its own. */
const MANUAL_KEYS: readonly SceneKey[] = [
	{ code: KEY.forward, does: 'pan the Manual camera forward' },
	{ code: KEY.back, does: 'pan the Manual camera back' },
	{ code: KEY.left, does: 'pan the Manual camera left' },
	{ code: KEY.right, does: 'pan the Manual camera right' },
	{ code: KEY.rise, does: 'raise the Manual camera' },
	{ code: KEY.fall, does: 'lower the Manual camera' },
];

/** The keys of the controls, which the page reads. */
const CONTROLS_KEYS: readonly SceneKey[] = [
	{ code: 'KeyH', does: 'open and close the controls' },
	{ code: 'Escape', does: 'close the controls' },
];

/** The keys that every showcase scene shares: the camera's, then the controls', which the page reads. */
export const SHOWCASE_KEYS: readonly SceneKey[] = [
	{ code: KEY.mode, does: 'switch the camera between Auto and Manual' },
	...MANUAL_KEYS,
	...CONTROLS_KEYS,
];

/**
 * The whole key table of a scene: the shared keys, then the scene's own. A scene that the user
 * drives in Manual gives its driving keys, which take the Manual camera's place. Throws when two
 * entries take the same key, and names both.
 */
export function keyTable(
	scene: readonly SceneKey[] = [],
	driving?: readonly SceneKey[],
): readonly SceneKey[] {
	const shared = driving
		? [SHOWCASE_KEYS[0] as SceneKey, ...driving, ...CONTROLS_KEYS]
		: SHOWCASE_KEYS;
	const table = [...shared, ...scene];
	const taken = new Map<string, string>();
	for (const key of table) {
		const other = taken.get(key.code);
		if (other !== undefined)
			throw new Error(`The key ${key.code} would ${key.does}, but it already does: ${other}.`);
		taken.set(key.code, key.does);
	}
	return table;
}

/** The timeline of a route: where each shot starts, how long it lasts, and the loop's length. */
export interface Route {
	readonly shots: readonly Shot[];
	readonly starts: readonly number[];
	readonly lengths: readonly number[];
	/** The length of the whole loop, in seconds. */
	readonly total: number;
	/** The spline's step from each shot to the next, in its own parameter, never zero. */
	readonly steps: readonly number[];
	/** The spline's parameter at each shot, plus the loop's own end. */
	readonly knots: readonly number[];
}

/**
 * Makes a route's timeline. A shot's length below a millisecond is raised to one, so the phase never
 * divides by zero and never stands still for a whole shot.
 */
export function routeTimeline(shots: readonly Shot[]): Route {
	const starts: number[] = [];
	const lengths: number[] = [];
	let total = 0;
	for (const shot of shots) {
		starts.push(total);
		const length = Math.max(0.001, Number.isFinite(shot.seconds) ? shot.seconds : 0.001);
		lengths.push(length);
		total += length;
	}
	// The spline's own parameter: one step per shot, the distance to the next shot raised to the
	// centripetal power. A step never reaches zero, so two shots at the same pose, such as a hold,
	// still have a tangent, and the curve passes through every shot.
	const steps: number[] = [];
	for (let i = 0; i < shots.length; i++) {
		const from = shots[i] as Shot;
		const to = shots[(i + 1) % shots.length] as Shot;
		const distance = Math.hypot(
			(to.position[0] as number) - (from.position[0] as number),
			(to.position[1] as number) - (from.position[1] as number),
			(to.position[2] as number) - (from.position[2] as number),
		);
		const step = Math.max(KNOT_FLOOR, distance ** SPLINE_ALPHA);
		steps.push(step);
	}
	const knots: number[] = [0];
	for (let i = 0; i < shots.length; i++) knots.push((knots[i] as number) + (steps[i] as number));
	return { shots, starts, lengths, total, steps, knots };
}

/**
 * Writes the route's pose at a phase into `out`: the camera's position, then the point it looks at.
 * The phase wraps around the loop, and a shot that holds keeps its own pose for its whole length.
 * This is the one interpolation of a route, so a test that samples the route checks what the player
 * plays.
 */
export function routePosition(route: Route, phase: number, out: Float32Array): void {
	const { shots, starts, lengths, total, steps, knots } = route;
	const count = shots.length;
	const a = ((phase % total) + total) % total || 0;
	let index = 0;
	for (let k = 0; k < count; k++) if (a >= (starts[k] as number)) index = k;
	const shot = shots[index] as Shot;
	const along = Math.min(
		1,
		Math.max(0, (a - (starts[index] as number)) / (lengths[index] as number)),
	);
	// The shot's own stretch of the spline's parameter, with the step before it and the step after it
	// as its other two knots. A shot that holds stays on its own knot, so a hold is exactly still.
	const t1 = knots[index] as number;
	const t2 = knots[index + 1] as number;
	const before = (index + count - 1) % count;
	const after = (index + 1) % count;
	const then = (index + 2) % count;
	const t0 = t1 - (steps[before] as number);
	const t3 = t2 + (steps[after] as number);
	const t = shot.move === 'hold' ? t1 : t1 + along * (t2 - t1);
	const first = shots[before] as Shot;
	const second = shots[after] as Shot;
	const third = shots[then] as Shot;
	for (let c = 0; c < 3; c++) {
		out[c] = catmullRom(
			first.position[c] as number,
			shot.position[c] as number,
			second.position[c] as number,
			third.position[c] as number,
			t0,
			t1,
			t2,
			t3,
			t,
		);
		out[3 + c] = catmullRom(
			first.target[c] as number,
			shot.target[c] as number,
			second.target[c] as number,
			third.target[c] as number,
			t0,
			t1,
			t2,
			t3,
			t,
		);
	}
}

/** How `createCinematic` is called. */
export interface CinematicOptions {
	/** The shots of the route, in the order that the loop plays them. */
	shots: readonly Shot[];
	/** The mutable point that the camera looks at, which the depth-of-field lens focuses on. */
	target: [number, number, number];
	/**
	 * The scene's own groups of the HUD, such as its times of day and its effects, read whenever the
	 * model is posted again.
	 */
	groups?: () => readonly HudGroup[];
	/** How fast the keys pan the manual camera, in canvas pixels per second. The default is 420. */
	speed?: number;
	/** The scene's own keys. A key that the table already holds throws. */
	keys?: readonly SceneAction[];
	/** Where the Manual camera may go. Without bounds it goes anywhere. */
	bounds?: CameraBounds;
	/**
	 * A scene that the user drives in Manual, such as a vehicle. Its keys take the Manual camera's
	 * place, the orbit controls stay off, and it moves the camera itself.
	 */
	driver?: Driver;
}

/** What a scene that the user drives gives the cinematic camera. */
export interface Driver {
	/** The keys that drive, in the place of the Manual camera's. */
	keys: readonly SceneKey[];
	/** Hands the vehicle and the camera to the user, from where the route left them. */
	take(): void;
	/**
	 * Moves the vehicle and places the camera, once per Manual frame. `held` answers whether one of
	 * the driver's own keys is down, so a scene reads no key outside the table.
	 */
	update(dt: number, held: (code: string) => boolean): void;
}

/**
 * Where the Manual camera may go: inside a scene's ring of mountains, below their lowest crest and
 * above the ground, so the view never reaches the plain background. The camera's height stays under
 * the highest that its focus may stand plus its farthest distance, and its reach across the ground
 * under the focus's reach plus that distance.
 */
export interface CameraBounds {
	/** The middle of the scene, x and z, around which the point the camera turns around stays. */
	center: readonly [number, number];
	/** How far that point may move from the middle, in meters. */
	focus: number;
	/** The lowest and highest that point may stand, in meters above y = 0. */
	focusHeight: readonly [number, number];
	/** The farthest the camera goes from that point, in meters. */
	distance: number;
	/** The ground's height at a point, which the camera and the point it turns around keep above. */
	ground: (x: number, z: number) => number;
	/**
	 * How far above the ground the camera keeps, in meters. A stream's bed is ground too, so a small
	 * clearance lets the camera dip under the water. The default is `GROUND_CLEARANCE`.
	 */
	clearance?: number;
}

/** How far above the ground the bounded camera keeps by default, in meters. */
export const GROUND_CLEARANCE = 1.5;

/**
 * The farthest that a bounded camera swings below the level of the point it turns around, as the
 * orbit's angle from straight up, in radians: a little past level, so a shot that looks up at a
 * tower is still in reach, while the ground stops anything lower.
 */
export const BOUNDED_POLAR_ANGLE = 1.85;

/**
 * Keeps a Manual camera at `position`, turning around `target`, inside `bounds`. The point it turns
 * around goes back into its disc and its heights, and the camera moves with it, so a pan stops at
 * the edge without turning the view. A camera under the ground rises along its orbit: it keeps its
 * distance and its bearing, so pushing against the ground never draws it closer. Returns true when
 * anything moved.
 */
export function keepInside(bounds: CameraBounds, target: Vec3Like, position: Vec3Like): boolean {
	const { center, focus, focusHeight, ground, clearance = GROUND_CLEARANCE } = bounds;
	let tx = target[0] as number;
	let ty = target[1] as number;
	let tz = target[2] as number;
	let px = position[0] as number;
	let py = position[1] as number;
	let pz = position[2] as number;
	let moved = false;
	const dx = tx - center[0];
	const dz = tz - center[1];
	const reach = Math.hypot(dx, dz);
	const pull = reach > focus ? focus / reach - 1 : 0;
	const lowest = Math.max(focusHeight[0], ground(tx + dx * pull, tz + dz * pull));
	const shift = [
		dx * pull,
		Math.max(lowest, Math.min(focusHeight[1], ty)) - ty,
		dz * pull,
	] as const;
	if (shift[0] !== 0 || shift[1] !== 0 || shift[2] !== 0) {
		tx += shift[0];
		ty += shift[1];
		tz += shift[2];
		px += shift[0];
		py += shift[1];
		pz += shift[2];
		moved = true;
	}
	let floor = ground(px, pz) + clearance;
	if (py < floor) {
		const ox = px - tx;
		const oz = pz - tz;
		const distance = Math.hypot(ox, py - ty, oz);
		const across = Math.hypot(ox, oz);
		const ux = across > 1e-6 ? ox / across : 1;
		const uz = across > 1e-6 ? oz / across : 0;
		// Lifting the camera along its orbit draws it in across the ground, where the ground may
		// stand higher, so the lift settles over a few steps.
		for (let step = 0; step < 3; step++) {
			const rise = Math.min(distance, Math.max(-distance, floor - ty));
			const out = Math.sqrt(Math.max(0, distance * distance - rise * rise));
			px = tx + ux * out;
			py = ty + rise;
			pz = tz + uz * out;
			const next = ground(px, pz) + clearance;
			if (next <= floor) break;
			floor = next;
		}
		moved = true;
	}
	if (moved) {
		target[0] = tx;
		target[1] = ty;
		target[2] = tz;
		position[0] = px;
		position[1] = py;
		position[2] = pz;
	}
	return moved;
}

/** The cinematic camera of a showcase scene. */
export interface Cinematic {
	/** The mode now: `'auto'` follows the route, `'manual'` answers the user. */
	readonly mode: 'auto' | 'manual';
	/** Reads the frame's keys and, in Auto, moves the camera along the route. Call once per frame. */
	update(dt: number): void;
	/** Sends the controls model again, for a button or key that the scene answered itself. */
	refresh(): void;
	/** Switches between the route and the user's camera, as the `c` key does. */
	toggle(): void;
	/** Sets the camera mode from the HUD: `Auto` follows the route, `Manual` hands it to the user. */
	select(id: string): void;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
/** The power that the route's spline raises each shot's distance to: the centripetal form. */
const SPLINE_ALPHA = 0.5;
/** The shortest step between two knots, so two shots at one pose still have a tangent. */
const KNOT_FLOOR = 1e-3;

/**
 * One component of the centripetal Catmull-Rom spline through `v0` to `v3`, at the parameter `t`
 * between the knots `t1` and `t2`. The curve passes through `v1` at `t1` and `v2` at `t2`, and its
 * speed never falls to zero at a knot, so a route through the shots never stops at one.
 */
function catmullRom(
	v0: number,
	v1: number,
	v2: number,
	v3: number,
	t0: number,
	t1: number,
	t2: number,
	t3: number,
	t: number,
): number {
	const a1 = ((t1 - t) * v0 + (t - t0) * v1) / (t1 - t0);
	const a2 = ((t2 - t) * v1 + (t - t1) * v2) / (t2 - t1);
	const a3 = ((t3 - t) * v2 + (t - t2) * v3) / (t3 - t2);
	const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0);
	const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
	return ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
}
/** Seconds to glide from the user's camera onto the route, after a switch back to Auto. */
const GLIDE = 1.5;
/** How finely the nearest point of the route is searched, in samples around the loop. */
const SAMPLES = 240;
/** How much the look-at target counts against the camera's position, in the search. */
const TARGET_WEIGHT = 0.6;

/**
 * Makes a cinematic camera. The scene gives the shots of its route and the point its lens focuses
 * on. In Manual the user turns, zooms and pans the camera around the point the shot was looking at,
 * with the engine's orbit controls, and the keys pan it too.
 */
export function createCinematic(
	ctx: SketchContext,
	camera: PerspectiveCamera,
	options: CinematicOptions,
): Cinematic {
	const { input, time, page } = ctx;
	const { shots, keys = [], driver } = options;
	keyTable(keys, driver?.keys);
	const driving = new Set(driver?.keys.map((key) => key.code));
	/** Whether one of the driver's keys is down. Any other key reads as up. */
	const driverKey = (code: string): boolean => driving.has(code) && input.isDown(code);
	const route = routeTimeline(shots);
	const { starts, total } = route;
	// The pose of the route at a phase: camera position, then the point it looks at.
	const sample = new Float32Array(6);
	const pose = new Float32Array(6);
	const from = new Float32Array(6);
	/** The time at which a glide started, so the glide can follow the route as it runs. */
	let glideStart = 0;
	let mode: 'auto' | 'manual' = 'auto';
	/** The shift that keeps the route's phase, after a glide has landed on it. */
	let phaseShift = 0;
	/** How far the glide has gone, from 0 to 1; 1 means the route drives the camera. */
	let glide = 1;
	/** The phase that a glide resumes from. */
	let glideFrom = 0;
	let announced = false;

	// The manual camera: the engine's orbit controls. A left drag or one finger turns the camera
	// around its target, the wheel or a pinch zooms, and a right drag or two fingers pan. The keys
	// pan as well.
	const held = vec3.create();
	/** The Manual camera's position as its bounds keep it. */
	const inside = vec3.create();
	const heldRotation = quat.create();
	camera.getPosition(held);
	camera.getRotation(heldRotation);
	const { bounds } = options;
	const controls = createOrbitControls(ctx, camera, {
		// The Orbit preset: left turns, the middle zooms and the right pans; one finger turns and
		// two fingers dolly and pan. A scene's bounds keep the camera inside its mountains and above
		// its ground; without them the limits are wide.
		enableDamping: true,
		screenSpacePanning: false,
		minDistance: 0.5,
		maxDistance: bounds ? bounds.distance : Number.POSITIVE_INFINITY,
		minPolarAngle: 0.05,
		maxPolarAngle: bounds ? BOUNDED_POLAR_ANGLE : 3,
	});
	controls.enabled = false;
	// The controls turn the camera toward their target as they start: put it back where the route
	// left it.
	camera.setPosition(held[0] as number, held[1] as number, held[2] as number);
	camera.setRotation(
		heldRotation[0] as number,
		heldRotation[1] as number,
		heldRotation[2] as number,
		heldRotation[3] as number,
	);

	// The clearance guard of the Auto route: the camera never passes through the scene's solid
	// geometry there. The Manual camera is free and may pass through anything, so this runs only for
	// the route. A scene marks what fills the air with `markEffect`, so a snowflake is not a wall,
	// and an object whose inside shows with `markInterior`.
	const clearance = createClearance(ctx);
	const previousCamera = vec3.create();
	const allowed = vec3.create();
	let primed = false;

	/** Stops the Auto camera short of a surface, so it slides along it instead of passing through. */
	const guardRoute = (): void => {
		camera.getPosition(allowed);
		if (!primed) {
			vec3.set(previousCamera, allowed[0] as number, allowed[1] as number, allowed[2] as number);
			primed = true;
		}
		if (clearance.move(previousCamera, allowed, allowed))
			camera.setPosition(allowed[0] as number, allowed[1] as number, allowed[2] as number);
		camera.getPosition(previousCamera);
	};

	/** Writes the route's pose at a phase into `out`. */
	const routePose = (phase: number, out: Float32Array): void => routePosition(route, phase, out);

	/** The shot that a phase falls in. */
	const shotAt = (phase: number): Shot => {
		const a = ((phase % total) + total) % total || 0;
		let index = 0;
		for (let k = 0; k < shots.length; k++) if (a >= (starts[k] as number)) index = k;
		return shots[index] as Shot;
	};

	// The controls orbit the route's opening look-at until a takeover gives them their own target,
	// so their first update never turns the camera around the origin. The camera also takes the
	// opening pose now, so a frame drawn before the route's first step shows the opening view and
	// never the pose the camera was created at.
	routePose(0, sample);
	controls.target[0] = sample[3] as number;
	controls.target[1] = sample[4] as number;
	controls.target[2] = sample[5] as number;
	camera.setPosition(sample[0] as number, sample[1] as number, sample[2] as number);
	camera.lookAt(sample[3] as number, sample[4] as number, sample[5] as number);
	options.target[0] = sample[3] as number;
	options.target[1] = sample[4] as number;
	options.target[2] = sample[5] as number;

	/** The phase of the route whose pose is nearest to `at`, weighing the position and the target. */
	const nearestPhase = (at: Float32Array): number => {
		let best = 0;
		let bestCost = Infinity;
		for (let k = 0; k < SAMPLES; k++) {
			const phase = (k / SAMPLES) * total;
			routePose(phase, sample);
			let cost = 0;
			for (let c = 0; c < 3; c++) {
				cost += ((sample[c] as number) - (at[c] as number)) ** 2;
				cost += TARGET_WEIGHT * ((sample[3 + c] as number) - (at[3 + c] as number)) ** 2;
			}
			if (cost < bestCost) {
				bestCost = cost;
				best = phase;
			}
		}
		return best;
	};

	/** Moves the camera to a pose, and points the lens at what it looks at. */
	const apply = (p: Float32Array): void => {
		const px = p[0] as number;
		const py = p[1] as number;
		const pz = p[2] as number;
		const tx = p[3] as number;
		const ty = p[4] as number;
		const tz = p[5] as number;
		camera.setPosition(px, py, pz);
		camera.lookAt(tx, ty, tz);
		options.target[0] = tx;
		options.target[1] = ty;
		options.target[2] = tz;
	};

	/** Sends the whole controls model to the page, with the camera group first. */
	const postControls = (): void => {
		const groups: HudGroup[] = [
			radioGroup('camera', 'Camera', CAMERA_OPTIONS, mode === 'manual' ? 'Manual' : 'Auto'),
			...(options.groups?.() ?? []),
		];
		page.post('hud', { groups, visible: true });
	};

	/** Switches the camera between the route and the user, as the `c` key and the button do. */
	const toggleMode = (): void => {
		if (mode === 'auto') {
			// The route's motion stops at once, and the user takes the camera exactly where it is:
			// never a snap to a shot. A takeover during the glide back onto the route keeps the
			// mid-glide pose, so the camera never jumps either. The controls take their target from
			// what the shot was looking at, so the camera holds still until the user moves it.
			if (glide < 1) {
				camera.getPosition(pose);
				pose[3] = options.target[0];
				pose[4] = options.target[1];
				pose[5] = options.target[2];
			} else {
				routePose(time.now + phaseShift, pose);
				apply(pose);
			}
			// A fling that damping still carries is dropped, so the camera is still from the first
			// frame of the switch.
			controls.stop();
			controls.target[0] = pose[3] as number;
			controls.target[1] = pose[4] as number;
			controls.target[2] = pose[5] as number;
			mode = 'manual';
			glide = 1;
			// A scene that the user drives moves the camera itself, so the orbit controls stay off.
			if (driver) driver.take();
			else controls.enabled = true;
		} else {
			// Auto glides: find the nearest point of the route, then ease onto it. The motion the
			// controls still carry is dropped, so no fling resumes when the user takes over again.
			mode = 'auto';
			controls.stop();
			controls.enabled = false;
			primed = false;
			camera.getPosition(from);
			from[3] = options.target[0];
			from[4] = options.target[1];
			from[5] = options.target[2];
			glideFrom = nearestPhase(from);
			// The glide measures the route from the moment it starts, so it lands on the moving route
			// and takes its speed, rather than setting off from a standstill.
			glideStart = time.now;
			glide = 0;
		}
		postControls();
	};

	// Send the model once, so the HUD shows before the first change.
	postControls();

	return {
		get mode() {
			return mode;
		},
		refresh() {
			postControls();
		},
		toggle() {
			toggleMode();
		},
		select(id) {
			const wanted = id === 'Manual' ? 'manual' : 'auto';
			if (wanted !== mode) toggleMode();
		},
		update(dt) {
			// Send the model again on the first frame, since the page binds its listener after the
			// sketch's setup runs.
			if (!announced) {
				announced = true;
				postControls();
			}
			if (input.wasPressed(KEY.mode)) toggleMode();
			for (const key of keys) if (input.wasPressed(key.code)) key.press();
			if (mode === 'manual' && driver) {
				driver.update(dt, driverKey);
				return;
			}
			if (mode === 'manual') {
				// The keys pan: W and S see forward and back, A and D move across, R and F rise and
				// fall. The controls take screen pixels, so the frame's step scales the speed.
				const step = (options.speed ?? 420) * dt;
				let across = 0;
				let along = 0;
				if (input.isDown(KEY.left)) across += step;
				if (input.isDown(KEY.right)) across -= step;
				if (input.isDown(KEY.forward)) along += step;
				if (input.isDown(KEY.back)) along -= step;
				if (across !== 0 || along !== 0) controls.pan(across, along);
				let rise = 0;
				if (input.isDown(KEY.rise)) rise += step / 60;
				if (input.isDown(KEY.fall)) rise -= step / 60;
				if (rise !== 0) {
					controls.target[1] = (controls.target[1] as number) + rise;
					camera.getPosition(from);
					camera.setPosition(from[0] as number, (from[1] as number) + rise, from[2] as number);
				}
				controls.update(dt);
				if (bounds) {
					camera.getPosition(inside);
					if (keepInside(bounds, controls.target, inside)) {
						camera.setPosition(inside[0] as number, inside[1] as number, inside[2] as number);
						camera.lookAt(controls.target[0], controls.target[1], controls.target[2]);
					}
				}
				// The lens focuses on the point that the camera turns around.
				options.target[0] = controls.target[0] as number;
				options.target[1] = controls.target[1] as number;
				options.target[2] = controls.target[2] as number;
				return;
			}
			if (glide < 1) {
				// Ease from the user's pose onto the route, which carries on while the glide runs: the
				// blend reaches the route's own pose at the route's own speed.
				glide = Math.min(1, glide + dt / GLIDE);
				const b = smooth(glide);
				routePose(glideFrom + (time.now - glideStart), sample);
				for (let c = 0; c < 6; c++)
					pose[c] = (from[c] as number) + ((sample[c] as number) - (from[c] as number)) * b;
				if (glide >= 1) phaseShift = glideFrom - glideStart;
			} else {
				routePose(time.now + phaseShift, pose);
			}
			apply(pose);
			// The route never passes through an object, unless its shot asks to reveal an inside.
			if (!shotAt(glide < 1 ? glideFrom : time.now + phaseShift).through) guardRoute();
		},
	};
}
