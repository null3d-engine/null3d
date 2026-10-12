// A minimap: a scene pass draws the ground and four colored boxes from an orthographic camera high
// above them into a texture, and an unlit screen behind the boxes shows it. The boxes stand at the
// map's corners, red at the far left, so the screen shows the map upright and unmirrored: red at
// its top left, green at its top right, blue at its bottom left and yellow at its bottom right. The
// map camera sees the screen too, and the pass leaves it out, as it leaves out every object that
// shows the pass's own texture. ?clear gives the pass a clear color of its own, which the map shows
// around the ground; without it the map clears to the scene's background. ?layers draws only the
// boxes into the map, through the pass's own layers. ?lamps dims the sun and lights the ground with
// a warm point light in the middle and a blue spot light on the yellow box; the sun and the spot
// light cast shadows, which the map draws where the main view draws them.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;

/** Each box's place on the ground and its color: the map's corners, as the map camera sees them. */
const BOXES = [
	{ position: [-3, 0.5, -3], color: '#e04040' },
	{ position: [3, 0.5, -3], color: '#40c040' },
	{ position: [-3, 0.5, 3], color: '#4060e0' },
	{ position: [3, 0.5, 3], color: '#e0c030' },
] as const;

const LAMPS = params.has('lamps');

export default defineSketch(({ scene, materials, geometry, textures, render, quality }) => {
	scene.setBackground('#20242c');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		position: [0, 7, 13],
		target: [0, 1.5, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: [-0.4, -1, -0.6],
		intensity: LAMPS ? 0.8 : 2.5,
		castShadows: LAMPS,
		shadow: { distance: 30 },
	});
	scene.createAmbientLight({ intensity: LAMPS ? 0.15 : 0.6 });
	const shadows = { castShadows: LAMPS, receiveShadows: LAMPS };
	if (LAMPS) {
		// A fixed shadow filter, so every GPU tier draws the same image whatever preset it runs.
		quality.set({ shadowFilter: 3 });
		scene.createPointLight({
			position: [0, 1.2, 0],
			color: '#ffb060',
			intensity: 12,
			range: 5,
		});
		scene.createSpotLight({
			position: [1.5, 5, 1.5],
			target: [3, 0, 3],
			color: '#60c8ff',
			intensity: 160,
			range: 10,
			angle: 0.45,
			penumbra: 0.2,
			castShadows: true,
		});
	}
	const ground = scene.createMesh({
		mesh: geometry.plane({ width: 10, height: 10 }),
		material: materials.standard({ color: '#9aa0a8', roughness: 0.9 }),
		receiveShadows: LAMPS,
	});
	ground.setRotationEuler(-Math.PI / 2, 0, 0);
	const box = geometry.box({ width: 1.4, height: 1, depth: 1.4 });
	for (const { position, color } of BOXES) {
		const object = scene.createMesh({
			mesh: box,
			material: materials.standard({ color, roughness: 0.6 }),
			position: [...position],
			...shadows,
		});
		object.setLayers(0b11);
	}
	// The map camera looks straight down, with the far side of the ground at the top of its image.
	const mapCamera = scene.createOrthographicCamera({
		height: 12,
		near: 1,
		far: 40,
		position: [0, 20, 0],
	});
	mapCamera.setRotationEuler(-Math.PI / 2, 0, 0);
	const pass = render.addPass({
		kind: 'scene',
		camera: mapCamera,
		writes: 'minimap',
		size: [256, 256],
		...(params.has('clear') ? { clearColor: '#103050' } : {}),
		...(params.has('layers') ? { layers: 0b10 } : {}),
	});
	if (params.has('layers')) ground.setLayers(0b01);
	const screen = materials.unlit({ map: textures.fromPass(pass) });
	scene.createMesh({
		mesh: geometry.plane({ width: 7, height: 7 }),
		material: screen,
		position: [0, 4.2, -6],
	});
	return {};
});
