// The sky's cloud tier. `?mode=sky` draws the sky alone, and `?mode=environment` the sky with its
// environment map on spheres from mirror to rough, which shows whether the map holds the clouds.
// `?mode=physical` draws the physical sky and its map. The step count comes from the page's
// `?cloudSteps=` switch, which the manifest sets for each tier, so a GPU path whose preset stops at
// Medium draws the tier too.
import { defineSketch, timeOfDay } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const mode = params.get('mode') ?? 'sky';

/** The sky that the tests draw: a low sun and a broken deck of cloud above the camera. */
const SKY = {
	sunPosition: [0.35, 0.22, -0.9] as [number, number, number],
	turbidity: 6,
	rayleigh: 2,
	mieCoefficient: 0.005,
	mieDirectionalG: 0.75,
	cloudCoverage: 0.5,
	cloudDensity: 0.5,
	cloudElevation: 0.45,
	cloudScale: 0.0002,
	cloudSpeed: 0,
	time: 12,
};

/** The physical sky's clouds, in the air and the light that `timeOfDay` gives. */
const PHYSICAL_CLOUDS = {
	cloudCoverage: 0.5,
	cloudDensity: 0.5,
	cloudElevation: 0.45,
	cloudScale: 0.0002,
	cloudSpeed: 0,
	time: 12,
};

export default defineSketch(async ({ scene, geometry, materials, assets, post }) => {
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 65,
			near: 0.1,
			far: 100,
			position: [0, 0, 0],
			target: [0, 0.28, -1],
		}),
	);
	const physical = mode === 'physical';
	// The physical sky draws its own light, so its exposure, its light and its map come from
	// `timeOfDay`, as the physical sky's own tests take them.
	const day = physical ? timeOfDay('goldenHour', { heading: 2.2 }) : undefined;
	scene.setBackground(
		day ? { atmosphere: { ...day.atmosphere, ...PHYSICAL_CLOUDS } } : { sky: SKY },
	);
	if (day) {
		post.set({ exposure: day.exposure });
		scene.createDirectionalLight({
			direction: day.light.direction,
			color: day.light.color,
			intensity: day.light.intensity,
		});
	}
	if (mode !== 'sky') {
		scene.setEnvironment(await assets.skyEnvironment());
		const sphere = geometry.sphere({ radius: 0.55, widthSegments: 48, heightSegments: 32 });
		const roughness = [0, 0.25, 0.5, 0.75, 1];
		for (let i = 0; i < roughness.length; i++) {
			const material = materials.standard({
				color: '#ffffff',
				metalness: 1,
				roughness: roughness[i] as number,
			});
			scene.createMesh({
				mesh: sphere,
				material,
				position: [-1.6 + i * 0.8, -0.25, -3],
			});
		}
	}
	return {};
});
