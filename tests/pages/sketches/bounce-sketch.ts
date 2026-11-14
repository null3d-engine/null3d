// One bounce of indirect light in a room open at the front and the top: a red wall at the left, a
// green wall at the right, and a white back wall and floor, lit by the built-in room environment
// alone. The neutral floor takes red light at the left and green at the right, which plain
// environment light cannot show, because it lights every surface alike. ?bounce draws the bounce
// light from the camera's view, ?grid bakes a light probe grid and draws its light instead, and
// neither draws the room's environment light alone. The corner between the wall and the floor is
// what the bounce spec measures; `bounce-grid` compares the two against each other.
import { bakeProbes, defineSketch, type QueryTarget } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;

type Colour = readonly [number, number, number];

export default defineSketch(async ({ scene, assets, materials, geometry, textures, quality }) => {
	const environment = await assets.builtinEnvironment('room');
	scene.setEnvironment(environment);
	scene.setBackground('#20242c');
	// The reference variants draw no bounce light, whatever preset the page runs: the image test
	// sets the light itself, so a preset's own value cannot hide a fault.
	quality.set({ bounceRays: 0 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 55, position: [0, 2.1, 6.2], target: [0, 0.9, -0.4] }),
	);

	// Each surface's colour, which the bake's bounce takes from the object that a ray hits.
	const colours = new Map<QueryTarget, Colour>();
	const surface = (
		colour: Colour,
		size: [number, number, number],
		position: [number, number, number],
	) => {
		const object = scene.createMesh({
			mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
			material: materials.standard({ color: colour, roughness: 0.9 }),
			position,
		});
		colours.set(object, colour);
	};
	const white: Colour = [0.8, 0.8, 0.8];
	const red: Colour = [0.85, 0.06, 0.05];
	const green: Colour = [0.05, 0.72, 0.1];
	surface(white, [6, 0.2, 6], [0, -0.1, 0]);
	surface(white, [6, 3, 0.2], [0, 1.5, -3.1]);
	surface(red, [0.2, 3, 6], [-3.1, 1.5, 0]);
	surface(green, [0.2, 3, 6], [3.1, 1.5, 0]);

	if (params.has('bounce')) {
		// Eight rays each way at the default ceiling, and the steps of each march as the engine
		// gives them. The image test sets this itself, so a preset's own value cannot hide a fault.
		quality.set({ bounceRays: 8 });
		return {};
	}
	if (!params.has('grid')) return {};
	const grid = bakeProbes(scene, {
		box: { min: [-2.9, 0.1, -2.9], max: [2.9, 2.9, 2.9] },
		spacing: 1,
		environment,
		albedo: (object) => (object ? colours.get(object) : undefined),
	}).finish();
	scene.setLightProbeGrid({
		texture: grid.toTexture(textures),
		origin: grid.origin,
		spacing: grid.spacing,
		counts: grid.counts,
	});
	return {};
});
