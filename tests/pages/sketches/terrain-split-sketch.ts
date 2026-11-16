// One hill of the terrain add-on, framed so that a known split of the quadtree crosses it: the
// camera stands `distance` meters along z from the hill, and the level of the block under the hill
// changes as the distance moves through the block's own split. `morph=off` keeps every block where
// it is, so the two frames either side of the split draw the hill at two levels and the switch
// shows. The ground lights from its own vertex normals, so a level's coarser grid changes the
// shading of the hill.
import { defineSketch } from '@null3d/engine';
import { createTerrain } from '@null3d/terrain';

const switches = new URL(import.meta.url).searchParams;
const morph = switches.get('morph') !== 'off';
const distance = Number(switches.get('distance') ?? 25.4);
/** The screen error in pixels, which moves the splits while the camera stands still. */
const error = Number(switches.get('error') ?? 0);

/** The ground's side, the hill's middle, and the hill's height and width. */
const SIZE = 64;
const HILL = { x: 4, z: 6, height: 4, radius: 5 };
/** The camera's height above the ground, and the field of view that the split was worked out for. */
const EYE = 8;

/** The height of the ground: one hill on a flat field. */
function ground(x: number, z: number): number {
	const dx = x - HILL.x;
	const dz = z - HILL.z;
	return HILL.height * Math.exp(-(dx * dx + dz * dz) / (2 * HILL.radius * HILL.radius));
}

export default defineSketch((ctx) => {
	const { scene, textures } = ctx;
	scene.setBackground('#8fb4d8');
	scene.createDirectionalLight({ direction: [-0.6, -1, -0.4], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.5 });
	const camera = scene.createPerspectiveCamera({
		fov: 52,
		near: 0.5,
		far: 500,
		position: [HILL.x, EYE, distance],
		target: [HILL.x, 1, HILL.z],
	});
	scene.setActiveCamera(camera);
	// One layer of a single texel: the hill's shape is the picture, and its shading comes from the
	// level's own vertices.
	const layer = textures.fromData({
		width: 1,
		height: 1,
		data: new Uint8Array([120, 150, 90, 255]),
		colorSpace: 'srgb',
		mipmaps: false,
	});
	const terrain = createTerrain(ctx, {
		size: SIZE,
		height: ground,
		resolution: 64,
		layers: [{ map: layer, tile: 8 }],
		chunkQuads: 8,
		maxLevel: 3,
		camera,
		bakedNormals: false,
		castShadows: false,
		...(error > 0 ? { error } : {}),
		morph,
	});
	terrain.update([HILL.x, EYE, distance]);
	return {};
});
