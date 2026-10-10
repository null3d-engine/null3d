// Creek: a showcase scene of a small stream in a grassy valley. Clear water runs over a stony bed:
// a reflection pass mirrors the banks and the sky in it, and the bed shows through it, bent by its
// ripples. Dense grass sways in the wind, and fallen leaves float on the current. Rocks, pebbles,
// grass and leaves are instance batches that cast and receive the sun's shadows. Everything is
// made in code: the land, its textures, the rocks, the grass and the water. Simple stand-ins mark
// the trees, the leafy plants and the cave mouth, for models made in Blender.
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
const proto = taaPrototype(params);

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
	const stones = createStones(ctx, detail.rock, detail.texture);
	const flora = await createFlora(ctx);
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
	proto.setup(ctx);
	page.onMessage((name, value) => {
		if (name === 'mood' && isMood(value)) choose(value);
		if (name === 'dslr') setLens(value === 'On');
	});

	return {
		onUpdate(dt) {
			const t = time.now;
			proto.update(ctx);
			if (!view.userCamera) {
				// A slow drift along the near bank, low over the water, or the prototype's orbit.
				const a = proto.orbit === null ? -2.6 + 0.18 * Math.sin(t * 0.06) : -2.6 + proto.orbit * t;
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

/**
 * The switches of the temporal anti-aliasing prototype (M2-EX18), for its measurements only:
 *
 * - `?aa=msaa`, `fxaa` (FXAA over MSAA), `taa`, `taa-linear` or `taa-still`: what smooths edges.
 * - `?fixed`: render scale 1 with the governor off. `?step`: each frame adds 1/60 s of sketch time.
 * - `?orbit=<radians per second>`: the camera circles the target at that rate; 0 holds it still.
 * - `?frames`: posts each frame's number to the page as 'frame'.
 * - The page's 'taa' and 'msaafxaa' messages turn those on, posting 'settled' once they draw, and
 *   the same names with '-off' turn them off.
 */
function taaPrototype(params: URLSearchParams) {
	const orbit = params.get('orbit');
	const frames = params.has('frames');
	const modes: Record<
		string,
		{
			taa: boolean | { filter?: 'linear'; jitter?: boolean; feedback?: number; depth?: 'light' };
			msaaFxaa: boolean;
		}
	> = {
		msaa: { taa: false, msaaFxaa: false },
		fxaa: { taa: false, msaaFxaa: true },
		taa: { taa: true, msaaFxaa: false },
		'taa-linear': { taa: { filter: 'linear' }, msaaFxaa: false },
		'taa-still': { taa: { jitter: false }, msaaFxaa: false },
		'taa-80': { taa: { feedback: 0.8 }, msaaFxaa: false },
		'taa-light': { taa: { depth: 'light' }, msaaFxaa: false },
	};
	type Ctx = Parameters<Parameters<typeof defineSketch>[0]>[0];
	return {
		orbit: orbit === null ? null : Number(orbit),
		setup({ post, quality, page, scene, time }: Ctx) {
			if (params.has('step'))
				(globalThis as { __null3dFixedStep?: number }).__null3dFixedStep = 1 / 60;
			if (params.has('fixed'))
				quality.set({ minRenderScale: 1, maxRenderScale: 1, governor: false });
			const aa = params.get('aa');
			if (aa !== null && modes[aa]) post.set(modes[aa]);
			page.onMessage((name) => {
				const on = name === 'taa' || name === 'msaafxaa';
				if (!on && name !== 'taa-off' && name !== 'msaafxaa-off') return;
				if (name.startsWith('taa')) post.set({ taa: on });
				else post.set({ msaaFxaa: on });
				if (!on) return;
				const frame = time.frame;
				const start = performance.now();
				void scene
					.warmUp()
					.then(() =>
						page.post('settled', { frames: time.frame - frame, ms: performance.now() - start }),
					);
			});
		},
		update({ page, time }: Ctx) {
			if (frames) page.post('frame', time.frame);
		},
	};
}
