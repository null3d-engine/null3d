// Skyway: flying a hover car through a rainy megacity at night. Sky lanes carry tens of thousands
// of hover cars above the streets, and the towers around them are windows, shop fronts and signs
// drawn in the shader. The wet roads mirror the light, rain falls through everything, and the hero
// car leads the camera down the canyons.
//
// The camera runs a cinematic route made for this scene (see SHOTS), the same way the other
// showcase scenes do: `c` switches between Auto, which flies the route, and Manual, which hands the
// camera to the user. The HUD's Traffic buttons change how many cars fly, and the Quality buttons
// change the preset. The stats overlay is on from the first frame.
import { defineSketch, type QualityPreset, timeOfDay, vec3 } from '@null3d/engine';
import { createLensKit, nightGrade } from '../../addons/lens-kit/index';
import { type CameraBounds, type Cinematic, createCinematic, type Shot } from '../../lib/cinematic';
import {
	ATMOSPHERE,
	type HudGroup,
	LIGHTING,
	POST,
	QUALITY,
	radioGroup,
	toggleGroup,
} from '../../lib/controls';
import { EFFECT_LAYER } from '../../lib/layers';
import { enableReflections } from '../../lib/ssr';
import { createMoods } from '../../lib/stage';
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
/** The fog's density in the ordinary moods, and the lit fog the sun and the lamps show through. */
const FOG_DENSITY = 0.0042;
const FOG_LIT = { intensity: 1.5, anisotropy: 0.42, distance: 430 };
/** How much denser the storm's fog is, and how much denser its rain. */
const STORM_FOG = 2.4;
const STORM_RAIN = 1.8;

