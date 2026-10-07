// Meshes and models destroyed while others stay, for the destroy test. ?mode=destroy makes every
// mesh and model, draws some frames, then destroys some of them with the objects that use them.
// ?mode=reference makes only the ones that stay. In both modes a cone comes next, which takes the
// room that the destroyed meshes left, and then the sketch posts 'ready' once more frames have
// drawn. The page compares the two pictures: the meshes that stay draw the same, wherever the
// engine moved their data. The destroyed ones come before the ones that stay, in each kind of
// mesh: plain, morphed and skinned.
import {
	defineSketch,
	type Mesh,
	type MeshGeometry,
	type Object3D,
	type Prefab,
} from '@null3d/engine';
import { armBuilder, blenderMorphBuilder, morphBuilder, shipBuilder } from '../lib/gltf-files';

const destroying = new URL(import.meta.url).searchParams.get('mode') === 'destroy';
/** Frames before the destroy, and frames after it before the picture. */
const FRAMES = 6;

/** The address of a glTF file's bytes, for assets.loadGltf. */
const addressOf = (bytes: Uint8Array) =>
	URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }));

export default defineSketch(async ({ scene, geometry, materials, assets, page, time }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({ position: [0, 3, 14], target: [0, 1, 0] });
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });
	const paint = materials.standard({ color: '#c8a060', roughness: 0.6 });
	const gone = { objects: [] as Object3D[], meshes: [] as MeshGeometry[], prefabs: [] as Prefab[] };
	const batches: { destroy(): void }[] = [];

	if (destroying) {
		const sphere = geometry.sphere();
		gone.meshes.push(sphere);
		gone.objects.push(scene.createMesh({ mesh: sphere, material: paint, position: [0, 4, 0] }));
	}
	scene.createMesh({ mesh: geometry.box(), material: paint, position: [-6, 0, 0] });
	if (destroying) {
		const blob = await assets.loadGltf(addressOf(morphBuilder().glb()));
		const ship = await assets.loadGltf(addressOf(shipBuilder().glb()));
		gone.prefabs.push(blob, ship);
		gone.objects.push(scene.instantiate(blob, { position: [-2, 4, 0] }));
		gone.objects.push(scene.instantiate(ship, { position: [2, 4, 0] }));
		const rows = scene.createInstances(ship, 2);
		rows.positions.set([4, 4, 0, 6, 4, 0]);
		rows.markDirty();
		batches.push(rows);
	}
	const face = await assets.loadGltf(addressOf(blenderMorphBuilder().glb()));
	const faceCopy = scene.instantiate(face, { position: [-3, 0, 0] });
	(faceCopy.find('Face') as Mesh).setMorphWeight('Smile', 1);
	const arm = await assets.loadGltf(addressOf(armBuilder().glb()));
	scene.instantiate(arm, { position: [1, -1, 0] });
	scene.createMesh({ mesh: geometry.torus(), material: paint, position: [5, 0, 0] });
	const ship = await assets.loadGltf(addressOf(shipBuilder().glb()));
	scene.instantiate(ship, { position: [-1, 4, 0], scale: [0.5, 0.5, 0.5] });

	let start = -1;
	let sent = false;
	return {
		onUpdate() {
			if (start < 0) start = time.frame;
			const frames = time.frame - start;
			if (frames === FRAMES) {
				for (const object of gone.objects) object.destroy();
				for (const batch of batches) batch.destroy();
				for (const mesh of gone.meshes) mesh.destroy();
				for (const prefab of gone.prefabs) prefab.destroy();
				scene.createMesh({ mesh: geometry.cone(), material: paint, position: [0, -2, 0] });
			}
			if (frames >= FRAMES * 2 && !sent) {
				sent = true;
				page.post('ready', { meshBytes: geometry.memoryBytes });
			}
		},
	};
});
