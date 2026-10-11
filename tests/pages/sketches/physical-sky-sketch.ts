// The physical sky at a time of day: `?time=afternoon`, `goldenHour`, `blueHour` or `night`, from
// `timeOfDay` with the physical model. The sky background, the sky's environment, the main light
// and the exposure come from it, with clouds and, at night, the moon and the stars. Spheres from
// mirror to rough show the sky's light, and a row of dark pillars that reach 20 kilometres away
// shows the aerial perspective: each farther pillar takes more of the air's color, which shows best on a dark surface. `?analytic`
// turns the quality setting `physicalSky` off, so the analytic sky stands in, as on Low.
// `?haze=0` turns the aerial perspective off.
import { defineSketch, type TimeOfDayPreset, timeOfDay } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const time = (params.get('time') ?? 'afternoon') as TimeOfDayPreset;
const aerialPerspective = Number(params.get('haze') ?? 1);

export default defineSketch(async ({ scene, assets, geometry, materials, post, quality }) => {
	if (params.has('analytic')) quality.set({ physicalSky: false });
	const day = timeOfDay(time, { heading: 2.2, model: 'physical' });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 50,
			far: 40000,
			position: [0, 1.6, 7],
			target: [0, 1.2, 0],
		}),
	);
	scene.setBackground({
		atmosphere: {
			...day.atmosphere,
			cloudCoverage: 0.35,
			aerialPerspective,
			metersPerUnit: 10,
		},
	});
	scene.setEnvironment(await assets.skyEnvironment());
	scene.createDirectionalLight({
		direction: day.light.direction,
		color: day.light.color,
		intensity: day.light.intensity,
	});
	post.set({ exposure: day.exposure });
	scene.createMesh({
		mesh: geometry.plane({ width: 8000, height: 8000 }),
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
	// Pillars at 20 to 2,000 units, 200 metres to 20 kilometres, each as tall as a sixth of its
	// distance, so each fills about the same height of the view. The near four stand left of the
	// spheres and the far four right of them, each a few degrees from the last.
	const pillar = geometry.box();
	const dark = materials.standard({ color: '#2c362c', roughness: 0.9 });
	for (let k = 0; k < 8; k++) {
		const distance = 20 * 100 ** (k / 7);
		const size = distance / 12;
		const angle = (k < 4 ? -37 + 5 * k : 22 + 5 * (k - 4)) * (Math.PI / 180);
		scene.createMesh({
			mesh: pillar,
			material: dark,
			position: [distance * Math.tan(angle), size, -distance],
			scale: [size * 0.5, size * 2, size * 0.5],
		});
	}
});
