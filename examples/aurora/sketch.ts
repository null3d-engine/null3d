// Aurora: a still night over a frozen lake, with curtains of green light across the sky. The aurora
// is the sky-layer example add-on: one WGSL function draws it over the core sky, which still draws
// the moon, the stars and the thin clouds that hide the light. The sky's environment map holds the
// aurora too, so the ice mirrors it, and the light that the map gives the scene lights the ice and
// the snow green from above.
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
		cloudCoverage: 0.06,
		cloudDensity: 0.25,
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
	// The lake's ice: a mirror, tinted by the water, that holds the aurora and the moon.
	const ice = materials.standard({ color: '#5d7686', roughness: 0.06, metalness: 1 });
	const plane = geometry.plane({ width: 4000, height: 4000 });
	scene.createMesh({
		mesh: plane,
		material: ice,
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	// A low ridge of snow along the far shore, fading into the night.
	math.seed(11);
	const snow = paint('#9fb4cc', 0.9, true);
	for (let k = 0; k < 34; k++) {
		const x = math.randFloat(-320, 320);
		const z = math.randFloat(-190, -120);
		const height = math.randFloat(14, 46);
		// Each cone turns about Y by its own angle: the quaternion of a turn of `turn` radians.
		const turn = math.randFloat(0, Math.PI);
		scene.createMesh({
			mesh: geometry.cone({ radius: height * 1.7, height, radialSegments: 6 }),
			material: snow,
			position: [x, height * 0.5 - 3, z],
			rotation: [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)],
		});
	}
	// Pines on the near shore, dark against the ice, each two cones of needles.
	const needles = paint('#0e2a24', 0.9, true);
	const low = geometry.cone({ radius: 2.2, height: 7, radialSegments: 6 });
	const high = geometry.cone({ radius: 1.5, height: 6, radialSegments: 6 });
	for (let k = 0; k < 16; k++) {
		const at = [math.randFloat(-70, 70), 0, math.randFloat(-42, -18)] as const;
		const scale = math.randFloat(0.8, 1.6);
		scene.createMesh({ mesh: low, material: needles, position: at, scale: [scale, scale, scale] });
		scene.createMesh({
			mesh: high,
			material: needles,
			position: [at[0], 5.5 * scale, at[2]],
			scale: [scale, scale, scale],
		});
	}

	// The aurora lights the ice and the snow through the sky's light, which its map carries, so it
	// needs no light of its own under it. Twice a second is enough for curtains that drift slowly.
	const aurora = createAurora(ctx, { opacity: 1, sun: 0.2, refresh: 0.5 });

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
