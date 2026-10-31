// The hero car of Skyway: a courier's hover car with a cockpit (see body.ts). In Auto it leads the
// camera through the city: it flies ahead of the shot and just below it, in the middle of the
// frame, so its tail lights and engine glow carry the eye down the street. In Manual the user drives
// it (see drive.ts for the flight). The camera follows it from behind or sits in the driver's seat,
// and a switch between the two flies the camera over the canopy and down into the seat, or back.
//
// Its paint is a clear coat over a deep blue, with amber running lights down its flanks, and the
// cockpit's floor is dark and matte. A tinted glass canopy closes the cockpit, and its glass carries
// the weather add-on's rain drops, which slide and leave trails and that a wiper clears now and
// then. Three screens from the screens add-on stand on the dashboard: the speed, the altitude and
// the navigation map. Each refreshes at its own rate, and only the part of its picture that changed
// uploads, so a number, a bar and a moving dot cost no frame work. Two spot lights at the nose light
// the rain ahead, and a neon band round the body's lower edge marks the field that holds it up.
import {
	type Group,
	math,
	type PerspectiveCamera,
	quat,
	type SketchContext,
	vec3,
} from '@null3d/engine';
import { createWindshield } from '../../addons/weather/index';
import type { HudGroup } from '../../lib/controls';
import { EFFECT_LAYER } from '../../lib/layers';
import { COCKPIT, CONSOLE, createCanopy, createCanopyOverlay, createShell, FITTINGS } from './body';
import { createCockpit } from './cockpit';
import { createConsole } from './console';
import {
	cityTowers,
	clearSight,
	FLIGHT,
	type Flight,
	fly,
	keepOut,
	type Stick,
	type Towers,
} from './drive';
import { HERO_LAYER } from './layout';

/** The layers of the car's own meshes: the effect layer, as the rest of what flies, and the layer
 * that the road's mirror camera draws on its own. */
const BODY_LAYERS = EFFECT_LAYER | HERO_LAYER;

/** How far ahead of the Auto camera the car flies, and how far below, in meters. */
const [AHEAD, BELOW] = [26, 5.2];
/** The scale of the hull, so the car is a little under five meters long. */
const SCALE = 2.2;
/** The driver's eye, in the body's own units: over the seat, under the canopy's ridge. */
const SEAT = [0, 1.04, -0.28] as const;
/** The middle of the glass bubble, in the body's own units. */
const BUBBLE_MIDDLE = [0, 0.92, -0.05] as const;
/** How long the camera takes to fly into the seat or back out behind the car, in seconds. */
const TRANSITION = 0.9;
/** How high the camera's path rises over the canopy on its way in or out, in meters. */
const ARC = 1.2;
/** The chase camera's place behind the car and above it, and how far ahead of the car it looks. */
const CHASE = { behind: 13, above: 4.4, ahead: 22, lift: 1.4 };
/** How quickly the chase camera follows the car's place and its look, per second. */
const CHASE_FOLLOW = 7;
/** How far before a tower the chase camera stops, so it does not skim a wall, in meters. */
const SIGHT_CLEARANCE = 0.6;
/**
 * How far ahead of the car the camera looks for a tower that a turn will bring between them, in
 * seconds, so the pull starts before the line crosses it.
 */
const SIGHT_LOOK = 0.3;
/** How fast the camera may close on the car before a tower, in meters per second, so it eases. */
const SIGHT_PULL = 60;
/**
 * How close a pulled camera stands to the car at least, in meters, so the car cannot fill the
 * frame; the car is a little under five meters long, and this keeps it under half the frame's
 * width from the side. The camera swings to a clear side of the car when the tower leaves no room
 * straight back.
 */
