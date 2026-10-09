// Times each stage of a sky map with the engine's generator for the GPU path that ?gpu= names:
// core WebGPU (webgpu), WebGPU in compatibility mode (compat) or WebGL2 (webgl2). The page builds
// the pipelines in the background, as the engine does, fills the map once whole, as at load, then
// refreshes it ?runs= times with a sun that moves, one stage at a time, as frames do. Each stage's
// time runs from its call until the GPU has finished it, on a queue with no other work; WebGL2
// also gives its timer queries' GPU times. On WebGPU the page then reads the map back, and makes
// the same sky again with ?reference=<directions> filter directions and 16 x 16 chain directions,
// as a file's map would take, so the test can compare the two.
import {
	DEPTH_SETUPS,
	programHost,
	webgl2EnvironmentGenerator,
	webgpuEnvironmentGenerator,
} from '@null3d/engine/internal';
import { ENVIRONMENT_SHADER as GLSL } from '../../packages/engine/src/generated/shaders-environment-glsl';
import { ENVIRONMENT_SHADER as WGSL } from '../../packages/engine/src/generated/shaders-environment-wgsl';
import { GpuMemory } from '../../packages/engine/src/gpu/memory';
import { SKY_MAP } from '../../packages/engine/src/scene/builtin-environments';
import { run, toBase64 } from './lib/result';

/** A sky map: faces of 256 texels down to 8, as the engine makes it, and its stages. */
const { size: SIZE, levels: LEVELS, stages: STAGES } = SKY_MAP;

type Tier = 'webgpu' | 'compat' | 'webgl2';
const params = new URLSearchParams(location.search);
const requested = params.get('gpu');
const tier: Tier = requested === 'compat' || requested === 'webgl2' ? requested : 'webgpu';
const runs = Number(params.get('runs') ?? '8');
const reference = Number(params.get('reference') ?? '1024');
/** The sky map's own filter, or ?samples= and ?chain= in its place, to weigh other counts. */
const ours = params.has('samples')
	? { samples: Number(params.get('samples')), chainSamples: Number(params.get('chain') ?? '4') }
	: undefined;

/** The sky's 16 settings with its sun at `elevation` radians, toward -Z turned by `turn`. */
function settings(elevation: number, turn: number): Float32Array {
	const sun = [
		Math.sin(turn) * Math.cos(elevation),
		Math.sin(elevation),
		-Math.cos(turn) * Math.cos(elevation),
	];
	return Float32Array.of(...sun, 0, 2.5, 1.2, 0.005, 0.8, 0.0002, 0.00002, 0.4, 0.4, 0.5, 0, 0, 0);
}

/**
 * A sky map's stage command, as the draw list holds it: its words and its floats, one memory. Its
 * texture and generator words go unread here.
 */
function command(stage: number, sky: Float32Array): [Uint32Array, Float32Array] {
	const words = new Uint32Array(19);
	const floats = new Float32Array(words.buffer);
	words[2] = stage;
	floats.set(sky, 3);
	return [words, floats];
}

interface Timed {
	/** Milliseconds of the first fill, every stage at once, from the call to the GPU's end. */
	fill: number;
	/** Milliseconds of each refresh's stages, by stage, from each call to the GPU's end. */
	stages: number[][];
	/** WebGL2's GPU milliseconds of each refresh's stages, by stage, where it can time them. */
	gpuStages: number[][];
	prepareTime: number;
	errors: string[];
	/** On WebGPU, the map's levels and the reference's, as shared-exponent texels. */
	levels?: Uint8Array[];
	referenceLevels?: Uint8Array[];
}

/** Each level's six faces of a WebGPU cube as shared-exponent texels, face after face. */
async function readLevels(device: GPUDevice, target: GPUTexture): Promise<Uint8Array[]> {
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
		const out = new Uint8Array(6 * side * rowBytes);
		for (let row = 0; row < 6 * side; row++)
			out.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes), row * rowBytes);
		buffer.unmap();
		buffer.destroy();
		levels.push(out);
	}
	return levels;
}

