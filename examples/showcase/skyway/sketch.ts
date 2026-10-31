// Skyway: flying a hover car through a rainy megacity. Sky lanes carry tens of thousands of hover
// cars above the streets, and the towers around them are windows, shop fronts and signs drawn in
// the shader. The wet roads mirror the light, rain falls through everything, and the hero car leads
// the camera down the canyons.
//
// The camera runs a cinematic route made for this scene (see SHOTS), the same way the other
// showcase scenes do: `c` switches between Auto, which flies the route, and Manual, which hands the
// camera to the user. The time of day runs the full day, as it does in the other showcases: the dial
// holds any hour, Auto moves the sun and the moon, and Studio opens its own light. The city's own
// lights follow the hour, so its windows and street lamps go out by day and light it at night. The
// HUD's Traffic buttons change how many cars fly, and the Quality buttons change the preset. The
// stats overlay starts collapsed to its frame rate, as every demo's does.
import { defineSketch, type GradingSettings, vec3 } from '@null3d/engine';
import { createLensKit } from '../../addons/lens-kit/index';
import { createSplashes, createSteam } from '../../addons/weather/index';
import { type CameraBounds, type Cinematic, createCinematic, type Shot } from '../../lib/cinematic';
import { type HudGroup, radioGroup } from '../../lib/controls';
import { EFFECT_LAYER } from '../../lib/layers';
import { createShowcaseEffects } from '../../lib/showcase-effects';
import { enableReflections } from '../../lib/ssr';
import { createMoods, isMood } from '../../lib/stage';
import { createCity } from './city';
import { createFacades } from './facades';
import { createHero } from './hero';
import { HALF } from './layout';
import { createRain } from './rain';
import { CARS, createTraffic } from './traffic';

/** The camera's vertical field of view in degrees. */
const FOV = 58;
/** The bearing of the moon and the sky's light about +Y. */
const HEADING = 2.1;
/** The fog's density in the ordinary weather, and the lit fog that the sun and the lamps show. */
const FOG_DENSITY = 0.0042;
const FOG_LIT = { intensity: 1.5, anisotropy: 0.42, distance: 430 };
/** How much denser the storm's fog is, and how much heavier its rain. */
const STORM_FOG = 2.4;
const STORM_RAIN = 1.8;
/** The storm's weather over the hour: full cloud, thick fog, and a sky and light cut by cloud. */
const STORM_WEATHER = { fog: STORM_FOG, cloud: 1, light: 0.35, sky: 0.5 };
/** The ordinary weather, which the Storm button gives back. */
const CLEAR_WEATHER = { fog: 1, light: 1, sky: 1 };
/** The lens's vignette, which the lens kit writes. */
const VIGNETTE = { intensity: 0.55, size: 1.05, falloff: 2.2 };
/** The point that the lens focuses on, kept up to date by the route. */
const TARGET: [number, number, number] = [-525, 90, 560];

/** The warm, cool-shadowed grade that a rainy city at every hour keeps. */
const NIGHT_GRADE: GradingSettings = {
	lift: [-0.02, -0.02, -0.02],
	gain: [1.05, 1.05, 1.05],
	saturation: 1.08,
	splitToning: {
		shadows: [0.35, 0.55, 1],
		highlights: [1, 0.86, 0.66],
		balance: 0,
		strength: 0.06,
	},
};

/**
 * The route: a circuit of four street canyons, climbing from the south entrance to the tower tops
 * and diving back down. It keeps to the streets of the plan, so it never enters a building.
 */
