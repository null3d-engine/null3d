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
import { createCity } from './city';
import { createFacades } from './facades';
import { createHero } from './hero';
import { HALF } from './layout';
import { createRain } from './rain';
import { CARS, createTraffic } from './traffic';

/** The camera's vertical field of view in degrees. */
const FOV = 58;
/** How much brighter than the model's own scale the night sky shows, for this exposure. */
const SKY = 3.6;
/** The bearing of the moon and the sky's light about +Y. */
const HEADING = 2.1;
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
	const night = timeOfDay('night', { heading: HEADING });
	// A dark blue night under cloud, brighter than the physical model's own scale so the wet
	// streets have something to mirror.
	scene.setBackground(
		{ sky: { ...night.sky, cloudCoverage: 0.85, time: 0 } },
		{ intensity: night.skyIntensity * SKY },
	);
	const room = await assets.skyEnvironment();
	scene.setEnvironment(room, { intensity: night.skyIntensity * SKY });
	scene.createDirectionalLight({
		direction: [-0.32, -0.62, 0.42],
		color: '#a8c0ee',
		intensity: 0.6,
	});
	scene.createAmbientLight({ color: '#28324a', intensity: 0.5 });

	const fog = {
		color: [
			(night.fog.color[0] as number) * SKY,
			(night.fog.color[1] as number) * SKY,
			(night.fog.color[2] as number) * SKY,
		] as [number, number, number],
		density: 0.0042,
		heightFalloff: 0.013,
		volumetric: { intensity: 1.5, anisotropy: 0.42, distance: 430 },
	};
	scene.setFog(fog);

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
		exposure: night.exposure * 1.25,
		ssr: { maxDistance: 260, thickness: 2, maxRoughness: 0.4, intensity: 1 },
		bloom: { intensity: 0.55, threshold: 1 },
		ao: { radius: 1.4 },
		vignette: { intensity: 0.55 },
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

	const groups = (): readonly HudGroup[] => [
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
				scene.setFog(lit ? fog : null);
				break;
			case 'rain':
				rain.setVisible(lit);
				break;
			case 'ao':
				post.set({ ao: lit ? { radius: 1.4 } : false });
				break;
			case 'environment':
				scene.setEnvironment(lit ? room : null, { intensity: night.skyIntensity * SKY });
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
				post.set({ vignette: lit ? { intensity: 0.55 } : false });
				break;
		}
	};
	page.onMessage((name, value) => {
		const picked = String(value);
		if (name === 'camera') film.select(picked);
		else if (name === 'atmosphere' || name === 'lighting' || name === 'post') {
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

	return {
		onUpdate(dt) {
			const t = time.now;
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
