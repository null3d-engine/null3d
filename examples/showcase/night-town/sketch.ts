// Night town: a showcase scene of a small town on a snowy night. Timber houses with lit windows
// stand around a cobbled square, a stone clock tower rises at its corner, and iron lamps throw the
// town's own warm light. Snow falls, chimneys smoke, mist lies over the square, and the moon lights
// the snow through the pines that ring the clearing. Everything is made in code: the land, the
// houses, the props, the trees and the falling snow.
//
// The camera runs a cinematic route made for this scene (see SHOTS). `c` toggles between the route
// (Auto) and the user's own fly camera (Manual); `h` hides the on-screen help. The page's buttons
// pick a time of day (Night at its start), and `d` or the buttons turn on a "DSLR" lens with depth of
// field. For held frames, the sketch's address takes the mood: `?mood=Night&dslr`.
import { defineSketch, type QualityPreset } from '@null3d/engine';
import { createCinematic, type Shot } from '../../lib/cinematic';
import { createMoods, isMood, type Mood } from '../../lib/stage';
import { createAir } from './air';
import { createHouses } from './houses';
import { createLamps } from './lamps';
import { createLand } from './land';
import { createProps } from './props';
import { createTrees } from './trees';

/** The detail that each preset builds at the start. */
const DETAIL: Record<QualityPreset, { land: number; texture: number }> = {
	low: { land: 224, texture: 256 },
	medium: { land: 288, texture: 512 },
	high: { land: 340, texture: 512 },
	ultra: { land: 400, texture: 1024 },
};
/** The camera's vertical field of view in degrees, and the DSLR lens's focal length in millimetres. */
const FOV = 45;
const DSLR_FOCAL_LENGTH = 50;
/** The turn of the moon's path about +y, so it stands behind the town and lights the square. */
const HEADING = 2.3;
/** The point that the camera looks at, over the square. */
const TARGET = [0, 1.4, 0] as const;

/**
 * The cinematic route. It opens high and back, showing the whole town, the square and the clock
 * tower at once. Then it swings over the town to the east, drops into the east lane for the tower,
 * crosses the square past the well and the lamps into the north lane, climbs the north lane and
 * sweeps high over the roofs to the south, drops into the south lane, and climbs back to the
 * opening view. Low passes keep to the open cross of the lanes and the square, so the camera never
 * enters a house. The first shot holds still, so a held frame lands on the opening view.
 */
const SHOTS: readonly Shot[] = [
	{ position: [-30, 30, -40], target: [2, 3, 6], seconds: 5, move: 'hold' },
	{ position: [-30, 30, -40], target: [2, 3, 6], seconds: 3 },
	{ position: [26, 14, -8], target: [8, 4, 2], seconds: 9 },
	{ position: [26, 6, -4], target: [12.6, 8, 8.4], seconds: 8 },
	{ position: [6, 4.0, 0.6], target: [0, 3, 0], seconds: 7 },
	{ position: [0.5, 4.2, 13], target: [0, 2.8, -2], seconds: 7 },
	{ position: [0, 15, 26], target: [0, 3, 2], seconds: 7 },
	{ position: [-20, 15, -14], target: [0, 3, 0], seconds: 8 },
	{ position: [-1, 4, -6], target: [1, 3, 2], seconds: 7 },
	{ position: [0, 12, 4], target: [0, 3, 2], seconds: 6 },
];

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, quality, page, time, input } = ctx;
	const detail = DETAIL[quality.preset];
	const [sky, room] = await Promise.all([
		assets.skyEnvironment(),
		assets.builtinEnvironment('room'),
	]);
	const sun = scene.createDirectionalLight({
		castShadows: true,
		shadow: { distance: 70, normalBias: 0.05, contactDistance: 0.25 },
	});
	post.set({
		bloom: { intensity: 0.72, threshold: 1 },
		ao: { radius: 0.7 },
		vignette: {},
	});
	const camera = scene.createPerspectiveCamera({ fov: FOV, near: 0.08, far: 500 });
	scene.setActiveCamera(camera);
	const target: [number, number, number] = [TARGET[0], TARGET[1], TARGET[2]];

	createLand(ctx, detail.land, detail.texture);
	const houses = createHouses(ctx, detail.texture);
	const props = createProps(ctx, houses.clear);
	const trees = await createTrees(ctx, (x, z) => houses.clear(x, z) || props.clear(x, z));
	const lamps = await createLamps(ctx);
	const air = await createAir(ctx, houses.homes);
	const fit = () => {
		trees.fit(quality.preset);
		lamps.fit(quality.preset);
		air.fit(quality.preset);
	};
	fit();

	// The mood: night at its start, with a little cloud and a light fog for depth.
	const setMood = createMoods(ctx, sun, sky, room, {
		heading: HEADING,
		fogDensity: 0.0075,
		cloudCoverage: 0.35,
	});
	const choose = (mood: Mood) => setMood(mood);
	const start = params.get('mood');
	choose(isMood(start) ? start : 'Night');

	// The "DSLR" lens: a 50 mm lens wide open, which focuses on the point that the camera looks at.
	const lens = { dof: { aperture: 1.8, maxBlur: 0.025, focusPoint: target } };
	let dslr = false;
	const setLens = (on: boolean) => {
		dslr = on;
		if (on) camera.setFocalLength(DSLR_FOCAL_LENGTH);
		else camera.setFov(FOV);
		post.set(on ? lens : { dof: false });
	};
	if (params.has('dslr')) setLens(true);

	const film = createCinematic(ctx, camera, {
		shots: SHOTS,
		target,
		speed: 8,
		rows: () => [{ key: 'D', text: `lens: ${dslr ? 'on' : 'off'}` }],
	});

	page.onMessage((name, value) => {
		if (name === 'mood' && isMood(value)) choose(value);
		if (name === 'dslr') setLens(value === 'On');
		if (name === 'camera') film.toggle();
	});

	return {
		onUpdate(dt) {
			const t = time.now;
			if (input.wasPressed('KeyD')) {
				setLens(!dslr);
				film.refresh();
			}
			film.update(dt);
			if (dslr) post.set(lens);
			air.update(t);
		},
	};
});
