// Makes the built-in room's environment map with the engine's generator for the GPU path that
// ?gpu= names: core WebGPU (webgpu), WebGPU in compatibility mode (compat) or WebGL2 (webgl2). The
// page reads every level of every face back as shared-exponent texels, which the test compares
// with the asset tool's map of the room. WebGL2 reads no shared-exponent texture, so there the
// generator hands each level's texels over on their way into the cube. The page also times the
// generator: the first map, which compiles the shaders, then ?runs= more, each until the GPU has
// finished it. Where the device has WebGL2's timer queries, it gives their GPU times too.
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

/** Bytes of the texels of a level's six faces, tightly packed. */
const levelBytes = (level: number) => 6 * (SIZE >> level) ** 2 * 4;

interface Made {
	/** Each level's six faces as shared-exponent texels, from level 0. */
	levels: Uint8Array[];
	/** Milliseconds from the call to the end of the GPU's work: the first map, then each other. */
	times: number[];
	/** GPU milliseconds of each map, where the device can time them. */
	gpuTimes: number[];
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
	const generate = webgpuRoomGenerator(WGSL.webgpu);
	const times: number[] = [];
	for (let k = 0; k <= runs; k++) {
		const start = performance.now();
		device.pushErrorScope('validation');
		generate(device, target);
		const validation = await device.popErrorScope();
		if (validation) errors.push(validation.message);
		await device.queue.onSubmittedWorkDone();
		times.push(performance.now() - start);
	}
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
	return { levels, times, gpuTimes: [], errors, core };
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
	const generate = webgl2RoomGenerator(GLSL.webgl2);
	const host = programHost(gl, DEPTH_SETUPS.reversed);
	const levels = Array.from({ length: LEVELS }, (_, level) => new Uint8Array(levelBytes(level)));
	const read = (face: number, level: number, size: number) => {
		const bytes = size * size * 4;
		const out = levels[level] as Uint8Array;
		gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out.subarray(face * bytes, (face + 1) * bytes));
	};
	const pixel = new Uint8Array(4);
	const times: number[] = [];
	const queries: WebGLQuery[] = [];
	for (let k = 0; k <= runs; k++) {
		const query = timer && gl.createQuery();
		if (timer && query) {
			gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
			queries.push(query);
		}
		const start = performance.now();
		generate(host, target as WebGLTexture, SIZE, LEVELS);
		if (timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
		// A pixel read into the page's memory waits for the GPU to finish what came before.
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
		times.push(performance.now() - start);
	}
	// One more map, read back as it goes into the cube: WebGL2 reads no shared-exponent texture.
	generate(host, target as WebGLTexture, SIZE, LEVELS, read);
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
	return { levels, times, gpuTimes, errors };
}

run('environment-generator', async () => {
	const made = tier === 'webgl2' ? await makeWebGL2() : await makeWebGPU();
	return {
		tier: tier === 'compat' ? 'webgpu-compat' : tier,
		core: made.core,
		errors: made.errors,
		times: made.times,
		gpuTimes: made.gpuTimes,
		size: SIZE,
		levels: made.levels.map(toBase64),
	};
});
