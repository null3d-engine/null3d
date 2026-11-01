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
import {
	defineSketch,
	math,
	type QualityPreset,
	type SketchContext,
	timeOfDay,
} from '@null3d/engine';
import { createUnderwater, createWater, foamMap, type Water, type WaterShape } from '@null3d/water';
import { type CameraBounds, createCinematic, type Shot } from '../../lib/cinematic';
import { createHaze } from '../../lib/haze';
import { EFFECT_LAYER, INTERIOR_LAYER, SUN_LAYERS } from '../../lib/layers';
import { reportLoading } from '../../lib/progress';
import { createShowcaseEffects, type ShadowReach } from '../../lib/showcase-effects';
import { createMoods, isMood, type Mood, type MoodMix, moodMix, moodShare } from '../../lib/stage';
import { createAir } from './air';
import { createFlora } from './flora';
import { createGrass } from './grass';
import {
	createLand,
	createMountains,
	GORGE,
	groundHeight,
	STREAM_REACH,
	streamCurrent,
	streamDepth,
	streamZ,
	UNREFLECTED_LAYER,
	WATER,
} from './land';
import { loadModels } from './models';
import { createShafts } from './shafts';
import { createStones, type Obstacle } from './stones';

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
/**
 * The turn of the sun's path, so that it rises out of the gorge at one end of the stream and sets
 * into the gorge at the other, over the water.
 */
const HEADING = Math.PI;
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
/** The color of the shafts of light at golden hour. */
const SHAFT_TINT = [1.0, 0.62, 0.3] as const;
/** The least change of a look's share that Auto writes to the scene. */
const LOOK_STEP = 0.005;
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
	// The point it turns around may sink under the water too, as the route's dip along the bed does.
	focusHeight: [-0.5, 6],
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
	// Down to the water, tracing the stream's own winding line back down the valley. The camera
	// sinks under the surface and glides along the bed for about six seconds, between the stones,
	// then rises out of the water again. The dip passes through the surface on purpose.
	{ position: [26, 1, streamZ(26)], target: [14, -0.1, streamZ(14)], seconds: 4, through: true },
	{ position: [17, -0.15, streamZ(17)], target: [5, -0.2, streamZ(5)], seconds: 5, through: true },
	{ position: [8, -0.16, streamZ(8)], target: [-4, -0.16, streamZ(-4)], seconds: 4, through: true },
	{ position: [1.5, 1.8, streamZ(1.5)], target: [-10.5, 0.5, streamZ(-10.5)], seconds: 6 },
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
/** True draws the water's reflection in every frame, for the bisect of the Apple WebGPU stall. */
const ALWAYS_REFLECT = params.get('reflect') === 'always';
/** The reflection target's share of the render size that the address names, for the same bisect. */
const REFLECT_SCALE = Number(params.get('reflection-scale')) || undefined;
/** The parts of the scene that the address leaves out, for the bisect of the Apple WebGPU stall. */
const WITHOUT = new Set((params.get('without') ?? '').split(',').filter(Boolean));
/**
 * True holds the route at its opening shot and draws every cascade in every frame, so a probe can
 * time each cascade's pass on one view.
 */
const CASCADE_PROBE = params.has('cascade-probe');
/**
 * The render scale that the address fixes, for the picture tests that draw below the whole canvas,
 * or undefined to leave the scale to the governor.
 */
const RENDER_SCALE = Number(params.get('render-scale')) || undefined;
/**
 * True draws the scene from just above the stream, looking along it, so the picture shows the
 * water's surface close up. The picture tests ask for it; the demo and its route never do.
 */
