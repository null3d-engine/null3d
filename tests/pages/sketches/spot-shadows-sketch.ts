// Spot light shadows: two spot lights shine down at an angle onto a ground that receives shadows,
// with boxes, a ball and a tall post that cast and receive them. Each light casts into its own
// tile of the shadow atlas. A box on the right receives shadows but casts none, a post casts but
// receives none, and an unlit box shows no shadow on itself. The page's ?shadowTileSize= switch
// fixes the tile size, and the sketch fixes the 3 x 3 shadow filter, so every GPU tier draws the
// same image whatever preset it runs. ?batches draws the ground's objects as rows of instance
// batches of one row each, which must cast and receive as the objects do.
import { defineSketch, type Material, type MeshGeometry } from '@null3d/engine';

/** Whether the objects draw as instance rows, from the sketch module's ?batches switch. */
const BATCHES = new URL(import.meta.url).searchParams.has('batches');

export default defineSketch(({ scene, materials, geometry, quality }) => {
	quality.set({ shadowFilter: 3 });
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 6, 12],
		target: [0, 0, -2],
		far: 100,
	});
	scene.setActiveCamera(camera);
	scene.createSpotLight({
		position: [-4, 7, 2],
		target: [-1, 0, -2],
		color: '#ffd9a8',
		intensity: 400,
		range: 20,
		angle: 0.6,
		penumbra: 0.2,
		castShadows: true,
	});
	scene.createSpotLight({
		position: [5, 6, -4],
		target: [1, 0, -1],
		color: '#a8c8ff',
		intensity: 320,
		range: 18,
		angle: 0.5,
		penumbra: 0.3,
		castShadows: true,
		shadow: { bias: 0.01, normalBias: 0.01 },
	});
	scene.createAmbientLight({ intensity: 0.08 });

	const ground = materials.standard({ color: '#9aa0a8' });
	const red = materials.standard({ color: '#e8554e' });
	const yellow = materials.standard({ color: '#f2c14e' });
	const green = materials.standard({ color: '#5bc27a' });
	const blue = materials.standard({ color: '#4a8cff' });
	const unlit = materials.unlit({ color: '#b06ce0' });
	const box = geometry.box();
	const both = { castShadows: true, receiveShadows: true };
	const place = (options: {
		mesh: MeshGeometry;
		material: Material;
		position: [number, number, number];
		castShadows?: boolean;
		receiveShadows?: boolean;
	}) => {
		if (!BATCHES) {
			scene.createMesh(options);
			return;
		}
		const { mesh, position, ...rest } = options;
		const batch = scene.createInstances(mesh, 1, rest);
		batch.positions.set(position);
		batch.markDirty();
	};

	scene.createMesh({
		mesh: geometry.box({ width: 40, height: 0.2, depth: 40 }),
		material: ground,
		position: [0, -0.1, -4],
		receiveShadows: true,
	});
	place({ mesh: box, material: red, position: [-1.5, 0.5, -1], ...both });
	place({
		mesh: geometry.sphere({ radius: 0.7 }),
		material: yellow,
		position: [0.5, 0.7, -2.5],
		...both,
	});
	place({
		mesh: geometry.box({ width: 0.4, height: 4, depth: 0.4 }),
		material: blue,
		position: [2, 2, -1],
		castShadows: true,
	});
	// A box that receives shadows but casts none, in the post's shadow.
	place({
		mesh: box,
		material: green,
		position: [-0.2, 0.5, 0.5],
		receiveShadows: true,
	});
	place({ mesh: box, material: unlit, position: [-3, 0.5, -3], ...both });
});
