// Creek: a showcase scene of a garden on the top of a round cliff that stands in a sea of cloud. A
// clear creek crosses the top from rim to rim, fed by a spring pool near the middle, and leaves over
// a lip at each end. A reflection pass mirrors the sky in it, and the bed shows through it, bent by
// its ripples. Behind the creek a band of raked gravel curves between moss islands, and a hill rises
// to a terrace. Dark volcanic walls of pillars and ledges run down from the rim into the cloud,
// whose billows drift on the wind and take the light of each hour. Leaves float on the current and
// fireflies hover at night. The land, its textures, the walls, the rocks, the water and the clouds
// are made in code.
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
import {
	createUnderwater,
	createWater,
	createWaterfall,
	foamMap,
	type Water,
	type Waterfall,
	type WaterShape,
} from '@null3d/water';
import { createWind, type WindField } from '@null3d/wind';
import { type CameraBounds, createCinematic, type Shot } from '../../lib/cinematic';
import { EFFECT_LAYER, SUN_LAYERS } from '../../lib/layers';
import { reportLoading } from '../../lib/progress';
import type { ShadowReach } from '../../lib/shadow-range';
import { createShowcaseEffects } from '../../lib/showcase-effects';
import { createMoods, isMood, type Mood, type MoodMix, moodMix, moodShare } from '../../lib/stage';
import { createAir } from './air';
import { createCliff } from './cliff';
import { createClouds } from './clouds';
import { createFlora } from './flora';
import {
	cameraFloor,
	createLand,
	LIPS,
	streamCurrent,
	streamDepth,
	streamHalf,
	streamSlope,
	streamZ,
	UNREFLECTED_LAYER,
	WATER,
} from './land';
import { SHOTS, WIDE, WIDE_LOOK } from './route';
import { createShafts } from './shafts';
import { createStones, type Obstacle } from './stones';

// The camera route, which this scene's frames and the shared route check both read.
export { SHOTS };

/**
 * The detail that each preset builds at the start: the land's quads, which also set the walls'
 * columns, texture sizes, the rocks' subdivisions and the water's columns.
 */
const DETAIL: Record<
	QualityPreset,
	{ land: number; texture: number; rock: number; water: number }
> = {
	low: { land: 160, texture: 256, rock: 2, water: 160 },
	medium: { land: 224, texture: 512, rock: 3, water: 240 },
	high: { land: 256, texture: 512, rock: 3, water: 300 },
	ultra: { land: 320, texture: 1024, rock: 3, water: 360 },
};
/** The camera's vertical field of view in degrees, and the DSLR lens's focal length in millimetres. */
const FOV = 45;
const DSLR_FOCAL_LENGTH = 50;
/**
 * The turn of the sun's path: in the morning its soft light comes from the opening view's upper
 * left and a little from the front, as in the concept picture.
 */
const HEADING = Math.PI + 0.58;
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
/** The point that the camera looks at, over the garden's middle. */
const TARGET = [WIDE_LOOK[0], WIDE_LOOK[1], WIDE_LOOK[2]] as const;
/**
 * The creek's core: the sphere around the cliff's top, which keeps its shadows wherever the camera
 * stands. The sun's shadows reach this far close up, and further as the camera draws back.
 */
export const SHADOW_REACH: ShadowReach = { distance: 50, center: [0, 1, 0], radius: 28 };
/**
 * Where the Manual camera may go: around the cliff, a little farther back than the opening view
 * stands, over its top and above the cloud's tops past its walls, where the cloud hides every
 * view's edge.
 */
export const BOUNDS: Omit<CameraBounds, 'ground'> = {
	center: [0, 0],
	focus: 26,
	// The point it turns around may sink under the water too, as the route's dip along the bed does.
	focusHeight: [-0.5, 6],
	distance: 70,
	// The stream's bed is the ground under the water, so the camera may dip under the surface but
	// never through the bed.
	clearance: 0.15,
};

const { smoothstep } = math;
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
 * True holds the route at its opening shot without the cascade probe's extra shadow work, so a
 * governed row can compare one view before and after the governor's steps.
 */
