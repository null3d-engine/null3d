// Island: a showcase scene of a Mediterranean town on a hilly island, alone in the open sea. Villages
// crown three hills, olive terraces and forest cover their slopes, a crescent of beach curves along the
// south-east, a golf course lies on the eastern headland, and the town stands around its church and
// square above the harbour. A town plan lays out its roads, houses and trees. The land comes from the
// terrain add-on, the sea from the water add-on, and the trees from models built in Blender and moved
// by the wind add-on.
//
// The camera runs a cinematic route made for this scene (see SHOTS). `c` toggles between the route
// (Auto) and the engine's orbit controls, which the user drives (Manual); `h` opens and closes the
// controls. Manual turns around the whole island, and zooms and pans down to any place on it. The
// controls pick a time of day (a summer morning at its start) and turn the effects on and off, among them a
// "DSLR" lens with depth of field. For held frames, the sketch's address takes the mood:
// `?mood=Midday&dslr`. `?grown` grows the trees before the first frame, as a held frame does, so a
// test that compares live frames sees the whole scene from its first frame on.
import { defineSketch } from '@null3d/engine';
import type { Wind } from '@null3d/wind';
import { type CameraBounds, createCinematic, type Shot } from '../../lib/cinematic';
import { EFFECT_LAYER, INTERIOR_LAYER, SUN_LAYERS } from '../../lib/layers';
import { createShowcaseEffects } from '../../lib/showcase-effects';
import { createMoods, isMood, nightAlbedo } from '../../lib/stage';
import { BIRD_COUNT, createBirds, ROOST_LAMPS } from './birds';
import { SEA_LEVEL } from './island';
import { createLand } from './land';
import { loadLifeModels } from './models';
import { groundHeight } from './plan';
import { createPoolWater } from './poolwater';
import { createSea } from './sea';
import { SHADOW_DISTANCE, SHADOW_REACH } from './shadow';
import { createIslandSound } from './sound';
import { createTown, type TownNight } from './town';
import { createPlaceholderModels, createTraffic, type TrafficOptions } from './traffic';
import { CASTER_LAYER, createCypressSpires, createIslandWind, createTrees } from './trees';

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
 * square, climbs over the south face to the highest hill's tower, circles it with the keep's crown in
 * view, pulls out east along the ridge to the eastern hill, sweeps over the golf course, and rises
 * back to the opening view.
 * The first shot holds still, so a held frame lands on the opening view.
 */
export const SHOTS: readonly Shot[] = [
	// The opening view holds only briefly, so the camera starts moving soon after the page loads.
	{ position: [600, 280, 540], target: [40, 80, -40], seconds: 0.8, move: 'hold' },
	// Drop from the high south-east toward the bay.
	{ position: [600, 280, 540], target: [40, 80, -40], seconds: 8 },
	{ position: [440, 195, 565], target: [170, 45, 175], seconds: 8 },
	// Down to the beach and low along the shore.
	{ position: [290, 105, 555], target: [280, 20, 240], seconds: 8.5 },
	{ position: [120, 44, 505], target: [-60, 30, 230], seconds: 8.5 },
	{ position: [-55, 34, 445], target: [-92, 30, 210], seconds: 6 },
	// The harbour front, then the town square, climbing.
	{ position: [-150, 58, 350], target: [-92, 34, 195], seconds: 5.5 },
	{ position: [-152, 135, 255], target: [-98, 40, 190], seconds: 7.5 },
	{ position: [-115, 205, 115], target: [-105, 110, -90], seconds: 10 },
	// High over the south face, then down to the tower in steps: each step slows the camera more, so
	// the turn into the close pass has no jolt.
	{ position: [-60, 258, -125], target: [-118, 196, -375], seconds: 9.5 },
	{ position: [-88, 220, -268], target: [-118, 202, -375], seconds: 6 },
	{ position: [-100, 205, -320], target: [-118, 202, -375], seconds: 7 },
	// Close in on the highest hill's tower and go most of the way around it. The aim is the keep's
	// crown, so the tower's top and base both stay inside the view.
	{ position: [-158, 202, -335], target: [-118, 202, -375], seconds: 7 },
	{ position: [-180, 201, -390], target: [-118, 202, -375], seconds: 6 },
	{ position: [-150, 201, -432], target: [-118, 202, -375], seconds: 7.3 },
	{ position: [-88, 201, -425], target: [-118, 202, -375], seconds: 7 },
	{ position: [-62, 202, -373], target: [-118, 202, -375], seconds: 11.4 },
	// Pull out east with the ridge and then the eastern hill as the subject, so land stays in frame.
	{ position: [20, 232, -300], target: [60, 150, -270], seconds: 11 },
	{ position: [175, 220, -288], target: [255, 160, -350], seconds: 11 },
	// Down over the golf course and around the east of the island.
	{ position: [340, 180, -205], target: [420, 85, -130], seconds: 11 },
	{ position: [545, 140, -40], target: [430, 55, -70], seconds: 11 },
	{ position: [680, 230, 280], target: [220, 70, -40], seconds: 6 },
	{ position: [655, 265, 425], target: [40, 80, -40], seconds: 6.5 },
];