/** The looks that the scene's Time of day buttons offer. Storm is the scene's own variation. */
const MOODS = ['Dusk', 'Night', 'Storm'] as const;
type SkywayMood = (typeof MOODS)[number];
/** The stage mood that each look takes: the storm is the night, under heavier cloud and rain. */
const STAGE_MOOD: Record<SkywayMood, 'Dusk' | 'Night'> = {
	Dusk: 'Dusk',
	Night: 'Night',
	Storm: 'Night',
};
const MOOD_OPTIONS = [
	{ id: 'Dusk', label: 'Dusk', tip: 'The sun has just set, and the city lights are coming on.' },
	{ id: 'Night', label: 'Night', tip: 'The city after dark, with the moon behind cloud.' },
	{ id: 'Storm', label: 'Storm', tip: 'A storm: heavy cloud, dense fog and driving rain.' },
] as const;
const isSkywayMood = (name: unknown): name is SkywayMood => MOODS.includes(name as SkywayMood);
/** The point that the lens focuses on, kept up to date by the route. */
const TARGET: [number, number, number] = [-525, 90, 560];

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
	// The sky, the sun, the fog and the exposure follow the shared stage, which eases between moods
	// and lights the scene from the sky. The scene gives the stage its lit fog, so the lamps and the
	// searchlights stay visible through the air in every mood.
	const [skyLight, room] = await Promise.all([
		assets.skyEnvironment(),
		assets.builtinEnvironment('room'),
	]);
	const night = timeOfDay('night', { heading: HEADING, model: 'physical' });
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
		// The city's own lights carry it: the physical night alone leaves the streets black.
		exposureScale: 4.5,
		// The sky's own light on the wet streets and the tower sides.
		environmentScale: 2.2,
		// A brighter sky than the night gives, so the towers stand against it.
		skyScale: 2.6,
	});
	// The storm's own sky: the physical night under full cloud, with the moon dimmed by it.
	const storm = {
		atmosphere: {
			sunPosition: night.atmosphere.sunPosition,
			sunIntensity: 0,
			moonPosition: night.atmosphere.moonPosition,
			moonIntensity: (night.atmosphere.moonIntensity as number) * 0.35,
			stars: 0,
			cloudCoverage: 1,
			time: 0,
		},
	};
	const stormSky = { intensity: (night.skyIntensity as number) * 0.5 };
	/** The storm's fog, which the scene writes while the storm runs. */
	const stormFog = {
		color: [0.03, 0.035, 0.06] as [number, number, number],
		density: FOG_DENSITY * STORM_FOG,
		heightFalloff: 0.013,
		volumetric: FOG_LIT,
	};
	let mood: SkywayMood = 'Night';
	const params = new URL(import.meta.url).searchParams;
	const start = params.get('mood');
	if (isSkywayMood(start)) mood = start;
	stage.set(STAGE_MOOD[mood]);

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
	const lensKit = await createLensKit(ctx, {
		sharpen: 0.35,
		vignette: { intensity: 0.55, size: 1.05, falloff: 2.2 },
		grade: { data: nightGrade(), intensity: 0.85 },
		aberration: 0.8,
		streak: 0.45,
		grain: 0.035,
		// The speed blur follows the camera's own travel, below, so a held frame has none.
		speedBlur: 0,
	});
	debug.stats(true);

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

	const fit = (): void => {
		facades.fit(quality.preset);
		traffic.fit(quality.preset);
	};
	fit();
	quality.onChange(fit);

	/** The state of each switch that the HUD offers. */
	const on: Record<string, boolean> = {
		fog: true,
		rain: true,
		ao: true,
		environment: true,
		bloom: true,
		dof: false,
		exposure: false,
		vignette: true,
	};
	/** The level of detail the Quality tab keeps, as the other showcases do. */
	let lodThreshold = quality.settings.lodThreshold || 1;

	/**
	 * Writes the storm's own sky and fog over the stage's night. A held frame runs no update, so
	 * the setup writes it once too.
	 */
	const writeStorm = (t: number): void => {
		storm.atmosphere.time = t;
		scene.setBackground(storm, stormSky);
		if (!on.fog) return;
		const air = stage.airColor;
		stormFog.color[0] = air[0] as number;
		stormFog.color[1] = air[1] as number;
		stormFog.color[2] = air[2] as number;
		scene.setFog(stormFog);
	};
	if (mood === 'Storm') writeStorm(0);

	const groups = (): readonly HudGroup[] => [
		radioGroup('mood', 'Time of day', MOOD_OPTIONS, mood),
		toggleGroup('atmosphere', 'Atmosphere', ATMOSPHERE, ['fog', 'rain'], (id) => on[id] ?? false),
		toggleGroup('lighting', 'Lighting', LIGHTING, ['ao', 'environment'], (id) => on[id] ?? false),
		toggleGroup(
			'post',
			'Post',
			POST,
			['bloom', 'dof', 'exposure', 'vignette'],
			(id) => on[id] ?? false,
		),
		radioGroup('traffic', 'Traffic', TRAFFIC_OPTIONS, String(traffic.count)),
		{
			...radioGroup('quality', 'Quality', QUALITY, quality.preset),
			extras: [
				{
					id: 'lod',
					label: 'LOD',
					tip: 'Draw simpler meshes in the distance. Off draws every mesh at its fullest.',
					active: quality.settings.lodThreshold > 0,
				},
			],
		},
	];
	let film: Cinematic;

	/** The lens's settings, which follow the point the route looks at. */
	const lens = { aperture: 1.8, maxBlur: 0.025, focusPoint: TARGET };
	/** The post settings of the lens while it is on, written once so a frame allocates nothing. */
	const lensSettings = { dof: lens };

	/** Turns one of the scene's own switches on or off. */
	const set = (id: string, lit: boolean): void => {
		on[id] = lit;
		switch (id) {
			case 'fog':
				stage.show('fog', lit);
				break;
			case 'rain':
				rain.setVisible(lit);
				break;
			case 'ao':
				post.set({ ao: lit ? { radius: 1.4 } : false });
				break;
			case 'environment':
				stage.show('environment', lit);
				break;
			case 'bloom':
				post.set({ bloom: lit ? { intensity: 0.55, threshold: 1 } : false });
				break;
			case 'dof':
				post.set(lit ? lensSettings : { dof: false });
				break;
			case 'exposure':
				post.set({ autoExposure: lit ? {} : false });
				break;
			case 'vignette':
				lensKit.set({ vignette: lit ? { intensity: 0.55, size: 1.05, falloff: 2.2 } : false });
				break;
		}
	};
	/** Takes one of the scene's looks: the stage for Dusk and Night, its own heavy weather for Storm. */
	const setMood = (next: SkywayMood): void => {
		mood = next;
		stage.set(STAGE_MOOD[next]);
		rain.setStrength(next === 'Storm' ? STORM_RAIN : 1);
	};
	rain.setStrength(mood === 'Storm' ? STORM_RAIN : 1);

	page.onMessage((name, value) => {
		const picked = String(value);
		if (name === 'camera') film.select(picked);
		else if (name === 'mood' && isSkywayMood(value)) {
			setMood(value);
			film.refresh();
		} else if (name === 'atmosphere' || name === 'lighting' || name === 'post') {
			set(picked, !(on[picked] ?? false));
			film.refresh();
		} else if (name === 'traffic') {
			traffic.setCount(Number(value));
			film.refresh();
		} else if (name === 'quality') {
			const lod = quality.settings.lodThreshold > 0;
			if (picked === 'lod') {
				if (lod) lodThreshold = quality.settings.lodThreshold;
				void quality.set({ lodThreshold: lod ? 0 : lodThreshold });
			} else {
				void quality.setPreset(picked as QualityPreset);
				lodThreshold = quality.settings.lodThreshold || lodThreshold;
				if (!lod) void quality.set({ lodThreshold: 0 });
			}
			film.refresh();
		}
	});

	film = createCinematic(ctx, camera, {
		shots: SHOTS,
		target: TARGET,
		groups,
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
			// The storm is the scene's own weather over the stage's night: a sky under full cloud,
			// and fog thick enough to hide the far towers.
			if (mood === 'Storm') writeStorm(t);
			film.update(dt);
			city.update(t);
			hero.update(dt, t, film.mode === 'auto');
			rain.follow(camera);
			camera.getWorldPosition(eye);
			traffic.update(eye, t);
			if (on.dof) post.set(lensSettings);
		},
	};
});
