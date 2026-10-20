// Creek: a showcase scene of a small stream in a grassy valley. Clear water runs over a stony bed:
// a reflection pass mirrors the banks and the sky in it, and the bed shows through it, bent by its
// ripples. Dense grass sways in the wind, and fallen leaves float on the current. Rocks, pebbles,
// grass and leaves are instance batches that cast and receive the sun's shadows. The land, its
// textures, the rocks, the grass and the water are made in code. The trees, the plants and the
// cave mouth are models that a script builds in Blender, loaded from files.
//
// The controls pick a time of day and turn the effects on and off, among them a "DSLR" lens with
// depth of field, which focuses on the point that the camera looks at. The camera runs a cinematic
// route that is made for this scene (see SHOTS); `c` hands it to the user. For held frames, the
// sketch's address takes the mood too: `?mood=Night&dslr`.
import { defineSketch, type QualityPreset, timeOfDay } from '@null3d/engine';
import { type CameraBounds, createCinematic, type Shot } from '../../lib/cinematic';
import { createHaze } from '../../lib/haze';
import { EFFECT_LAYER, INTERIOR_LAYER } from '../../lib/layers';
import { reportLoading } from '../../lib/progress';
import { createShowcaseEffects, type ShadowReach } from '../../lib/showcase-effects';
import { createMoods, isMood, type Mood, nearestMood } from '../../lib/stage';
import { createAir } from './air';
import { createFlora } from './flora';
import { createGrass } from './grass';
import {
	createLand,
	createMountains,
	GORGE,
	groundHeight,
	streamZ,
	UNREFLECTED_LAYER,
	WATER,
} from './land';
import { loadModels } from './models';
import { createShafts } from './shafts';
import { createStones } from './stones';
import { createUnderwater } from './underwater';
import { createWater } from './water';

/** The detail that each preset builds at the start: the land's quads, texture sizes and more. */
const DETAIL: Record<
	QualityPreset,
	{ land: number; texture: number; rock: number; water: number; ring: readonly [number, number] }
> = {
	low: { land: 192, texture: 256, rock: 2, water: 200, ring: [160, 32] },
	medium: { land: 256, texture: 512, rock: 3, water: 300, ring: [224, 40] },
	high: { land: 320, texture: 512, rock: 3, water: 400, ring: [288, 48] },
	ultra: { land: 384, texture: 1024, rock: 3, water: 400, ring: [320, 56] },
};
/** The camera's vertical field of view in degrees, and the DSLR lens's focal length in millimetres. */
const FOV = 45;
const DSLR_FOCAL_LENGTH = 50;
/** The turn of the sun's path, so that it sets low over the stream, ahead of the camera. */
const HEADING = Math.PI + 0.5;
/** The light of the caustics on the stream's bed in each mood: the sun's color, at its strength. */
const CAUSTICS: Record<Mood, [number, number, number]> = {
	Auto: [0.32, 0.3, 0.25],
	Dawn: [0.3, 0.2, 0.12],
	Morning: [0.32, 0.3, 0.25],
	Midday: [0.32, 0.3, 0.25],
	Afternoon: [0.32, 0.3, 0.25],
	Golden: [0.3, 0.18, 0.08],
	Dusk: [0, 0, 0],
	Night: [0, 0, 0],
	Studio: [0.08, 0.08, 0.08],
};
/** The point that the camera looks at, over the stream. */
const TARGET = [1.5, 0, -0.4] as const;
/**
 * The creek's core: the sphere around the stream, its banks and their trees, which keeps its
 * shadows wherever the camera stands. The sun's shadows reach this far close up, and further as
 * the camera draws back.
 */
export const SHADOW_REACH: ShadowReach = { distance: 60, center: [0, 4, 0], radius: 34 };
/**
 * Where the Manual camera may go: around the creek, a little farther back than the opening view
 * stands, and above the ground and the mountains' slopes. Its highest reach, the focus's top plus
 * the distance, stays under the mountains' lowest crest.
 */
export const BOUNDS: Omit<CameraBounds, 'ground'> = {
	center: [0, 0],
	focus: 30,
	focusHeight: [0, 6],
	distance: 45,
	// The stream's bed is the ground under the water, so the camera may dip under the surface but
	// never through the bed.
	clearance: 0.15,
};
/**
 * The cinematic route. It opens high over the whole valley, showing the stream, both banks and the
 * trees at once. It glides down behind the near bank's trees and runs along them to the end of the
 * line, facing across to the far bank, then turns back down the valley. It drops to the water and
 * traces the stream's own winding line back past the trees with no pause, then turns right to run
 * behind the far bank's trees, facing the near bank. Last it circles out around the creek's head to
 * the opening view, with the middle of the creek in frame, and zooms back to the opening distance.
 * The opening shot holds only briefly, so a held frame lands on a settled pose and the camera moves
 * off it at once; the low passes stay over the stream, so the camera never enters a tree or a bank.
 * The opening pose repeats in the second shot: a shot starts at its own pose, so without the repeat
 * the camera would snap when the hold ends.
 */
