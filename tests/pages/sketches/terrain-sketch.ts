// Terrain of the terrain add-on, in hold mode: a height field drawn as a camera-centred quadtree of
// blocks, with grass, soil, rock and snow blended by a splat map filled from the height and slope.
// The camera stands still, so the held frame catches the blocks at the finest level around it and
// the coarse blocks of the far hills. The seed and the height function are fixed, so every run
// draws the same frame on every GPU path.
import { defineSketch, math } from '@null3d/engine';
import { createTerrain, terrainTextures } from '@null3d/terrain';

const SIZE = 512;

/** The height of the ground at a point: hills with a valley that runs along z. */
function ground(x: number, z: number): number {
	const hills = 30 * Math.sin(x * 0.011) * Math.cos(z * 0.009) + 8 * Math.sin(x * 0.05 + z * 0.03);
	const valley = -16 * Math.exp(-(z * z) / (2 * 120 * 120));
	return hills + valley + 6;
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
	const terrain = createTerrain(ctx, {
		size: SIZE,
		height: ground,
		resolution: 256,
		layers: [
			{ map: layers.grass, tile: 5 },
			{ map: layers.soil, tile: 9 },
			{ map: layers.rock, tile: 6, roughness: 0.85 },
			{ map: layers.snow, tile: 12, roughness: 0.7 },
		],
		maxLevel: 5,
		split: 2.2,
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
	terrain.update([-90, 0, 150]);
	return {};
});
