// Aurora: a still night over a frozen lake, with curtains of green light across the sky. The aurora
// is the sky-layer example add-on: one WGSL function draws it over the core sky, which still draws
// the moon, the stars and the thin clouds that hide the light. The light of the sky comes from the
// core sky's environment map, so the ice mirrors what the sky shows; the aurora adds light to the
// sky alone, and the sketch adds a little of its own to the ice below it.
import {
	defineSketch,
	emptyTimeOfDay,
	math,
	type TimeOfDayOptions,
	timeOfDay,
} from '@null3d/engine';
import { createAurora } from '../addons/aurora/index';

/** Where the camera stands and looks, over the ice toward the ridges. */
const EYE = [0, 2.4, 30] as const;
const TARGET = [0, 16, -140] as const;
/** The turn of the sun's path, so that the moon stands behind the ridges. */
const HEADING = 0.55;

/** The hour at a sketch time: the night turns slowly, from 21:00 to 3:00. */
function clock(seconds: number): number {
	return 21 + math.euclideanModulo(seconds / 120, 6);
}

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	const day = emptyTimeOfDay();
	const dayOptions: TimeOfDayOptions = { heading: HEADING, model: 'physical' };
	const sky = {
		// Thin, slow clouds: the aurora shows through them, and they hide it where they thicken.
		cloudCoverage: 0.12,
		cloudDensity: 0.35,
		cloudElevation: 0.7,
		aerialPerspective: 1.5,
		sunPosition: day.atmosphere.sunPosition,
		moonPosition: day.atmosphere.moonPosition,
		sunIntensity: 0,
		moonIntensity: 0,
		stars: 0,
		time: 0,
	};
	const environment = await assets.skyEnvironment();
	scene.setEnvironment(environment, { intensity: 1 });
	post.set({ bloom: { intensity: 0.35, threshold: 0.6 }, vignette: {} });
	const moon = scene.createDirectionalLight();
	const camera = scene.createPerspectiveCamera({ fov: 55, near: 0.5, far: 4000, position: EYE });
	camera.lookAt(...TARGET);
	scene.setActiveCamera(camera);

	const paint = (color: string, roughness = 0.7, flatShading = false) =>
		materials.standard({ color, roughness, flatShading });
	// The lake's ice: glossy enough to hold the moon and the sky's last light.
	const ice = materials.standard({ color: '#16232f', roughness: 0.16, metalness: 0.0 });
	const plane = geometry.plane({ width: 4000, height: 4000 });
	scene.createMesh({
		mesh: plane,
		material: ice,
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	// A low ridge of snow along the far shore, and a second behind it, fading into the night.
	math.seed(11);
	const snow = paint('#9fb4cc', 0.9, true);
	for (let k = 0; k < 24; k++) {
		const x = math.randFloat(-900, 900);
		const z = math.randFloat(-460, -300);
		const height = math.randFloat(30, 120);
		scene.createMesh({
			mesh: geometry.cone({ radius: height * 1.4, height, radialSegments: 7 }),
			material: snow,
			position: [x, height * 0.5 - 6, z],
			rotation: [0, math.randFloat(0, Math.PI), 0, 1],
		});
	}
	// Pines on the near shore, dark against the ice, each a trunk and two cones of needles.
	const needles = paint('#0e2a24', 0.9, true);
	const low = geometry.cone({ radius: 2.2, height: 7, radialSegments: 6 });
	const high = geometry.cone({ radius: 1.5, height: 6, radialSegments: 6 });
	for (let k = 0; k < 14; k++) {
		const at = [math.randFloat(-120, 120), 0, math.randFloat(-70, -30)] as const;
		const scale = math.randFloat(0.7, 1.5);
		scene.createMesh({ mesh: low, material: needles, position: at, scale: [scale, scale, scale] });
		scene.createMesh({
			mesh: high,
			material: needles,
			position: [at[0], 5.5 * scale, at[2]],
			scale: [scale, scale, scale],
		});
	}

	const aurora = createAurora(ctx, { opacity: 1, sun: 0.2 });
	// A dim, wide light under the aurora, as its light falls on the ice and the snow.
	const glow = scene.createAmbientLight();
	glow.setColor([0.06, 0.2, 0.12]);
	glow.setIntensity(0.5);

	return {
		onUpdate() {
			const hour = clock(time.now);
			timeOfDay(hour, dayOptions, day);
			sky.sunPosition = day.atmosphere.sunPosition;
			sky.moonPosition = day.atmosphere.moonPosition;
			sky.moonIntensity = day.atmosphere.moonIntensity;
			sky.stars = day.atmosphere.stars;
			sky.time = time.now;
			scene.setBackground({ atmosphere: sky });
			moon.setDirection(...day.light.direction);
			moon.setColor(day.light.color);
			moon.setIntensity(day.light.intensity);
			scene.setFog({ color: day.fog.color, density: 0.0009, height: 0, heightFalloff: 0.08 });
			post.set({ exposure: day.exposure });
			// The curtains swell and thin as they drift, as a real aurora does over a minute.
			aurora.set({ opacity: 0.8 + 0.2 * Math.sin(time.now * 0.35), sun: 0.2 });
		},
	};
});
