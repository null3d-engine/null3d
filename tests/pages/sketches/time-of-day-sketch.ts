// A time of day: `?time=afternoon`, `goldenHour`, `blueHour` or `night`. The sky background, the
// sky's environment, the main light, the fog and the exposure all come from `timeOfDay`. Spheres
// from mirror to rough, of metal and of plastic, stand on a ground plane in front of the horizon,
// so the image shows the sky, its reflections, its diffuse light and the fog together.
import { defineSketch, type TimeOfDayPreset, timeOfDay } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const raw = params.get('time') ?? 'afternoon';
const time = params.has('minute')
	? Number(params.get('minute')) / 60
	: raw.startsWith('h')
		? Number(raw.slice(1)) / 100
		: (raw as TimeOfDayPreset);
const preview = globalThis as { __null3dNightfall?: string; __null3dNightSky?: number };
preview.__null3dNightfall = params.get('nightfall') ?? 'phases';
preview.__null3dNightSky = Number(params.get('nightsky') ?? 1);

export default defineSketch(async ({ scene, assets, geometry, materials, post }) => {
	const day = timeOfDay(time, { heading: 2.2 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [0, 1.6, 7], target: [0, 1.2, 0] }),
	);
	scene.setBackground(
		{ sky: { ...day.sky, cloudCoverage: 0.35 } },
		{ intensity: day.skyIntensity },
	);
	const sky = await assets.skyEnvironment();
	scene.setEnvironment(sky, { intensity: day.skyIntensity });
	scene.createDirectionalLight({
		direction: day.light.direction,
		color: day.light.color,
		intensity: day.light.intensity,
	});
	scene.setFog({ color: day.fog.color, density: 0.008, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure });
	scene.createMesh({
		mesh: geometry.plane({ width: 200, height: 200 }),
		material: materials.standard({ color: '#6f7a5a', roughness: 0.9 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	const sphere = geometry.sphere({ radius: 0.55, widthSegments: 48, heightSegments: 24 });
	for (let k = 0; k < 4; k++) {
		const roughness = k / 3;
		const x = (k - 1.5) * 1.3;
		const metal = materials.standard({ color: '#e8e4dc', metalness: 1, roughness });
		const plastic = materials.standard({ color: '#c8402f', metalness: 0, roughness });
		scene.createMesh({ mesh: sphere, material: metal, position: [x, 1.9, 0] });
		scene.createMesh({ mesh: sphere, material: plastic, position: [x, 0.6, 0] });
	}
});
