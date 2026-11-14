// Showroom to street: a new car under the softboxes of a dark studio, on a mirror floor, with a
// configurator tablet beside it, and then the car drives out into a short wet street. The studio's
// reflection probe gives the paint its softbox highlights, and one planar reflection across the
// ground carries the car, the lamps and the neon into both floors. The camera runs a route made for
// the scene: it opens on the configurator with the car beside it, turns around the car while it
// waits, follows it out through the opening, watches it turn at the far end, and comes back in front
// of it to settle on the view it opened with. `c` switches between the route (Auto) and the user's
// own camera (Manual). A tap on the tablet changes the paint, the wheels, the
// trim or the lights, and the car takes the change at once. The scene shows no controls panel: the
// route plays by itself.
import { defineSketch } from '@null3d/engine';
import { CAMERA_LAYERS, SUN_LAYERS } from '../lib/layers';
import type { ShadowReach } from '../lib/shadow-range';
import { createMoods, isMood } from '../lib/stage';
import { createCar } from './car';
import { START_CONFIG } from './config';
import { createHud } from './hud';
import { carPose, STUDIO_Z } from './route';
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

const params = new URL(import.meta.url).searchParams;
/** The parts of the scene that the address leaves out, for a cost measurement. */
const WITHOUT = new Set((params.get('without') ?? '').split(',').filter(Boolean));
/** The render scale that the address fixes, or undefined to leave the scale to the governor. */
const RENDER_SCALE = Number(params.get('render-scale')) || undefined;
/** False turns the frame-budget governor off, so a measurement keeps one preset's settings. */
const GOVERNOR = params.get('governor') !== 'off';

export default defineSketch(async (ctx) => {
	const { scene, assets, post, page, quality, render, textures, time } = ctx;
	page.post('loading', 'Building the studio');
	const [sky, room] = await Promise.all([
		assets.skyEnvironment(),
		assets.builtinEnvironment('room'),
	]);
	const sun = scene.createDirectionalLight({
		castShadows: !WITHOUT.has('shadows'),
		layers: SUN_LAYERS,
		shadow: { distance: SHADOW_REACH.distance, normalBias: 0.04, contactDistance: 0.25 },
	});
	post.set({
		...(WITHOUT.has('ao') ? {} : { ao: { radius: 0.7 } }),
		...(WITHOUT.has('bloom') ? {} : { bloom: { intensity: 0.45, threshold: 1 } }),
	});
	// Every mesh draws at its fullest level, so the paint, the tablet and the lamps keep their edges.
	void quality.set({
		lodThreshold: 0,
		...(RENDER_SCALE ? { minRenderScale: RENDER_SCALE, maxRenderScale: RENDER_SCALE } : {}),
		...(GOVERNOR ? {} : { governor: false }),
	});
	// The one reflection both floors read: the scene mirrored across the ground, at half the size.
	const reflection = WITHOUT.has('reflection')
		? textures.fromData({
				width: 1,
				height: 1,
				data: new Uint8Array([6, 7, 9, 255]),
				colorSpace: 'srgb',
			})
		: textures.fromPass(
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
	// A night sky beyond the street with thick air the lamps light; the softboxes carry the studio.
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
	for (const part of ['sky', 'fog', 'environment'] as const)
		if (WITHOUT.has(part)) stage.show(part, false);

	page.post('loading', 'Building the street');
	if (!WITHOUT.has('street')) createStreet(ctx, reflection, WITHOUT);
	if (!WITHOUT.has('studio')) createStudio(ctx, reflection, WITHOUT);
	const car = createCar(ctx);
	const tablet = WITHOUT.has('tablet')
		? undefined
		: createTablet(ctx, (config) => car.apply(config));
	car.apply(tablet?.config ?? START_CONFIG);
	if (WITHOUT.has('car')) car.root.setVisible(false);
	const opening = carPose(0);
	car.root.setPosition(0, 0, opening.z);
	car.root.setRotationEuler(0, opening.heading, 0);
	/** The z where the car stood a frame ago, which its forward travel and its wheels take from. */
	let lastZ = opening.z;

	// The scene's route and the lens that follows the car; the showroom sets its own effects above,
	// and shows no controls panel.
	const hud = createHud(ctx, {
		camera,
		sun,
		shadowReach: SHADOW_REACH,
		target,
		focalLength: FOCAL_LENGTH,
	});

	return {
		onUpdate(dt) {
			const t = time.now;
			stage.update(dt);
			hud.update(dt);
			const pose = carPose(t);
			car.root.setPosition(0, 0, pose.z);
			car.root.setRotationEuler(0, pose.heading, 0);
			// The car moves along z only: its forward travel is the part of that move along its nose,
			// which rolls the wheels by the distance over their radius.
			car.roll(-(pose.z - lastZ) * Math.sin(pose.heading));
			lastZ = pose.z;
			// The lens and the Manual camera's focus stay on the car wherever it drives.
			target[2] = pose.z;
			tablet?.update();
			hud.lens();
		},
	};
});