const SIGHT_MIN = 10;
/** How low above the car the camera sits when it has pulled all the way in, in meters. */
const SIGHT_LOW = 1.6;
/** How far past the car the camera looks when it has pulled all the way in, in meters. */
const SIGHT_LEAD = 2;
/** The widest swing to either side of the car's tail that tries to find a clear view, in radians. */
const SIGHT_SWING = Math.PI / 2;
/** How far apart the swings sit, in radians. */
const SIGHT_STEP = Math.PI / 18;
/** How quickly the pull's distance eases from the usual chase to the standoff, per second. */
const SIGHT_RADIUS_EASE = 4;
/**
 * The distance at which the low pull gives way to the usual chase look, in meters. It sits just
 * past the standoff, so a camera pulled in looks a little past the car, and one at its usual
 * distance looks down the road as it always did.
 */
const SIGHT_CLOSE = SIGHT_MIN + 1;
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
struct Uniforms { glow: f32, cockpit: f32, cockpitZ: f32, floor: f32 }

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // The body's own place, which its texture coordinates carry, so the paint turns with the car.
    let d = vec3f(input.uv.x, input.uv.y, input.uv1.x);
    // The cockpit's floor, the body's top under the glass bubble: dark and matte.
    let trim = step(abs(d.x), material.cockpit) * step(abs(d.z), material.cockpitZ)
        * step(material.floor - 0.04, d.y);
    // The flanks carry a strip of amber running lights.
    let strip = step(0.86, abs(d.x)) * step(abs(d.z), 1.5) * step(0.5, d.y) * step(d.y, 0.56);

    s.baseColor = mix(vec3f(0.035, 0.05, 0.075), vec3f(0.004, 0.005, 0.007), trim);
    s.metalness = mix(0.55, 0.0, trim);
    s.roughness = mix(0.24, 0.95, trim);
    s.clearcoat = 1.0 - trim;
    s.clearcoatRoughness = 0.12;
    s.emissive = vec3f(1.0, 0.35, 0.06) * strip * 2.0;
    // A neon band round the body's lower edge and its pods', the edge of the field that holds the
    // car up, on the faces that look outward; and a faint glow on the tail.
    let band = step(0.12, d.y) * step(d.y, 0.22) * step(abs(input.normal.y), 0.8);
    s.emissive += vec3f(0.15, 0.6, 1.0) * band * material.glow * 2.2;
    let tail = 1.0 - step(-1.9, d.z);
    s.emissive += vec3f(0.3, 0.75, 1.0) * tail * material.glow * 0.25;
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
	/** The car's world pose, which a splash or steam effect hangs under. */
	readonly group: Group;
	/** Where the camera sits now. */
	readonly view: View;
	/** Puts the camera behind the car or in its seat. */
	setView(view: View): void;
	/**
	 * Writes the middle of the glass bubble into `out` as x, y and z, and the car's yaw after them,
	 * for the rain to keep out of.
	 */
	canopy(out: Float32Array): void;
	/** Shows the scene's controls on the console, as the page's panel shows them. */
	showControls(groups: readonly HudGroup[]): void;
	/** Sets how heavy the rain is on the car's glass, from 0 for a dry glass to 1. */
	setRain(value: number): void;
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
 * lens focuses on, which the car keeps while the user drives. `towers` is what the camera keeps the
 * car in sight of; a proof can leave out a tower that the car must not see.
 */
