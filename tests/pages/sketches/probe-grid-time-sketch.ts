// A floor under an open sky, lit by the sky's environment through a probe grid that the setup bakes
// once. The page's 'move' turns the day from the afternoon to the night: the sky's own settings
// change, its light follows over the refresh that the sky map takes, and the grid's light follows
// with it, because the share of the sky that each probe sees multiplies the live sky's color. A
// grid that baked the sky into its probes would keep the afternoon's light and the floor would
// hardly move.
import { bakeProbes, defineSketch, timeOfDay } from '@null3d/engine';

const HOURS = 15;
const NIGHT = 23;

export default defineSketch(async ({ scene, assets, geometry, materials, page, textures }) => {
	const day = timeOfDay(HOURS);
	const sky = { ...day.sky };
	const background = { sky };
	const environment = await assets.skyEnvironment();
	scene.setBackground(background);
	scene.setEnvironment(environment, { intensity: day.skyIntensity });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 45, position: [0, 2.4, 5], target: [0, 0.2, 0] }),
	);
	scene.createMesh({
		mesh: geometry.box({ width: 20, height: 0.2, depth: 20 }),
		material: materials.standard({ color: '#c8c8c8', roughness: 0.9 }),
		position: [0, -0.1, 0],
	});
	const grid = bakeProbes(scene, {
		box: { min: [-6, 0.4, -6], max: [6, 2.2, 6] },
		spacing: 1.5,
		environment,
		environmentOptions: { intensity: day.skyIntensity },
		albedo: () => [0.5, 0.5, 0.5],
	}).finish();
	scene.setLightProbeGrid({
		texture: grid.toTexture(textures),
		origin: grid.origin,
		spacing: grid.spacing,
		counts: grid.counts,
		skyLuminance: grid.skyLuminance,
	});
	let move = false;
	page.onMessage((name) => {
		if (name === 'move' && !move) move = true;
	});
	return {
		onUpdate() {
			if (!move) return;
			move = false;
			const night = timeOfDay(NIGHT);
			Object.assign(sky, night.sky);
			scene.setBackground(background);
			scene.setEnvironment(environment, { intensity: night.skyIntensity });
		},
	};
});
