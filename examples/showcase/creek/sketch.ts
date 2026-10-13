// Creek: a showcase scene of a small stream in a grassy valley. Clear water runs over a stony bed:
// a reflection pass mirrors the banks and the sky in it, and the bed shows through it, bent by its
// ripples. Dense grass sways in the wind, and fallen leaves float on the current. Rocks, pebbles,
// grass and leaves are instance batches that cast and receive the sun's shadows. The land, its
// textures, the rocks, the grass and the water are made in code. The trees, the plants and the
// cave mouth are models that a script builds in Blender, loaded from files.
//
// The page's buttons pick a mood (four times of day and a studio) and turn on a "DSLR" lens with
// depth of field, which focuses on the point that the camera orbits. For held frames, the sketch's
// address takes them too: `?mood=Night&dslr`.
import { defineSketch, type QualityPreset, timeOfDay } from '@null3d/engine';
import { createCinematic, type Shot } from '../../lib/cinematic';
import { interact } from '../../lib/interact';
import { createMoods, isMood, type Mood } from '../../lib/stage';
import { createAir } from './air';
import { createFlora } from './flora';
import { createGrass } from './grass';
import { createLand, UNREFLECTED_LAYER, WATER } from './land';
import { loadModels } from './models';
import { createShafts } from './shafts';
import { createStones } from './stones';
import { createWater } from './water';

/** The detail that each preset builds at the start: the land's quads, texture sizes and more. */
const DETAIL: Record<
	QualityPreset,
	{ land: number; texture: number; rock: number; water: number }
> = {
	low: { land: 192, texture: 256, rock: 2, water: 200 },
	medium: { land: 256, texture: 512, rock: 3, water: 300 },
	high: { land: 320, texture: 512, rock: 3, water: 400 },
	ultra: { land: 384, texture: 1024, rock: 3, water: 400 },
};
/** The camera's vertical field of view in degrees, and the DSLR lens's focal length in millimetres. */
const FOV = 45;
const DSLR_FOCAL_LENGTH = 50;
/** The turn of the sun's path, so that it sets low over the stream, ahead of the camera. */
const HEADING = Math.PI + 0.5;
/** The light of the caustics on the stream's bed in each mood: the sun's color, at its strength. */
const CAUSTICS: Record<Mood, [number, number, number]> = {
	Afternoon: [0.32, 0.3, 0.25],
	Golden: [0.3, 0.18, 0.08],
	Blue: [0, 0, 0],
	Night: [0, 0, 0],
	Studio: [0.08, 0.08, 0.08],
};
/** The point that the camera looks at, over the stream. */
const TARGET = [1.5, 0, -0.4] as const;
/**
 * The pose that the image tests hold at, from the route's own first frame: the held frame's camera
 * stays exactly where the scripted drift left it, so the scene's references do not change.
 */
const HOLD_A = -2.6 + 0.18 * Math.sin(4 * 0.06);
const HOLD_POSE: readonly [number, number, number] = [
	TARGET[0] + 10.5 * Math.cos(HOLD_A),
	WATER + 1.9 + 0.2 * Math.sin(4 * 0.05),
	TARGET[2] - 10.5 * Math.sin(HOLD_A),
];
const HOLD_LOOK: readonly [number, number, number] = [TARGET[0], TARGET[1], TARGET[2]];
/**
 * The cinematic route: low along the near bank toward the water and the far trees, up over the
 * valley, then down the stream past the cave, and back. Its first shot holds still.
 */
