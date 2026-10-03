// glTF files with meshopt compression, for the glTF loader's page test: the test file under the
// vendor extension's name, the Khronos test file under the Khronos name, the same file with a
// fallback buffer, which the loader must not download, and a file whose meshopt data does not
// decode. The sketch posts what it found as `result`.
import { defineSketch, EngineError, type Prefab } from '@null3d/engine';
import { GltfBuilder } from '../lib/gltf-files';

/** The address of a sample file on the dev server, as `sampleUrl` in tools/lib/samples.ts gives it. */
const sampleUrl = (path: string) => `/samples/${path}`;

const FILES = {
	ext: new URL('../assets/models/simple-instancing-meshopt.glb', import.meta.url).href,
	khr: sampleUrl('sources/khronos/MeshoptCubeTest/glTF-Meshopt/MeshoptCubeTest.gltf'),
	fallback: sampleUrl('sources/khronos/MeshoptCubeTest/glTF/MeshoptCubeTest.gltf'),
};

/** A file of one triangle list whose meshopt data is a few bytes that do not decode. */
function brokenFile(): Uint8Array {
	const b = new GltfBuilder();
	const positions = b.positions(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
	const view = b.meshoptView(new Uint8Array([0xe1, 0, 0, 0]), {
		count: 3,
		byteStride: 2,
		mode: 'TRIANGLES',
	});
	const indices = b.accessorOf(view, 5123, 3, 1);
	b.node({ mesh: b.mesh([{ attributes: { POSITION: positions }, indices }]) });
	return b.uses('EXT_meshopt_compression', true).glb();
}

/** A prefab's bounds, rounded to a thousandth. */
const bounds = (prefab: Prefab) =>
	[...prefab.bounds.min, ...prefab.bounds.max].map((v) => Math.round(v * 1000) / 1000);

export default defineSketch(async ({ scene, assets, page }) => {
	scene.setActiveCamera(scene.createPerspectiveCamera({ position: [0, 2, 8], target: [0, 0, 0] }));
	const ext = await assets.loadGltf(FILES.ext);
	const khr = await assets.loadGltf(FILES.khr);
	const fallback = await assets.loadGltf(FILES.fallback);
	scene.instantiate(ext);
	scene.instantiate(khr);
	let broken = 'none';
	const url = URL.createObjectURL(
		new Blob([brokenFile() as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }),
	);
	try {
		await assets.loadGltf(url);
	} catch (error) {
		broken = error instanceof EngineError ? error.code : String(error);
	}
	page.post('result', {
		bounds: { ext: bounds(ext), khr: bounds(khr), fallback: bounds(fallback) },
		materials: khr.materials.length,
		broken,
	});
	return {};
});
