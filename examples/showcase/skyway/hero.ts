// The hero car of Skyway: a courier's hover car. In Auto it leads the camera through the city: it
// flies ahead of the shot and just below it, in the middle of the frame, so its tail lights and
// engine glow carry the eye down the street. In Manual the user drives it, and the camera follows
// it from behind or rides in the driver's seat (see drive.ts for the flight).
//
// Its paint is a clear coat over a deep blue, with amber running lights down its flanks. Three
// panels carry screens from the screens add-on: the speed, the altitude and the navigation map.
// They sit on the rear deck for the view from behind, and on the dashboard for the view from the
// seat. Each refreshes at its own rate, and only the part of its picture that changed uploads, so a
// number, a bar and a moving dot cost no frame work. Two spot lights at the nose light the rain
// ahead, and a lamp under the belly spills the car's colour on the air below it.
import { math, type PerspectiveCamera, quat, type SketchContext, vec3 } from '@null3d/engine';
import { createVehicleHull } from '../../addons/traffic-lanes/index';
import { EFFECT_LAYER } from '../../lib/layers';
import { createCockpit } from './cockpit';
import { cityTowers, type Flight, fly, keepOut, type Stick } from './drive';

/** How far ahead of the Auto camera the car flies, and how far below, in meters. */
const [AHEAD, BELOW] = [26, 5.2];
/** The scale of the hull, so the car is a little under five meters long. */
const SCALE = 2.2;
/** The driver's eye, in the body's own units: low under the canopy, just behind its windshield. */
const SEAT = [0, 0.93, 0.18] as const;
/** The chase camera's place behind the car and above it, and how far ahead of the car it looks. */
const CHASE = { behind: 13, above: 4.4, ahead: 22, lift: 1.4 };
/** How quickly the chase camera follows the car's place and its look, per second. */
const CHASE_FOLLOW = 7;

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
struct Uniforms { scale: f32, glow: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    let d = (input.worldPosition - object.position) / material.scale;
    // The canopy is glass: dark, smooth and quick to mirror the street.
    let canopy = step(0.85, d.y) * step(abs(d.z), 1.1);
    // The flanks carry a strip of amber running lights.
    let strip = step(0.86, abs(d.x)) * step(abs(d.z), 1.7) * step(0.3, d.y) * step(d.y, 0.46);

    s.baseColor = mix(vec3f(0.035, 0.05, 0.075), vec3f(0.01, 0.014, 0.02), canopy);
    s.metalness = mix(0.55, 0.95, canopy);
    s.roughness = mix(0.24, 0.04, canopy);
    s.clearcoat = mix(1.0, 0.0, canopy);
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
	const { scene, geometry, materials } = ctx;
	const group = scene.createGroup({ name: 'hero' });
	const body = scene.createGroup({ parent: group, scale: [SCALE, SCALE, SCALE] });

