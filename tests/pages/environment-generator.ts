// Makes the built-in room's environment map with the engine's generator for the GPU path that
// ?gpu= names: core WebGPU (webgpu), WebGPU in compatibility mode (compat) or WebGL2 (webgl2). The
// page reads every level of every face back as shared-exponent texels, which the test compares
// with the asset tool's map of the room. WebGL2 reads no shared-exponent texture, so there the
// generator hands each level's texels over on their way into the cube. The page also times the
// generator in ?slices= slices, as the engine runs one a frame: the first map, which compiles the
// shaders, then ?runs= more, each until the GPU has finished it, then each slice of one more map on
// its own. It first builds the pipelines in the background, as the engine does before the first
// slice, and gives that time too. Where the device has WebGL2's timer queries, it gives their GPU
// times as well.
import {
	DEPTH_SETUPS,
	programHost,
	webgl2RoomGenerator,
	webgpuRoomGenerator,
} from '@null3d/engine/internal';
import { ENVIRONMENT_SHADER as GLSL } from '../../packages/engine/src/generated/shaders-environment-glsl';
import { ENVIRONMENT_SHADER as WGSL } from '../../packages/engine/src/generated/shaders-environment-wgsl';
import { run, toBase64 } from './lib/result';

/** The room's map: faces of 256 texels down to 8, as the engine makes it. */
const SIZE = 256;
const LEVELS = 6;

type Tier = 'webgpu' | 'compat' | 'webgl2';
const params = new URLSearchParams(location.search);
const requested = params.get('gpu');
const tier: Tier = requested === 'compat' || requested === 'webgl2' ? requested : 'webgpu';
const runs = Number(params.get('runs') ?? '0');
/** The slices of the work, one a frame, as the engine makes the room. */
const slices = Number(params.get('slices') ?? '32');

/** Bytes of the texels of a level's six faces, tightly packed. */
const levelBytes = (level: number) => 6 * (SIZE >> level) ** 2 * 4;

interface Made {
	/** Each level's six faces as shared-exponent texels, from level 0. */
	levels: Uint8Array[];
	/** Milliseconds that the generator took to build its pipelines in the background. */
	prepareTime: number;
	/**
	 * Milliseconds from the first slice to the end of the GPU's work on the last, each slice right
	 * after the one before: the first map, then each other.
	 */
	times: number[];
	/** Milliseconds of each slice of one more map, each until the GPU finished it. */
	sliceTimes: number[];
	/** GPU milliseconds of each map, where the device can time them. */
	gpuTimes: number[];
	/** GPU milliseconds of each slice of one more map, where the device can time them. */
	gpuSliceTimes: number[];
	errors: string[];
	core?: boolean;
}

async function makeWebGPU(): Promise<Made> {
	const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
	if (!adapter) throw new Error('no WebGPU adapter');
	const coreFeatures = 'core-features-and-limits' as GPUFeatureName;
	const wanted = tier === 'webgpu' && adapter.features.has(coreFeatures);
	const device = await adapter.requestDevice({ requiredFeatures: wanted ? [coreFeatures] : [] });
	const errors: string[] = [];
	device.addEventListener('uncapturederror', (event) => {
		errors.push((event as GPUUncapturedErrorEvent).error.message);
	});
	const target = device.createTexture({
		size: [SIZE, SIZE, 6],
		format: 'rgb9e5ufloat',
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
		mipLevelCount: LEVELS,
		textureBindingViewDimension: 'cube',
	});
	const generator = webgpuRoomGenerator(WGSL.webgpu);
	const generate = generator.run;
	const started = performance.now();
	await generator.prepare(device);
	const prepareTime = performance.now() - started;
	const times: number[] = [];
	device.pushErrorScope('validation');
	for (let k = 0; k <= runs; k++) {
		const start = performance.now();
		for (let slice = 0; slice < slices; slice++) generate(device, target, slice, slices);
		await device.queue.onSubmittedWorkDone();
		times.push(performance.now() - start);
	}
	const sliceTimes: number[] = [];
	for (let slice = 0; slice < slices; slice++) {
		const start = performance.now();
		generate(device, target, slice, slices);
		await device.queue.onSubmittedWorkDone();
		sliceTimes.push(performance.now() - start);
	}
	const validation = await device.popErrorScope();
	if (validation) errors.push(validation.message);
	const levels: Uint8Array[] = [];
	for (let level = 0; level < LEVELS; level++) {
		const side = SIZE >> level;
		const rowBytes = side * 4;
		const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
		const buffer = device.createBuffer({
			size: bytesPerRow * side * 6,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});
		const encoder = device.createCommandEncoder();
		encoder.copyTextureToBuffer(
			{ texture: target, mipLevel: level },
			{ buffer, bytesPerRow, rowsPerImage: side },
			[side, side, 6],
		);
		device.queue.submit([encoder.finish()]);
		await buffer.mapAsync(GPUMapMode.READ);
		const mapped = new Uint8Array(buffer.getMappedRange());
		const out = new Uint8Array(levelBytes(level));
		for (let row = 0; row < 6 * side; row++)
			out.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes), row * rowBytes);
		buffer.unmap();
		buffer.destroy();
		levels.push(out);
	}
	const core = device.features.has(coreFeatures);
	device.destroy();
	return { levels, prepareTime, times, sliceTimes, gpuTimes: [], gpuSliceTimes: [], errors, core };
}

