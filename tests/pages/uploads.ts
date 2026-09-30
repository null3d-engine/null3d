// Sends uploads of several sizes through the engine's WebGPU replay over several frames: the
// smallest and the largest through writeBuffer, the rest through the staging ring, which starts
// small, falls back to writeBuffer while it grows, then reuses its buffers. After each frame it reads
// every target buffer back and checks each byte against what that frame uploaded. It also reports
// the WebGPU errors each frame raised, which explain lost uploads.
import {
	loadWgslShaders,
	STAGING_MAX_BYTES,
	STAGING_MIN_BYTES,
	UploadRoutes,
	WebGPUBackend,
} from '@null3d/engine/internal';
import * as G from '../../packages/engine/src/generated/gpu';
import { TestMemory } from './lib/drawlist';
import { run } from './lib/result';

const KIB = 1024;
const MIB = 1024 * KIB;
/** Upload sizes: below the ring's range, three in it, and one above it. */
const SIZES = [4 * KIB, 256 * KIB, 2 * MIB, 3.5 * MIB, 5 * MIB];
const FRAMES = 6;
const USAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

/** The byte that frame `frame` uploads at `index` of upload `upload`. */
const pattern = (frame: number, upload: number, index: number) =>
	(frame * 31 + upload * 7 + index + (index >> 8)) & 255;

run('uploads', async () => {
	const adapter = await navigator.gpu?.requestAdapter();
	if (!adapter) throw new Error('no WebGPU adapter');
	const device = await adapter.requestDevice();
	const uncaptured: string[] = [];
	device.addEventListener('uncapturederror', (event) => {
		uncaptured.push((event as GPUUncapturedErrorEvent).error.message);
	});
	// Every upload in the ring's range takes the ring, whichever route this device favors.
	const shaders = await loadWgslShaders(0);
	const backend = new WebGPUBackend(
		device,
		undefined,
		'rgba8unorm',
		shaders,
		new UploadRoutes(true),
	);
	const total = SIZES.reduce((sum, size) => sum + size, 0);
	const memory = new TestMemory(total + SIZES.length * 256 + 64 * KIB, 256);
	const sources = SIZES.map((size) => memory.put(new Uint8Array(size)));

	const frames: { staged: number; uploaded: number; wrong: number[]; errors: string[] }[] = [];
	for (let frame = 0; frame < FRAMES; frame++) {
		for (const [upload, size] of SIZES.entries()) {
			const at = sources[upload] as number;
			for (let i = 0; i < size; i++) memory.bytes[at + i] = pattern(frame, upload, i);
		}
		memory.reset();
		if (frame === 0)
			for (const [upload, size] of SIZES.entries())
				memory.push(G.OP_CREATE_BUFFER, upload + 1, size, USAGE);
		for (const [upload, size] of SIZES.entries())
			memory.push(G.OP_WRITE_BUFFER, upload + 1, 0, sources[upload] as number, size);
		memory.push(G.OP_SUBMIT);
		backend.resetCounts();
		device.pushErrorScope('validation');
		device.pushErrorScope('internal');
		backend.replay(memory.words, memory.floats, 0, memory.listLength, memory.buffer);
		const errors = (await Promise.all([device.popErrorScope(), device.popErrorScope()]))
			.filter((error) => error !== null)
			.map((error) => error.message);

		const wrong: number[] = [];
		for (const [upload, size] of SIZES.entries()) {
			const target = backend.buffer(upload + 1);
			if (!target) throw new Error(`the replay made no buffer ${upload + 1}`);
			const readback = device.createBuffer({
				size,
				usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
			});
			const encoder = device.createCommandEncoder();
			encoder.copyBufferToBuffer(target, 0, readback, 0, size);
			device.queue.submit([encoder.finish()]);
			await readback.mapAsync(GPUMapMode.READ);
			const bytes = new Uint8Array(readback.getMappedRange());
			let mismatches = 0;
			for (let i = 0; i < size; i++) if (bytes[i] !== pattern(frame, upload, i)) mismatches++;
			readback.destroy();
			wrong.push(mismatches);
		}
		frames.push({
			staged: backend.counts.stagedBytes,
			uploaded: backend.counts.uploadBytes,
			wrong,
			errors,
		});
	}
	backend.destroy();
	device.destroy();
	return { sizes: SIZES, ring: [STAGING_MIN_BYTES, STAGING_MAX_BYTES], frames, uncaptured };
});