	const paint = materials.shader({
		wgsl: paintWgsl,
		uniforms: { scale: SCALE, glow: 1 },
		color: '#1a2536',
		roughness: 0.24,
		metalness: 0.55,
		clearcoat: 1,
		clearcoatRoughness: 0.12,
	});
	scene.createMesh({
		mesh: createVehicleHull(ctx),
		material: paint,
		parent: body,
		layers: EFFECT_LAYER,
	});
	// The dashboard under the panels, inside the hull: only the view from the seat sees it.
	scene.createMesh({
		mesh: geometry.box({ width: 1.3, height: 0.08, depth: 0.34 }),
		material: materials.standard({ color: '#0b1018', roughness: 0.6, metalness: 0.3 }),
		position: [0, 0.71, 0.72],
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

	// The panels, turned up toward the eye that reads them.
	const tilt = quat.create();
	quat.fromEuler(tilt, -0.42, Math.PI, 0, 'YXZ');
	const cockpit = createCockpit(ctx, body, tilt);

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
		position: [0, 0.12, -0.3],
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
	/** True while the user drives, until the next frame in Auto. */
	let driving = false;

	const towers = cityTowers();
	const flight: Flight = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, climb: 0, turning: 0 };
	const stick: Stick = { throttle: 0, steer: 0, lift: 0 };
	/** The chase camera's place, which keeps out of the towers as the car does. */
	const chase: Flight = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, climb: 0, turning: 0 };

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
		// and roll mirror the car's.
		quat.fromEuler(turn, -pitch, yaw + Math.PI, -roll, 'YXZ');
		camera.setRotation(turn[0] as number, turn[1] as number, turn[2] as number, turn[3] as number);
	};

	/** Puts the camera behind the car, easing after it, and looks down the car's way. */
	const follow = (dt: number, snap: boolean): void => {
		const sx = Math.sin(yaw);
		const sz = Math.cos(yaw);
		const k = snap ? 1 : 1 - Math.exp(-CHASE_FOLLOW * dt);
		chase.x += ((at[0] as number) - sx * CHASE.behind - chase.x) * k;
		chase.y += ((at[1] as number) + CHASE.above - chase.y) * k;
		chase.z += ((at[2] as number) - sz * CHASE.behind - chase.z) * k;
		// The camera never sits inside a tower, though the car may hug one.
		keepOut(chase, towers);
		vec3.set(
			goal,
			(at[0] as number) + sx * CHASE.ahead,
			(at[1] as number) + CHASE.lift,
			(at[2] as number) + sz * CHASE.ahead,
		);
		for (let c = 0; c < 3; c++)
			look[c] = (look[c] as number) + ((goal[c] as number) - (look[c] as number)) * k;
		camera.setPosition(chase.x, chase.y, chase.z);
		camera.lookAt(look[0] as number, look[1] as number, look[2] as number);
	};

	/** Puts the car where the opening shot looks, so the first frame shows it in place. */
	const opening = (): void => {
		const [px, py, pz] = start.position;
		const [tx, ty, tz] = start.target;
		vec3.set(ahead, tx - px, ty - py, tz - pz);
		vec3.normalize(ahead, ahead);
		vec3.set(at, px + ahead[0] * AHEAD, py + ahead[1] * AHEAD - BELOW, pz + ahead[2] * AHEAD);
		vec3.copy(goal, at);
		yaw = Math.atan2(ahead[0], ahead[2]);
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
			cockpit.place(view === 'cockpit');
			// The chase camera starts where it belongs, so the switch never sweeps through the city.
			if (driving && view === 'chase') follow(0, true);
		},
		take() {
			driving = true;
			flight.x = at[0] as number;
			flight.y = at[1] as number;
			flight.z = at[2] as number;
			flight.yaw = yaw;
			flight.speed = speed;
			flight.climb = 0;
			// The chase camera starts at the Auto camera's place and eases behind the car.
			camera.getWorldPosition(eye);
			chase.x = eye[0] as number;
			chase.y = eye[1] as number;
			chase.z = eye[2] as number;
			vec3.copy(look, at);
		},
		drive(dt, held) {
			driving = true;
			stick.throttle = (held('KeyW') ? 1 : 0) - (held('KeyS') ? 1 : 0);
			stick.steer = (held('KeyA') ? 1 : 0) - (held('KeyD') ? 1 : 0);
			stick.lift = (held('KeyR') ? 1 : 0) - (held('KeyF') ? 1 : 0);
			fly(flight, stick, dt, towers);
			vec3.set(at, flight.x, flight.y, flight.z);
			yaw = flight.yaw;
			// The car banks into a turn and lifts its nose as it climbs.
			roll = math.damp(roll, math.clamp(-flight.turning * 0.3, -0.35, 0.35), 6, dt);
			pitch = math.damp(pitch, math.clamp(-flight.climb * 0.012, -0.18, 0.18), 6, dt);
			speed = Math.abs(flight.speed);
			pose();
			if (view === 'cockpit') ride();
			else follow(dt, false);
			focus[0] = at[0] as number;
			focus[1] = at[1] as number;
			focus[2] = at[2] as number;
		},
		update(dt, t, auto) {
			if (auto) {
				if (driving) {
					// Back in Auto, the car levels out as it eases after the route again.
					driving = false;
					pitch = 0;
				}
				camera.getWorldPosition(eye);
				camera.getRotation(turn);
				vec3.transformQuat(ahead, [0, 0, -1], turn);
				if (view === 'cockpit') {
					// The car carries the camera in its seat, turned the way the route looks.
					yaw = Math.atan2(ahead[0], ahead[2]);
					roll = 0;
					quat.fromEuler(spin, 0, yaw, 0, 'YXZ');
					vec3.set(seat, SEAT[0] * SCALE, SEAT[1] * SCALE, SEAT[2] * SCALE);
					vec3.transformQuat(seat, seat, spin);
					vec3.sub(at, eye, seat);
					vec3.copy(goal, at);
				} else {
					// The car keeps its place ahead of the shot, in the middle of the frame, easing
					// after it.
					vec3.set(
						goal,
						(eye[0] as number) + ahead[0] * AHEAD,
						(eye[1] as number) + ahead[1] * AHEAD - BELOW,
						(eye[2] as number) + ahead[2] * AHEAD,
					);
					for (let k = 0; k < 3; k++)
						at[k] = math.damp(at[k] as number, goal[k] as number, 5.5, dt);
					// The car turns to its own travel, so a turn of the route banks it.
					const dx = (at[0] as number) - (before[0] as number);
					const dz = (at[2] as number) - (before[2] as number);
					if (Math.hypot(dx, dz) > dt * 0.6) {
						const wanted = Math.atan2(dx, dz);
						let gap = wanted - yaw;
						gap = Math.atan2(Math.sin(gap), Math.cos(gap));
						const next = gap * (1 - Math.exp(-6 * dt));
						yaw += next;
						roll = math.damp(
							roll,
							math.clamp((-next / Math.max(dt, 1e-3)) * 0.06, -0.4, 0.4),
							7,
							dt,
						);
					}
				}
				const dx = (at[0] as number) - (before[0] as number);
				const dz = (at[2] as number) - (before[2] as number);
				speed = math.damp(speed, Math.hypot(dx, dz) / Math.max(dt, 1e-3), 5, dt);
				pose();
			}
			vec3.copy(before, at);
			engine.set({ strength: 2.6 + Math.sin(t * 17) * 0.45 });
			engineLight.setIntensity(130 + Math.sin(t * 17) * 26);
			// The panels read out the flight at their own rates.
			cockpit.update(t, speed * 3.6, at[1] as number);
		},
	};
}
