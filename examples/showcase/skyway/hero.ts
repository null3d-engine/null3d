// The hero car of Skyway: a courier's hover car with a cockpit (see body.ts). In Auto it leads the
// camera through the city: it flies ahead of the shot and just below it, in the middle of the
// frame, so its tail lights and engine glow carry the eye down the street. In Manual the user drives
// it (see drive.ts for the flight). The camera follows it from behind or sits in the driver's seat,
// and a switch between the two flies the camera over the canopy and down into the seat, or back.
//
// Its paint is a clear coat over a deep blue, with amber running lights down its flanks, and the
// cockpit's trim is dark and matte. A tinted glass canopy closes the cockpit. Three screens from the
// screens add-on stand on the dashboard: the speed, the altitude and the navigation map. Each
// refreshes at its own rate, and only the part of its picture that changed uploads, so a number, a
// bar and a moving dot cost no frame work. Two spot lights at the nose light the rain ahead, and a
// lamp under the belly spills the car's colour on the air below it.
import { math, type PerspectiveCamera, quat, type SketchContext, vec3 } from '@null3d/engine';
import type { HudGroup } from '../../lib/controls';
import { EFFECT_LAYER } from '../../lib/layers';
import { CONSOLE, createCanopy, createShell, FITTINGS, WELL } from './body';
import { createCockpit } from './cockpit';
import { createConsole } from './console';
import { cityTowers, type Flight, fly, keepOut, type Stick } from './drive';

/** How far ahead of the Auto camera the car flies, and how far below, in meters. */
const [AHEAD, BELOW] = [26, 5.2];
/** The scale of the hull, so the car is a little under five meters long. */
const SCALE = 2.2;
/** The driver's eye, in the body's own units: over the seat, under the canopy's ridge. */
const SEAT = [0, 0.96, -0.3] as const;
/** How long the camera takes to fly into the seat or back out behind the car, in seconds. */
const TRANSITION = 0.9;
/** How high the camera's path rises over the canopy on its way in or out, in meters. */
const ARC = 1.2;
/** The chase camera's place behind the car and above it, and how far ahead of the car it looks. */
const CHASE = { behind: 13, above: 4.4, ahead: 22, lift: 1.4 };
/** How quickly the chase camera follows the car's place and its look, per second. */
const CHASE_FOLLOW = 7;
/** The chase camera's tilt above the car, and its distance from it. */
const CHASE_TILT = Math.atan2(CHASE.above, CHASE.behind);
const CHASE_DISTANCE = Math.hypot(CHASE.behind, CHASE.above);
/**
 * How a drag and the wheel move the camera while the user drives: radians of turn and of tilt per
 * CSS pixel of drag, the zoom per pixel of scroll, and the nearest and farthest the chase camera
 * sits. In the seat a drag turns the driver's head, as far as `head` and `nod` allow.
 */
const ORBIT = { turn: 0.006, tilt: 0.004, zoom: 0.0015, near: 6, far: 70, head: 1.9, nod: 0.9 };
/**
 * How long the camera waits after the last drag before it eases back behind the car or straight
 * ahead, in seconds, and how quickly it eases, per second. It eases only while the car moves, so a
 * user may look round a car that hovers.
 */
const SETTLE = { wait: 1.5, rate: 1.6, speed: 2 };

/** The keys that drive the car, as the cinematic camera's table lists them. */
export const DRIVE_KEYS = [
	{ code: 'KeyW', does: 'speed the hover car up' },
	{ code: 'KeyS', does: 'slow the hover car down, then reverse' },
	{ code: 'KeyA', does: 'turn the hover car left' },
	{ code: 'KeyD', does: 'turn the hover car right' },
	{ code: 'KeyR', does: 'climb' },
	{ code: 'KeyF', does: 'sink' },
] as const;

/** Where the camera sits: behind the car, or in the driver's seat. */
export type View = 'chase' | 'cockpit';