const WATER_CLOSE = params.has('water-close');
/** The close camera's place, just over the stream, and the point it looks at down the stream. */
const CLOSE_POSITION: readonly [number, number, number] = [-11, 0.55, streamZ(-11) + 0.9];
const CLOSE_TARGET: readonly [number, number, number] = [1, -0.5, streamZ(1)];
/** The shot that holds the close camera, so the picture draws the surface and nothing else moves. */
const CLOSE_SHOT: Shot = {
	position: CLOSE_POSITION,
	target: CLOSE_TARGET,
	seconds: 1,
	move: 'hold',
};
/** The water's length in the middle of the land, whose columns are finer toward the middle. */
const WATER_MIDDLE = 140;
/** The meters between the columns of the water that runs on down the valley past the middle. */
const FAR_STEP = 8;
/** The rows across the water's sheet: fine where the camera looks, coarse down the gorges. */
const WATER_ROWS = 48;
const GORGE_ROWS = 12;
/** The half width of the water's sheet: the stream's reach, plus the margin that its banks leave. */
const WATER_HALF = STREAM_REACH + 1;
/** The water's depth under its middle line, in meters: the mean bed that the stream cuts. */
const STREAM_DEPTH = 0.62;

/**
 * The creek's water, drawn by the add-on. Three sheets run along x: fine columns where the camera
 * looks, and 8 m columns on down each gorge into the haze. The sheets are straight, and the shape
 * gives the bed and the current that the winding stream has at each point, so every part of the
 * water carries the stream's own flow. The stones that break the surface give it the foam. The
 * reflection draws layer 0 alone, which leaves out what lies on or under the water.
 */
function createCreekWater(
	ctx: SketchContext,
	quadsX: number,
	obstacles: readonly Obstacle[],
	reach: number,
	alwaysReflect: boolean,
	reflectScale: 0.25 | 0.5 | 1 | undefined,
): Water {
	const middle = Array.from({ length: quadsX + 1 }, (_, k) => {
		const s = (k / quadsX) * 2 - 1;
		return (WATER_MIDDLE / 2) * (0.25 * s + 0.75 * s * s * s);
	});
	const steps = Math.ceil((reach - WATER_MIDDLE / 2) / FAR_STEP);
	const far = Array.from({ length: steps + 1 }, (_, k) => WATER_MIDDLE / 2 + k * FAR_STEP);
	const sheet = (xs: readonly number[], across: number): WaterShape => ({
		kind: 'river',
		middle: xs.map((x) => [x, 0] as const),
		halfWidth: WATER_HALF,
		depth: STREAM_DEPTH,
		current: (x) => streamCurrent(x),
		bed: streamDepth,
		// The columns are the sheet's own, and the bed ends the surface, so the mesh needs no shore band.
		mesh: { step: 1e9, across, reach: 1 },
	});
	return createWater(ctx, {
		shapes: [
			sheet(middle, WATER_ROWS),
			sheet(far, GORGE_ROWS),
			sheet(far.map((x) => -x).reverse(), GORGE_ROWS),
		],
		level: WATER,
		layers: 1,
		...(reflectScale !== undefined && { reflectionScale: reflectScale }),
		...(alwaysReflect && { reflectionEvery: { low: 1, medium: 1, high: 1, ultra: 1 } }),
		bed: 'shape',
		// The stream's own bed gives the water all its depth, so the surface draws opaque.
		material: { alphaMode: 'opaque' },
		foam: foamMap(ctx, obstacles, {
			origin: [-30, -6.5],
			size: [60, 13],
			width: 1024,
			height: 224,
		}),
	});
}