async function timeWebGPU(): Promise<Timed> {
	const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
	if (!adapter) throw new Error('no WebGPU adapter');
	const coreFeatures = 'core-features-and-limits' as GPUFeatureName;
	const wanted = tier === 'webgpu' && adapter.features.has(coreFeatures);
	const device = await adapter.requestDevice({ requiredFeatures: wanted ? [coreFeatures] : [] });
	const errors: string[] = [];
	device.addEventListener('uncapturederror', (event) => {
		errors.push((event as GPUUncapturedErrorEvent).error.message);
	});
	const cube = () =>
		device.createTexture({
			size: [SIZE, SIZE, 6],
			format: 'rgb9e5ufloat',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
			mipLevelCount: LEVELS,
			textureBindingViewDimension: 'cube',
		});
	const memory = new GpuMemory();
	const generator = webgpuEnvironmentGenerator(WGSL.webgpu, ours);
	const started = performance.now();
	await generator.prepare(device);
	const prepareTime = performance.now() - started;
	const target = cube();
	const stage = async (k: number, sky: Float32Array) => {
		const start = performance.now();
		const encoder = device.createCommandEncoder();
		generator.skyStage(device, encoder, target, ...command(k, sky), 0, memory);
		device.queue.submit([encoder.finish()]);
		await device.queue.onSubmittedWorkDone();
		return performance.now() - start;
	};
	const sky = settings(0.6, 0);
	let start = performance.now();
	const encoder = device.createCommandEncoder();
	for (let k = 0; k < STAGES; k++)
		generator.skyStage(device, encoder, target, ...command(k, sky), 0, memory);
	device.queue.submit([encoder.finish()]);
	await device.queue.onSubmittedWorkDone();
	const fill = performance.now() - start;
	const stages: number[][] = Array.from({ length: STAGES }, () => []);
	for (let r = 0; r < runs; r++) {
		const moved = settings(0.6 - 0.05 * (r + 1), 0.1 * r);
		for (let k = 0; k < STAGES; k++) stages[k]?.push(await stage(k, moved));
	}
	// The last sky again, filtered as a file's map is, for the comparison.
	const last = settings(0.6 - 0.05 * runs, 0.1 * (runs - 1));
	start = performance.now();
	const levels = await readLevels(device, target);
	const fine = webgpuEnvironmentGenerator(WGSL.webgpu, { samples: reference, chainSamples: 16 });
	await fine.prepare(device);
	const exact = cube();
	const fineEncoder = device.createCommandEncoder();
	for (let k = 0; k < STAGES; k++)
		fine.skyStage(device, fineEncoder, exact, ...command(k, last), 0, memory);
	device.queue.submit([fineEncoder.finish()]);
	const referenceLevels = await readLevels(device, exact);
	generator.release(target, memory);
	fine.release(exact, memory);
	device.destroy();
	return { fill, stages, gpuStages: [], prepareTime, errors, levels, referenceLevels };
}

/** WebGL2's timer queries, which TypeScript's DOM types do not describe. */
interface TimerQuery {
	readonly TIME_ELAPSED_EXT: number;
	readonly GPU_DISJOINT_EXT: number;
}

async function timeWebGL2(): Promise<Timed> {
	const canvas = new OffscreenCanvas(1, 1);
	const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false });
	if (!gl) throw new Error('no WebGL2 context');
	const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQuery | null;
	const target = gl.createTexture() as WebGLTexture;
	gl.bindTexture(gl.TEXTURE_CUBE_MAP, target);
	gl.texStorage2D(gl.TEXTURE_CUBE_MAP, LEVELS, gl.RGB9_E5, SIZE, SIZE);
	gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
	const generator = webgl2EnvironmentGenerator(GLSL.webgl2);
	const host = programHost(
		gl,
		DEPTH_SETUPS.reversed,
		gl.getExtension('KHR_parallel_shader_compile'),
	);
	const memory = new GpuMemory();
	const started = performance.now();
	await generator.prepare(host);
	const prepareTime = performance.now() - started;
	/** Resolves on the next turn of the page's event loop. */
	const turn = () =>
		new Promise<void>((resolve) => {
			const channel = new MessageChannel();
			channel.port1.onmessage = () => resolve();
			channel.port2.postMessage(0);
		});
	const queries: [number, WebGLQuery][] = [];
	/** Runs stages `first` to `last`, and gives the time from the call until the GPU finished. */
	const timed = async (first: number, last: number, sky: Float32Array) => {
		const query = timer && gl.createQuery();
		if (timer && query) {
			gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
			if (first === last) queries.push([first, query]);
		}
		const start = performance.now();
		for (let k = first; k <= last; k++)
			generator.skyStage(host, target, SIZE, LEVELS, ...command(k, sky), 0, memory);
		if (timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
		const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
		gl.flush();
		while (fence && gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) await turn();
		gl.deleteSync(fence);
		return performance.now() - start;
	};
	const fill = await timed(0, STAGES - 1, settings(0.6, 0));
	const stages: number[][] = Array.from({ length: STAGES }, () => []);
	for (let r = 0; r < runs; r++) {
		const moved = settings(0.6 - 0.05 * (r + 1), 0.1 * r);
		for (let k = 0; k < STAGES; k++) stages[k]?.push(await timed(k, k, moved));
	}
	const gpuStages: number[][] = Array.from({ length: STAGES }, () => []);
	for (const [k, query] of queries) {
		for (
			let wait = 0;
			!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && wait < 100;
			wait++
		)
			await new Promise((resolve) => setTimeout(resolve, 10));
		if (timer && !gl.getParameter(timer.GPU_DISJOINT_EXT))
			gpuStages[k]?.push((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6);
	}
	const errors: string[] = [];
	for (let error = gl.getError(); error !== gl.NO_ERROR && errors.length < 8; error = gl.getError())
		errors.push(`WebGL error 0x${error.toString(16)}`);
	generator.release(gl, target, memory);
	return { fill, stages, gpuStages, prepareTime, errors };
}

run('sky-map-cost', async () => {
	const timed = tier === 'webgl2' ? await timeWebGL2() : await timeWebGPU();
	return {
		tier: tier === 'compat' ? 'webgpu-compat' : tier,
		...timed,
		levels: timed.levels?.map(toBase64),
		referenceLevels: timed.referenceLevels?.map(toBase64),
	};
});
