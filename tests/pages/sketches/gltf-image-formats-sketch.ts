// glTF files made in code whose textures are the same picture in each image format that the
// loader reads, for the image test of image formats. Each file holds one unlit square. From the
// left: the PNG as the texture's own image, the WebP through EXT_texture_webp and the AVIF through
// EXT_texture_avif, both required with no fallback, the AVIF with the PNG as its fallback for
// other loaders, and the AVIF named by address in a .gltf file rather than held in the file. Every
// square must show the PNG's four quarters.
import { defineSketch } from '@null3d/engine';
import { GltfBuilder } from '../lib/gltf-files';

// Each address is a literal, so a production build ships the file.
const PNG = new URL('../assets/textures/quadrants.png', import.meta.url);
const WEBP = new URL('../assets/textures/quadrants.webp', import.meta.url);
const AVIF = new URL('../assets/textures/quadrants.avif', import.meta.url);

/** The bytes of a file. */
async function bytesOf(address: URL): Promise<Uint8Array> {
	const response = await fetch(address);
	return new Uint8Array(await response.arrayBuffer());
}

/** The address of bytes, for assets.loadGltf. */
const addressOf = (bytes: Uint8Array, type = 'model/gltf-binary') =>
	URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));

/**
 * A file of one unlit square of side 1.6 facing +z, mapped with the texture that `texture`
 * describes, whose images `images` gives.
 */
function square(images: object[], texture: object, extensions: string[] = []): GltfBuilder {
	const b = new GltfBuilder().uses('KHR_materials_unlit');
	for (const name of extensions) b.uses(name, !('source' in texture));
	const positions = new Float32Array([-0.8, -0.8, 0, 0.8, -0.8, 0, 0.8, 0.8, 0, -0.8, 0.8, 0]);
	// glTF's texture coordinates start at the image's top left.
	const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
	b.json.images = images;
	b.json.textures = [texture];
	const material = b.material({
		pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 },
		extensions: { KHR_materials_unlit: {} },
	});
	b.node({
		mesh: b.mesh([
			{
				attributes: { POSITION: b.positions(positions), TEXCOORD_0: b.accessor(uvs, 2) },
				indices: b.accessor(new Uint16Array([0, 1, 2, 0, 2, 3]), 1),
				material,
			},
		]),
	});
	return b;
}

/** An image held in the file's buffer. */
function held(b: GltfBuilder, bytes: Uint8Array, mimeType: string): object {
	return { bufferView: b.view(bytes), mimeType };
}

export default defineSketch(async ({ scene, assets, post }) => {
	// Each square shows its texels as the image holds them, so no tone mapping may change them.
	post.set({ toneMapping: 'none' });
	scene.setBackground('#20242a');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 45, near: 0.1, far: 50, position: [0, 0, 8.5] }),
	);
	const [png, webp, avif] = await Promise.all([bytesOf(PNG), bytesOf(WEBP), bytesOf(AVIF)]);

	const files: Uint8Array[] = [];
	const plain = square([], { source: 0 });
	plain.json.images = [held(plain, png, 'image/png')];
	files.push(plain.glb());
	for (const [bytes, mimeType, extension] of [
		[webp, 'image/webp', 'EXT_texture_webp'],
		[avif, 'image/avif', 'EXT_texture_avif'],
	] as const) {
		const b = square([], { extensions: { [extension]: { source: 0 } } }, [extension]);
		b.json.images = [held(b, bytes, mimeType)];
		files.push(b.glb());
	}
	const fallback = square([], { source: 0, extensions: { EXT_texture_avif: { source: 1 } } }, [
		'EXT_texture_avif',
	]);
	fallback.json.images = [held(fallback, png, 'image/png'), held(fallback, avif, 'image/avif')];
	files.push(fallback.glb());
	const named = square(
		[{ uri: AVIF.href, mimeType: 'image/avif' }],
		{ extensions: { EXT_texture_avif: { source: 0 } } },
		['EXT_texture_avif'],
	);

	const models = await Promise.all([
		...files.map((bytes) => assets.loadGltf(addressOf(bytes))),
		assets.loadGltf(addressOf(named.gltf(), 'model/gltf+json')),
	]);
	models.forEach((model, k) => {
		scene.instantiate(model, { position: [-4 + k * 2, 0, 0] });
	});
});
