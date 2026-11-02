// Showroom to street: a new car under the softboxes of a dark studio, on a mirror floor, with a
// configurator tablet beside it, and then the car drives out into a short wet street. The studio's
// reflection probe gives the paint its softbox highlights, and one planar reflection across the
// ground carries the car, the lamps and the neon into both floors. The camera runs a route made for
// the scene: it opens on the configurator with the car beside it, turns around the car while it
// waits, follows it out through the opening, watches it turn at the far end, and comes back in front
// of it to settle on the view it opened with. `c` switches between the route (Auto) and the user's
// own camera (Manual). A tap on the tablet changes the paint, the wheels, the
// trim or the lights, and the car takes the change at once. The controls HUD offers the time of day,
// the effects and the quality preset, as the other showcases do.
import { defineSketch } from '@null3d/engine';
import { type CameraBounds, type Cinematic, createCinematic } from '../../lib/cinematic';
import { CAMERA_LAYERS, SUN_LAYERS } from '../../lib/layers';
import { createShowcaseEffects, type ShadowReach } from '../../lib/showcase-effects';
import { createMoods, isMood } from '../../lib/stage';
import { createCar } from './car';
import { carPose, STUDIO_Z } from './route';
import { SHOTS } from './shots';
import { createStreet } from './street';
import { createStudio } from './studio';
import { createTablet } from './tablet';

/** The camera's vertical field of view in degrees, and the lens's focal length in millimetres. */
const FOV = 40;
const FOCAL_LENGTH = 55;
/** The bearing of the moon's path about +Y, so it stands beyond the street's far end. */
const HEADING = 2.4;
/** The fog's density: thick enough that the street's far end closes into the air. */
const FOG_DENSITY = 0.02;
/** The point that the Manual camera turns around and the lens focuses on, which follows the car. */
const TARGET: [number, number, number] = [0, 0.9, STUDIO_Z];

/** The studio's core, which keeps its shadows as the camera moves between the studio and the street. */
const SHADOW_REACH: ShadowReach = { distance: 38, center: [0, 2, 8], radius: 17 };

/** Where the Manual camera may go: over the studio and the street, above the road. */
const BOUNDS: Omit<CameraBounds, 'ground'> = {
	center: [0, -4],
	focus: 20,
	focusHeight: [0.6, 5],
	distance: 28,
};

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, page, render, textures, time } = ctx;
	page.post('loading', 'Building the studio');
	const [sky, room] = await Promise.all([
		assets.skyEnvironment(),
		assets.builtinEnvironment('room'),
	]);
	const sun = scene.createDirectionalLight({
		castShadows: true,
		layers: SUN_LAYERS,
		shadow: { distance: SHADOW_REACH.distance, normalBias: 0.04, contactDistance: 0.25 },
	});
	post.set({ ao: { radius: 0.7 }, bloom: { intensity: 0.45, threshold: 1 } });
	// The one reflection that both floors read: the scene mirrored across the ground, the car and the
	// street's lamps included. It draws at half the size, which a wet surface hides.
	const reflection = textures.fromPass(
		render.addPass({
			kind: 'reflection',
			writes: 'ground',
			plane: { point: [0, 0, 0] },
			scale: 0.5,
			layers: CAMERA_LAYERS,
		}),
	);
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.08,
		far: 400,
		layers: CAMERA_LAYERS,
	});
	scene.setActiveCamera(camera);
	const target: [number, number, number] = [TARGET[0], TARGET[1], TARGET[2]];

	// The stage: a night sky beyond the street, with thick air that the lamps light. The studio's own
	// softboxes carry its interior, so the hour only sets the street's sky and the air.
	const stage = createMoods(ctx, sun, sky, room, {
		heading: HEADING,
		fogDensity: FOG_DENSITY,
		cloudCoverage: 0.28,
		volumetric: { intensity: 1.7, anisotropy: 0.42, distance: 70 },
		exposureScale: 1.0,
		environmentScale: 0.9,
		backdrop: [0.01, 0.012, 0.02],
	});
	const mood = params.get('mood');
	stage.set(isMood(mood) ? mood : 'Night');

	page.post('loading', 'Building the street');
	createStreet(ctx, reflection);
	createStudio(ctx, reflection);
	const car = createCar(ctx);
	const tablet = createTablet(ctx, (config) => car.apply(config));
	car.apply(tablet.config);
	const opening = carPose(0);
	car.root.setPosition(0, 0, opening.z);
	car.root.setRotationEuler(0, opening.heading, 0);
	/** The z where the car stood a frame ago, which its forward travel and its wheels take from. */
	let lastZ = opening.z;

	// The scene's controls: the shared sky, fog, environment, shadow and lens switches, and its own
	// ambient occlusion and bloom.
	const controls = createShowcaseEffects(ctx, {
		camera,
		sun,
		shadowReach: SHADOW_REACH,
		stage,
		start: {
			sky: true,
			fog: true,
			environment: true,
			shadows: true,
			contact: true,
			ao: true,
			bloom: true,
			dof: false,
			exposure: false,
			vignette: true,
		},
		supported: {
			atmosphere: ['sky', 'fog'],
			lighting: ['shadows', 'contact', 'ao', 'environment'],
			post: ['bloom', 'dof', 'exposure', 'vignette'],
		},
		apply(id, on) {
			switch (id) {
				case 'contact':
					sun.setShadow({ contactDistance: on ? 0.25 : 0 });
					break;
				case 'ao':
					post.set({ ao: on ? { radius: 0.7 } : false });
					break;
				case 'bloom':
					post.set({ bloom: on ? { intensity: 0.45, threshold: 1 } : false });
					break;
			}
		},
		mood: (next) => stage.set(next),
		hour: (hours) => stage.setHour(hours),
		film: () => film,
		fov: FOV,
		focalLength: FOCAL_LENGTH,
		focus: target,
	});

	let film: Cinematic;
	film = createCinematic(ctx, camera, {
		shots: SHOTS,
		target,
		groups: controls.groups,
		bounds: { ...BOUNDS, ground: () => 0 },
	});
	controls.fitShadows();

	return {
		onUpdate(dt) {
			const t = time.now;
			stage.update(dt);
			controls.update(t);
			film.update(dt);
			const pose = carPose(t);
			car.root.setPosition(0, 0, pose.z);
			car.root.setRotationEuler(0, pose.heading, 0);
			// The car moves along z only: its forward travel is the part of that move along its nose,
			// which rolls the wheels by the distance over their radius.
			car.roll(-(pose.z - lastZ) * Math.sin(pose.heading));
			lastZ = pose.z;
			// The lens and the Manual camera's focus stay on the car wherever it drives.
			target[2] = pose.z;
			tablet.update();
			const lens = controls.lens();
			if (lens) post.set(lens);
		},
	};
});