export const SHOTS: readonly Shot[] = [
	// The opening view holds, so a held frame lands on it: high over the south entrance, looking
	// down the canyon into the haze.
	{ position: [-525, 170, 520], target: [-525, 90, 200], seconds: 1.2, move: 'hold' },
	{ position: [-525, 142, 430], target: [-525, 86, 260], seconds: 7 },
	{ position: [-525, 112, 300], target: [-525, 80, 150], seconds: 6 },
	{ position: [-525, 90, 180], target: [-525, 74, 20], seconds: 6 },
	{ position: [-525, 76, 30], target: [-524, 71, -50], seconds: 6 },
	{ position: [-524, 70, -52], target: [-512, 70, -78], seconds: 4 },
	{ position: [-505, 72, -75], target: [-420, 76, -75], seconds: 5 },
	{ position: [-380, 80, -75], target: [-240, 86, -75], seconds: 6 },
	{ position: [-190, 92, -75], target: [-50, 100, -75], seconds: 6 },
	{ position: [10, 108, -75], target: [150, 120, -75], seconds: 6 },
	{ position: [280, 142, -75], target: [400, 158, -75], seconds: 7 },
	{ position: [500, 168, -75], target: [522, 176, -84], seconds: 4 },
	{ position: [522, 178, -84], target: [524, 182, -110], seconds: 3 },
	{ position: [525, 186, -150], target: [525, 190, -270], seconds: 6 },
	{ position: [525, 192, -330], target: [525, 188, -450], seconds: 6 },
	{ position: [522, 178, -500], target: [512, 172, -522], seconds: 4 },
	{ position: [500, 168, -525], target: [420, 160, -525], seconds: 4 },
	{ position: [370, 152, -525], target: [230, 142, -525], seconds: 6 },
	{ position: [170, 134, -525], target: [30, 128, -525], seconds: 6 },
	{ position: [-60, 122, -525], target: [-200, 116, -525], seconds: 6 },
	{ position: [-320, 112, -525], target: [-460, 108, -525], seconds: 6 },
	{ position: [-500, 108, -525], target: [-524, 106, -512], seconds: 4 },
	{ position: [-524, 106, -500], target: [-525, 104, -420], seconds: 4 },
	{ position: [-525, 104, -340], target: [-525, 100, -220], seconds: 6 },
	{ position: [-525, 100, -140], target: [-525, 98, -20], seconds: 6 },
	{ position: [-525, 98, 40], target: [-525, 98, 160], seconds: 6 },
	{ position: [-525, 104, 240], target: [-525, 110, 360], seconds: 6 },
	{ position: [-525, 118, 420], target: [-525, 128, 480], seconds: 6 },
	{ position: [-525, 140, 490], target: [-525, 156, 512], seconds: 5 },
];

/**
 * Where the Manual camera may go: anywhere over the city, above the streets and under the tallest
 * towers, so the user never drops through the ground or leaves the plan.
 */
export const BOUNDS: Omit<CameraBounds, 'ground'> = {
	center: [0, 0],
	focus: HALF * 0.9,
	focusHeight: [12, 240],
	distance: 420,
};

