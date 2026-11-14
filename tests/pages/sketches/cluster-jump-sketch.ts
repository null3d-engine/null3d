// The heightfield with a tree of cluster patches (tests/pages/sketches/cluster-sketch.ts) under a
// batch of spheres whose mesh has two coarser levels. The spheres' buckets put draws and copies
// before the ground's, so the cluster pass must find the ground's copy and write the ground's draw
// where the opaque pass reads it, and the copy moves with the spheres' level slices when a jump
// changes the levels that they pick. The page posts `jump` with a camera place; the sketch moves
// the camera there in its next update and answers `jumped` from the update after it, once the
// thread that draws has taken a frame with the jump.
import { defineSketch } from '@null3d/engine';
import { AMBIENT, SUN } from '../../../bench/scenes/spec';

/** The spheres along each side of the batch's square. */
const SIDE = 8;

export default defineSketch(async ({ scene, assets, geometry, materials, page }) => {
	scene.setBackground('#ff00ff');
	scene.createDirectionalLight(SUN);
	scene.createAmbientLight(AMBIENT);
	// The levels are set by hand, at distances that the camera's jumps cross, so each jump changes
	// how many copies each level takes.
	const sphere = geometry.sphere({ radius: 0.4, widthSegments: 32, heightSegments: 16 });
	sphere.setLevels([
		{ mesh: geometry.sphere({ radius: 0.4, widthSegments: 12, heightSegments: 8 }), distance: 15 },
		{ mesh: geometry.sphere({ radius: 0.4, widthSegments: 6, heightSegments: 4 }), distance: 30 },
	]);
	const count = SIDE * SIDE;
	const batch = scene.createInstances(sphere, count, {
		material: materials.standard({ color: '#d8d0c0', roughness: 0.8 }),
	});
	for (let k = 0; k < count; k++) {
		batch.positions.set(
			[((k % SIDE) - SIDE / 2) * 6, 6, (Math.floor(k / SIDE) - SIDE / 2) * 6],
			k * 3,
		);
		batch.rotations.set([0, 0, 0, 1], k * 4);
		batch.scales.set([1, 1, 1], k * 3);
	}
	batch.markDirty();
	scene.instantiate(await assets.loadGltf('assets/models/cluster-terrain.glb'));
	// A second tree, at its own place, so a jump between them leaves one tree's stale counts
	// behind and the later tree's list can lose patches.
	scene.instantiate(await assets.loadGltf('assets/models/cluster-terrain-b.glb'), {
		position: [-300, 0, 0],
	});
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.5,
		far: 300,
		position: [0, 7, 26],
		target: [0, 1, -20.8],
	});
	scene.setActiveCamera(camera);
	let next: [number, number, number] | null = null;
	let answer = false;
	page.onMessage((type, data) => {
		if (type === 'jump') next = data as [number, number, number];
	});
	return {
		onUpdate: () => {
			if (answer) {
				answer = false;
				page.post('jumped', null);
			}
			if (next) {
				camera.setPosition(...next);
				camera.lookAt(next[0], 1, -next[2] * 0.8);
				next = null;
				answer = true;
			}
		},
	};
});