const WIDE: readonly [number, number, number] = [-23, 13, 19];
const WIDE_LOOK: readonly [number, number, number] = [2, 0, 0];
export const SHOTS: readonly Shot[] = [
	// The opening: high over the valley with the whole stream in view. It holds briefly, so the
	// image test's held frame lands on a settled pose and the auto camera moves off it quickly.
	{ position: WIDE, target: WIDE_LOOK, seconds: 1, move: 'hold' },
	// The same pose, then the glide to the near bank: the repeat avoids a snap at the hold's end.
	{ position: WIDE, target: WIDE_LOOK, seconds: 7 },
	// Behind the near bank's trees, looking across to the far bank.
	{ position: [-17, 5, 12.5], target: [-11, 1, -7], seconds: 6 },
	// Along behind the near tree line, still facing the far bank.
	{ position: [6, 5, 14.5], target: [10, 1, -6], seconds: 6 },
	// The end of the near tree line: it turns to face back down the valley here.
	{ position: [26, 5, 15.5], target: [28, 1, -4], seconds: 7 },
	// Down to the water, tracing the stream's own winding line back down the valley.
	{ position: [26, 2.4, streamZ(26)], target: [10, 0.5, streamZ(10)], seconds: 8 },
	{ position: [6, 2.2, streamZ(6)], target: [-8, 0.5, streamZ(-8)], seconds: 7 },
	{ position: [-12.5, 2.2, streamZ(-12.5)], target: [-22, 0.6, streamZ(-22)], seconds: 7 },
	// Right to the far bank, behind its trees and facing back over the water.
	{ position: [-12.5, 4.5, -18], target: [-6, 1, 6], seconds: 7 },
	// Along the back of the far bank's trees, all the way down the valley.
	{ position: [-22, 4.5, -18], target: [-16, 1, 6], seconds: 7 },
	// Circle out around the creek's head to the opening view, keeping the middle of the creek in
	// frame and zooming back to the opening distance, so the loop closes on the opening pose.
	{ position: [-27, 7, 2], target: [1, 0.5, 0], seconds: 8 },
];

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, quality, page, time } = ctx;
	const detail = DETAIL[quality.preset];
	reportLoading(ctx);
	const [sky, room] = await Promise.all([
		assets.skyEnvironment(),
		assets.builtinEnvironment('room'),
	]);
	const sun = scene.createDirectionalLight({
		castShadows: true,
		// Two cascades over a wider distance: one box fitted to the camera dropped casters at its
		// edge as the camera moved, which made the shadows under the trees change.
		shadow: { distance: SHADOW_REACH.distance, normalBias: 0.04, cascades: 2 },
	});
	// Bloom, auto exposure and the vignette start off; the HUD's Post buttons turn each on. Ambient
	// occlusion starts on, so the scene's shadows read.
	post.set({
		ao: { radius: 0.5 },
		bloom: { blend: 'add', intensity: 0.2, threshold: 1 },
	});
	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.05,
		far: 2000,
		layers: 1 | UNREFLECTED_LAYER | INTERIOR_LAYER | EFFECT_LAYER,
		// The camera takes the route's opening pose at once, so even a frame drawn before the
		// route's first step shows the opening view, never the origin inside the far bank.
		position: WIDE,
		target: WIDE_LOOK,
	});
	scene.setActiveCamera(camera);
	const target: [number, number, number] = [TARGET[0], TARGET[1], TARGET[2]];

	createLand(ctx, detail.land, detail.texture);
	const mountains = createMountains(ctx, detail.ring[0], detail.ring[1]);
	// Haze fills the far ends of the gorges, where the land and the stream run out.
	const hazes = [0, Math.PI].map((bearing) =>
		createHaze(ctx, {
			bearing,
			from: GORGE.haze[0],
			to: GORGE.haze[1],
			halfWidth: 160,
			solid: 60,
			fade: 120,
			sheets: 10,
		}),
	);
	page.post('loading', 'Loading the trees, plants and cave');
	const models = await loadModels(ctx);
	const stones = createStones(ctx, detail.rock, detail.texture, models.cave);
	const water = createWater(ctx, detail.water, stones.obstacles, GORGE.end);
	const underwater = createUnderwater(ctx, camera, WATER);
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

	// The mood and the lens: from the address at the start, then from the HUD. The physical sky
	// draws the real sun by day and the moon at night; Auto moves them across the sky.
	const stage = createMoods(ctx, sun, sky, room, {
		heading: HEADING,
		fogDensity: 0.006,
		cloudCoverage: 0.3,
		haze: { Golden: 1.2, Dusk: 1.5 },
		backdrop: [0.02, 0.03, 0.05],
	});
	const golden = timeOfDay('goldenHour', { heading: HEADING });
	/** The mood whose look the scene shows. In Auto it is the fixed mood nearest to the hour. */
	let current: Mood = 'Afternoon';
	// Shafts of light at golden hour, at High and above: below, their march costs too much.
	const light = () => {
		const on =
			controls.on.shafts &&
			current === 'Golden' &&
			(quality.preset === 'high' || quality.preset === 'ultra');
		shafts.set(on ? golden.light.direction : undefined, [1.0, 0.62, 0.3]);
	};
	quality.onChange(() => {
		fit();
		light();
	});
	/** Gives the scene the look of a mood: its fireflies, its air and its water. */
	const showLook = (mood: Mood): void => {
		current = mood;
		flora.nightLights(mood === 'Night' || mood === 'Dusk');
		air.setMood(mood);
		water.setCaustics(CAUSTICS[mood]);
		light();
	};
	const choose = (mood: Mood) => {
		stage.set(mood);
		// Auto moves the hour through the day, so it takes the look of the hour rather than one look
		// that then sits under a moonlit sky.
		showLook(mood === 'Auto' ? nearestMood(stage.hours) : mood);
	};
	// The scene's controls: which effects its HUD offers, what each of its own does, and the state each
	// starts in. The shared part, the sky, the fog, the environment light, the shadows and the lens,
	// lives in `createShowcaseEffects`.
	const controls = createShowcaseEffects(ctx, {
		camera,
		sun,
		shadowReach: SHADOW_REACH,
		stage,
		start: {
			sky: true,
			fog: false,
			shafts: false,
			fireflies: false,
			shadows: true,
			ao: true,
			environment: true,
			bloom: true,
			dof: false,
			exposure: false,
			vignette: false,
		},
		supported: {
			atmosphere: ['sky', 'fog', 'shafts', 'fireflies'],
			lighting: ['shadows', 'ao', 'environment'],
			post: ['bloom', 'dof', 'exposure', 'vignette'],
		},
		apply(id, on) {
			switch (id) {
				case 'shafts':
					light();
					break;
				case 'fireflies':
					air.setFireflies(on);
					break;
				case 'fog':
					// The mist over the water is haze too, so the fog switch hides it with the fog.
					air.setMist(on);
					break;
				case 'ao':
					post.set({ ao: on ? { radius: 0.5 } : false });
					break;
				case 'bloom':
					post.set({ bloom: on ? { blend: 'add', intensity: 0.2, threshold: 1 } : false });
					break;
			}
		},
		mood: choose,
		hour(hours) {
			stage.setHour(hours);
			// The slider holds any hour, so the scene takes the look of the fixed mood nearest to it.
			showLook(nearestMood(hours));
		},
		film: () => film,
		fov: FOV,
		focalLength: DSLR_FOCAL_LENGTH,
		focus: target,
		dslr: params.has('dslr'),
	});
	const start = params.get('mood');
	choose(isMood(start) ? start : 'Afternoon');
	// The haze takes the air's color now too, since a held frame runs no update.
	for (const haze of hazes) haze.setColor(stage.airColor);

	const film = createCinematic(ctx, camera, {
		shots: SHOTS,
		target,
		groups: controls.groups,
		bounds: {
			...BOUNDS,
			ground: (x, z) => Math.max(groundHeight(x, z), mountains.heightAt(x, z)),
		},
	});
	// The camera stands at the route's opening pose now, so the shadows reach as far as it needs.
	controls.fitShadows();

	return {
		onUpdate(dt) {
			const t = time.now;
			stage.update(dt);
			for (const haze of hazes) haze.setColor(stage.airColor);
			underwater.update(stage.airColor, CAUSTICS[current]);
			controls.update(t);
			// In Auto the look follows the hour: the fireflies, the mist and the caustics cross to the
			// next time of day as the sun does.
			if (stage.auto) {
				const at = nearestMood(stage.hours);
				if (at !== current) showLook(at);
			}
			film.update(dt);
			const lens = controls.lens();
			if (lens) post.set(lens);
			flora.update(t);
			air.update(t);
			water.update();
		},
		onLateUpdate() {
			shafts.update();
		},
	};
});