const STILL_ROUTE = params.has('still-route');
/**
 * The render scale that the address fixes, for the picture tests that draw below the whole canvas,
 * or undefined to leave the scale to the governor.
 */
const RENDER_SCALE = Number(params.get('render-scale')) || undefined;
/**
 * False when the address asks for the sun's contact shadows and the scene's screen-space bounce
 * light: the demo draws without them, because their passes cost a share of the frame and the
 * pictures with and without them are the same at Low, Medium and High.
 */
const EFFECTS = params.get('effects') === 'on';
/**
 * The strength of a gust that the address sends, and the sketch time when it sends it. The demo's
 * own gust answers the G key, and a held frame presses no key, so a picture test names the send in
 * its address. The place is the camera's, as the key's is, and the route is a function of the
 * sketch time, so both hold still.
 */
const GUST_STRENGTH = Number(params.get('gust')) || 0;
const GUST_SEND_AT = Number(params.get('gust-at')) || 0;
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
/** The rows across the water's sheet. */
const WATER_ROWS = 56;
/** How far the water's sheet reaches past the creek's edge, in half widths: to where the bed rises out. */
const WATER_REACH = 1.36;
/** How far the sheet reaches at each lip, in half widths: just past the water that shows there. */
const WATER_AT_LIP = 0.95;
/**
 * Each lip's fall: how far it drops, into the cloud, where it thins away; how far each side widens
 * per meter fallen, so it fans out down the drop; and the share of the creek's half width that
 * leaves over the lip, narrower than the creek, between the lip's shoulders.
 */
const FALL = { drop: 22, spread: 0.12, width: 0.75 } as const;
/**
 * The light on the falls' spray and mist: how much of the air's own color it keeps, its faint lilac
 * cast, its strength over the air's, and the least change of the air that it follows.
 */
const SPRAY = { color: 0.15, tint: [1, 0.975, 1.02], gain: 5.6, step: 0.01 } as const;
/** The water's depth under its middle line, in meters: the mean bed that the creek cuts. */
const STREAM_DEPTH = 0.62;
/** The foam map's box on the ground, over the whole creek, and its texels. */
const FOAM_BOX = { origin: [LIPS.west - 1, 9], size: [LIPS.east - LIPS.west + 2, 11.5] } as const;

/**
 * The creek's water, drawn by the add-on. One sheet follows the creek from lip to lip: its columns
 * are its own, and its ends lie square across the creek, on the lips' straight edges, so the water
 * ends where the rim does. The shape gives the bed and the current at each point, so every part of
 * the water carries the creek's own flow, out of the pool both ways. The stones that break the
 * surface give it the foam. The reflection draws layer 0 alone, which leaves out what lies on or
 * under the water.
 */
function createCreekWater(
	ctx: SketchContext,
	columns: number,
	obstacles: readonly Obstacle[],
	alwaysReflect: boolean,
	reflectScale: 0.25 | 0.5 | 1 | undefined,
	wind: WindField,
): Water {
	const xs = Array.from(
		{ length: columns + 1 },
		(_, k) => LIPS.west + ((LIPS.east - LIPS.west) * k) / columns,
	);
	const sheet: WaterShape = {
		kind: 'river',
		middle: xs.map((x) => [x, streamZ(x)] as const),
		// Near each lip the sheet narrows to the water that shows, so it never runs on past the rim.
		halfWidth: xs.map((x) => {
			const lip = 1 - smoothstep(Math.min(x - LIPS.west, LIPS.east - x), 0.5, 2.5);
			return streamHalf(x) * (WATER_REACH + (WATER_AT_LIP - WATER_REACH) * lip);
		}),
		depth: STREAM_DEPTH,
		current: streamCurrent,
		bed: streamDepth,
		// The columns are the sheet's own, and the bed ends the surface, so the mesh needs no shore band.
		mesh: { step: 1e9, across: WATER_ROWS, reach: 1 },
	};
	return createWater(ctx, {
		shapes: [sheet],
		level: WATER,
		layers: 1,
		// The creek runs smooth between its foam: the swell is a tenth of a lake's, and the fine
		// ripples are faint, so a low view along the water shows no even lines of them.
		waveAmplitude: 0.1,
		ripple: 0.35,
		wind,
		...(reflectScale !== undefined && { reflectionScale: reflectScale }),
		...(alwaysReflect && { reflectionEvery: { low: 1, medium: 1, high: 1, ultra: 1 } }),
		bed: 'shape',
		// The stream's own bed gives the water all its depth, so the surface draws opaque. The water is
		// clear and shallow, with a muted grey-teal tint, so the pale bed shows through it.
		material: {
			alphaMode: 'opaque',
			attenuationColor: '#3e9e92',
			attenuationDistance: 0.6,
			// A thin volume bends the bed's picture little, so the view along the water close up
			// never reaches past the frame's edge for it.
			thickness: 0.15,
		},
		// The stones' own trails carry the foam downstream both ways from the pool, so the map draws
		// rings, a little wider than the add-on's own.
		foam: foamMap(ctx, obstacles, {
			origin: FOAM_BOX.origin,
			size: FOAM_BOX.size,
			width: 1024,
			height: 288,
			reach: 1,
			trail: 0,
		}),
	});
}

