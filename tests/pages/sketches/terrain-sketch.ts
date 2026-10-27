// Terrain of the terrain add-on, in hold mode: a height field drawn as a camera-centred quadtree of
// blocks, with grass, soil, rock and snow blended by a splat map filled from the height and slope.
// The camera stands still, so the held frame catches the blocks at the finest level around it and
// the coarse blocks of the far hills, which light from normals baked over the whole ground. The
// seed and the height function are fixed, so every run draws the same frame on every GPU path.
//
// `normals=vertex` lights from the meshes' own normals instead, and `blend=off` drops the layers'
// heights, so a test can compare each feature with its absence.
import { defineSketch, math } from '@null3d/engine';
import { createTerrain, type TerrainLayer, terrainTextures } from '@null3d/terrain';

const SIZE = 512;
const switches = new URL(import.meta.url).searchParams;
const bakedNormals = switches.get('normals') !== 'vertex';
const contrast = switches.get('blend') === 'off' ? 0 : undefined;

/**
 * The height of the ground at a point: hills with a valley that runs along z, and small folds
 * finer than a far block's cells, so a block's own vertices would miss them.
 */
function ground(x: number, z: number): number {
	const hills = 30 * Math.sin(x * 0.011) * Math.cos(z * 0.009) + 8 * Math.sin(x * 0.05 + z * 0.03);
	const valley = -16 * Math.exp(-(z * z) / (2 * 120 * 120));
	// Three crossing waves, so the folds look like the ground's own bumps rather than a ridge pattern.
	const folds =
		0.8 * Math.sin(x * 0.23 + z * 0.17) +
		0.5 * Math.sin(x * 0.41 - z * 0.31 + 1.7) +
		0.3 * Math.sin(x * 0.59 + z * 0.47 + 4.1);
	return hills + valley + folds + 6;
}

export default defineSketch((ctx) => {
	const { scene } = ctx;
	scene.setBackground('#8fb4d8');
	scene.createDirectionalLight({ direction: [-0.5, -1, -0.35], intensity: 3, castShadows: true });
	scene.createAmbientLight({ intensity: 0.5 });
	const camera = scene.createPerspectiveCamera({
		fov: 52,
		near: 0.5,
		far: 2000,
		position: [-90, 46, 150],
		target: [0, 8, -60],
	});
	scene.setActiveCamera(camera);

	const layers = terrainTextures(ctx.textures, { size: 96, seed: 3 });
	const blend = (layer: TerrainLayer): TerrainLayer =>
		contrast === undefined ? layer : { ...layer, contrast };
	const terrain = createTerrain(ctx, {
		size: SIZE,
		height: ground,
		resolution: 256,
		layers: [
			blend({ map: layers.grass, tile: 5 }),
			blend({ map: layers.soil, tile: 9 }),
			blend({ map: layers.rock, tile: 6, roughness: 0.85 }),
			blend({ map: layers.snow, tile: 12, roughness: 0.7 }),
		],
		maxLevel: 5,
		camera,
		bakedNormals,
	});
	// Place a few stones on the ground with the field's own height, to show the sampler.
	const heightfield = terrain.heightfield;
	const stone = ctx.materials.standard({ color: '#6d6559', roughness: 0.95, flatShading: true });
	math.seed(3);
	for (let k = 0; k < 24; k++) {
		const x = math.randFloat(-SIZE / 2, SIZE / 2);
		const z = math.randFloat(-SIZE / 2, SIZE / 2);
		const radius = math.randFloat(1, 3);
		scene.createMesh({
			mesh: ctx.geometry.sphere({ radius, widthSegments: 8, heightSegments: 5 }),
			material: stone,
			position: [x, heightfield.heightAt(x, z) + radius * 0.5, z],
			castShadows: true,
			receiveShadows: true,
		});
	}
	terrain.update([-90, 46, 150]);
	return {};
});
