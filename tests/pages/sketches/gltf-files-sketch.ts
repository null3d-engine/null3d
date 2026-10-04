// glTF files made in code, for the glTF loader's page test: a model that loads and copies, a face
// with shape keys in sparse accessors as Blender writes it, and files that must fail with their
// codes. The sketch posts what it found as `result`.
import { defineSketch, EngineError, type Mesh } from '@null3d/engine';
import { armBuilder, blenderMorphBuilder, GltfBuilder, shipBuilder } from '../lib/gltf-files';
import { pngHeader } from '../lib/image-headers';

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
	const codeOf = async (url: string, options?: Parameters<typeof assets.loadGltf>[1]) => {
		try {
			await assets.loadGltf(url, options);
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
	// A .gltf file whose buffer lies at an address that the page rewrites, or refuses.
	const named = shipBuilder().gltf('https://files.example/ship.bin');
	const binary = addressOf(shipBuilder().bytes(), 'application/octet-stream');
	const rewritten = (rewriteUrl: (address: URL) => string | null) =>
		codeOf(addressOf(named, 'model/gltf+json'), { rewriteUrl });
	// An embedded image whose bytes do not decode, and a PNG header that claims 65,536 pixels a side.
	const image = (bytes: Uint8Array) => {
		const b = shipBuilder();
		b.json.images = [{ bufferView: b.view(bytes), mimeType: 'image/png' }];
		b.json.textures = [{ source: 0 }];
		b.json.materials[0].pbrMetallicRoughness = { baseColorTexture: { index: 0 } };
		return addressOf(b.glb());
	};
	// An accessor type that names a property of every JavaScript object, at the largest count.
	const constructorType = shipBuilder();
	Object.assign(constructorType.json.accessors[0], { type: 'constructor', count: 0x7fffffff });
	// Fifty accessors that glTF fills with zeros: a few kilobytes that would decode to 600 MB.
	const zeros = new GltfBuilder();
	const filled = Array.from({ length: 50 }, () => {
		const at = zeros.json.accessors.push({
			componentType: 5126,
			count: 999_999,
			type: 'VEC3',
			min: [0, 0, 0],
			max: [0, 0, 0],
		});
		return { attributes: { POSITION: at - 1 } };
	});
	zeros.node({ mesh: zeros.mesh(filled) });
	// A clip whose 6 tracks each hold two keys 34,000 seconds apart: 6 million keys at 30 a second.
	const long = armBuilder();
	const input = long.accessor(new Float32Array([0, 34_000]), 1, { min: [0], max: [34_000] });
	const output = long.accessor(new Float32Array([0, 0, 0, 1, 1, 1]), 3);
	long.json.animations.push({
		name: 'Long',
		samplers: [{ input, output }],
		channels: [0, 1, 2, 3, 4, 5].map((node) => ({ sampler: 0, target: { node, path: 'scale' } })),
	});
	const codes = {
		broken: await codeOf(addressOf(broken.glb())),
		draco: await codeOf(addressOf(shipBuilder().uses('KHR_draco_mesh_compression', true).glb())),
		missing: await codeOf(addressOf(missing.gltf(bin), 'model/gltf+json')),
		loop: await codeOf(addressOf(loop.glb())),
		huge: await codeOf(addressOf(huge.glb())),
		html: await codeOf(addressOf(notGltf, 'text/html')),
		absent: await codeOf('/tests/pages/assets/models/no-such-model.glb'),
		empty: await codeOf(addressOf(new GltfBuilder().glb())),
		named: await codeOf(addressOf(constructorType.glb())),
		zeros: await codeOf(addressOf(zeros.glb())),
		long: await codeOf(addressOf(long.glb())),
		rewritten: await rewritten(() => binary),
		refused: await rewritten((address) =>
			address.hostname === 'files.example' ? null : address.href,
		),
		undecodable: await codeOf(image(new TextEncoder().encode('not an image'))),
		claimsHuge: await codeOf(image(pngHeader(65536, 65536))),
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
