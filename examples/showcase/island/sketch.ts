// Island: a showcase scene of a Mediterranean town on a hilly island, alone in the open sea. Villages
// crown three hills, olive terraces and forest cover their slopes, a crescent of beach curves along the
// south-east, a golf course lies on the eastern headland, and the town stands around its church and
// square above the harbour. A town plan lays out its roads, houses and trees. The land comes from the
// terrain add-on, the sea from the water add-on and the trees from the vegetation add-on.
//
// The camera runs a cinematic route made for this scene (see SHOTS). `c` toggles between the route
// (Auto) and the engine's orbit controls, which the user drives (Manual); `h` opens and closes the
// controls. Manual turns around the whole island, and zooms and pans down to any place on it. The
// controls pick a time of day (a summer morning at its start) and turn the effects on and off, among them a
// "DSLR" lens with depth of field. For held frames, the sketch's address takes the mood:
// `?mood=Midday&dslr`.
import { defineSketch } from '@null3d/engine';
import { type CameraBounds, createCinematic, type Shot } from '../../lib/cinematic';
import { EFFECT_LAYER, INTERIOR_LAYER, SUN_LAYERS } from '../../lib/layers';
import { createShowcaseEffects } from '../../lib/showcase-effects';
import { createMoods, isMood } from '../../lib/stage';
import { SEA_LEVEL } from './island';
import { createLand } from './land';
import { groundHeight } from './plan';
import { createSea } from './sea';
import { SHADOW_DISTANCE, SHADOW_REACH } from './shadow';
import { createTown } from './town';
import { CASTER_LAYER, createTrees } from './trees';

/** The camera's vertical field of view in degrees, and the DSLR lens's focal length in millimetres. */
const FOV = 45;
const DSLR_FOCAL_LENGTH = 50;
/** The turn of the sun's path about +y, so the morning sun stands over the bay and lights the town's fronts. */
const HEADING = 4.6;

/** The hour that the scene starts at. */
const MORNING = 10;

/**
 * Where the Manual camera may go: far enough back to see the whole island, and down to any place on
 * it, above the ground and the sea.
 */
export const BOUNDS: Omit<CameraBounds, 'ground'> = {
	center: [0, 0],
	focus: 700,
	focusHeight: [0.5, 280],
	distance: 1700,
};

/**
 * The cinematic route. It opens high off the south-east, showing the whole island. Then it drops to
 * the bay and flies in low toward the beach, turns along the town's waterfront to the harbour and the
 * square, climbs over the south face to the highest hill's tower and circles it, crosses to the eastern hill, sweeps
 * over the golf course, and rises back to the opening view.
 * The first shot holds still, so a held frame lands on the opening view.
 */