export default defineSketch(async (ctx) => {
	const { scene, assets, post, quality, page, time } = ctx;
	if (RENDER_SCALE !== undefined)
		await quality.set({
			minRenderScale: RENDER_SCALE,
			maxRenderScale: RENDER_SCALE,
			governor: false,
		});
	// The cascade probe needs each cascade's pass in the frame's report, in every frame, and one
	// frame size for every reading.
	if (CASCADE_PROBE)
		await quality.set({
			farCascadeInterval: 1,
			governor: false,
			minRenderScale: 1,
			maxRenderScale: 1,
		});
	const detail = DETAIL[quality.preset];
	reportLoading(ctx);
	const [sky, room] = await Promise.all([
		assets.skyEnvironment(),
		assets.builtinEnvironment('room'),
	]);
	const sun = scene.createDirectionalLight({
		castShadows: true,
		layers: SUN_LAYERS,
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
			floor: GORGE.floorHaze,
			sheets: 10,
		}),
	);
	page.post('loading', 'Loading the trees, plants and cave');
	const models = await loadModels(ctx);
	const stones = createStones(ctx, detail.rock, detail.texture, models.cave);
	const water = WITHOUT.has('water')
		? undefined
		: createCreekWater(
				ctx,
				detail.water,
				stones.obstacles,
				GORGE.end,
				ALWAYS_REFLECT,
				REFLECT_SCALE as 0.25 | 0.5 | 1 | undefined,
			);
	const underwater = water && createUnderwater(ctx, camera, water);
	const flora = await createFlora(ctx, models);
	const air = await createAir(ctx, flora.crowns);
	const shafts = createShafts(ctx, camera);
	const grass = WITHOUT.has('grass')
		? undefined
		: createGrass(ctx, (x, z) => stones.clear(x, z) || flora.clear(x, z));
	const fit = () => {
		grass?.fit(quality.preset);
		stones.fit(quality.preset);
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
	/**
	 * The look the scene shows: two moods and the share of the second. An hour's look blends between
	 * the moods on either side, so the fireflies, the air and the caustics change with the light.
	 */
	const look: MoodMix = { from: 'Afternoon', to: 'Afternoon', share: 0 };
	/** The hour's look, which Auto works out in each frame before it compares it with the one shown. */
	const next: MoodMix = { ...look };
	/** The studio's own look. */
	const STUDIO: MoodMix = { from: 'Studio', to: 'Studio', share: 0 };
	/** The light of the caustics on the stream's bed, blended between the look's moods. */
	const caustics: [number, number, number] = [0, 0, 0];
	// Shafts of light at golden hour, at High and above: below, their march costs too much. They
	// fade with golden hour's share of the look.
	const shaftTint: [number, number, number] = [0, 0, 0];
	const light = () => {
		const share = moodShare(look, 'Golden');
		const on =
			controls.on.shafts && share > 0 && (quality.preset === 'high' || quality.preset === 'ultra');
		for (let c = 0; c < 3; c++) shaftTint[c] = (SHAFT_TINT[c] as number) * share;
		shafts.set(on ? golden.light.direction : undefined, shaftTint);
	};
	quality.onChange(() => {
		fit();
		light();
	});
	/** Gives the scene a look: its fireflies, its air, its water's caustics and its shafts. */
	const showLook = (mix: MoodMix): void => {
		look.from = mix.from;
		look.to = mix.to;
		look.share = mix.share;
		flora.nightLights(moodShare(look, 'Night') + moodShare(look, 'Dusk'));
		air.setLook(look);
		const a = CAUSTICS[look.from];
		const b = CAUSTICS[look.to];
		for (let c = 0; c < 3; c++) caustics[c] = math.lerp(a[c] as number, b[c] as number, look.share);
		water?.setCaustics(caustics);
		light();
	};
	const choose = (mood: Mood) => {
		stage.set(mood);
		// A fixed mood shows its own look, and Auto the look of the hour it starts from.
		showLook(mood === 'Studio' ? STUDIO : moodMix(stage.hours, next));
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
			// The slider holds any hour, so the scene takes the look of that hour.
			showLook(moodMix(hours, next));
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
	for (const haze of hazes) haze.update(stage.airColor, stage.light);

	const film = createCinematic(ctx, camera, {
		shots: WATER_CLOSE ? [CLOSE_SHOT] : SHOTS,
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
			for (const haze of hazes) haze.update(stage.airColor, stage.light);
			controls.update(t);
			// In Auto the look follows the hour: the fireflies, the mist and the caustics move to the
			// next time of day as the light does. A change too small to see is not written.
			if (stage.auto) {
				moodMix(stage.hours, next);
				if (
					next.from !== look.from ||
					next.to !== look.to ||
					Math.abs(next.share - look.share) > LOOK_STEP
				)
					showLook(next);
			}
			// The cascade probe times one view, so its route holds the opening pose.
			film.update(CASCADE_PROBE ? 0 : dt);
			// After the camera moves, so the view under the water turns the frame the camera dips.
			underwater?.update(t, stage.airColor, caustics);
			const lens = controls.lens();
			if (lens) post.set(lens);
			flora.update(t);
			air.update(t);
			water?.update();
		},
		onLateUpdate() {
			shafts.update();
		},
	};
});
