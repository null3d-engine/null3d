// glTF files made in code, for the glTF loader's page test: a model that loads and copies, a face
// with shape keys in sparse accessors as Blender writes it, and files that must fail with their
// codes. The sketch posts what it found as `result`.
import { defineSketch, EngineError, type Mesh } from '@null3d/engine';
import { blenderMorphBuilder, GltfBuilder, shipBuilder } from '../lib/gltf-files';

/** The address of bytes, for assets.loadGltf. */
const addressOf = (bytes: Uint8Array, type = 'model/gltf-binary') =>
	URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));

export default defineSketch(async ({ scene, assets, page }) => {
	const camera = scene.createPerspectiveCamera({ position: [0, 2, 8], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	const ship = await assets.loadGltf(addressOf(shipBuilder().glb()));
	const copy = scene.instantiate(ship, { position: [1, 0, 0] });
	const clone = scene.clone(copy);
	const batch = scene.createInstances(ship, 8);
	const face = await assets.loadGltf(addressOf(blenderMorphBuilder().glb()));
	const faceMesh = scene.instantiate(face, { position: [-3, 0, 0] }).find('Face') as Mesh;

	/** The code of the error that loading `url` gives, or 'none'. */
	const codeOf = async (url: string) => {
		try {
			await assets.loadGltf(url);
			return 'none';
		} catch (error) {
			return error instanceof EngineError ? error.code : String(error);
		}
	};
	const broken = shipBuilder();
	broken.json.accessors[0].byteOffset = 1 << 20;
	const missing = shipBuilder();
	const bin = new URL('/tests/pages/assets/models/no-such-file.bin', location.origin).href;
	const loop = shipBuilder();
	loop.json.nodes[0].children = [1];
	loop.json.nodes[1].children = [0];
	const huge = shipBuilder();
	huge.json.accessors[0].count = 2_000_000_000;
	const notGltf = new TextEncoder().encode('<!doctype html><title>404</title>');
	const codes = {
		broken: await codeOf(addressOf(broken.glb())),
		draco: await codeOf(addressOf(shipBuilder().uses('KHR_draco_mesh_compression', true).glb())),
		missing: await codeOf(addressOf(missing.gltf(bin), 'model/gltf+json')),
		loop: await codeOf(addressOf(loop.glb())),
		huge: await codeOf(addressOf(huge.glb())),
		html: await codeOf(addressOf(notGltf, 'text/html')),
		absent: await codeOf('/tests/pages/assets/models/no-such-model.glb'),
		empty: await codeOf(addressOf(new GltfBuilder().glb())),
	};
	page.post('result', {
		nodes: [copy.find('Ship')?.name, copy.find('Hull')?.name, copy.find('Turret')?.name],
		hullParts: ship.find('Hull')?.mesh === undefined,
		cloneIsNew: clone !== copy && clone.name === copy.name,
		batchRows: batch.count,
		bounds: [ship.bounds.min, ship.bounds.max],
		materials: ship.materials.length,
		faceWeights: ['Smile', 'Blink', 'Rest'].map((name) => faceMesh.getMorphWeight(name)),
		codes,
	});
	return {};
});