export const SHOTS: readonly Shot[] = [
	// The opening view holds only briefly, so the camera starts moving soon after the page loads.
	{ position: [600, 280, 540], target: [40, 80, -40], seconds: 0.8, move: 'hold' },
	{ position: [600, 280, 540], target: [40, 80, -40], seconds: 8 },
	{ position: [420, 220, 560], target: [150, 40, 150], seconds: 11 },
	{ position: [150, 55, 520], target: [-60, 30, 230], seconds: 12 },
	{ position: [-70, 30, 410], target: [-92, 30, 200], seconds: 11 },
	{ position: [-130, 70, 330], target: [-92, 36, 190], seconds: 9 },
	{ position: [-110, 165, 60], target: [-110, 150, -220], seconds: 12 },
	{ position: [-30, 270, -190], target: [-118, 192, -375], seconds: 10 },
	// Close in on the highest hill's tower, low over its trees, and go most of the way around it.
	{ position: [-90, 192, -326], target: [-118, 192, -375], seconds: 4 },
	{ position: [-136, 191, -328], target: [-118, 192, -375], seconds: 4 },
	{ position: [-166, 190, -358], target: [-118, 192, -375], seconds: 6 },
	{ position: [-140, 190, -421], target: [-118, 192, -375], seconds: 6 },
	{ position: [-72, 192, -397], target: [-118, 192, -375], seconds: 6 },
	{ position: [-74, 196, -354], target: [-118, 192, -375], seconds: 6 },
	{ position: [90, 250, -250], target: [255, 170, -350], seconds: 9 },
	{ position: [330, 185, -220], target: [430, 60, -60], seconds: 9 },
	{ position: [560, 130, -20], target: [430, 45, -70], seconds: 9 },
	{ position: [680, 240, 300], target: [200, 70, -40], seconds: 9 },
];

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, page, time } = ctx;
	const preset = ctx.quality.preset;
	// A phone's range stands still. The stretchable range follows the town as the camera draws back,
	// which on a phone would grow the shadow maps again over the far hills.
	const stretchable = preset !== 'low';
	page.post('loading', 'Raising the island');
	// The environment maps build on the GPU, and on a software GPU that takes minutes. Nothing that
	// the visitor's controls need depends on them, so the loads run beside the scene's own build and
	// the stage takes them when they arrive.
	const sky = assets.skyEnvironment();
	const room = assets.builtinEnvironment('room');
	const sun = scene.createDirectionalLight({
		castShadows: true,
		layers: SUN_LAYERS | CASTER_LAYER,
		// The offsets keep the ground from shadowing itself in the far cascades, whose wide texels would
		// band it in rings around the camera. One texel of each cascade caps them, so near things stay tight.
		shadow: {
			distance: SHADOW_DISTANCE[preset],
			normalBias: 1,
			bias: 1,
			contactDistance: 0.25,
		},
	});
	// Warm light thrown back from the dry ground lifts the shadows' undersides, so they do not read sky blue.
	scene.createHemisphereLight({ skyColor: '#b9a890', groundColor: '#c2965c', intensity: 0.8 });
	// Bloom, auto exposure and the vignette start off; the HUD's Post buttons turn each on. Ambient
	// occlusion starts on, so the scene's shadows read.
	post.set({ ao: { radius: 0.7 } });
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.3,
		far: 42000,
		layers: 1 | INTERIOR_LAYER | EFFECT_LAYER,
	});
	scene.setActiveCamera(camera);
	const opening = SHOTS[0]?.target ?? [0, 25, 0];
	const target: [number, number, number] = [opening[0], opening[1], opening[2]];

	// The analytic sky that Low would draw matches the physical sky only in its mean light over the whole
	// sphere, so away from the sun it reads far darker and deeper in hue. The island's sky fills half of many
	// views, so it keeps the physical sky on every preset.
	// The island draws no screen-space bounce light on any preset: its open daylight gains little from
	// it, and the frame keeps the time.
	ctx.quality.set({ physicalSky: true, bounceRays: 0 });

	// The mood: a summer morning at its start, with a little cloud and a thin haze for depth. `Auto`
	// moves the sun and the moon across the sky; the other moods hold an hour. The controls and the
	// camera's route come before the town: they need no part of it, and they post the HUD, so a
	// visitor gets the controls while the island is still rising.
	const stage = createMoods(ctx, sun, sky, room, {
		heading: HEADING,
		fogDensity: 0.000018,
		exposureScale: 3,
		environmentScale: 1,
		cloudCoverage: 0,
		haze: { Golden: 0.7 },
		backdrop: [0.02, 0.025, 0.04],
	});
	const start = params.get('mood');
	if (isMood(start)) stage.set(start);
	else stage.setHour(MORNING);

	// The scene's controls: which effects its HUD offers, what each of its own does, and the state each
	// starts in. The shared part, the sky, the fog, the environment light, the shadows and the lens,
	// lives in `createShowcaseEffects`.
	const controls = createShowcaseEffects(ctx, {
		camera,
		sun,
		...(stretchable && { shadowReach: SHADOW_REACH }),
		stage,
		start: {
			lod: true,
			sky: true,
			fog: true,
			shadows: true,
			contact: true,
			ao: true,
			environment: true,
			bloom: false,
			dof: false,
			exposure: false,
			vignette: false,
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
					post.set({ bloom: on ? { blend: 'add', intensity: 0.7, threshold: 1 } : false });
					break;
			}
		},
		mood: (picked) => stage.set(picked),
		hour: (hours) => stage.setHour(hours),
		film: () => film,
		fov: FOV,
		focalLength: DSLR_FOCAL_LENGTH,
		focus: target,
		dslr: params.has('dslr'),
	});

	const film = createCinematic(ctx, camera, {
		shots: SHOTS,
		target,
		groups: controls.groups,
		bounds: {
			...BOUNDS,
			ground: (x, z) => Math.max(groundHeight(x, z), SEA_LEVEL),
		},
	});
	// The camera stands at the route's opening pose now, so the shadows reach as far as it needs.
	controls.fitShadows();

	const land = createLand(ctx);
	const sea = createSea(ctx);
	createTown(ctx);
	page.post('loading', 'Growing the trees');
	const trees = await createTrees(ctx, camera);
	// The stage writes the light its maps give before the first frame draws.
	await Promise.all([sky, room]);

	const eye: [number, number, number] = [0, 0, 0];
	return {
		onUpdate(dt) {
			const t = time.now;
			stage.update(dt);
			controls.update(t);
			film.update(dt);
			const lens = controls.lens();
			if (lens) post.set(lens);
			camera.getPosition(eye);
			land.update(eye);
			sea.update();
			trees.update();
		},
	};
});
