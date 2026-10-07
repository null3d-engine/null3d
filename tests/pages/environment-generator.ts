// Makes the built-in room's environment map with the engine's generator for the GPU path that
// ?gpu= names: core WebGPU (webgpu), WebGPU in compatibility mode (compat) or WebGL2 (webgl2). The
// page reads every level of every face back as shared-exponent texels, which the test compares
// with the asset tool's map of the room. WebGL2 reads no shared-exponent texture, so there the
// generator hands each level's texels over on their way into the cube, and the page then checks
// that the finished cube holds the same light: it draws every texel of every level into a float
// target, where the device has one, and counts the texels that differ. The page also times the
// generator as the engine runs it, the whole map in one go: it first builds the pipelines in the
// background, as the engine does while a sketch loads, then makes the first map, as at load, then
// ?runs= more. Each map's time runs from the call until the GPU has finished it. Where the device
// has WebGL2's timer queries, it gives their GPU times as well.
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
	/**
	 * On WebGL2, the texels of each level of a finished map that differ from the texels on their way
	 * into the cube; null where the device draws into no float target, and on WebGPU.
	 */
	cubeWrong: number[] | null;
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
	const started = performance.now();
	await generator.prepare(device);
	const prepareTime = performance.now() - started;
	const times: number[] = [];
	const callTimes: number[] = [];
	device.pushErrorScope('validation');
	for (let k = 0; k <= runs; k++) {
		const start = performance.now();
		generator.run(device, target);
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
	return { levels, prepareTime, times, callTimes, gpuTimes: [], cubeWrong: null, errors, core };
}

/**
 * Draws each texel of a cube level, at the texel's center with no filtering, into a float target:
 * the six faces side by side, as the generator lays them out, in the cube map table that every GPU
 * path shares.
 */
const CUBE_READ_VERTEX = `#version 300 es
void main() {
	vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;
const CUBE_READ_FRAGMENT = `#version 300 es
precision highp float;
uniform highp samplerCube cube;
uniform int size;
uniform float level;
out vec4 color;
void main() {
	ivec2 at = ivec2(gl_FragCoord.xy);
	int face = min(at.x / size, 5);
	vec2 c = (2.0 * vec2(float(at.x - face * size), float(at.y)) + 1.0) / float(size) - 1.0;
	vec3 d = vec3(-c.x, -c.y, -1.0);
	if (face == 0) d = vec3(1.0, -c.y, -c.x);
	else if (face == 1) d = vec3(-1.0, -c.y, c.x);
	else if (face == 2) d = vec3(c.x, 1.0, c.y);
	else if (face == 3) d = vec3(c.x, -1.0, -c.y);
	else if (face == 4) d = vec3(c.x, -c.y, 1.0);
	color = vec4(textureLod(cube, d, level).rgb, 1.0);
}`;

/** Reads every level of a WebGL2 cube back as linear RGBA floats, faces side by side, or null. */
function readCube(gl: WebGL2RenderingContext, cube: WebGLTexture): Float32Array[] | null {
	if (!gl.getExtension('EXT_color_buffer_float')) return null;
	const shader = (kind: number, source: string) => {
		const made = gl.createShader(kind) as WebGLShader;
		gl.shaderSource(made, source);
		gl.compileShader(made);
		return made;
	};
	const program = gl.createProgram() as WebGLProgram;
	gl.attachShader(program, shader(gl.VERTEX_SHADER, CUBE_READ_VERTEX));
	gl.attachShader(program, shader(gl.FRAGMENT_SHADER, CUBE_READ_FRAGMENT));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS))
		throw new Error(`the cube read program failed: ${gl.getProgramInfoLog(program)}`);
	const sampler = gl.createSampler();
	gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
	gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	const target = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, target);
	gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 6 * SIZE, SIZE);
	const framebuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
	gl.useProgram(program);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_CUBE_MAP, cube);
	gl.bindSampler(0, sampler);
	gl.uniform1i(gl.getUniformLocation(program, 'cube'), 0);
	const levels: Float32Array[] = [];
	for (let level = 0; level < LEVELS; level++) {
		const side = SIZE >> level;
		gl.uniform1i(gl.getUniformLocation(program, 'size'), side);
		gl.uniform1f(gl.getUniformLocation(program, 'level'), level);
		gl.viewport(0, 0, 6 * side, side);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		const texels = new Float32Array(6 * side * side * 4);
		gl.readPixels(0, 0, 6 * side, side, gl.RGBA, gl.FLOAT, texels);
		levels.push(texels);
	}
	gl.bindSampler(0, null);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.deleteFramebuffer(framebuffer);
	gl.deleteTexture(target);
	gl.deleteSampler(sampler);
	gl.deleteProgram(program);
	return levels;
}

/**
 * The texels of each level that differ between the finished cube's light, faces side by side, and
 * the shared-exponent texels on their way into it, face after face.
 */
function cubeDifferences(cube: Float32Array[], levels: Uint8Array[]): number[] {
	return cube.map((read, level) => {
		const side = SIZE >> level;
		const words = new Uint32Array((levels[level] as Uint8Array).slice().buffer);
		let wrong = 0;
		for (let face = 0; face < 6; face++)
			for (let y = 0; y < side; y++)
				for (let x = 0; x < side; x++) {
					const word = words[(face * side + y) * side + x] as number;
					const unit = 2 ** ((word >>> 27) - 24);
					const expected = [word & 511, (word >>> 9) & 511, (word >>> 18) & 511];
					const at = (y * 6 * side + face * side + x) * 4;
					const differs = expected.some(
						(m, c) => Math.abs((read[at + c] as number) - m * unit) > 1e-6 * m * unit,
					);
					if (differs) wrong++;
				}
		return wrong;
	});
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
	const make = (read?: Parameters<typeof generator.run>[4]) =>
		generator.run(host, target as WebGLTexture, SIZE, LEVELS, read);
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
	// The finished cube of the last map, then one more map, read back as it goes into the cube:
	// WebGL2 reads no shared-exponent texture. Reading the texels on their way waits for each step,
	// so only the cube of a map made without it shows a step that read texels too early.
	const cube = readCube(gl, target as WebGLTexture);
	make(read);
	const cubeWrong = cube && cubeDifferences(cube, levels);
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
	return { levels, prepareTime, times, callTimes, gpuTimes, cubeWrong, errors };
}

run('environment-generator', async () => {
	const made = tier === 'webgl2' ? await makeWebGL2() : await makeWebGPU();
	return {
		tier: tier === 'compat' ? 'webgpu-compat' : tier,
		core: made.core,
		errors: made.errors,
		prepareTime: made.prepareTime,
		times: made.times,
		callTimes: made.callTimes,
		gpuTimes: made.gpuTimes,
		cubeWrong: made.cubeWrong,
		size: SIZE,
		levels: made.levels.map(toBase64),
	};
});