export function createHero(
	ctx: SketchContext,
	camera: PerspectiveCamera,
	start: HeroStart,
	focus: [number, number, number],
	towers: Towers = cityTowers(),
): Hero {
	const { scene, geometry, materials, page, input } = ctx;
	const group = scene.createGroup({ name: 'hero' });
	const body = scene.createGroup({ parent: group, scale: [SCALE, SCALE, SCALE] });

	const paint = materials.shader({
		wgsl: paintWgsl,
		uniforms: {
			glow: 1,
			cockpit: COCKPIT.half,
			cockpitZ: COCKPIT.length,
			floor: COCKPIT.floor,
		},
		color: '#1a2536',
		roughness: 0.24,
		metalness: 0.55,
		clearcoat: 1,
		clearcoatRoughness: 0.12,
	});
	scene.createMesh({ mesh: createShell(ctx), material: paint, parent: body, layers: BODY_LAYERS });
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
			layers: BODY_LAYERS,
			castShadows: false,
		});
	}
	// The canopy: tinted glass, which shows the lit cockpit dimly from outside and the city from in.
	const canopy = createCanopy(ctx);
	scene.createMesh({
		mesh: canopy,
		material: materials.standard({
			color: '#0a1620',
			roughness: 0.05,
			metalness: 0,
			opacity: 0.3,
			alphaMode: 'blend',
			doubleSided: true,
		}),
		parent: body,
		layers: BODY_LAYERS,
		castShadows: false,
	});
	// The glass carries the weather add-on's drops: beads that slide and leave trails, and a wiper
	// that clears them now and then. The overlay is a blended surface over the canopy, so the car's
	// paint and reflections stay under it.
	const shield = createWindshield(ctx, {
		mesh: createCanopyOverlay(ctx),
		parent: body,
		layers: BODY_LAYERS,
		wiper: { every: 7, duration: 0.9 },
	});

	// The engine's two nozzles, and the lamp that plays behind them.
	const engine = materials.shader({ wgsl: glowWgsl, uniforms: { strength: 1.2 }, fog: false });
	for (const side of [-1, 1]) {
		scene.createMesh({
			mesh: geometry.sphere({ radius: 0.11, widthSegments: 14, heightSegments: 10 }),
			material: engine,
			position: [side * 0.34, 0.36, -2.0],
			scale: [1, 1, 0.6],
			parent: body,
			layers: BODY_LAYERS,
			castShadows: false,
		});
	}
	const engineLight = scene.createPointLight({
		position: [0, 0.55, -2.6],
		color: '#4fb8ff',
		intensity: 70,
		range: 12,
		parent: body,
		layers: BODY_LAYERS,
	});

	// The screens on the dashboard, turned up toward the driver's eye.
	const tilt = quat.create();
	quat.fromEuler(tilt, -0.5, Math.PI, 0, 'YXZ');
	const cockpit = createCockpit(ctx, body, tilt);
	// The console on the dashboard's face, which repeats the scene's controls for the driver.
	const lean = quat.create();
	quat.fromEuler(lean, -CONSOLE.lean, Math.PI, 0, 'YXZ');
	// A press on the console, found in the car's own space: from the driver's eye along the press's
	// direction onto the console's plane. The engine's own hit tests the console where the last
	// update put it, against the ray of the frame on screen, and in a moving car the two differ by
	// a frame of travel, which shifts a press across the console's rows.
	const facing = {
		normal: vec3.transformQuat(vec3.create(), [0, 0, 1], lean),
		across: vec3.transformQuat(vec3.create(), [1, 0, 0], lean),
		up: vec3.transformQuat(vec3.create(), [0, 1, 0], lean),
	};
	const unturn = quat.create();
	const along = vec3.create();
	const toConsole = vec3.create();
	const touchscreen = createConsole(
		ctx,
		body,
		lean,
		CONSOLE.at,
		CONSOLE.size,
		(event, width, height) => {
			if (inside < 1) return null;
			quat.invert(unturn, spin);
			vec3.transformQuat(along, event.ray.direction, unturn);
			const facingDot = vec3.dot(along, facing.normal);
			if (Math.abs(facingDot) < 1e-6) return null;
			vec3.set(
				toConsole,
				CONSOLE.at[0] - SEAT[0],
				CONSOLE.at[1] - SEAT[1],
				CONSOLE.at[2] - SEAT[2],
			);
			const distance = vec3.dot(toConsole, facing.normal) / facingDot;
			if (distance <= 0) return null;
			// The hit, from the console's middle, along its width and its height.
			vec3.scaleAndAdd(toConsole, vec3.negate(toConsole, toConsole), along, distance);
			const u = vec3.dot(toConsole, facing.across) / CONSOLE.size[0] + 0.5;
			const v = vec3.dot(toConsole, facing.up) / CONSOLE.size[1] + 0.5;
			if (u < 0 || u > 1 || v < 0 || v > 1) return null;
			return { x: u * width, y: (1 - v) * height };
		},
	);

	// The nose lamps light the rain and the street ahead.
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

	// The place now, the place last frame, and the vectors that fly the car and place the camera.
	const at = vec3.create();
	const before = vec3.create();
	const eye = vec3.create();
	const turn = quat.create();
	const ahead = vec3.create();
	const goal = vec3.create();
	const spin = quat.create();
	const look = vec3.create();
	/** The glass bubble's middle, as the rain's shelter reads it. */
	const middle = vec3.create();
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
	/** How far round the car the camera holds its chosen side while a tower blocks it. */
	let sightSide = 0;
	let sightSideReach = 0;
	/** The world angle of the held side, and how far the pull has eased in toward the standoff. */
	let sightAngle = 0;
	let sightRadius = 0;

	const flight: Flight = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, climb: 0, turning: 0 };
	/** The car and camera where a look-ahead puts them, to test the line before a turn reaches it. */
	const probeCar: Flight = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, climb: 0, turning: 0 };
	const probeEye: Flight = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, climb: 0, turning: 0 };
	/** The yaw the last frame showed, so the camera reads how fast the car turns. */
	let sightYaw = 0;
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

	/** How much of the usual chase look remains at `away` meters from the car. */
	const closenessAt = (away: number): number =>
		math.clamp((away - SIGHT_CLOSE) / Math.max(CHASE_DISTANCE - SIGHT_CLOSE, 1e-3), 0, 1);

	/** Keeps a placed camera at the standoff from the car, where the towers leave room. */
	const clampStandoff = (eye: Flight): void => {
		const dx = eye.x - (at[0] as number);
		const dy = eye.y - (at[1] as number);
		const dz = eye.z - (at[2] as number);
		const away = Math.hypot(dx, dy, dz);
		if (away < SIGHT_MIN && away > 1e-3) {
			const out = SIGHT_MIN / away;
			eye.x = (at[0] as number) + dx * out;
			eye.y = (at[1] as number) + dy * out;
			eye.z = (at[2] as number) + dz * out;
		}
	};

	/**
	 * Places the camera before the nearest tower that stands between it and the car, no closer to
	 * the car than the standoff. A tower that leaves no room straight back makes the camera swing to
	 * the nearer side that still sees the car; the swing eases onto that side, and the camera holds
	 * it while the tower stays, so a still car gets a still shot. The closer it sits, the lower it
	 * looks from.
	 */
	const settleSight = (dt: number): void => {
		const atX = at[0] as number;
		const atY = at[1] as number;
		const atZ = at[2] as number;
		const tilt = CHASE_TILT + orbit.tilt;
		const around = yaw + Math.PI + orbit.turn;
		const level = Math.cos(tilt) * orbit.distance;
		// The pull releases when the usual chase place behind the car clears. Checking the camera
		// itself would end the pull as soon as the swing puts it in front of the tower, and the swing
		// would start over every frame.
		probeEye.x = atX + Math.sin(around) * level;
		probeEye.y = atY + Math.sin(tilt) * orbit.distance;
		probeEye.z = atZ + Math.cos(around) * level;
		if (!clearSight(atX, atY, atZ, probeEye, towers, SIGHT_CLEARANCE)) {
			sightSide = 0;
			sightSideReach = 0;
			return;
		}
		if (sightSide === 0) {
			const entryX = probeEye.x;
			const entryY = probeEye.y;
			const entryZ = probeEye.z;
			const entry = Math.hypot(entryX - atX, entryY - atY, entryZ - atZ);
			const reach = Math.max(entry, SIGHT_MIN);
			const low = atY + SIGHT_LOW + (CHASE.above - SIGHT_LOW) * closenessAt(reach);
			const back = Math.atan2(chase.x - atX, chase.z - atZ);
			for (let step = 0; step <= SIGHT_SWING && sightSide === 0; step += SIGHT_STEP) {
				for (const way of step === 0 ? [1] : [1, -1]) {
					const swing = back + way * step;
					probeEye.x = atX + Math.sin(swing) * reach;
					probeEye.y = low;
					probeEye.z = atZ + Math.cos(swing) * reach;
					keepOut(probeEye, towers);
					if (!clearSight(atX, atY, atZ, probeEye, towers, SIGHT_CLEARANCE)) {
						sightSide = swing - around;
						sightSideReach = reach;
						sightAngle = swing;
						sightRadius = Math.hypot(chase.x - atX, chase.y - atY, chase.z - atZ);
						break;
					}
				}
			}
			// No side sees the car: keep the camera as far from the tower as the line allows.
			if (sightSide === 0) {
				chase.x = entryX;
				chase.y = entryY;
				chase.z = entryZ;
				keepOut(chase, towers);
				return;
			}
		}
		// The tower's shadow spans the angles between the usual place and the clear side, so easing
		// the angle across it would put the camera close to the car, or behind the tower. The camera
		// takes the clear side at once and eases its distance toward that side's reach, which is the
		// usual chase distance whenever a tower is in the way; the ten-metre standoff is a floor the
		// tower's push meets, not an eased target.
		const low = atY + SIGHT_LOW + (CHASE.above - SIGHT_LOW) * closenessAt(sightSideReach);
		const target = around + sightSide;
		sightAngle = target;
		sightRadius += (sightSideReach - sightRadius) * (1 - Math.exp(-SIGHT_RADIUS_EASE * dt));
		probeEye.x = atX + Math.sin(sightAngle) * sightRadius;
		probeEye.y = low;
		probeEye.z = atZ + Math.cos(sightAngle) * sightRadius;
		keepOut(probeEye, towers);
		// A side that the car's turn blocks as well is given up: the camera takes the tower's entry
		// for this frame and chooses a new side on the next one, rather than holding a hidden car.
		if (clearSight(atX, atY, atZ, probeEye, towers, SIGHT_CLEARANCE)) {
			sightSide = 0;
			sightSideReach = 0;
		}
		// The tower may have pushed the placed point toward the car, and the last keep-out can do so
		// again; the standoff runs after both, so the camera keeps out of the car's body.
		clampStandoff(probeEye);
		chase.x = probeEye.x;
		chase.y = probeEye.y;
		chase.z = probeEye.z;
		keepOut(chase, towers);
		clampStandoff(chase);
	};

	/**
	 * Puts the camera behind the car, or where a drag turned it round the car, easing after it. It
	 * looks down the car's way from behind, and at the car itself once a drag turns it away.
	 */
	const follow = (dt: number, snap: boolean): void => {
		const sx = Math.sin(yaw);
		const sz = Math.cos(yaw);
		const k = snap ? 1 : 1 - Math.exp(-CHASE_FOLLOW * dt);
		const turnRate = math.clamp((yaw - sightYaw) / Math.max(dt, 1e-4), -FLIGHT.turn, FLIGHT.turn);
		sightYaw = yaw;
		const around = yaw + Math.PI + orbit.turn;
		const tilt = CHASE_TILT + orbit.tilt;
		const level = Math.cos(tilt) * orbit.distance;
		chase.x += ((at[0] as number) + Math.sin(around) * level - chase.x) * k;
		chase.y += ((at[1] as number) + Math.sin(tilt) * orbit.distance - chase.y) * k;
		chase.z += ((at[2] as number) + Math.cos(around) * level - chase.z) * k;
		// The camera never sits inside a tower, though the car may hug one.
		keepOut(chase, towers);
		// A tower between the car and the camera would hide the car. The camera moves before the
		// nearest one, stands no closer than its standoff, and swings to a side when the tower
		// leaves no room behind the car.
		settleSight(dt);
		// A turn can bring a tower across the line in a single frame, so the pull above would snap
		// the camera in. Look a short way along the car's path and, while the line still clears,
		// close on the car at a limited rate, so the pull starts before the tower arrives.
		if (speed > 0.5) {
			probeCar.x = (at[0] as number) + Math.sin(yaw) * speed * SIGHT_LOOK;
			probeCar.y = at[1] as number;
			probeCar.z = (at[2] as number) + Math.cos(yaw) * speed * SIGHT_LOOK;
			const future = yaw + turnRate * SIGHT_LOOK + Math.PI + orbit.turn;
			probeEye.x = probeCar.x + Math.sin(future) * level;
			probeEye.y = probeCar.y + Math.sin(tilt) * orbit.distance;
			probeEye.z = probeCar.z + Math.cos(future) * level;
			if (clearSight(probeCar.x, probeCar.y, probeCar.z, probeEye, towers, SIGHT_CLEARANCE)) {
				const dx = chase.x - (at[0] as number);
				const dy = chase.y - (at[1] as number);
				const dz = chase.z - (at[2] as number);
				const away = Math.hypot(dx, dy, dz);
				const target = Math.max(
					SIGHT_MIN,
					Math.hypot(
						probeEye.x - (at[0] as number),
						probeEye.y - (at[1] as number),
						probeEye.z - (at[2] as number),
					),
				);
				const reached = Math.max(target, away - SIGHT_PULL * dt);
				if (reached < away) {
					const share = reached / away;
					chase.x = (at[0] as number) + dx * share;
					chase.y = (at[1] as number) + dy * share;
					chase.z = (at[2] as number) + dz * share;
					keepOut(chase, towers);
				}
			}
		}
		// The look lies ahead of the car while the camera sits at its usual distance, and only a
		// little past the car once the camera has pulled in, so the road ahead stays in the frame
		// while the car fills no more of it than a chase view allows. The camera sits lower as it
		// closes, and both the height and the look ease with the distance, so neither jumps.
		const away = Math.hypot(
			chase.x - (at[0] as number),
			chase.y - (at[1] as number),
			chase.z - (at[2] as number),
		);
		// While the pull holds, the look stays just past the car and the camera low, whatever its
		// easing distance, so the car stays framed as the pull closes. Once the pull releases, the
		// look and height ease back to the usual chase down the road.
		const closeness = sightSide !== 0 ? 0 : closenessAt(away);
		if (closeness < 1)
			chase.y = (at[1] as number) + SIGHT_LOW + (CHASE.above - SIGHT_LOW) * closeness;
		const lead =
			(SIGHT_LEAD + (CHASE.ahead - SIGHT_LEAD) * closeness) *
			math.clamp(1 - (Math.abs(orbit.turn) + Math.abs(orbit.tilt)) / 0.6, 0, 1);
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
		group,
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
		canopy(out) {
			vec3.set(
				middle,
				BUBBLE_MIDDLE[0] * SCALE,
				BUBBLE_MIDDLE[1] * SCALE,
				BUBBLE_MIDDLE[2] * SCALE,
			);
			vec3.transformQuat(middle, middle, spin);
			out[0] = (at[0] as number) + (middle[0] as number);
			out[1] = (at[1] as number) + (middle[1] as number);
			out[2] = (at[2] as number) + (middle[2] as number);
			out[3] = yaw;
		},
		showControls(groups) {
			touchscreen.show(groups);
		},
		setRain(value) {
			shield.setRain(math.clamp(value, 0, 1));
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
			sightYaw = yaw;
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
			engine.set({ strength: 1.2 + Math.sin(t * 17) * 0.2 });
			engineLight.setIntensity(60 + Math.sin(t * 17) * 12);
			// The drops slide and the wiper sweeps.
			shield.update(t);
			// The panels read out the flight at their own rates.
			cockpit.update(t, speed * 3.6, at[1] as number);
			touchscreen.update();
		},
	};
}
