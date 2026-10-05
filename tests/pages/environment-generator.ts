// Makes the built-in room's environment map with the engine's generator for the GPU path that
// ?gpu= names: core WebGPU (webgpu), WebGPU in compatibility mode (compat) or WebGL2 (webgl2), or
// with ?source=<address> the map of a Radiance or OpenEXR file, which the page reads with the
// engine's readers first, as the panorama worker does. The page reads every level of every face
// back as shared-exponent texels, which the test compares with the asset tool's map. WebGL2 reads no shared-exponent texture, so there the
// generator hands each level's texels over on their way into the cube. The page also times the
// generator as the engine runs it, the whole map in one go: it first builds the pipelines in the
// background, as the engine does while a sketch loads, then makes the first map, as at load, then
// ?runs= more. Each map's time runs from the call until the GPU has finished it. Where the device
// has WebGL2's timer queries, it gives their GPU times as well.
import {
	DEPTH_SETUPS,
	programHost,
	webgl2EnvironmentGenerator,
	webgpuEnvironmentGenerator,
} from '@null3d/engine/internal';
import { ENVIRONMENT_SHADER as GLSL } from '../../packages/engine/src/generated/shaders-environment-glsl';
import { ENVIRONMENT_SHADER as WGSL } from '../../packages/engine/src/generated/shaders-environment-wgsl';
import { readPanorama } from '../../packages/engine/src/scene/panorama-files';
import type { GeneratorSource } from '../../packages/engine/src/shared/images';
import { run, toBase64 } from './lib/result';

/** The room's map: faces of 256 texels down to 8, as the engine makes it. */
const SIZE = 256;
const LEVELS = 6;

type Tier = 'webgpu' | 'compat' | 'webgl2';
const params = new URLSearchParams(location.search);
const requested = params.get('gpu');
const tier: Tier = requested === 'compat' || requested === 'webgl2' ? requested : 'webgpu';
const runs = Number(params.get('runs') ?? '0');
const file = params.get('source');

/** The largest side of a panorama on the GPU, as the engine's panorama loader sets it. */
const PANORAMA_SIDE = 8 * SIZE;

/** Bytes of the texels of a level's six faces, tightly packed. */
const levelBytes = (level: number) => 6 * (SIZE >> level) ** 2 * 4;

interface Made {
	/** Each level's six faces as shared-exponent texels, from level 0. */
	levels: Uint8Array[];
	/** Milliseconds that the generator took to build its pipelines in the background. */
	prepareTime: number;
	/**
	 * Milliseconds from each map's call to the end of the GPU's work on it: the first map, as at
	 * load, then each other.
	 */
	times: number[];
	/** Milliseconds of the thread's own time in each map's call. */
	callTimes: number[];
	/** GPU milliseconds of each map, where the device can time them. */
	gpuTimes: number[];
	errors: string[];
	core?: boolean;
}