/**
 * The light that the sky above and the dry ground below throw back into the scene, by day and by
 * night: the day's warm light lifts the shadows' undersides, and the night's keeps a faint, cool
 * glow so nothing reads as black.
 */
const AMBIENT_DAY = { sky: '#b9a890', ground: '#c2965c', intensity: 0.8 } as const;
const AMBIENT_NIGHT = { sky: '#2a3550', ground: '#14161c', intensity: 0.06 } as const;

/**
 * The island's lit fog: the dry haze over the sea and the town, with the low sun's shafts through
 * it and the lamps' cones at night. The haze is very thin across the island's kilometres, so the
 * lit part is strong and reaches far.
 */
const SHAFTS = { intensity: 12, anisotropy: 0.6, distance: 2200 } as const;

/** The effects that the island's HUD offers, which its controls answer. */
export const SUPPORTED = {
	atmosphere: ['sky', 'fog', 'shafts'],
	lighting: ['shadows', 'contact', 'ao', 'environment'],
	post: ['bloom', 'dof', 'exposure', 'vignette'],
} as const;

/** The light between the day's and the night's, by the share of a town's lamps that are lit. */
function ambientAt(night: number): {
	sky: [number, number, number];
	ground: [number, number, number];
	intensity: number;
} {
	const mix = (day: string, dark: string): [number, number, number] => {
		const [a, b] = [hexOf(day), hexOf(dark)];
		return [
			a[0] + (b[0] - a[0]) * night,
			a[1] + (b[1] - a[1]) * night,
			a[2] + (b[2] - a[2]) * night,
		];
	};
	return {
		sky: mix(AMBIENT_DAY.sky, AMBIENT_NIGHT.sky),
		ground: mix(AMBIENT_DAY.ground, AMBIENT_NIGHT.ground),
		intensity: AMBIENT_DAY.intensity + (AMBIENT_NIGHT.intensity - AMBIENT_DAY.intensity) * night,
	};
}

