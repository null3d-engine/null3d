// glTF files with Draco compression, for the glTF loader's page test: the repository's Draco test
// file, the Khronos skinned Draco model, a copy of the test file whose Draco data does not decode,
// and the test file again after it, which a fresh decoder must read. The sketch posts what it found
// as `result`.
import { defineSketch, EngineError, type Prefab } from '@null3d/engine';

/** The address of a sample file on the dev server, as `sampleUrl` in tools/lib/samples.ts gives it. */
const sampleUrl = (path: string) => `/samples/${path}`;

const FILES = {
	coordinates: new URL('../assets/models/texture-coordinates-draco.glb', import.meta.url).href,
	rigged: sampleUrl('sources/khronos/RiggedSimple/glTF-Draco/RiggedSimple.gltf'),
};

/** The bytes that start Draco data: "DRACO". */
const MAGIC = [0x44, 0x52, 0x41, 0x43, 0x4f];

/** A copy of a file whose first Draco data names an encoding method that does not exist. */
function broken(file: Uint8Array): Uint8Array {
	const copy = file.slice();
	const at = copy.findIndex((_, k) => MAGIC.every((byte, j) => copy[k + j] === byte));
	if (at < 0) throw new Error('the test file holds no Draco data');
	copy[at + 8] = 0xff;
	return copy;
}

/** A prefab's bounds, rounded to a thousandth. */
const bounds = (prefab: Prefab) =>
	[...prefab.bounds.min, ...prefab.bounds.max].map((v) => Math.round(v * 1000) / 1000);

export default defineSketch(async ({ scene, assets, page }) => {
	scene.setActiveCamera(scene.createPerspectiveCamera({ position: [0, 2, 8], target: [0, 0, 0] }));
	const coordinates = await assets.loadGltf(FILES.coordinates);
	const rigged = await assets.loadGltf(FILES.rigged);
	scene.instantiate(coordinates);
	scene.instantiate(rigged).animator().play('animation_0');
	const bytes = new Uint8Array(await (await fetch(FILES.coordinates)).arrayBuffer());
	const url = URL.createObjectURL(
		new Blob([broken(bytes) as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' }),
	);
	let refused = 'none';
	try {
		await assets.loadGltf(url);
	} catch (error) {
		refused = error instanceof EngineError ? error.code : String(error);
	}
	const again = await assets.loadGltf(
		URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' })),
	);
	page.post('result', {
		bounds: { coordinates: bounds(coordinates), rigged: bounds(rigged), again: bounds(again) },
		clips: rigged.clips,
		refused,
	});
	return {};
});
