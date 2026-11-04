// The asset tool's test scene (tests/lib/asset-scene.ts), as the source file or as one of the
// tool's outputs: with its defaults, which `?file=optimized` picks, its meshes quantized and its
// textures in KTX2, or with levels of detail, which `?file=lod` picks and whose ball draws its
// first level here. `?copied` gives each level its own copy of its base's vertex streams, which the
// loader then stores as a mesh of its own: the picture must match `asset-scene-lod` exactly, which
// proves that a level stored over its base's vertices draws what an array mesh drew.
import { defineSketch, type Mesh } from '@null3d/engine';
import { AMBIENT, SUN } from '../../../bench/scenes/spec';

const FILES = {
	source: 'assets/models/asset-scene.glb',
	optimized: 'assets/models/optimized/asset-scene.glb',
	lod: 'assets/models/optimized/asset-scene-lod-meshopt.glb',
} as const;

/**
 * The ball's level bias in the picture with levels. A ball of this size switches its first level
 * about 55 meters out and its second about 160, so at 10 times the error it draws level 1 where the
 * camera stands, between 5.5 and 16 meters.
 */
const LEVEL_BIAS = 10;

const params = new URL(import.meta.url).searchParams;

/** The bytes of a binary glTF with a new JSON chunk, which the BIN chunk follows unchanged. */
function withJson(bytes: Uint8Array, json: object): Uint8Array<ArrayBuffer> {
	const text = new TextEncoder().encode(JSON.stringify(json));
	const length = (text.length + 3) & ~3;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunk = view.getUint32(12, true);
	const bin = bytes.subarray(20 + chunk);
	const out = new Uint8Array(20 + length + bin.length);
	const outView = new DataView(out.buffer);
	outView.setUint32(0, view.getUint32(0, true), true);
	outView.setUint32(4, view.getUint32(4, true), true);
	outView.setUint32(8, out.length, true);
	outView.setUint32(12, length, true);
	outView.setUint32(16, 0x4e4f534a, true);
	out.set(text, 20);
	out.fill(0x20, 20 + text.length, 20 + length);
	out.set(bin, 20 + length);
	return out;
}

/**
 * The same file with each level primitive reading copies of its base's attribute accessors, each
 * over a copy of its buffer view, so the loader cannot tell that the vertices repeat and holds them
 * as a mesh of its own, as it held every level before. The blob that carries the result has no
 * folder of its own, so the file's other addresses become absolute.
 */
function withCopiedLevels(bytes: Uint8Array, base: URL): Uint8Array<ArrayBuffer> {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const jsonLength = view.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
		accessors: Record<string, unknown>[];
		bufferViews: Record<string, unknown>[];
		images?: { uri?: string }[];
		buffers?: { uri?: string }[];
		meshes: { name?: string; primitives: { attributes: Record<string, number> }[] }[];
	};
	for (const file of [...(json.images ?? []), ...(json.buffers ?? [])])
		if (file.uri !== undefined) file.uri = new URL(file.uri, base).href;
	for (const mesh of json.meshes) {
		if (!/_lod\d+$/.test(mesh.name ?? '')) continue;
		for (const primitive of mesh.primitives)
			for (const [name, at] of Object.entries(primitive.attributes)) {
				const accessor = { ...(json.accessors[at] as Record<string, unknown>) };
				const bufferView = accessor.bufferView as number | undefined;
				if (bufferView !== undefined)
					accessor.bufferView =
						json.bufferViews.push({ ...(json.bufferViews[bufferView] as object) }) - 1;
				primitive.attributes[name] = json.accessors.push(accessor) - 1;
			}
	}
	return withJson(bytes, json);
}

/** A URL of a model file, or of the same file with copied level vertices. */
async function modelUrl(url: string): Promise<string> {
	if (!params.has('copied')) return url;
	// The sketch runs in a worker, where a relative address names no page file. The test page
	// always serves the repository's `tests/pages` folder, so the address starts there.
	const absolute = new URL(`/tests/pages/${url}`, self.location.origin);
	const response = await fetch(absolute);
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.length < 20)
		throw new Error(
			`the level file did not download from ${absolute.href}: status ${response.status}, ${bytes.length} bytes`,
		);
	const copied = withCopiedLevels(bytes, absolute);
	return URL.createObjectURL(new Blob([copied], { type: 'model/gltf-binary' }));
}

export default defineSketch(async ({ scene, assets, post }) => {
	const name = (params.get('file') ?? 'source') as keyof typeof FILES;
	const url = FILES[name];
	if (!url) throw new Error(`no asset scene file is named ${name}`);
	post.set({ toneMapping: 'none' });
	scene.setBackground('#60666e');
	scene.createDirectionalLight(SUN);
	scene.createAmbientLight(AMBIENT);
	const model = scene.instantiate(await assets.loadGltf(await modelUrl(url)));
	// The file's Ball node draws a mesh, which the copy makes an object of.
	const ball = name === 'lod' ? (model.find('Ball') as Mesh | undefined) : undefined;
	ball?.setLevelBias(LEVEL_BIAS);
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 40,
			near: 0.5,
			far: 30,
			position: [4.5, 4.5, 7],
			target: [0, 0.9, 0],
		}),
	);
	return {};
});
