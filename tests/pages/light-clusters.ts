// Light clustering on the GPU lists the same lights as the job workers. The fixture file holds
// cases of lights, the parameters that the core gives the GPU's light clustering pass for them, and
// the light grid that the job workers list (the render crate's tests/light_grid.rs writes it). For
// each case the page replays the pass through the engine's WebGPU backend, reads the grid back, and
// counts the grid's words that differ from the job workers'.
import { loadWgslShaders, WebGPUBackend } from '@null3d/engine/internal';
import * as G from '../../packages/engine/src/generated/gpu';
import { TestMemory } from './lib/drawlist';
import { run } from './lib/result';

/** Threads per workgroup of the light clustering shader. */
const WORKGROUP_SIZE = 128;
/** The buffers, pipelines and bind group of the pass, by the ids the page gives them. */
const PARAMS = 1;
const LIGHTS = 2;
const GRID = 3;
const GROUP = 1;
const STEPS = [G.TEMPLATE_LIGHT_COUNT, G.TEMPLATE_LIGHT_PLACE, G.TEMPLATE_LIGHT_WRITE];

/** One case of the fixture: the parameters' words, the light list's, and the grid's. */
interface Case {
	params: Uint32Array;
	lights: Uint32Array;
	expected: Uint32Array;
}

/** The fixture's cases, each part a count of words and then the words. */
function cases(words: Uint32Array): Case[] {
	let at = 1;
	const take = (wordsPer: number) => {
		const count = (words[at] as number) * wordsPer;
		const part = words.subarray(at + 1, at + 1 + count);
		at += 1 + count;
		return part;
	};
	return Array.from({ length: words[0] as number }, () => ({
		params: take(1),
		lights: take(16),
		expected: take(1),
	}));
}

/** Runs the light clustering pass over a case, and returns the grid that it fills. */
async function cluster(device: GPUDevice, backend: WebGPUBackend, c: Case): Promise<Uint32Array> {
	const [tilesX = 0, tilesY = 0, slices = 0] = c.params;
	const [, room = 0, clusters = 0] = c.params.subarray(4);
	const gridBytes = (clusters + room) * 4;
	const memory = new TestMemory(1 << 20, 4096);
	const blobs = [memory.put(c.params), memory.put(c.lights)];
	const buffers: [number, number, number][] = [
		[PARAMS, c.params.byteLength, G.BUFFER_USAGE_UNIFORM | G.BUFFER_USAGE_COPY_DST],
		[LIGHTS, Math.max(c.lights.byteLength, 64), G.BUFFER_USAGE_STORAGE | G.BUFFER_USAGE_COPY_DST],
		[GRID, gridBytes, G.BUFFER_USAGE_STORAGE | G.BUFFER_USAGE_COPY_SRC],
	];
	for (const [id, size, usage] of buffers) memory.push(G.OP_CREATE_BUFFER, id, size, usage);
	memory.push(G.OP_WRITE_BUFFER, PARAMS, 0, blobs[0] as number, c.params.byteLength);
	memory.push(G.OP_WRITE_BUFFER, LIGHTS, 0, blobs[1] as number, c.lights.byteLength);
	for (const [k, template] of STEPS.entries())
		memory.push(G.OP_CREATE_COMPUTE_PIPELINE, k + 1, template, 0);
	memory.push(
		G.OP_CREATE_BIND_GROUP,
		GROUP,
		G.LAYOUT_LIGHT_CLUSTERS,
		buffers.length,
		...buffers.flatMap(([id], binding) => [binding, G.RESOURCE_BUFFER, id, 0, 0]),
	);
	const tiles = Math.ceil((tilesX * tilesY) / WORKGROUP_SIZE);
	memory.push(G.OP_BEGIN_COMPUTE_PASS);
	memory.push(G.OP_SET_BIND_GROUP, 0, GROUP, 0);
	for (const [k, template] of STEPS.entries()) {
		memory.push(G.OP_SET_COMPUTE_PIPELINE, k + 1);
		if (template === G.TEMPLATE_LIGHT_PLACE) memory.push(G.OP_DISPATCH, 1, 1, 1);
		else memory.push(G.OP_DISPATCH, tiles, slices, 1);
	}
	memory.push(G.OP_END_COMPUTE_PASS);
	memory.push(G.OP_SUBMIT);
	backend.replay(memory.words, memory.floats, 0, memory.listLength, memory.buffer);

	const read = device.createBuffer({
		size: gridBytes,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	});
	const encoder = device.createCommandEncoder();
	encoder.copyBufferToBuffer(backend.buffer(GRID) as GPUBuffer, 0, read, 0, gridBytes);
	device.queue.submit([encoder.finish()]);
	await read.mapAsync(GPUMapMode.READ);
	const grid = new Uint32Array(read.getMappedRange().slice(0));
	read.destroy();
	return grid;
}

run('light-clusters', async () => {
	const adapter = await navigator.gpu?.requestAdapter();
	if (!adapter) throw new Error('no WebGPU adapter');
	const device = await adapter.requestDevice();
	const response = await fetch('../fixtures/light-clusters.bin');
	if (!response.ok) throw new Error(`the fixture did not load: ${response.status}`);
	const fixture = new Uint32Array(await response.arrayBuffer());
	const shaders = await loadWgslShaders(0);
	const backend = new WebGPUBackend(device, undefined, 'rgba8unorm', shaders);
	const results = [];
	for (const c of cases(fixture)) {
		const grid = await cluster(device, backend, c);
		let differing = 0;
		let first = -1;
		for (const [i, word] of c.expected.entries())
			if (grid[i] !== word) {
				differing++;
				if (first < 0) first = i;
			}
		results.push({
			lights: c.lights.length / 16,
			words: c.expected.length,
			differing,
			// The first word that differs, the GPU's value and the job workers'.
			first: first < 0 ? null : [first, grid[first], c.expected[first]],
		});
	}
	return { cases: results };
});