async function makeWebGPU(source: GeneratorSource): Promise<Made> {
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
	const generator = webgpuEnvironmentGenerator(WGSL.webgpu);
	const started = performance.now();
	await generator.prepare(device);
	const prepareTime = performance.now() - started;
	const times: number[] = [];
	const callTimes: number[] = [];
	device.pushErrorScope('validation');
	for (let k = 0; k <= runs; k++) {
		const start = performance.now();
		generator.run(device, target, source);
		callTimes.push(performance.now() - start);
		await device.queue.onSubmittedWorkDone();
		times.push(performance.now() - start);
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
	return { levels, prepareTime, times, callTimes, gpuTimes: [], errors, core };
}

/** WebGL2's timer queries, which TypeScript's DOM types do not describe. */
interface TimerQuery {
	readonly TIME_ELAPSED_EXT: number;
	readonly GPU_DISJOINT_EXT: number;
}

async function makeWebGL2(source: GeneratorSource): Promise<Made> {
	const canvas = new OffscreenCanvas(1, 1);
	const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false });
	if (!gl) throw new Error('no WebGL2 context');
	const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQuery | null;
	const target = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_CUBE_MAP, target);
	gl.texStorage2D(gl.TEXTURE_CUBE_MAP, LEVELS, gl.RGB9_E5, SIZE, SIZE);
	const generator = webgl2EnvironmentGenerator(GLSL.webgl2);
	const parallel = gl.getExtension('KHR_parallel_shader_compile');
	const host = programHost(gl, DEPTH_SETUPS.reversed, parallel);
	const started = performance.now();
	await generator.prepare(host);
	const prepareTime = performance.now() - started;
	const levels = Array.from({ length: LEVELS }, (_, level) => new Uint8Array(levelBytes(level)));
	const read = (level: number, size: number) => {
		const strip = new Uint8Array(6 * size * size * 4);
		gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, strip);
		const out = levels[level] as Uint8Array;
		for (let row = 0; row < size; row++)
			for (let face = 0; face < 6; face++) {
				const from = (row * 6 + face) * size * 4;
				out.set(strip.subarray(from, from + size * 4), (face * size + row) * size * 4);
			}
	};
	/** Resolves on the next turn of the page's event loop, with no timer's least delay. */
	const turn = () =>
		new Promise<void>((resolve) => {
			const channel = new MessageChannel();
			channel.port1.onmessage = () => resolve();
			channel.port2.postMessage(0);
		});
	const make = (read?: Parameters<typeof generator.run>[5]) =>
		generator.run(host, target as WebGLTexture, SIZE, LEVELS, source, read);
	const times: number[] = [];
	const callTimes: number[] = [];
	const queries: WebGLQuery[] = [];
	// Each map runs inside a timer query, where the context has one, and its time runs until a
	// fence says that the GPU has finished it. WebGL updates a fence only between turns of the
	// event loop.
	for (let k = 0; k <= runs; k++) {
		const query = timer && gl.createQuery();
		if (timer && query) {
			gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
			queries.push(query);
		}
		const start = performance.now();
		make();
		callTimes.push(performance.now() - start);
		if (timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
		const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
		gl.flush();
		while (fence && gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) await turn();
		gl.deleteSync(fence);
		times.push(performance.now() - start);
	}
	// One more map, read back as it goes into the cube: WebGL2 reads no shared-exponent texture.
	make(read);
	const gpuTimes: number[] = [];
	for (const query of queries) {
		for (
			let wait = 0;
			!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && wait < 100;
			wait++
		)
			await new Promise((resolve) => setTimeout(resolve, 10));
		if (timer && !gl.getParameter(timer.GPU_DISJOINT_EXT))
			gpuTimes.push((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6);
	}
	const errors: string[] = [];
	for (let error = gl.getError(); error !== gl.NO_ERROR && errors.length < 8; error = gl.getError())
		errors.push(`WebGL error 0x${error.toString(16)}`);
	return { levels, prepareTime, times, callTimes, gpuTimes, errors };
}

run('environment-generator', async () => {
	let source: GeneratorSource = 'room';
	let sh: number[] = [];
	let readTime = 0;
	let gain = 1;
	if (file) {
		const bytes = await (await fetch(file)).arrayBuffer();
		const started = performance.now();
		const read = await readPanorama(bytes, PANORAMA_SIDE);
		readTime = performance.now() - started;
		source = read.panorama;
		sh = Array.from(read.sh);
		gain = read.panorama.gain;
	}
	const made = tier === 'webgl2' ? await makeWebGL2(source) : await makeWebGPU(source);
	return {
		sh,
		readTime,
		gain,
		tier: tier === 'compat' ? 'webgpu-compat' : tier,
		core: made.core,
		errors: made.errors,
		prepareTime: made.prepareTime,
		times: made.times,
		callTimes: made.callTimes,
		gpuTimes: made.gpuTimes,
		size: SIZE,
		levels: made.levels.map(toBase64),
	};
});
