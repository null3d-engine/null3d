// Replays a hand-built draw list through the engine's WebGPU backend: GPU culling in a compute pass,
// then indirect draws from a render bundle with 4x MSAA and reversed depth. It checks the GPU side of
// the WebGPU render path before the core records these lists itself. It draws the 8-bit path, whose
// shaders encode their colors for the 8-bit target themselves.
import { loadWgslShaders, readbackWebGPU, WebGPUBackend } from '@null3d/engine/internal';
import * as C from '../../packages/engine/src/generated/core';
import * as G from '../../packages/engine/src/generated/gpu';
import {
	boxMesh,
	frustumPlanes,
	lookAt,
	multiply,
	perspectiveReversed,
	TestMemory,
} from './lib/drawlist';
import { run, toBase64 } from './lib/result';

const SIZE = 256;
const SAMPLES = 4;
const INSTANCE_BYTES = 64;
const BOX = 0.8;

run('replay', async () => {
	const adapter = await navigator.gpu?.requestAdapter();
	if (!adapter) throw new Error('no WebGPU adapter');
	const device = await adapter.requestDevice();
	const target = device.createTexture({
		size: [SIZE, SIZE],
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	const shaders = await loadWgslShaders(G.PERMUTATION_TONE_MAP);
	const backend = new WebGPUBackend(device, undefined, 'rgba8unorm', shaders);
	backend.canvasTarget = target;

	// Instances: a 5 x 5 grid in two buckets, on the view's two layers, plus one behind the camera
	// and one above the grid on a layer the view leaves out, which culling must both drop.
	const positions: [number, number, number][] = [];
	for (let z = 0; z < 5; z++)
		for (let x = 0; x < 5; x++) positions.push([(x - 2) * 2, 0, (z - 2) * 2]);
	positions.push([0, 0, 20], [0, 1.5, 0]);
	const bucketOf = (i: number) => (i === 25 ? 0 : i % 2);
	const viewLayers = 0b011;
	const layersOf = (i: number) => (i === 26 ? 0b100 : i % 3 === 0 ? 0b010 : 0b001);
	const matrices = new Float32Array(positions.length * 12);
	for (const [i, [x, y, z]] of positions.entries())
		matrices.set([1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z], i * 12);
	const instanceBuckets = new Uint32Array(positions.map((_, i) => bucketOf(i)));
	const instanceLayers = new Uint32Array(positions.map((_, i) => layersOf(i)));
	const capacity = [
		instanceBuckets.filter((b) => b === 0).length,
		instanceBuckets.filter((b) => b === 1).length,
	];
	// Each bucket's record: its slice's base, its material, the mesh's radius, then its indirect
	// draws, from its first on. Each bucket has one draw, the box's one part.
	const bucketInfo = new Uint32Array(16);
	const bucketFloats = new Float32Array(bucketInfo.buffer);
	bucketInfo.set([0, 0, 0, 0, 1], 0);
	bucketFloats[2] = Math.sqrt(3) * (BOX / 2);
	bucketInfo.set([capacity[0] as number, 1, 0, 1, 1], 8);
	bucketFloats[10] = Math.sqrt(3) * (BOX / 2);

	const view = lookAt([0, 6, 10], [0, 0, 0]);
	const viewProj = multiply(perspectiveReversed((60 * Math.PI) / 180, 1, 0.1, 100), view);
	const frame = new Float32Array(G.SIZE_FRAME_UNIFORM_BYTES / 4);
	frame.set(viewProj, 0);
	frame.set([0, 6, 10, 1], 16);
	const sun = [-1, -2, -1];
	const length = Math.hypot(...sun);
	frame.set([sun[0]! / length, sun[1]! / length, sun[2]! / length, 0], 20);
	frame.set([3, 3, 3, 0], 24);
	frame.set([0.4, 0.4, 0.4, 0], 28);
	// The output settings: an exposure of 1 and no tone mapping, so the 8-bit target holds the lit
	// colors encoded as sRGB.
	frame[32] = 1;
	new Uint32Array(frame.buffer)[33] = C.TONE_MAPPING_NONE;
	// Two rows of the material table, each starting with its color and opacity. The shader reads
	// nothing else of them.
	const materials = new Float32Array((2 * G.SIZE_MATERIAL_BYTES) / 4);
	materials.set([0.8, 0.1, 0.1, 1], 0);
	materials.set([0.1, 0.3, 0.9, 1], G.SIZE_MATERIAL_BYTES / 4);
	// The planes, the instance count and the view's layers, then the offset from the camera to each
	// grid cell, then the runs of the cell order. Every instance here lies in cell 0, whose zero
	// offset keeps the positions in world space, and no run is listed, so thread i culls instance i.
	const cull = new Float32Array(28 + 4 * G.SIZE_MAX_CELLS + 4 * G.SIZE_MAX_CULL_RANGES);
	cull.set(frustumPlanes(viewProj), 0);
	new Uint32Array(cull.buffer).set([positions.length, viewLayers, 0, 0], 24);
	const indirect = new Uint32Array([36, 0, 0, 0, 0, 36, 0, 0, 0, 0]);
	const mesh = boxMesh(BOX);

	const memory = new TestMemory(1 << 20, 4096);
	const blobs = {
		vertices: memory.put(mesh.vertices),
		indices: memory.put(mesh.indices),
		frame: memory.put(frame),
		materials: memory.put(materials),
		matrices: memory.put(matrices),
		instanceBuckets: memory.put(instanceBuckets),
		instanceLayers: memory.put(instanceLayers),
		buckets: memory.put(bucketInfo),
		indirect: memory.put(indirect),
		cull: memory.put(cull),
		// A one-entry table of the split-sum terms of specular light that the frame group binds:
		// the scale and bias of a smooth surface seen head on.
		dfg: memory.put(new Float32Array([1, 0, 0, 0])),
	};
	const U = {
		VERTEX: 0x20,
		INDEX: 0x10,
		UNIFORM: 0x40,
		STORAGE: 0x80,
		INDIRECT: 0x100,
		COPY_DST: 0x8,
		COPY_SRC: 0x4,
	};
	const buffers: [number, number, number, number][] = [
		[1, mesh.vertices.byteLength, U.VERTEX | U.COPY_DST, blobs.vertices],
		[2, Math.ceil(mesh.indices.byteLength / 4) * 4, U.INDEX | U.COPY_DST, blobs.indices],
		[3, frame.byteLength, U.UNIFORM | U.COPY_DST, blobs.frame],
		[4, materials.byteLength, U.STORAGE | U.COPY_DST, blobs.materials],
		[5, matrices.byteLength, U.STORAGE | U.COPY_DST, blobs.matrices],
		[6, instanceBuckets.byteLength, U.STORAGE | U.COPY_DST, blobs.instanceBuckets],
		[7, bucketInfo.byteLength, U.STORAGE | U.COPY_DST, blobs.buckets],
		[8, positions.length * INSTANCE_BYTES, U.VERTEX | U.STORAGE, -1],
		[9, indirect.byteLength, U.INDIRECT | U.STORAGE | U.COPY_DST | U.COPY_SRC, blobs.indirect],
		[10, cull.byteLength, U.UNIFORM | U.COPY_DST, blobs.cull],
		[11, instanceLayers.byteLength, U.STORAGE | U.COPY_DST, blobs.instanceLayers],
		// The cell order, which a dispatch with no runs never reads.
		[12, 4, U.STORAGE | U.COPY_DST, -1],
	];
	for (const [id, size, usage] of buffers) memory.push(G.OP_CREATE_BUFFER, id, size, usage);
	for (const [id, size, , source] of buffers)
		if (source >= 0) memory.push(G.OP_WRITE_BUFFER, id, 0, source, size);
	memory.push(
		G.OP_CREATE_TEXTURE,
		1,
		SIZE,
		SIZE,
		1,
		G.FORMAT_CANVAS,
		GPUTextureUsage.RENDER_ATTACHMENT,
		SAMPLES,
		1,
		G.VIEW_2D,
	);
	memory.push(
		G.OP_CREATE_TEXTURE,
		2,
		SIZE,
		SIZE,
		1,
		G.FORMAT_DEPTH32_FLOAT,
		GPUTextureUsage.RENDER_ATTACHMENT,
		SAMPLES,
		1,
		G.VIEW_2D,
	);
	memory.push(
		G.OP_CREATE_TEXTURE,
		3,
		1,
		1,
		1,
		G.FORMAT_RGBA32_FLOAT,
		GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		1,
		1,
		G.VIEW_2D,
	);
	memory.push(G.OP_WRITE_TEXTURE, 3, 0, 0, 0, 0, 1, 1, 1, blobs.dfg, 16);
	memory.push(
		G.OP_CREATE_RENDER_PIPELINE,
		1,
		G.TEMPLATE_INSTANCED_LIT,
		G.PERMUTATION_TONE_MAP,
		G.FORMAT_CANVAS,
		G.FORMAT_DEPTH32_FLOAT,
		SAMPLES,
		0,
		0,
	);
	memory.push(G.OP_CREATE_COMPUTE_PIPELINE, 1, G.TEMPLATE_CULL, 0);
	memory.push(
		G.OP_CREATE_BIND_GROUP,
		1,
		G.LAYOUT_FRAME,
		3,
		...[0, G.RESOURCE_BUFFER, 3, 0, 0],
		...[1, G.RESOURCE_BUFFER, 4, 0, 0],
		...[3, G.RESOURCE_TEXTURE, 3, 0, 0],
	);
	memory.push(
		G.OP_CREATE_BIND_GROUP,
		2,
		G.LAYOUT_CULL,
		8,
		...[10, 5, 6, 7, 8, 9, 11, 12].flatMap((buffer, binding) => [
			binding,
			G.RESOURCE_BUFFER,
			buffer,
			0,
			0,
		]),
	);
	memory.push(G.OP_BEGIN_BUNDLE, 1, G.FORMAT_CANVAS, G.FORMAT_DEPTH32_FLOAT, SAMPLES);
	memory.push(G.OP_SET_PIPELINE, 1);
	memory.push(G.OP_SET_BIND_GROUP, 0, 1, 0);
	memory.push(G.OP_SET_VERTEX_BUFFER, 0, 1, 0, 0);
	memory.push(G.OP_SET_INDEX_BUFFER, 2, G.INDEX_FORMAT_UINT16, 0, 0);
	for (const bucket of [0, 1]) {
		memory.push(
			G.OP_SET_VERTEX_BUFFER,
			1,
			8,
			(bucket === 0 ? 0 : (capacity[0] as number)) * INSTANCE_BYTES,
			0,
		);
		memory.push(G.OP_DRAW_INDEXED_INDIRECT, 9, bucket * 20);
	}
	memory.push(G.OP_END_BUNDLE);
	memory.push(G.OP_BEGIN_COMPUTE_PASS);
	memory.push(G.OP_SET_COMPUTE_PIPELINE, 1);
	memory.push(G.OP_SET_BIND_GROUP, 0, 2, 0);
	memory.push(G.OP_DISPATCH, 1, 1, 1);
	memory.push(G.OP_END_COMPUTE_PASS);
	const background = 0.0065;
	memory.pushFloats(G.OP_BEGIN_RENDER_PASS, [
		1,
		0,
		2,
		{ f: background },
		{ f: background },
		{ f: background },
		{ f: 1 },
		{ f: 0 },
		G.PASS_CLEAR_COLOR | G.PASS_CLEAR_DEPTH,
	]);
	memory.push(G.OP_EXECUTE_BUNDLES, 1, 1);
	memory.push(G.OP_END_RENDER_PASS);
	memory.push(G.OP_SUBMIT);

	backend.replay(memory.words, memory.floats, 0, memory.listLength, memory.buffer);

	const counts = device.createBuffer({
		size: indirect.byteLength,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	});
	const encoder = device.createCommandEncoder();
	encoder.copyBufferToBuffer(backend.buffer(9) as GPUBuffer, 0, counts, 0, indirect.byteLength);
	device.queue.submit([encoder.finish()]);
	await counts.mapAsync(GPUMapMode.READ);
	const drawn = new Uint32Array(counts.getMappedRange().slice(0));
	const pixels = await readbackWebGPU(device, target);
	return { visible: [drawn[1], drawn[6]], width: SIZE, height: SIZE, pixels: toBase64(pixels) };
});