const paintWgsl = /* wgsl */ `
struct Uniforms { glow: f32, well: f32, wellZ: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // The body's own place, which its texture coordinates carry, so the paint turns with the car.
    let d = vec3f(input.uv.x, input.uv.y, input.uv1.x);
    // The cockpit's trim: the well's walls and floor, dark and matte.
    let trim = step(abs(d.x), material.well + 0.005) * step(abs(d.z), material.wellZ + 0.005)
        * step(d.y, 0.86);
    // The flanks carry a strip of amber running lights.
    let strip = step(0.86, abs(d.x)) * step(abs(d.z), 1.7) * step(0.3, d.y) * step(d.y, 0.46);

    s.baseColor = mix(vec3f(0.035, 0.05, 0.075), vec3f(0.004, 0.005, 0.007), trim);
    s.metalness = mix(0.55, 0.0, trim);
    s.roughness = mix(0.24, 0.95, trim);
    s.clearcoat = 1.0 - trim;
    s.clearcoatRoughness = 0.12;
    s.emissive = vec3f(1.0, 0.35, 0.06) * strip * 2.6;
    // A thin cold line under the belly, and the engine's light at the tail.
    let belly = step(d.y, 0.16) * step(0.02, d.y);
    s.emissive += vec3f(0.15, 0.6, 1.0) * belly * material.glow;
    let tail = 1.0 - step(-1.55, d.z);
    s.emissive += vec3f(0.3, 0.75, 1.0) * tail * material.glow * 0.6;
    return s;
}
`;

const glowWgsl = /* wgsl */ `
struct Uniforms { strength: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = vec3f(0.0);
    s.metalness = 0.0;
    s.roughness = 1.0;
    s.emissive = vec3f(0.35, 0.8, 1.0) * material.strength;
    return s;
}
`;

/** The hero car of the scene. */
export interface Hero {
	/** Where the camera sits now. */
	readonly view: View;
	/** Puts the camera behind the car or in its seat. */
	setView(view: View): void;
	/** Shows the scene's controls on the console, as the page's panel shows them. */
	showControls(groups: readonly HudGroup[]): void;
	/**
	 * Takes the on-screen pad's wishes, each from -1 to 1: the throttle, the steer to the left and
	 * the lift. The keys add to them.
	 */
	setPad(throttle: number, steer: number, lift: number): void;
	/** Hands the car to the user from where Auto left it, at the speed it flew. */
	take(): void;
	/** Flies the car on the user's keys and places the camera after it. Call once per Manual frame. */
	drive(dt: number, held: (code: string) => boolean): void;
	/**
	 * Flies the car after the Auto camera, or carries the camera in its seat, then lights the
	 * engine and reads out the flight. Call once per frame, after the camera moves.
	 */
	update(dt: number, t: number, auto: boolean): void;
}

/** Where the car starts, from the route's opening pose. */
export interface HeroStart {
	position: readonly [number, number, number];
	target: readonly [number, number, number];
}

/**
 * Builds the hero car, and puts it where the opening shot leaves it. `focus` is the point that the
 * lens focuses on, which the car keeps while the user drives.
 */
