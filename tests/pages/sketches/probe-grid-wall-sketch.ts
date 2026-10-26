// A room split by a partition: the half on the left stands under a roof, so the sky reaches it
// only through the partition, and the half on the right stands open to the sky. The grid's spacing
// puts a row of its probes inside the partition, which is where a grid of this kind leaks: probes
// in geometry bake the light of the open half, and the filter spreads it into the roofed half, so
// a bright band stands on the floor and the wall beside the partition. The bake gives those probes
// no weight, which keeps their light out of the room. ?unmasked gives every probe its whole weight
// again, so the one picture shows the room without the mask and the other the room with it.
//
// The bake runs in the setup, before the first frame: hold mode, which the image tests use, draws
// its one frame without running any of the sketch's code.
import { bakeProbes, defineSketch, type QueryTarget } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;

type Colour = readonly [number, number, number];

export default defineSketch(async ({ scene, assets, materials, geometry, textures }) => {
	const environment = await assets.builtinEnvironment('room');
	scene.setEnvironment(environment);
	scene.setBackground('#20242c');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 60,
			position: [-2.8, 1.5, 2.8],
			target: [-0.2, 0.9, -0.4],
		}),
	);

	// Each surface's colour, which the bake's bounce takes from the object that a ray hits.
	const colours = new Map<QueryTarget, Colour>();
	const wall: Colour = [0.5, 0.5, 0.5];
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
	// The room's shell: a floor, four walls and a roof over the left half alone.
	surface(wall, [9, 0.2, 9], [0, -0.1, 0]);
	surface(wall, [9, 3.4, 0.2], [0, 1.7, -4.5]);
	surface(wall, [9, 3.4, 0.2], [0, 1.7, 4.5]);
	surface(wall, [0.2, 3.4, 9], [-4.5, 1.7, 0]);
	surface(wall, [0.2, 3.4, 9], [4.5, 1.7, 0]);
	surface(wall, [4.3, 0.2, 9], [-2.25, 3.3, 0]);
	// The partition, with its middle at the grid's own plane through the room's middle.
	surface(wall, [0.4, 3.4, 8.8], [0, 1.7, 0]);
	const sphere = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.5 }),
		material: materials.standard({ color: wall, roughness: 0.9 }),
		position: [-2.6, 0.5, -1.4],
	});
	colours.set(sphere, wall);

	const grid = bakeProbes(scene, {
		box: { min: [-4, 0.05, -4], max: [4, 2.9, 4] },
		spacing: 1,
		environment,
		albedo: (object) => (object ? colours.get(object) : undefined),
	}).finish();
	if (params.has('unmasked')) grid.validity.fill(1);
	scene.setLightProbeGrid({
		texture: grid.toTexture(textures),
		origin: grid.origin,
		spacing: grid.spacing,
		counts: grid.counts,
		skyLuminance: grid.skyLuminance,
	});
	return {};
});
