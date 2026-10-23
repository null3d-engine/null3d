// Gaussian splats from a glTF file that the sketch makes: a wavy ribbon of coloured splats, with a
// bar in front of part of it. The file carries the KHR_gaussian_splatting extension, which the
// splats add-on reads through the engine's glTF extension handler. The splats inside the model draw
// in the file's order, and the model's parts sort by depth, so the bar and the ribbon mix as they do
// for any other model.
import { color, defineSketch } from '@null3d/engine';
// The add-on registers the glTF extension as its module loads.
import '../../../packages/splats/src/index';

/** The page's switch: `splats` changes the ribbon's size for a slower GPU. */
const params = new URL(import.meta.url).searchParams;
const COUNT = Number(params.get('splats') ?? 12_000);

/** The splats' palette. */
const PALETTE = ['#66e0d0', '#7fb2ff', '#f2d06b', '#ff8fa3', '#b6e36a'];

/** A repeatable number from an index and a channel, from 0 to 1. */
function hash(index: number, channel: number): number {
	let x = (index * 374761393 + channel * 668265263) >>> 0;
	x = ((x ^ (x >>> 13)) * 1274126177) >>> 0;
	return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** The cloud of a ribbon that rises and falls across the view. */
function cloud() {
	const positions = new Float32Array(COUNT * 3);
	const rotations = new Float32Array(COUNT * 4);
	const scales = new Float32Array(COUNT * 3);
	const opacities = new Float32Array(COUNT);
	const colors = new Float32Array(COUNT * 3);
	const linear = new Float32Array(3);
	for (let i = 0; i < COUNT; i++) {
		const u = i / COUNT;
		const across = hash(i, 1) * 2 - 1;
		const x = -1.6 + u * 3.2 + (hash(i, 2) - 0.5) * 0.05;
		const y = Math.sin(u * Math.PI * 2) * 0.45 + across * 0.32;
		const z = (hash(i, 3) - 0.5) * 0.06;
		positions.set([x, y, z], i * 3);
		const spread = 0.02 + hash(i, 4) * 0.02;
		scales.set([spread, spread * (0.5 + hash(i, 5) * 0.6), spread * 0.6], i * 3);
		const turn = hash(i, 6) * 0.6 - 0.3;
		rotations.set([0, 0, Math.sin(turn), Math.cos(turn)], i * 4);
		opacities[i] = 0.6 + hash(i, 7) * 0.35;
		const hex = PALETTE[Math.floor(hash(i, 8) * PALETTE.length) % PALETTE.length] as string;
		color.fromHex(linear, hex);
		colors.set([linear[0] as number, linear[1] as number, linear[2] as number], i * 3);
	}
	return { positions, rotations, scales, opacities, colors };
}

/** A binary glTF file of the cloud, with one splat primitive that requires the extension. */
function glbFile(data: ReturnType<typeof cloud>): Blob {
	const parts = [data.positions, data.rotations, data.scales, data.opacities, data.colors];
	const views = parts.map((part) => part.byteLength);
	const buffer = new Uint8Array(views.reduce((sum, size) => sum + size, 0));
	const offsets: number[] = [];
	let at = 0;
	for (const part of parts) {
		offsets.push(at);
		buffer.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), at);
		at += part.byteLength;
	}
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < COUNT; i++)
		for (let k = 0; k < 3; k++) {
			const value = data.positions[i * 3 + k] as number;
			min[k] = Math.min(min[k] as number, value);
			max[k] = Math.max(max[k] as number, value);
		}
	const json = {
		asset: { version: '2.0' },
		extensionsUsed: ['KHR_gaussian_splatting'],
		extensionsRequired: ['KHR_gaussian_splatting'],
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0, translation: [0, 0.55, 0] }],
		meshes: [
			{
				primitives: [
					{
						attributes: {
							POSITION: 0,
							'KHR_gaussian_splatting:ROTATION': 1,
							'KHR_gaussian_splatting:SCALE': 2,
							'KHR_gaussian_splatting:OPACITY': 3,
							'KHR_gaussian_splatting:SH_DEGREE_0_COEF_0': 4,
						},
						mode: 0,
						extensions: {
							KHR_gaussian_splatting: {
								kernel: 'ellipse',
								colorSpace: 'srgb_rec709_display',
							},
						},
					},
				],
			},
		],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: COUNT, type: 'VEC3', min, max },
			{ bufferView: 1, componentType: 5126, count: COUNT, type: 'VEC4' },
			{ bufferView: 2, componentType: 5126, count: COUNT, type: 'VEC3' },
			{ bufferView: 3, componentType: 5126, count: COUNT, type: 'SCALAR' },
			{ bufferView: 4, componentType: 5126, count: COUNT, type: 'VEC3' },
		],
		bufferViews: views.map((byteLength, k) => ({ buffer: 0, byteOffset: offsets[k], byteLength })),
		buffers: [{ byteLength: buffer.byteLength }],
	};
	const text = new TextEncoder().encode(JSON.stringify(json));
	const jsonLength = (text.length + 3) & ~3;
	const binLength = (buffer.byteLength + 3) & ~3;
	const file = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
	const view = new DataView(file.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, file.length, true);
	view.setUint32(12, jsonLength, true);
	view.setUint32(16, 0x4e4f534a, true);
	file.set(text, 20);
	file.fill(0x20, 20 + text.length, 20 + jsonLength);
	view.setUint32(20 + jsonLength, binLength, true);
	view.setUint32(24 + jsonLength, 0x004e4942, true);
	file.set(buffer, 28 + jsonLength);
	return new Blob([file], { type: 'model/gltf-binary' });
}

export default defineSketch(async (ctx) => {
	const { scene, geometry, materials, assets } = ctx;
	scene.setBackground('#0a0d14');
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.1,
		far: 60,
		position: [0, 1.1, 3.4],
		target: [0, 0.2, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
	scene.createMesh({
		mesh: geometry.box({ width: 12, height: 0.1, depth: 12 }),
		material: materials.standard({ color: '#20242c', roughness: 0.9 }),
		position: [0, -0.75, 0],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 0.12, height: 1.2, depth: 0.12 }),
		material: materials.standard({ color: '#e8e2d8', roughness: 0.6 }),
		position: [0.35, -0.2, 0.8],
	});
	const prefab = await assets.loadGltf(URL.createObjectURL(glbFile(cloud())));
	scene.instantiate(prefab);
	return {};
});
