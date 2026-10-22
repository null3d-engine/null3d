// The hero car of Skyway: a courier's hover car that leads the camera through the city. It flies
// just below and to one side of what the shot looks at, so it sits low in the frame and its tail
// lights and engine glow carry the eye down the street. In Manual the car holds where it was, and
// the user may fly around it.
//
// Its paint is a clear coat over a deep blue, with amber running lights down its flanks. Two panels
// on the rear deck carry screens that the sketch draws on OffscreenCanvas objects: speed on one,
// altitude on the other. They refresh a dozen times a second, so a number and a bar move without
// touching the frame's own work. Two spot lights at the nose light the rain ahead, and a lamp under
// the belly spills the car's colour on the air below it.
import { math, type PerspectiveCamera, quat, type SketchContext, vec3 } from '@null3d/engine';
import { createVehicleHull } from '../../addons/traffic-lanes/index';
import { EFFECT_LAYER } from '../../lib/layers';

/** How far ahead of the camera the car flies, how far to its right, and how far below, in meters. */
const [AHEAD, BESIDE, BELOW] = [26, 4.6, 5.2];
/** The scale of the hull, so the car is a little under five meters long. */
const SCALE = 2.2;
/** The world's up, which the camera's frame is built from. */
const WORLD_UP = [0, 1, 0] as const;

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
	/** Flies the car after the camera, or holds it in Manual. Call once per frame. */
	update(dt: number, t: number, chasing: boolean): void;
}

/** Where the car starts, from the route's opening pose. */
export interface HeroStart {
	position: readonly [number, number, number];
	target: readonly [number, number, number];
}

/** Builds the hero car, and puts it where the opening shot leaves it. */
export function createHero(ctx: SketchContext, camera: PerspectiveCamera, start: HeroStart): Hero {
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

	// The two screens on the rear deck, turned up towards the chase camera.
	const speedScreen = makeScreen(ctx, 'VELOCITY', 'km/h');
	const flightScreen = makeScreen(ctx, 'FLIGHT 07', 'ALT');
	const tilt = quat.create();
	quat.fromEuler(tilt, -0.42, Math.PI, 0, 'YXZ');
	for (const [at, screen] of [
		[-0.42, speedScreen],
		[0.42, flightScreen],
	] as const) {
		scene.createMesh({
			mesh: geometry.plane({ width: 0.62, height: 0.3 }),
			material: materials.unlit({ map: screen.map, color: '#bfe9ff' }),
			position: [at, 0.99, -1.28],
			rotation: tilt,
			parent: body,
			layers: EFFECT_LAYER,
		});
	}

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

	// The place now, the place last frame, and the vectors that fly the car.
	const at = vec3.create();
	const before = vec3.create();
	const eye = vec3.create();
	const turn = quat.create();
	const ahead = vec3.create();
	const side = vec3.create();
	const goal = vec3.create();
	const spin = quat.create();
	let yaw = 0;
	let roll = 0;
	let speed = 0;
	let paintedAt = Number.NEGATIVE_INFINITY;

	/** Puts the car where the opening shot looks, so the first frame shows it in place. */
	const opening = (): void => {
		const [px, py, pz] = start.position;
		const [tx, ty, tz] = start.target;
		vec3.set(ahead, tx - px, ty - py, tz - pz);
		vec3.normalize(ahead, ahead);
		vec3.cross(side, ahead, WORLD_UP);
		vec3.normalize(side, side);
		vec3.set(
			at,
			px + ahead[0] * AHEAD + side[0] * BESIDE,
			py + ahead[1] * AHEAD - BELOW,
			pz + ahead[2] * AHEAD + side[2] * BESIDE,
		);
		vec3.copy(goal, at);
		yaw = Math.atan2(ahead[0], ahead[2]);
		quat.fromEuler(spin, 0, yaw, 0, 'YXZ');
		group.setPose(at, spin);
		vec3.copy(before, at);
	};
	opening();

	return {
		update(dt, t, chasing) {
			if (chasing) {
				// The car keeps its place ahead of the shot, easing after it.
				camera.getWorldPosition(eye);
				camera.getRotation(turn);
				vec3.transformQuat(ahead, [0, 0, -1], turn);
				vec3.transformQuat(side, [1, 0, 0], turn);
				vec3.set(
					goal,
					(eye[0] as number) + ahead[0] * AHEAD + side[0] * BESIDE,
					(eye[1] as number) + ahead[1] * AHEAD - BELOW,
					(eye[2] as number) + ahead[2] * AHEAD + side[2] * BESIDE,
				);
			}
			for (let k = 0; k < 3; k++) at[k] = math.damp(at[k] as number, goal[k] as number, 5.5, dt);
			// The car turns to its own travel, so a turn of the route banks it.
			const dx = (at[0] as number) - (before[0] as number);
			const dz = (at[2] as number) - (before[2] as number);
			const moved = Math.hypot(dx, dz);
			if (moved > dt * 0.6) {
				const wanted = Math.atan2(dx, dz);
				let gap = wanted - yaw;
				gap = Math.atan2(Math.sin(gap), Math.cos(gap));
				const next = gap * (1 - Math.exp(-6 * dt));
				yaw += next;
				roll = math.damp(roll, math.clamp((-next / Math.max(dt, 1e-3)) * 0.06, -0.4, 0.4), 7, dt);
				speed = math.damp(speed, moved / Math.max(dt, 1e-3), 5, dt);
			}
			vec3.copy(before, at);
			quat.fromEuler(spin, 0, yaw, roll, 'YXZ');
			group.setPose(at, spin);
			engine.set({ strength: 2.6 + Math.sin(t * 17) * 0.45 });
			engineLight.setIntensity(130 + Math.sin(t * 17) * 26);
			// The screens read out the flight, a dozen times a second.
			if (t - paintedAt < 1 / 12) return;
			paintedAt = t;
			speedScreen.paint(speed * 3.6);
			flightScreen.paint(at[1] as number);
		},
	};
}