export default defineSketch(async (ctx) => {
	const { scene, assets, post, quality, page, time } = ctx;
	if (!EFFECTS) {
		const still = { contactShadowSteps: 0, bounceRays: 0 } as const;
		await quality.set(still);
		// A preset change gives the settings their preset's values, so the demo sets them again.
		quality.onChange(() => {
			if (quality.settings.contactShadowSteps !== 0 || quality.settings.bounceRays !== 0)
				void quality.set(still);
		});
	}
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
		// Past the cloud's dome, which carries the sea of cloud to the horizon.
		far: 2000,
		layers: 1 | UNREFLECTED_LAYER | EFFECT_LAYER,
		// The camera takes the route's opening pose at once, so even a frame drawn before the
		// route's first step shows the opening view, never the origin inside the far bank.
		position: WIDE,
		target: WIDE_LOOK,
	});
	scene.setActiveCamera(camera);
	// The garden's one wind field. The falling leaves and the water read it, and G sends a gust that
	// a person can watch cross the creek.
	const wind = createWind(ctx, { camera, box: 128 });
	const target: [number, number, number] = [TARGET[0], TARGET[1], TARGET[2]];
	/** A scratch place for the camera, which the gust control reads. */
	const here: number[] = [0, 0, 0];

	const land = createLand(ctx, detail.land, detail.texture);
	createCliff(ctx, land.rim, detail.texture);
	page.post('loading', 'Gathering the cloud');
	const clouds = await createClouds(ctx, quality.preset);
	page.post('loading', 'Laying the stones');
	const stones = createStones(ctx, detail.rock, detail.texture);
	const water = WITHOUT.has('water')
		? undefined
		: createCreekWater(
				ctx,
				detail.water,
				stones.obstacles,
				ALWAYS_REFLECT,
				REFLECT_SCALE as 0.25 | 0.5 | 1 | undefined,
				wind.field,
			);
	const underwater = water && createUnderwater(ctx, camera, water);
	// A fall at each lip, where the creek's sheet ends: it leaves with the creek's own width and
	// speed, and drops into the cloud. It lies past the water's edge, so the reflection leaves it out.
	page.post('loading', 'Pouring the falls');
	const falls: Waterfall[] = water
		? await Promise.all(
				[LIPS.west, LIPS.east].map((x) => {
					const away = Math.sign(x);
					const [vx, vz] = streamCurrent(x - away * 0.3);
					return createWaterfall(ctx, {
						lip: [x, streamZ(x)],
						direction: [away, away * streamSlope(x)],
						halfWidth: streamHalf(x) * FALL.width,
						level: WATER,
						speed: Math.hypot(vx, vz),
						drop: FALL.drop,
						spread: FALL.spread,
						layers: UNREFLECTED_LAYER,
						wind: wind.field,
					});
				}),
			)
		: [];
	const flora = await createFlora(ctx);
	// The bare garden has no crowns yet, so no leaves fall; the mist and the motes still drift.
	const air = await createAir(ctx, [], wind.field);
	const shafts = createShafts(ctx, camera);
	const fit = () => {
		stones.fit(quality.preset);
		clouds.fit(quality.preset);
	};
	fit();

	// The mood and the lens: from the address at the start, then from the HUD. The physical sky
	// draws the real sun by day and the moon at night; Auto moves them across the sky.
	// The garden opens on a soft morning under heavy cloud, with the air thick over the cloud sea.
	const stage = createMoods(ctx, sun, sky, room, {
		heading: HEADING,
		fogDensity: 0.0025,
		cloudCoverage: 0.75,
		haze: { Morning: 1.4, Golden: 1.2, Dusk: 1.5 },
		// The cloud above and the cloud below both fill the garden with soft light: the sun's own
		// light is weak and the sky's share grows, so the shadows stay soft, and the picture opens up
		// past the clear sky's exposure.
		exposureScale: 3.2,
		environmentScale: 2.2,
		sunScale: 0.35,
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
			fog: true,
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
					// The mist over the water is haze too, so the fog switch hides it with the fog. The
					// cloud stays, since without it the world's edge would show.
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
	choose(isMood(start) ? start : 'Morning');
	// The falls' spray and mist are unlit, so they take the cloud's own tone of the air: its color
	// greyed toward its brightness, with a faint lilac cast. A change too small to see is not written.
	const sprayLight: [number, number, number] = [0, 0, 0];
	const sprayAir: [number, number, number] = [-1, -1, -1];
	const lightFalls = () => {
		const air = stage.airColor;
		const moved =
			Math.abs(air[0] - sprayAir[0]) +
			Math.abs(air[1] - sprayAir[1]) +
			Math.abs(air[2] - sprayAir[2]);
		if (moved <= SPRAY.step) return;
		const grey = 0.2126 * air[0] + 0.7152 * air[1] + 0.0722 * air[2];
		for (let c = 0; c < 3; c++) {
			sprayAir[c] = air[c];
			sprayLight[c] =
				(grey + (air[c] - grey) * SPRAY.color) * (SPRAY.tint[c] as number) * SPRAY.gain;
		}
		for (const fall of falls) fall.setLight(sprayLight);
	};
	// The clouds and the falls take the air's color now too, since a held frame runs no update.
	clouds.update(stage.airColor, stage.light);
	lightFalls();

	const film = createCinematic(ctx, camera, {
		shots: WATER_CLOSE ? [CLOSE_SHOT] : SHOTS,
		target,
		groups: controls.groups,
		keys: [
			{
				code: 'KeyG',
				does: 'send a gust across the garden',
				// From where the camera stands, so a person can watch the air travel across the creek.
				press() {
					camera.getPosition(here);
					wind.gust([here[0] as number, here[2] as number], 10);
				},
			},
		],
		bounds: { ...BOUNDS, ground: cameraFloor },
	});
	// The camera stands at the route's opening pose now, so the shadows reach as far as it needs.
	controls.fitShadows();
	/** True once the address's gust has been sent, so one send reaches the field. */
	let gustSent = false;

	return {
		onUpdate(dt) {
			const t = time.now;
			// The address's gust goes in before the field steps, so the frame that draws carries it
			// and the readers see its settings at once.
			if (GUST_STRENGTH > 0 && !gustSent && t >= GUST_SEND_AT) {
				gustSent = true;
				camera.getPosition(here);
				wind.gust([here[0] as number, here[2] as number], GUST_STRENGTH);
				page.post('gust', {
					at: t,
					strength: GUST_STRENGTH,
					place: [here[0] as number, here[2] as number],
				});
			}
			// The field's box follows the camera, so it steps before anything reads it.
			wind.update();
			stage.update(dt);
			clouds.update(stage.airColor, stage.light);
			lightFalls();
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
			film.update(CASCADE_PROBE || STILL_ROUTE ? 0 : dt);
			// After the camera moves, so the view under the water turns the frame the camera dips.
			underwater?.update(t, stage.airColor, caustics);
			const lens = controls.lens();
			if (lens) post.set(lens);
			water?.update();
		},
		onLateUpdate() {
			// The particles start where the frame's objects stand, after the wind's field has stepped.
			flora.update();
			air.update();
			clouds.step();
			for (const fall of falls) fall.update();
			shafts.update();
		},
	};
});