/** WebGL2's timer queries, which TypeScript's DOM types do not describe. */
interface TimerQuery {
	readonly TIME_ELAPSED_EXT: number;
	readonly GPU_DISJOINT_EXT: number;
}

async function makeWebGL2(): Promise<Made> {
	const canvas = new OffscreenCanvas(1, 1);
	const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false });
	if (!gl) throw new Error('no WebGL2 context');
	const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQuery | null;
	const target = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_CUBE_MAP, target);
	gl.texStorage2D(gl.TEXTURE_CUBE_MAP, LEVELS, gl.RGB9_E5, SIZE, SIZE);
	const generator = webgl2RoomGenerator(GLSL.webgl2);
	const generate = generator.run;
	const parallel = gl.getExtension('KHR_parallel_shader_compile');
	const host = programHost(gl, DEPTH_SETUPS.reversed, parallel);
	const started = performance.now();
	await generator.prepare(host);
	const prepareTime = performance.now() - started;
	const levels = Array.from({ length: LEVELS }, (_, level) => new Uint8Array(levelBytes(level)));
	const read = (level: number, y: number, rows: number, size: number) => {
		const strip = new Uint8Array(6 * size * rows * 4);
		gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, strip);
		const out = levels[level] as Uint8Array;
		for (let row = 0; row < rows; row++)
			for (let face = 0; face < 6; face++) {
				const from = (row * 6 + face) * size * 4;
				out.set(strip.subarray(from, from + size * 4), (face * size + y + row) * size * 4);
			}
	};
	/** Resolves on the next turn of the page's event loop, with no timer's least delay. */
	const turn = () =>
		new Promise<void>((resolve) => {
			const channel = new MessageChannel();
			channel.port1.onmessage = () => resolve();
			channel.port2.postMessage(0);
		});
	/**
	 * Runs `work` inside a timer query, where the context has one, and returns the time until the
	 * GPU has finished it, from a fence. WebGL updates a fence only between turns of the event loop.
	 */
	const timed = async (work: () => void, queries: WebGLQuery[]) => {
		const query = timer && gl.createQuery();
		if (timer && query) {
			gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
			queries.push(query);
		}
		const start = performance.now();
		work();
		if (timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
		const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
		gl.flush();
		while (fence && gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) await turn();
		gl.deleteSync(fence);
		return performance.now() - start;
	};
	const make = (slice: number, read?: Parameters<typeof generate>[6]) =>
		generate(host, target as WebGLTexture, SIZE, LEVELS, slice, slices, read);
	const times: number[] = [];
	const mapQueries: WebGLQuery[] = [];
	for (let k = 0; k <= runs; k++)
		times.push(
			await timed(() => {
				for (let slice = 0; slice < slices; slice++) make(slice);
			}, mapQueries),
		);
	const sliceTimes: number[] = [];
	const sliceQueries: WebGLQuery[] = [];
	for (let slice = 0; slice < slices; slice++)
		sliceTimes.push(await timed(() => make(slice), sliceQueries));
	// One more map, read back as it goes into the cube: WebGL2 reads no shared-exponent texture.
	for (let slice = 0; slice < slices; slice++) make(slice, read);
	const results = async (queries: WebGLQuery[]) => {
		const out: number[] = [];
		for (const query of queries) {
			for (
				let wait = 0;
				!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && wait < 100;
				wait++
			)
				await new Promise((resolve) => setTimeout(resolve, 10));
			if (timer && !gl.getParameter(timer.GPU_DISJOINT_EXT))
				out.push((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6);
		}
		return out;
	};
	const gpuTimes = await results(mapQueries);
	const gpuSliceTimes = await results(sliceQueries);
	const errors: string[] = [];
	for (let error = gl.getError(); error !== gl.NO_ERROR && errors.length < 8; error = gl.getError())
		errors.push(`WebGL error 0x${error.toString(16)}`);
	return { levels, prepareTime, times, sliceTimes, gpuTimes, gpuSliceTimes, errors };
}

run('environment-generator', async () => {
	const made = tier === 'webgl2' ? await makeWebGL2() : await makeWebGPU();
	return {
		tier: tier === 'compat' ? 'webgpu-compat' : tier,
		core: made.core,
		errors: made.errors,
		slices,
		prepareTime: made.prepareTime,
		times: made.times,
		sliceTimes: made.sliceTimes,
		gpuTimes: made.gpuTimes,
		gpuSliceTimes: made.gpuSliceTimes,
		size: SIZE,
		levels: made.levels.map(toBase64),
	};
});
