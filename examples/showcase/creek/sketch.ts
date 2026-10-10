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
import { defineSketch, type QualityPreset } from '@null3d/engine';
import { interact } from '../../lib/interact';
import { createMoods, isMood, type Mood } from '../../lib/stage';
import { createFlora } from './flora';
import { createGrass, INLAND_LAYER } from './grass';
import { createLand, WATER } from './land';
import { loadModels } from './models';
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
/** The point that the camera looks at, over the stream. */
const TARGET = [1.5, 0, -0.4] as const;

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, quality, page, time } = ctx;
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
		layers: 1 | INLAND_LAYER,
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, {
		target: [...TARGET],
		minDistance: 1.5,
		maxDistance: 40,
		maxPolarAngle: 1.5,
	});

	createLand(ctx, detail.land, detail.texture);
	createWater(ctx, detail.water);
	const models = await loadModels(ctx);
	const stones = createStones(ctx, detail.rock, detail.texture, models.cave);
	const flora = await createFlora(ctx, models);
	const grass = createGrass(ctx, (x, z) => stones.clear(x, z) || flora.clear(x, z));
	const fit = () => {
		grass.fit(quality.preset);
		stones.fit(quality.preset);
	};
	fit();
	quality.onChange(fit);

	// The mood and the lens: from the address at the start, then from the page's buttons.
	// The sun sets low over the stream, ahead of the camera.
	const setMood = createMoods(ctx, sun, sky, room, {
		heading: Math.PI + 0.5,
		fogDensity: 0.006,
		cloudCoverage: 0.3,
	});
	const choose = (mood: Mood) => {
		setMood(mood);
		flora.nightLights(mood === 'Night' || mood === 'Blue');
	};
	const start = params.get('mood');
	choose(isMood(start) ? start : 'Afternoon');
	// The DSLR lens: a 50 mm lens wide open, which focuses on the point that the camera orbits in
	// every frame. Off, the camera keeps its wider view and everything stays sharp.
	const lens = { dof: { aperture: 1.8, maxBlur: 0.025, focusPoint: view.controls.target } };
	let dslr = false;
	const setLens = (on: boolean) => {
		dslr = on;
		if (on) camera.setFocalLength(DSLR_FOCAL_LENGTH);
		else camera.setFov(FOV);
		post.set(on ? lens : { dof: false });
	};
	if (params.has('dslr')) setLens(true);
	page.onMessage((name, value) => {
		if (name === 'mood' && isMood(value)) choose(value);
		if (name === 'dslr') setLens(value === 'On');
	});

	return {
		onUpdate(dt) {
			const t = time.now;
			if (!view.userCamera) {
				// A slow drift along the near bank, low over the water.
				const a = -2.6 + 0.18 * Math.sin(t * 0.06);
				camera.setPosition(
					TARGET[0] + 10.5 * Math.cos(a),
					WATER + 1.9 + 0.2 * Math.sin(t * 0.05),
					TARGET[2] - 10.5 * Math.sin(a),
				);
				camera.lookAt(TARGET[0], TARGET[1], TARGET[2]);
			}
			view.update(dt);
			if (dslr) post.set(lens);
			flora.update(t);
		},
	};
});