const SHOTS: readonly Shot[] = [
	{ position: HOLD_POSE, target: HOLD_LOOK, seconds: 5, move: 'hold' },
	{ position: [-13, 6.5, 11], target: [1.5, 0.6, -0.4], seconds: 8 },
	{ position: [21, 2.6, 1.5], target: [6, 0.8, -2], seconds: 8 },
	{ position: [4, 8.5, -15], target: [4, 3, -3], seconds: 7 },
	{ position: [-16, 4, -9], target: [1.5, 1, -0.4], seconds: 7 },
	{ position: HOLD_POSE, target: HOLD_LOOK, seconds: 7 },
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
		shadow: { distance: 40, normalBias: 0.04 },
	});
	post.set({ bloom: { intensity: 0.2, threshold: 1 }, ao: { radius: 0.5 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.05,
		far: 2000,
		layers: 1 | UNREFLECTED_LAYER,
	});
	scene.setActiveCamera(camera);
	const target: [number, number, number] = [TARGET[0], TARGET[1], TARGET[2]];
	const view = interact(ctx, camera, {
		target,
		minDistance: 1.5,
		maxDistance: 40,
		maxPolarAngle: 1.5,
	});

	createLand(ctx, detail.land, detail.texture);
	const models = await loadModels(ctx);
	const stones = createStones(ctx, detail.rock, detail.texture, models.cave);
	const water = createWater(ctx, detail.water, stones.obstacles);
	const flora = await createFlora(ctx, models);
	const air = await createAir(ctx, flora.crowns);
	const shafts = createShafts(ctx, camera);
	const grass = createGrass(ctx, (x, z) => stones.clear(x, z) || flora.clear(x, z));
	const fit = () => {
		grass.fit(quality.preset);
		stones.fit(quality.preset);
		water.fit(quality.preset);
	};
	fit();

	// The mood and the lens: from the address at the start, then from the page's buttons.
	// Golden hour has a haze, and shafts of light through the trees; dusk has more mist.
	const setMood = createMoods(ctx, sun, sky, room, {
		heading: HEADING,
		fogDensity: 0.006,
		cloudCoverage: 0.3,
		haze: { Golden: 2.2, Blue: 1.5 },
	});
	const golden = timeOfDay('goldenHour', { heading: HEADING });
	let current: Mood = 'Afternoon';
	// Shafts of light at golden hour, at High and above: below, their march costs too much.
	const light = () => {
		const on = current === 'Golden' && (quality.preset === 'high' || quality.preset === 'ultra');
		shafts.set(on ? golden.light.direction : undefined, [1.0, 0.62, 0.3]);
	};
	quality.onChange(() => {
		fit();
		light();
	});
	const choose = (mood: Mood) => {
		current = mood;
		setMood(mood);
		flora.nightLights(mood === 'Night' || mood === 'Blue');
		air.setMood(mood);
		water.setCaustics(CAUSTICS[mood]);
		light();
	};
	const start = params.get('mood');
	choose(isMood(start) ? start : 'Afternoon');
	// The DSLR lens: a 50 mm lens wide open, which focuses on the point that the camera orbits in
	// every frame. Off, the camera keeps its wider view and everything stays sharp.
	const lens = { dof: { aperture: 1.8, maxBlur: 0.025, focusPoint: target } };
	let dslr = false;
	const setLens = (on: boolean) => {
		dslr = on;
		if (on) camera.setFocalLength(DSLR_FOCAL_LENGTH);
		else camera.setFov(FOV);
		post.set(on ? lens : { dof: false });
	};
	if (params.has('dslr')) setLens(true);
	const film = createCinematic(ctx, camera, view, {
		shots: SHOTS,
		target,
		rows: () => [{ key: 'D', text: `lens: ${dslr ? 'on' : 'off'}` }],
	});
	page.onMessage((name, value) => {
		if (name === 'mood' && isMood(value)) choose(value);
		if (name === 'dslr') setLens(value === 'On');
	});

	return {
		onUpdate(dt) {
			const t = time.now;
			if (input.wasPressed('KeyD')) {
				setLens(!dslr);
				film.refresh();
			}
			film.update(dt);
			if (film.mode === 'manual') view.update(dt);
			if (dslr) post.set(lens);
			flora.update(t);
			air.update(t);
			water.update();
		},
		onLateUpdate() {
			shafts.update();
		},
	};
});