/** A hex color as three numbers from 0 to 1, in its own sRGB values. */
function hexOf(hex: string): [number, number, number] {
	const value = Number.parseInt(hex.slice(1), 16);
	return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

const params = new URL(import.meta.url).searchParams;

/** The places that the camera's route visits, where the island's people walk as models. */
const WATCH = SHOTS.map((shot) => shot.position);

export default defineSketch(
	// The island's frames are limited by the sketch thread, not the GPU: the governor's lowest tier
	// would cut the render to a third and turn the effects off without gaining a frame, so the page
	// keeps full quality and plays at the rate the scene gives.
	async (ctx) => {
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
		// Warm light thrown back from the dry ground lifts the shadows' undersides, so they do not read sky blue
		// by day. It follows the hour: by night it fades to a faint, cool moonlit glow, so the beaches and
		// houses settle into the dark instead of glowing.
		const ambient = scene.createHemisphereLight({
			skyColor: AMBIENT_DAY.sky,
			groundColor: AMBIENT_DAY.ground,
			intensity: 0,
		});
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
		// The scene runs below the engine's frame target, so the quality governor would trade resolution
		// for frames while the route moves, and the flythrough would soften. The island keeps the full
		// render scale on every preset instead: the picture stays sharp, and the frame rate is what it is.
		ctx.quality.set({
			physicalSky: true,
			bounceRays: 0,
			minRenderScale: 1,
			maxRenderScale: 1,
			// A phone's governor keeps its frame steps, but never raises the level threshold: raised,
			// it draws a model's coarse level near the camera, and the keep's coarse level carries
			// half its slit windows, so its towers lose their windows at the range a visitor looks.
			governorLevels: false,
			// The walls, the roads and the crowns are seen across the ground at a glancing angle, where a
			// texture without anisotropy blurs into its own average.
			maxAnisotropy: 16,
		});
		// At High and Ultra the frames are the sketch thread's, and the governor cannot make that work
		// cheaper: its steps only soften the picture (the render scale, the levels of detail, the shadow
		// filter and the effects) for no frame. Low and Medium keep it, since a phone's frames are the
		// GPU's. The detail steps matter most: with the scale pinned, they raise the level threshold and
		// cut the crowns near the camera, which reads as a jolt.
		const guardQuality = () => {
			const wanted = ctx.quality.preset === 'low' || ctx.quality.preset === 'medium';
			if (ctx.quality.settings.governor !== wanted) void ctx.quality.set({ governor: wanted });
		};
		guardQuality();
		ctx.quality.onChange(guardQuality);

		// The mood: a summer morning at its start, with a little cloud and a thin haze for depth. `Auto`
		// moves the sun and the moon across the sky; the other moods hold an hour. The controls and the
		// camera's route come before the town: they need no part of it, and they post the HUD, so a
		// visitor gets the controls while the island is still rising.
		const stage = createMoods(ctx, sun, sky, room, {
			heading: HEADING,
			fogDensity: 0.000018,
			// The studio's own haze would hide the island from an opening view hundreds of meters out.
			studioFog: 0.00006,
			backgroundFog: Number(params.get('background-fog')) || 0,
			exposureScale: 3,
			environmentScale: 1,
			cloudCoverage: 0,
			haze: { Golden: 0.7 },
			volumetric: SHAFTS,
			backdrop: [0.02, 0.025, 0.04],
		});
		// `?shafts=on` starts the lit fog on, so a cost run or a picture can compare both states.
		const shaftsOn = params.get('shafts') === 'on';
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
				// Every showcase starts with the air clear, and the HUD's Fog switch adds the haze.
				// `?fog=on` starts the haze on, as a cost run and a picture need it with the shafts.
				fog: params.get('fog') === 'on',
				shafts: shaftsOn,
				shadows: true,
				contact: true,
				ao: true,
				environment: true,
				bloom: false,
				dof: false,
				exposure: false,
				vignette: false,
			},
			supported: SUPPORTED,
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
			// The island spans kilometres, so a scroll flies eight times as far as the default, and the
			// keys pan twice as fast. R and F rise four times as fast as the pan speed's default.
			wheelSpeed: 8,
			speed: 840,
			riseSpeed: 28,
			bounds: {
				...BOUNDS,
				// The camera keeps just above the turf and the sea, so a scroll reaches the ground.
				clearance: 0.6,
				ground: (x, z) => Math.max(groundHeight(x, z), SEA_LEVEL),
			},
		});
		// The camera stands at the route's opening pose now, so the shadows reach as far as it needs.
		controls.fitShadows();

		// The island's one wind field: the trees, the lawns and the pools' water read the same air.
		const wind = createIslandWind(ctx, camera);
		const land = createLand(ctx);
		const sea = createSea(ctx, camera);
		let night: TownNight | undefined;
		// `?pool=N` sets how many lights follow the view, so a cost run compares counts.
		const askedPool = params.get('pool');
		const pool = askedPool === null ? undefined : Number(askedPool);
		const town = createTown(ctx, {
			...(pool !== undefined && Number.isFinite(pool) && { lights: Math.max(0, pool) }),
		}).then((made) => {
			night = made;
		});
		// `?poolwater=off` is a documented cost switch, like `?walkers`: the pools within reach of the
		// camera draw with the water add-on, and the switch leaves them as the gardens' flat quads for
		// a cost run. Every far pool keeps its quad either way.
		const poolAsked = params.get('poolwater');
		const poolwater = poolAsked === 'off' ? undefined : createPoolWater(ctx, camera, wind.field);
		page.post('loading', 'Growing the trees');
		// The species and the lawns take seconds to grow. A live page draws the island without them and
		// lets them appear as they land; a held picture, a page that asks with `?grown`, or the WebGL2
		// path waits, so its first frame shows the finished scene. The WebGL2 render plan cannot take
		// the pipelines that a frame after the first adds, so that path grows before it draws.
		const grownFirst =
			ctx.engine.held || params.has('grown') || ctx.engine.capabilities.tier === 'webgl2';
		// The real people and vehicle models replace the placeholders when they land; the motion system
		// is the same either way. A held frame waits for them, so it never catches a placeholder.
		const life = grownFirst
			? await loadLifeModels(ctx).catch((error) => {
					console.warn(
						'island: the people and vehicle models are unavailable, so the placeholders stand',
						error,
					);
					return undefined;
				})
			: undefined;
		// `?walkers=12` sets how many people draw as skinned walkers, so a cost run can compare counts.
		const walkers = Number(params.get('walkers'));
		const trafficOptions: TrafficOptions = {
			watch: WATCH,
			...(Number.isFinite(walkers) && walkers > 0 && { walkers }),
		};
		let traffic = createTraffic(ctx, life ?? createPlaceholderModels(ctx), trafficOptions);
		// The crows fly their own errands between the perches, and roost while the town's lamps are
		// lit. `?birds=N` sets how many fly, so a cost run can compare counts.
		const asked = params.get('birds');
		const birdCount = asked === null ? BIRD_COUNT : Number(asked);
		const birds = createBirds(ctx, camera, {
			count: Number.isFinite(birdCount) ? birdCount : BIRD_COUNT,
			night: () => stage.lamps >= ROOST_LAMPS,
		});
		// A live page loads the models after its first frame, so the load never holds the first frame.
		// The placeholders move meanwhile, and they leave when the models stand.
		let settling = false;
		const settleTraffic = (): void => {
			if (settling) return;
			settling = true;
			void loadLifeModels(ctx).then(
				(models) => {
					try {
						const grown = createTraffic(ctx, models, trafficOptions);
						const previous = traffic;
						traffic = grown;
						sound.setTraffic(traffic);
						previous.destroy();
					} catch (error) {
						console.warn(
							'island: the people and vehicle models could not stand, so the placeholders stay',
							error,
						);
					}
				},
				(error: unknown) =>
					console.warn(
						'island: the people and vehicle models are unavailable, so the placeholders stay',
						error,
					),
			);
		};
		// The cypresses need no species assets, so a page that grows the rest later places them before
		// the first frame.
		if (!grownFirst) createCypressSpires(ctx);
		// The sea, the surf, the wind, the leaves and the traffic, which the page's speaker button starts.
		const sound = createIslandSound(ctx, camera);
		sound.setTraffic(traffic);
		let trees: { update(): void; wind: Wind } | undefined;
		let growing = false;
		const grow = (): void => {
			if (growing) return;
			growing = true;
			void createTrees(ctx, camera, { spires: false, wind }).then(
				(grown) => {
					trees = grown;
					sound.setWind(grown.wind);
				},
				(error: unknown) => console.error(error),
			);
		};
		// A live page grows the forest and brings in the life models once the first frame has drawn,
		// so neither costs the first frame anything, and both appear as they land.
		if (!grownFirst)
			void ctx.engine.firstFrame.then(() => {
				grow();
				settleTraffic();
			});
		if (grownFirst) {
			trees = await createTrees(ctx, camera, { wind });
			sound.setWind(trees.wind);
			// A held frame waits for the town's models too, so it never catches the code-built
			// landmarks beside the model ones.
			await town;
			// The stage writes the light its maps give before the first frame draws.
			await Promise.all([sky, room]);
		}

		const eye: [number, number, number] = [0, 0, 0];
		/** The day-to-night colour of the open ground, the water and the white water, written each frame. */
		const tint: [number, number, number] = [1, 1, 1];
		return {
			onUpdate(dt) {
				const t = time.now;
				stage.update(dt);
				// The scene's own ambient takes the hour, eased by the same share as the town's lamps.
				const ambientNow = ambientAt(stage.lamps);
				ambient.setColor(ambientNow.sky);
				ambient.setGroundColor(ambientNow.ground);
				ambient.setIntensity(ambientNow.intensity);
				controls.update(t);
				film.update(dt);
				const lens = controls.lens();
				if (lens) post.set(lens);
				camera.getPosition(eye);
				// The shared field follows the camera and its gusts fade, so it steps before every reader:
				// the trees sway with it and the pools' ripples and surface take it next.
				wind.update();
				night?.update(eye, stage.lamps, stage.hours);
				// Open ground and open water darken with the hour, so neither outshines the town.
				nightAlbedo(stage.lamps, tint);
				land.setTint(tint);
				land.update(eye);
				sea.update(tint);
				traffic.update(time.now);
				birds.update();
				trees?.update();
				poolwater?.update();
			},
			onLateUpdate(dt) {
				sound.update(dt);
			},
		};
	},
	{ lowestTier: false },
);