export function createHero(
	ctx: SketchContext,
	camera: PerspectiveCamera,
	start: HeroStart,
	focus: [number, number, number],
): Hero {
	const { scene, geometry, materials, page, input } = ctx;
	const group = scene.createGroup({ name: 'hero' });
	const body = scene.createGroup({ parent: group, scale: [SCALE, SCALE, SCALE] });

	const paint = materials.shader({
		wgsl: paintWgsl,
		uniforms: { glow: 1, well: WELL.half, wellZ: WELL.front },
		color: '#1a2536',
		roughness: 0.24,
		metalness: 0.55,
		clearcoat: 1,
		clearcoatRoughness: 0.12,
		// The cockpit's walls face in, so both faces of the shell draw.
		doubleSided: true,
	});
	scene.createMesh({ mesh: createShell(ctx), material: paint, parent: body, layers: EFFECT_LAYER });
	// The cockpit's seat, yoke and dashboard. The car's own lamps sit a meter from them, so they
	// would light them far brighter than the city does: they take no light, and keep a dark shade.
	const fittings = materials.unlit({ color: '#0c1118' });
	for (const fitting of FITTINGS) {
		scene.createMesh({
			mesh: geometry.box({
				width: fitting.size[0],
				height: fitting.size[1],
				depth: fitting.size[2],
			}),
			material: fittings,
			position: [fitting.at[0], fitting.at[1], fitting.at[2]],
			parent: body,
			layers: EFFECT_LAYER,
			castShadows: false,
		});
	}
	// The canopy: tinted glass, which shows the lit cockpit dimly from outside and the city from in.
	scene.createMesh({
		mesh: createCanopy(ctx),
		material: materials.standard({
			color: '#0a1620',
			roughness: 0.05,
			metalness: 0,
			opacity: 0.3,
			alphaMode: 'blend',
			doubleSided: true,
		}),
		parent: body,
		layers: EFFECT_LAYER,
		castShadows: false,
	});

	// The engine's two nozzles, and the lamp that plays behind them.
	const engine = materials.shader({ wgsl: glowWgsl, uniforms: { strength: 4 }, fog: false });
	for (const side of [-1, 1]) {
		scene.createMesh({
			mesh: geometry.sphere({ radius: 0.17, widthSegments: 14, heightSegments: 10 }),
			material: engine,
			position: [side * 0.46, 0.52, -2.02],
			scale: [1, 1, 0.6],
			parent: body,
			layers: EFFECT_LAYER,
			castShadows: false,
		});
	}
	const engineLight = scene.createPointLight({
		position: [0, 0.55, -2.6],
		color: '#4fb8ff',
		intensity: 220,
		range: 14,
		parent: body,
		layers: EFFECT_LAYER,
	});

	// The screens on the dashboard, turned up toward the driver's eye.
	const tilt = quat.create();
	quat.fromEuler(tilt, -0.5, Math.PI, 0, 'YXZ');
	const cockpit = createCockpit(ctx, body, tilt);
	// The console on the dashboard's face, which repeats the scene's controls for the driver.
	const lean = quat.create();
	quat.fromEuler(lean, -CONSOLE.lean, Math.PI, 0, 'YXZ');
	const touchscreen = createConsole(ctx, body, lean, CONSOLE.at, CONSOLE.size);

	// The nose lamps light the rain and the street ahead, and a lamp under the belly spills the
	// car's own colour on the air below it.
	for (const side of [-1, 1]) {
		scene.createSpotLight({
			position: [side * 0.55, 0.46, 1.9],
			direction: [side * 0.05, -0.08, 1],
			color: '#dbeaff',
			intensity: 2600,
			range: 110,
			angle: 0.38,
			penumbra: 0.7,
			parent: body,
			layers: EFFECT_LAYER,
		});
	}
	scene.createPointLight({
		position: [0, -0.2, -0.3],
		color: '#3fa8ff',
		intensity: 160,
		range: 16,
		parent: body,
		layers: EFFECT_LAYER,
	});

	// The place now, the place last frame, and the vectors that fly the car and place the camera.
	const at = vec3.create();
	const before = vec3.create();
	const eye = vec3.create();
	const turn = quat.create();
	const ahead = vec3.create();
	const goal = vec3.create();
	const spin = quat.create();
	const look = vec3.create();
	const seat = vec3.create();
	let yaw = 0;
	let pitch = 0;
	let roll = 0;
	let speed = 0;
	let view: View = 'chase';
	/** How far the camera is on its way into the seat: 0 behind the car, 1 in the seat. */
	let inside = 0;
	/** True while the user drives, until the next frame in Auto. */
	let driving = false;
	/** The car's place and yaw as it trails the Auto camera. */
	const trail = vec3.create();
	let trailYaw = 0;
	/** The point that the seat looks at, and the camera's place on its way in or out. */
	const sight = vec3.create();
	const path = vec3.create();

	const towers = cityTowers();
	const flight: Flight = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, climb: 0, turning: 0 };
	const stick: Stick = { throttle: 0, steer: 0, lift: 0 };
	/** The on-screen pad's wishes, which a touch screen drives with. */
	const pad: Stick = { throttle: 0, steer: 0, lift: 0 };
	/** Adds a key pair's wish to the pad's, within -1 to 1. */
	const wish = (plus: boolean, minus: boolean, touch: number): number =>
		math.clamp((plus ? 1 : 0) - (minus ? 1 : 0) + touch, -1, 1);
	/** The chase camera's place, which keeps out of the towers as the car does. */
	const chase: Flight = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, climb: 0, turning: 0 };
	/**
	 * How far a drag has turned the camera from behind the car, or the driver's head from straight
	 * ahead, the chase camera's distance, and the seconds since the last press.
	 */
	const orbit = { turn: 0, tilt: 0, distance: CHASE_DISTANCE, idle: SETTLE.wait };

	/**
	 * Turns the camera with a drag of the pointer or a finger, and zooms the chase camera with the
	 * wheel or a pinch. After a while with no press, while the car moves, the camera eases back.
	 */
	const steerCamera = (dt: number): void => {
		const { pointer } = input;
		orbit.idle = pointer.buttons !== 0 ? 0 : orbit.idle + dt;
		orbit.turn -= pointer.dragDx * ORBIT.turn;
		orbit.tilt += pointer.dragDy * ORBIT.tilt;
		if (view === 'cockpit') {
			orbit.turn = math.clamp(orbit.turn, -ORBIT.head, ORBIT.head);
			orbit.tilt = math.clamp(orbit.tilt, -ORBIT.nod, ORBIT.nod);
		} else {
			orbit.turn = Math.atan2(Math.sin(orbit.turn), Math.cos(orbit.turn));
			orbit.tilt = math.clamp(orbit.tilt, -0.15 - CHASE_TILT, 1.3 - CHASE_TILT);
			if (pointer.wheel !== 0)
				orbit.distance = math.clamp(
					orbit.distance * Math.exp(pointer.wheel * ORBIT.zoom),
					ORBIT.near,
					ORBIT.far,
				);
		}
		if (orbit.idle > SETTLE.wait && speed > SETTLE.speed) {
			const k = 1 - Math.exp(-SETTLE.rate * dt);
			orbit.turn -= orbit.turn * k;
			orbit.tilt -= orbit.tilt * k;
		}
	};

	/** Turns the car to its yaw, pitch and roll, and puts it at `at`. */
	const pose = (): void => {
		quat.fromEuler(spin, pitch, yaw, roll, 'YXZ');
		group.setPose(at, spin);
	};

	/** Writes the driver's eye into `seat`, from the car's place and turn. */
	const seatPlace = (): void => {
		vec3.set(seat, SEAT[0] * SCALE, SEAT[1] * SCALE, SEAT[2] * SCALE);
		vec3.transformQuat(seat, seat, spin);
		vec3.add(seat, seat, at);
	};

	/** Puts the camera in the driver's seat, looking along the nose. */
	const ride = (): void => {
		seatPlace();
		camera.setPosition(seat[0] as number, seat[1] as number, seat[2] as number);
		// The camera looks along its own -Z, so it turns half a turn more than the nose, and its pitch
		// and roll mirror the car's. A drag turns the driver's head from there.
		quat.fromEuler(turn, -pitch - orbit.tilt, yaw + Math.PI + orbit.turn, -roll, 'YXZ');
		camera.setRotation(turn[0] as number, turn[1] as number, turn[2] as number, turn[3] as number);
	};

	/** Moves the camera's way in or out of the seat on by a frame, toward the view chosen. */
	const travel = (dt: number): void => {
		const step = dt / TRANSITION;
		inside = view === 'cockpit' ? Math.min(1, inside + step) : Math.max(0, inside - step);
	};

	/**
	 * Flies the camera between `from`, the place behind the car, looking at `toward`, and the seat.
	 * The path rises over the canopy and comes down through it, and the look turns from the car's
	 * way ahead to the seat's.
	 */
	const between = (
		share: number,
		fromX: number,
		fromY: number,
		fromZ: number,
		toward: Float32Array | number[],
	): void => {
		const e = share * share * (3 - 2 * share);
		seatPlace();
		const sx = Math.sin(yaw);
		const sz = Math.cos(yaw);
		vec3.set(
			sight,
			(seat[0] as number) + sx * CHASE.ahead,
			seat[1] as number,
			(seat[2] as number) + sz * CHASE.ahead,
		);
		const rise = Math.sin(Math.PI * e) * ARC;
		vec3.set(
			path,
			fromX + ((seat[0] as number) - fromX) * e,
			fromY + ((seat[1] as number) - fromY) * e + rise,
			fromZ + ((seat[2] as number) - fromZ) * e,
		);
		camera.setPosition(path[0] as number, path[1] as number, path[2] as number);
		camera.lookAt(
			(toward[0] as number) + ((sight[0] as number) - (toward[0] as number)) * e,
			(toward[1] as number) + ((sight[1] as number) - (toward[1] as number)) * e,
			(toward[2] as number) + ((sight[2] as number) - (toward[2] as number)) * e,
		);
	};

	/**
	 * Puts the camera behind the car, or where a drag turned it round the car, easing after it. It
	 * looks down the car's way from behind, and at the car itself once a drag turns it away.
	 */
	const follow = (dt: number, snap: boolean): void => {
		const sx = Math.sin(yaw);
		const sz = Math.cos(yaw);
		const k = snap ? 1 : 1 - Math.exp(-CHASE_FOLLOW * dt);
		const around = yaw + Math.PI + orbit.turn;
		const tilt = CHASE_TILT + orbit.tilt;
		const level = Math.cos(tilt) * orbit.distance;
		chase.x += ((at[0] as number) + Math.sin(around) * level - chase.x) * k;
		chase.y += ((at[1] as number) + Math.sin(tilt) * orbit.distance - chase.y) * k;
		chase.z += ((at[2] as number) + Math.cos(around) * level - chase.z) * k;
		// The camera never sits inside a tower, though the car may hug one.
		keepOut(chase, towers);
		const lead =
			CHASE.ahead * math.clamp(1 - (Math.abs(orbit.turn) + Math.abs(orbit.tilt)) / 0.6, 0, 1);
		vec3.set(
			goal,
			(at[0] as number) + sx * lead,
			(at[1] as number) + CHASE.lift,
			(at[2] as number) + sz * lead,
		);
		for (let c = 0; c < 3; c++)
			look[c] = (look[c] as number) + ((goal[c] as number) - (look[c] as number)) * k;
	};

	/** Places the camera behind the car, in its seat, or on the way between, as `inside` says. */
	const place = (): void => {
		if (inside >= 1) ride();
		else if (inside <= 0) {
			camera.setPosition(chase.x, chase.y, chase.z);
			camera.lookAt(look[0] as number, look[1] as number, look[2] as number);
		} else between(inside, chase.x, chase.y, chase.z, look);
	};

	/** Puts the car where the opening shot looks, so the first frame shows it in place. */
	const opening = (): void => {
		const [px, py, pz] = start.position;
		const [tx, ty, tz] = start.target;
		vec3.set(ahead, tx - px, ty - py, tz - pz);
		vec3.normalize(ahead, ahead);
		vec3.set(at, px + ahead[0] * AHEAD, py + ahead[1] * AHEAD - BELOW, pz + ahead[2] * AHEAD);
		vec3.copy(goal, at);
		vec3.copy(trail, at);
		yaw = Math.atan2(ahead[0], ahead[2]);
		trailYaw = yaw;
		pose();
		vec3.copy(before, at);
	};
	opening();

	return {
		get view() {
			return view;
		},
		setView(next) {
			if (next === view) return;
			view = next;
			// Each view starts from its own rest: behind the car, or looking straight ahead. The camera
			// then flies from one to the other.
			orbit.turn = 0;
			orbit.tilt = 0;
		},
		showControls(groups) {
			touchscreen.show(groups);
		},
		setPad(throttle, steer, lift) {
			pad.throttle = throttle;
			pad.steer = steer;
			pad.lift = lift;
		},
		take() {
			driving = true;
			// A touch screen has no keys, so the page shows its driving pad while the user drives.
			page.post('drive-pad', { visible: true });
			flight.x = at[0] as number;
			flight.y = at[1] as number;
			flight.z = at[2] as number;
			flight.yaw = yaw;
			flight.speed = speed;
			flight.climb = 0;
			// The chase camera starts at the Auto camera's place and eases behind the car.
			camera.getPosition(eye);
			chase.x = eye[0] as number;
			chase.y = eye[1] as number;
			chase.z = eye[2] as number;
			vec3.copy(look, at);
		},
		drive(dt, held) {
			driving = true;
			stick.throttle = wish(held('KeyW'), held('KeyS'), pad.throttle);
			stick.steer = wish(held('KeyA'), held('KeyD'), pad.steer);
			stick.lift = wish(held('KeyR'), held('KeyF'), pad.lift);
			fly(flight, stick, dt, towers);
			vec3.set(at, flight.x, flight.y, flight.z);
			yaw = flight.yaw;
			// The car banks into a turn and lifts its nose as it climbs.
			roll = math.damp(roll, math.clamp(-flight.turning * 0.3, -0.35, 0.35), 6, dt);
			pitch = math.damp(pitch, math.clamp(-flight.climb * 0.012, -0.18, 0.18), 6, dt);
			speed = Math.abs(flight.speed);
			pose();
			steerCamera(dt);
			travel(dt);
			follow(dt, false);
			place();
			focus[0] = at[0] as number;
			focus[1] = at[1] as number;
			focus[2] = at[2] as number;
		},
		update(dt, t, auto) {
			if (auto) {
				if (driving) {
					// Back in Auto, the car levels out as it eases after the route again.
					driving = false;
					page.post('drive-pad', { visible: false });
					pad.throttle = 0;
					pad.steer = 0;
					pad.lift = 0;
					pitch = 0;
					vec3.copy(trail, at);
					trailYaw = yaw;
					orbit.turn = 0;
					orbit.tilt = 0;
					orbit.distance = CHASE_DISTANCE;
				}
				travel(dt);
				// The route's place this frame, as the cinematic camera just set it. The world place
				// is last frame's, which in the seat view is the car's own seat.
				camera.getPosition(eye);
				camera.getRotation(turn);
				vec3.transformQuat(ahead, [0, 0, -1], turn);
				// The car trails the shot, ahead of it and in the middle of the frame, easing after
				// it, and turns to its own travel, so a turn of the route banks it.
				const wasX = trail[0] as number;
				const wasZ = trail[2] as number;
				vec3.set(
					goal,
					(eye[0] as number) + ahead[0] * AHEAD,
					(eye[1] as number) + ahead[1] * AHEAD - BELOW,
					(eye[2] as number) + ahead[2] * AHEAD,
				);
				for (let k = 0; k < 3; k++)
					trail[k] = math.damp(trail[k] as number, goal[k] as number, 5.5, dt);
				const tx = (trail[0] as number) - wasX;
				const tz = (trail[2] as number) - wasZ;
				let banking = 0;
				if (Math.hypot(tx, tz) > dt * 0.6) {
					let gap = Math.atan2(tx, tz) - trailYaw;
					gap = Math.atan2(Math.sin(gap), Math.cos(gap));
					const next = gap * (1 - Math.exp(-6 * dt));
					trailYaw += next;
					banking = math.clamp((-next / Math.max(dt, 1e-3)) * 0.06, -0.4, 0.4);
				}
				vec3.copy(at, trail);
				yaw = trailYaw;
				roll = math.damp(roll, banking, 7, dt);
				pose();
				// The car never moves for a view: the seat view puts the camera in its seat as it
				// flies, and the way in or out flies the camera between the route's place, behind
				// and above the car, and the seat.
				if (inside >= 1) ride();
				else if (inside > 0) {
					vec3.set(
						goal,
						(eye[0] as number) + ahead[0] * CHASE.ahead,
						(eye[1] as number) + ahead[1] * CHASE.ahead,
						(eye[2] as number) + ahead[2] * CHASE.ahead,
					);
					between(inside, eye[0] as number, eye[1] as number, eye[2] as number, goal);
				}
				const dx = (at[0] as number) - (before[0] as number);
				const dz = (at[2] as number) - (before[2] as number);
				speed = math.damp(speed, Math.hypot(dx, dz) / Math.max(dt, 1e-3), 5, dt);
			}
			vec3.copy(before, at);
			engine.set({ strength: 2.6 + Math.sin(t * 17) * 0.45 });
			engineLight.setIntensity(130 + Math.sin(t * 17) * 26);
			// The panels read out the flight at their own rates.
			cockpit.update(t, speed * 3.6, at[1] as number);
			touchscreen.update();
		},
	};
}