/** The counts that the Traffic buttons offer. */
const TRAFFIC_OPTIONS = [
	{ id: String(CARS.low), label: '30k', tip: 'Thirty thousand cars: light traffic.' },
	{ id: String(CARS.high), label: '75k', tip: 'Seventy-five thousand cars: a busy skyway.' },
	{ id: String(CARS.ultra), label: '100k', tip: 'A hundred thousand cars: the full flow.' },
] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, quality, page, time, debug } = ctx;
	page.post('loading', 'Opening the skyway');
	// The sky, the sun, the fog and the exposure follow the shared stage, which eases between hours
	// and lights the scene from the sky. The scene gives the stage its lit fog, so the lamps and the
	// searchlights stay visible through the air in every mood.
	const [skyLight, room] = await Promise.all([
		assets.skyEnvironment(),
		assets.builtinEnvironment('room'),
	]);
	const sun = scene.createDirectionalLight({
		direction: [-0.32, -0.62, 0.42],
		color: '#a8c0ee',
		intensity: 0.6,
	});
	scene.createAmbientLight({ color: '#28324a', intensity: 1.2 });
	const stage = createMoods(ctx, sun, skyLight, room, {
		heading: HEADING,
		fogDensity: FOG_DENSITY,
		cloudCoverage: 0.45,
		backdrop: [0.01, 0.012, 0.02],
		volumetric: FOG_LIT,
		// The city's own lights carry it: the physical night alone leaves the streets black. The
		// scales hold at every hour, as the physical model's own exposure already falls by day.
		exposureScale: 4.5,
		environmentScale: 2.2,
		skyScale: 2.6,
	});
	const params = new URL(import.meta.url).searchParams;
	const start = params.get('mood');
	// A held frame has no buttons, so its address may ask for the storm as well as the hour.
	const storm = params.has('storm');
	stage.set(isMood(start) ? start : 'Night');
	const lensOff = params.get('lens') === 'off';

	const camera = scene.createPerspectiveCamera({
		fov: FOV,
		near: 0.1,
		far: 3200,
		layers: 1 | EFFECT_LAYER,
	});
	scene.setActiveCamera(camera);
	enableReflections(ctx);
	post.set({
		toneMapping: 'agx-punchy',
		ssr: { maxDistance: 260, thickness: 2, maxRoughness: 0.4, intensity: 1 },
		bloom: { intensity: 0.55, threshold: 1 },
		ao: { radius: 1.4 },
	});
	// The lens kit gives the picture its grade, its sharpening, its vignette and the camera's own
	// marks: the fringes, the streak on the brightest light, grain and a little speed blur.
	const lensKit = createLensKit(ctx, {
		sharpen: 0.35,
		vignette: VIGNETTE,
		grading: NIGHT_GRADE,
		aberration: lensOff ? 0 : 0.8,
		streak: lensOff ? 0 : 0.45,
		bloomLevel: 2,
		grain: lensOff ? 0 : 0.035,
		// The speed blur follows the camera's own travel, below, so a held frame has none.
		speedBlur: 0,
	});
	// Collapsed, like every other demo's overlay, so the panel does not cover the city on load.
	debug.stats({ collapsed: true });

	page.post('loading', 'Raising the towers');
	const facades = createFacades(ctx);
	const city = createCity(ctx);
	page.post('loading', 'Streaming the lanes');
	const traffic = createTraffic(ctx);
	const rain = createRain(ctx);
	/** The camera's place, which the real lights follow. */
	const eye = vec3.create();
	/** The camera's place, which the lens's speed blur follows. */
	const eyeForSpeed = vec3.create();
	const hero = createHero(ctx, camera, {
		position: (SHOTS[0] as Shot).position,
		target: TARGET,
	});
	// The rain's splashes on the car's roof and body, and the vapour from its engine nozzles, both
	// through the particles add-on. The hero group is not scaled, so these sizes are meters.
	const spray = await createSplashes(ctx, {
		parent: hero.group,
		position: [0, 2.45, 0],
		size: [2.4, 0.08, 6.2],
		rate: 70,
	});
	const vapour = await createSteam(ctx, {
		parent: hero.group,
		position: [0, 1.2, -4.4],
		size: [1.2, 0.12, 0.25],
		rate: 14,
		wind: [0, 0.5, -1.2],
	});

	const fit = (): void => {
		facades.fit(quality.preset);
		traffic.fit(quality.preset);
	};
	fit();
	quality.onChange(fit);

	/** The share of the city's own lights already in the scene, so a settled hour writes none again. */
	let lit = Number.NaN;
	/** Turns the city's windows, signs and street lamps to the share that the hour gives them. */
	const showLights = (share: number): void => {
		// The stage eases its lamps in small steps through dusk and dawn. Below a step nothing
		// visible changes, so a settled hour writes none of them again.
		if (Math.abs(share - lit) < 0.002) return;
		lit = share;
		facades.power(share);
		city.power(share);
	};
	// The held frame runs no update, so the city already holds the hour's light.
	showLights(stage.lamps);

	/** The lens's settings, which follow the point the route looks at. */
	const lens = { aperture: 1.8, maxBlur: 0.025, focusPoint: TARGET };
	/** The post settings of the lens while it is on, written once so a frame allocates nothing. */
	const lensSettings = { dof: lens };
	let film: Cinematic;

	// The scene's controls: the same time of day dial, Auto and Studio as the other showcase scenes,
	// and its own rain, storm, traffic and ambient occlusion.
	const controls = createShowcaseEffects(ctx, {
		camera,
		sun,
		stage,
		start: {
			sky: true,
			fog: true,
			rain: true,
			storm,
			ao: true,
			environment: true,
			bloom: true,
			dof: false,
			exposure: false,
			vignette: true,
		},
		supported: {
			atmosphere: ['sky', 'fog', 'rain', 'storm'],
			lighting: ['ao', 'environment'],
			post: ['bloom', 'dof', 'exposure', 'vignette'],
		},
		// The lens kit owns the vignette, and the scene's own lens owns the depth of field, so their
		// switches answer here rather than through the shared post cases.
		own: ['dof', 'vignette'],
		apply(id, on) {
			switch (id) {
				case 'rain':
					rain.setVisible(on);
					spray.setVisible(on);
					vapour.setVisible(on);
					hero.setRain(on ? 1 : 0);
					break;
				case 'storm':
					stage.setWeather(on ? STORM_WEATHER : CLEAR_WEATHER);
					rain.setStrength(on ? STORM_RAIN : 1);
					city.setRain(on ? 1 : 0.85);
					break;
				case 'ao':
					post.set({ ao: on ? { radius: 1.4 } : false });
					break;
				case 'bloom':
					post.set({ bloom: on ? { intensity: 0.55, threshold: 1 } : false });
					break;
				case 'dof':
					post.set(on ? lensSettings : { dof: false });
					break;
				case 'vignette':
					lensKit.set({ vignette: on ? VIGNETTE : false });
					break;
			}
		},
		mood: (next) => stage.set(next),
		hour: (hours) => stage.setHour(hours),
		film: () => film,
		fov: FOV,
		focalLength: FOV,
		focus: TARGET,
		extra: (): readonly HudGroup[] => [
			radioGroup('traffic', 'Traffic', TRAFFIC_OPTIONS, String(traffic.count)),
		],
	});
	// The held frame's storm, which the address asked for, reaches the same switch that the HUD posts.
	if (storm) controls.set('storm', true);
	// The Traffic buttons are the scene's own, so they answer here; the shared controls own the rest.
	page.onMessage((name, value) => {
		if (name !== 'traffic') return;
		traffic.setCount(Number(value));
		film.refresh();
	});

	film = createCinematic(ctx, camera, {
		shots: SHOTS,
		target: TARGET,
		groups: controls.groups,
		bounds: { ...BOUNDS, ground: () => 0 },
	});

	/** The camera's place a frame ago, for the speed that the lens smears by. */
	const was = vec3.create();
	// The camera keeps its distance from where it turns, so the change of its place is its travel.
	camera.getWorldPosition(was);
	let smear = 0;
	return {
		onUpdate(dt) {
			const t = time.now;
			stage.update(dt);
			showLights(stage.lamps);
			camera.getWorldPosition(eyeForSpeed);
			const travel = Math.hypot(
				(eyeForSpeed[0] as number) - (was[0] as number),
				(eyeForSpeed[1] as number) - (was[1] as number),
				(eyeForSpeed[2] as number) - (was[2] as number),
			);
			vec3.copy(was, eyeForSpeed);
			// A fraction of a frame's travel, settling over a few frames, so the smear never jumps.
			smear = Math.min(
				0.12,
				smear + (travel / Math.max(dt, 1e-3) / 900 - smear) * Math.min(1, dt * 6),
			);
			lensKit.set({ speedBlur: smear });
			film.update(dt);
			city.update(t);
			hero.update(dt, t, film.mode === 'auto');
			rain.follow(camera);
			camera.getWorldPosition(eye);
			traffic.update(eye, t);
			if (controls.on.dof) post.set(lensSettings);
			controls.update(t);
		},
		onLateUpdate() {
			// The particles move in the late update, where every object's world place is this frame's.
			spray.update();
			vapour.update();
		},
	};
});
