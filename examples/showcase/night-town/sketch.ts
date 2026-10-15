// Night town: a showcase scene of a small town on a snowy night. Timber houses with lit windows
// stand around a cobbled square, a stone clock tower rises at its corner, and iron lamps throw the
// town's own warm light. Snow falls, chimneys smoke, mist lies over the square, and the moon lights
// the snow through the pines that ring the clearing. Everything is made in code: the land, the
// houses, the props, the trees and the falling snow.
//
// The camera runs a cinematic route made for this scene (see SHOTS). `c` toggles between the route
// (Auto) and the user's own fly camera (Manual); `h` opens and closes the controls. The controls
// pick a time of day (Night at its start) and turn the effects on and off, among them a "DSLR" lens
// with depth of field. For held frames, the sketch's address takes the mood: `?mood=Night&dslr`.
import { defineSketch, type QualityPreset } from '@null3d/engine';
import { createCinematic, type Shot } from '../../lib/cinematic';
import {
	ATMOSPHERE,
	LIGHTING,
	POST,
	QUALITY,
	radioGroup,
	TIMES_OF_DAY,
	toggleGroup,
} from '../../lib/controls';
import { EFFECT_LAYER, INTERIOR_LAYER } from '../../lib/layers';
import { createMoods, isMood } from '../../lib/stage';
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
export const SHOTS: readonly Shot[] = [
	// The opening view holds only briefly, so the camera starts moving soon after the page loads.
	{ position: [-30, 30, -40], target: [2, 3, 6], seconds: 0.8, move: 'hold' },
	{ position: [-30, 30, -40], target: [2, 3, 6], seconds: 3 },
	{ position: [26, 14, -8], target: [8, 4, 2], seconds: 9 },
	{ position: [26, 6, -1.2], target: [12.6, 8, 8.4], seconds: 8 },
	{ position: [6, 4.0, -0.3], target: [0, 3, 0], seconds: 6 },
	{ position: [2, 4.0, 6], target: [0, 3, 0], seconds: 3 },
	{ position: [0.3, 4.2, 13], target: [0, 2.8, -2], seconds: 7 },
	{ position: [0, 15, 26], target: [0, 3, 2], seconds: 7 },
	{ position: [-20, 15, -14], target: [0, 3, 0], seconds: 8 },
	{ position: [-1, 4, -6], target: [1, 3, 2], seconds: 7 },
	{ position: [0, 12, 4], target: [0, 3, 2], seconds: 6 },
];

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, quality, page, time } = ctx;
	const detail = DETAIL[quality.preset];
	page.post('loading', 'Building the town');
	const [sky, room] = await Promise.all([
		assets.skyEnvironment(),
		assets.builtinEnvironment('room'),
	]);
	const sun = scene.createDirectionalLight({
		castShadows: true,
		shadow: { distance: 70, normalBias: 0.05, contactDistance: 0.25 },
	});
	// Bloom, auto exposure and the vignette start off; the HUD's Post buttons turn each on. Ambient
	// occlusion starts on, so the scene's shadows read.
	post.set({ ao: { radius: 0.7 } });
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.08,
		far: 500,
		layers: 1 | INTERIOR_LAYER | EFFECT_LAYER,
	});
	scene.setActiveCamera(camera);
	const target: [number, number, number] = [TARGET[0], TARGET[1], TARGET[2]];

	createLand(ctx, detail.land, detail.texture);
	const houses = createHouses(ctx, detail.texture);
	const props = createProps(ctx, houses.clear);
	page.post('loading', 'Growing the pines');
	const trees = await createTrees(ctx, (x, z) => houses.clear(x, z) || props.clear(x, z));
	const lamps = await createLamps(ctx);
	page.post('loading', 'Falling the snow');
	const air = await createAir(ctx, houses.homes);
	const fit = () => {
		trees.fit(quality.preset);
		lamps.fit(quality.preset);
		air.fit(quality.preset);
	};
	fit();

	// The mood: night at its start, with a little cloud and a light fog for depth. `Auto` moves the
	// sun and the moon across the sky; the other moods hold an hour.
	const stage = createMoods(ctx, sun, sky, room, {
		heading: HEADING,
		fogDensity: 0.0075,
		cloudCoverage: 0.35,
		backdrop: [0.02, 0.025, 0.04],
	});
	const start = params.get('mood');
	stage.set(isMood(start) ? start : 'Night');

	// The scene's own controls: the effects that its HUD offers, and the state of each.
	const effects: Record<string, boolean> = {
		sky: true,
		fog: true,
		snow: true,
		shadows: true,
		contact: true,
		ao: true,
		environment: true,
		bloom: false,
		dof: false,
		exposure: false,
		vignette: false,
	};
	// The "DSLR" lens: a 50 mm lens wide open, which focuses on the point that the camera looks at.
	const lens = { dof: { aperture: 1.8, maxBlur: 0.025, focusPoint: target } };
	let dslr = false;
	const setLens = (on: boolean) => {
		dslr = on;
		effects.dof = on;
		if (on) camera.setFocalLength(DSLR_FOCAL_LENGTH);
		else camera.setFov(FOV);
		post.set(on ? lens : { dof: false });
	};
	if (params.has('dslr')) setLens(true);

	const setEffect = (id: string, on: boolean): void => {
		effects[id] = on;
		switch (id) {
			case 'sky':
			case 'fog':
			case 'environment':
				stage.show(id, on);
				break;
			case 'snow':
				air.setSnow(on);
				break;
			case 'shadows':
				sun.setCastShadows(on);
				break;
			case 'contact':
				sun.setShadow({ contactDistance: on ? 0.25 : 0 });
				break;
			case 'ao':
				post.set({ ao: on ? { radius: 0.7 } : false });
				break;
			case 'bloom':
				post.set({ bloom: on ? { blend: 'add', intensity: 0.7, threshold: 1 } : false });
				break;
			case 'dof':
				setLens(on);
				break;
			case 'exposure':
				post.set({ autoExposure: on ? {} : false });
				break;
			case 'vignette':
				post.set({ vignette: on ? {} : false });
				break;
		}
	};
	const groups = () => [
		radioGroup('mood', 'Time of day', TIMES_OF_DAY, stage.mood),
		toggleGroup(
			'atmosphere',
			'Atmosphere',
			ATMOSPHERE,
			['sky', 'fog', 'snow'],
			(id) => effects[id] ?? false,
		),
		toggleGroup(
			'lighting',
			'Lighting',
			LIGHTING,
			['shadows', 'contact', 'ao', 'environment'],
			(id) => effects[id] ?? false,
		),
		toggleGroup(
			'post',
			'Post',
			POST,
			['bloom', 'dof', 'exposure', 'vignette'],
			(id) => effects[id] ?? false,
		),
		radioGroup('quality', 'Quality', QUALITY, quality.preset),
	];

	const film = createCinematic(ctx, camera, {
		shots: SHOTS,
		target,
		speed: 8,
		groups,
	});

	page.onMessage((name, value) => {
		const picked = String(value);
		if (name === 'camera') film.select(picked);
		else if (name === 'mood' && isMood(value)) {
			stage.set(value);
			film.refresh();
		} else if (name === 'atmosphere' || name === 'lighting' || name === 'post') {
			setEffect(picked, !(effects[picked] ?? false));
			film.refresh();
		} else if (name === 'quality') {
			void quality.setPreset(picked as QualityPreset);
			film.refresh();
		}
	});

	return {
		onUpdate(dt) {
			const t = time.now;
			stage.update(dt);
			film.update(dt);
			if (dslr) post.set(lens);
			air.update(t);
		},
	};
});