/** A screen on the car's deck, drawn on a canvas and uploaded a few times a second. */
interface Screen {
	readonly map: ReturnType<SketchContext['textures']['fromCanvas']>;
	/** Draws a new value, when its whole number changes. */
	paint(value: number): void;
}

/** Makes one screen: a frame, a title, a large number and a bar under it. */
function makeScreen(ctx: SketchContext, title: string, unit: string): Screen {
	const canvas = new OffscreenCanvas(512, 256);
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('the canvas has no 2D context');
	const map = ctx.textures.fromCanvas(canvas, { refreshHz: 12 });
	let shown = Number.NaN;

	/** Paints the parts that never change. */
	const frame = (): void => {
		context.fillStyle = '#050b12';
		context.fillRect(0, 0, 512, 256);
		context.strokeStyle = '#1d4a63';
		context.lineWidth = 4;
		context.strokeRect(8, 8, 496, 240);
		context.fillStyle = '#3fa8c8';
		context.font = 'bold 26px sans-serif';
		context.textAlign = 'left';
		context.textBaseline = 'top';
		context.fillText(title, 26, 24);
		context.fillStyle = '#1b3a4a';
		context.fillRect(26, 208, 460, 20);
	};
	frame();
	map.refresh();

	return {
		map,
		paint(value) {
			const whole = Math.round(value);
			if (whole === shown) return;
			shown = whole;
			frame();
			context.fillStyle = '#c9f2ff';
			context.font = 'bold 118px sans-serif';
			context.textAlign = 'right';
			context.textBaseline = 'top';
			context.fillText(String(whole), 400, 62);
			context.fillStyle = '#5fc8e8';
			context.font = 'bold 32px sans-serif';
			context.textAlign = 'left';
			context.fillText(unit, 414, 132);
			context.fillStyle = '#37c8e8';
			context.fillRect(26, 208, Math.round(460 * Math.min(1, whole / 400)), 20);
			map.refresh();
		},
	};
}
