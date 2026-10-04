// Runs every function of the shader library on the GPU path that ?gpu= names: core WebGPU
// (webgpu), WebGPU in compatibility mode (compat) or WebGL2 (webgl2). The library test shader
// draws one row of four rgba32uint texels per case, and the page compares the bits it reads back
// with the TypeScript references of `lib/shader-library-cases.ts`. The values are numbers, not an
// image, so the page reads them straight from the GPU objects it made. The page binds three.js's
// table of specular terms where the engine binds it, for `lighting::dfg_lut`.
//
// The test shader has one variant per library module, and the page draws each variant over the
// rows of its module's cases. A variant that does not compile, link or build a pipeline is a
// failure that names the module and the GPU's own message, in the result and in the page's
// trail. The page still draws the other modules and compares their results.
import { type GlslProgram, SHADERS, type ShaderVariant } from '@null3d/engine/internal';
import { DFG_SIZE, dfgTexels } from './lib/dfg-table';
import { progress, run } from './lib/result';
import {
	allCases,
	type Case,
	compareResults,
	FUNCTIONS,
	INPUT_TEXELS,
	probeFault,
	RESULT_VALUES,
	TARGET_PROBE,
} from './lib/shader-library-cases';

type Tier = 'webgpu' | 'compat' | 'webgl2';
const requested = new URLSearchParams(location.search).get('gpu');
const tier: Tier = requested === 'compat' || requested === 'webgl2' ? requested : 'webgpu';

/** Texels per case in the input texture: the function number, then the inputs. */
const CASE_TEXELS = INPUT_TEXELS + 1;
/** Texels per case in the target: sixteen results, four per texel. */
const RESULT_TEXELS = RESULT_VALUES / 4;
/** WebGPU copies texture rows into buffers at offsets aligned to this many bytes. */
const COPY_ROW_ALIGNMENT = 256;

/** The test shader's variants, one per library module, by the module's name. */
const VARIANTS: [string, ShaderVariant<'main'>][] = Object.entries(SHADERS.test_library);

/** The library module of each function, by function number. */
const MODULES = FUNCTIONS.map((fn) => fn.name.slice(0, fn.name.indexOf('::')));

/** The input texture's texels: one row per case. */
function inputTexels(cases: readonly Case[]): Uint32Array {
	const texels = new Uint32Array(cases.length * CASE_TEXELS * 4);
	cases.forEach((c, row) => {
		const at = row * CASE_TEXELS * 4;
		texels[at] = c.function;
		texels.set(c.inputs.bits, at + 4);
	});
	return texels;
}

/** A module's runs of consecutive rows, each as its first row and its number of rows. */
function moduleRows(cases: readonly Case[], module: string): [number, number][] {
	const runs: [number, number][] = [];
	cases.forEach((c, row) => {
		if (MODULES[c.function] !== module) return;
		const last = runs.at(-1);
		if (last && last[0] + last[1] === row) last[1]++;
		else runs.push([row, 1]);
	});
	return runs;
}

/** The bits that the draws wrote, and the modules that could not draw, each with the reason. */
interface Drawn {
	bits: Uint32Array;
	failures: Map<string, string>;
	/** On WebGL2: the kind of storage that held the results. */
	target?: string;
	/**
	 * On WebGL2: why the device cannot hand back 32-bit results whole, from the probe of the
	 * target. The values it read back then say nothing of the library.
	 */
	deviceFault?: string;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Notes a module whose variant could not draw, in the trail and in the failures. */
function fail(failures: Map<string, string>, module: string, error: unknown): void {
	const reason = message(error);
	progress(`${module}: ${reason}`);
	failures.set(module, reason);
}

/** The kinds of GPU error that a scope catches. A pipeline that a driver cannot build is internal. */
const ERROR_FILTERS: readonly GPUErrorFilter[] = ['validation', 'internal', 'out-of-memory'];

/**
 * Runs `work` inside an error scope of each kind, and throws with every error that the scopes
 * caught or that `work` threw.
 */
async function scoped<T>(device: GPUDevice, work: () => Promise<T>): Promise<T> {
	for (const filter of ERROR_FILTERS) device.pushErrorScope(filter);
	const reasons: string[] = [];
	let value: T | undefined;
	try {
		value = await work();
	} catch (error) {
		reasons.push(message(error));
	}
	for (const _ of ERROR_FILTERS) {
		const error = await device.popErrorScope();
		if (error) reasons.push(`${error.constructor.name}: ${error.message.trim()}`);
	}
	if (reasons.length > 0) throw new Error(reasons.join('; '));
	return value as T;
}

/** Builds a module's pipeline, and throws with the compiler's or the driver's message. */
async function libraryPipeline(
	device: GPUDevice,
	layout: GPUPipelineLayout,
	module: string,
	wgsl: NonNullable<ShaderVariant<'main'>['wgsl']>,
): Promise<GPURenderPipeline> {
	const shader = device.createShaderModule({ label: module, code: wgsl.source });
	const { messages } = await shader.getCompilationInfo();
	for (const m of messages)
		progress(`${module} WGSL ${m.type} ${m.lineNum}:${m.linePos} ${m.message}`);
	if (messages.some((m) => m.type === 'error')) throw new Error('the WGSL did not compile');
	try {
		return await device.createRenderPipelineAsync({
			label: module,
			layout,
			vertex: { module: shader, entryPoint: wgsl.pipelines.main.vertex },
			fragment: {
				module: shader,
				entryPoint: wgsl.pipelines.main.fragment,
				targets: [{ format: 'rgba32uint' }],
			},
		});
	} catch (error) {
		const reason = error instanceof GPUPipelineError ? ` (${error.reason})` : '';
		throw new Error(`pipeline${reason}: ${message(error).trim()}`);
	}
}

async function runWebGPU(cases: readonly Case[], input: Uint32Array): Promise<Drawn> {
	const rows = cases.length;
	const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
	if (!adapter) throw new Error('no WebGPU adapter');
	const coreFeatures = 'core-features-and-limits' as GPUFeatureName;
	const wanted = tier === 'webgpu' && adapter.features.has(coreFeatures);
	const device = await adapter.requestDevice({ requiredFeatures: wanted ? [coreFeatures] : [] });
	void device.lost.then((lost) => progress(`device lost (${lost.reason}): ${lost.message}`));
	device.addEventListener('uncapturederror', (event) =>
		progress(`uncaptured ${event.error.constructor.name}: ${event.error.message}`),
	);
	const fragment = GPUShaderStage.FRAGMENT;
	const layout = device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: fragment, texture: { sampleType: 'uint' } },
			{ binding: 3, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
		],
	});
	const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
	const failures = new Map<string, string>();
	const pipelines: [string, GPURenderPipeline][] = [];
	for (const [module, variant] of VARIANTS) {
		try {
			const wgsl = variant.wgsl!;
			pipelines.push([
				module,
				await scoped(device, () => libraryPipeline(device, pipelineLayout, module, wgsl)),
			]);
		} catch (error) {
			fail(failures, module, error);
		}
	}

	const bits = await scoped(device, async () => {
		const dfg = device.createTexture({
			size: [DFG_SIZE, DFG_SIZE],
			format: 'rgba32float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		device.queue.writeTexture({ texture: dfg }, dfgTexels(), { bytesPerRow: DFG_SIZE * 16 }, [
			DFG_SIZE,
			DFG_SIZE,
		]);
		const inputs = device.createTexture({
			size: [CASE_TEXELS, rows],
			format: 'rgba32uint',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
		device.queue.writeTexture({ texture: inputs }, input, { bytesPerRow: CASE_TEXELS * 16 }, [
			CASE_TEXELS,
			rows,
		]);
		const target = device.createTexture({
			size: [RESULT_TEXELS, rows],
			format: 'rgba32uint',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});
		const rowBytes = RESULT_TEXELS * 16;
		const alignedRow = Math.ceil(rowBytes / COPY_ROW_ALIGNMENT) * COPY_ROW_ALIGNMENT;
		const readback = device.createBuffer({
			size: alignedRow * rows,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{ view: target.createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' },
			],
		});
		pass.setBindGroup(
			0,
			device.createBindGroup({
				layout,
				entries: [
					{ binding: 0, resource: inputs.createView() },
					{ binding: 3, resource: dfg.createView() },
				],
			}),
		);
		for (const [module, pipeline] of pipelines) {
			pass.setPipeline(pipeline);
			for (const [first, count] of moduleRows(cases, module)) {
				pass.setScissorRect(0, first, RESULT_TEXELS, count);
				pass.draw(3);
			}
		}
		pass.end();
		encoder.copyTextureToBuffer(
			{ texture: target },
			{ buffer: readback, bytesPerRow: alignedRow, rowsPerImage: rows },
			[RESULT_TEXELS, rows],
		);
		device.queue.submit([encoder.finish()]);
		await readback.mapAsync(GPUMapMode.READ);
		const mapped = new Uint32Array(readback.getMappedRange());
		const out = new Uint32Array(rows * RESULT_VALUES);
		const stride = alignedRow / 4;
		for (let row = 0; row < rows; row++)
			out.set(mapped.subarray(row * stride, row * stride + RESULT_VALUES), row * RESULT_VALUES);
		readback.unmap();
		return out;
	}).catch((error: unknown) => {
		throw new Error(`WebGPU: ${message(error)}`);
	});
	device.destroy();
	return { bits, failures };
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
	const compiled = gl.createShader(type);
	if (!compiled) throw new Error('createShader returned null');
	gl.shaderSource(compiled, source);
	gl.compileShader(compiled);
	if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS))
		throw new Error(`GLSL: ${gl.getShaderInfoLog(compiled) ?? ''}`);
	return compiled;
}

/** Links a program and makes it current, or throws with the compiler's or linker's log. */
function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
	const program = gl.createProgram();
	gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
	gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS))
		throw new Error(`GLSL link: ${gl.getProgramInfoLog(program) ?? ''}`);
	gl.useProgram(program);
	return program;
}

/** Links a module's program, makes it current, and points its samplers at their units. */
function useProgram(gl: WebGL2RenderingContext, glsl: GlslProgram): void {
	const program = linkProgram(gl, glsl.vertex.source, glsl.fragment.source);
	// The cases go in unit 0 and the table of specular terms in unit 1.
	for (const texture of glsl.fragment.textures)
		gl.uniform1i(gl.getUniformLocation(program, texture.name), texture.binding === 3 ? 1 : 0);
}

function runWebGL2(cases: readonly Case[], input: Uint32Array): Drawn {
	const rows = cases.length;
	const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
	if (!gl) throw new Error('no WebGL2 context');

	// Integer textures are complete only with nearest filtering.
	const inputs = gl.createTexture();
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, inputs);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA32UI,
		CASE_TEXELS,
		rows,
		0,
		gl.RGBA_INTEGER,
		gl.UNSIGNED_INT,
		input,
	);
	// The table of specular terms is read with texelFetch.
	const dfg = gl.createTexture();
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, dfg);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA32F,
		DFG_SIZE,
		DFG_SIZE,
		0,
		gl.RGBA,
		gl.FLOAT,
		dfgTexels(),
	);

	const { target, deviceFault } = integerTarget(gl, rows);
	gl.enable(gl.SCISSOR_TEST);
	// GL counts rows from the bottom, in the fragment position, the scissor box and readPixels, so
	// row k of the target and of the readback is case k, as on WebGPU.
	const failures = new Map<string, string>();
	for (const [module, variant] of VARIANTS) {
		try {
			useProgram(gl, variant.glsl!.main);
			for (const [first, count] of moduleRows(cases, module)) {
				gl.scissor(0, first, RESULT_TEXELS, count);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
			const error = gl.getError();
			if (error !== gl.NO_ERROR) throw new Error(`WebGL2 error ${error} after the draws`);
		} catch (error) {
			fail(failures, module, error);
		}
	}
	const bits = new Uint32Array(rows * RESULT_VALUES);
	gl.readPixels(0, 0, RESULT_TEXELS, rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, bits);
	const error = gl.getError();
	if (error !== gl.NO_ERROR) throw new Error(`WebGL2 error ${error} after the readback`);
	if (gl.isContextLost()) throw new Error('the WebGL2 context was lost');
	gl.getExtension('WEBGL_lose_context')?.loseContext();
	return { bits, failures, target, ...(deviceFault && { deviceFault }) };
}

/** A full-screen triangle, and a fragment shader that writes the probe's values from a uniform. */
const PROBE_VERTEX = `#version 300 es
void main() {
	vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;
const PROBE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform highp uvec4 probe;
layout(location = 0) out highp uvec4 color;
void main() {
	color = probe;
}`;

/** The kinds of storage that the page tries for its target, in order. */
type TargetKind = 'texture' | 'renderbuffer';
const TARGET_KINDS: readonly TargetKind[] = ['texture', 'renderbuffer'];

/** Reads the first texel of the bound target. */
function firstTexel(gl: WebGL2RenderingContext): Uint32Array {
	const texel = new Uint32Array(4);
	gl.readPixels(0, 0, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, texel);
	return texel;
}

/** Binds a framebuffer with an rgba32uint target of this kind, or throws when it is incomplete. */
function bindTarget(gl: WebGL2RenderingContext, kind: TargetKind, rows: number): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
	if (kind === 'texture') {
		// A unit of its own, as the library's programs read units 0 and 1.
		gl.activeTexture(gl.TEXTURE2);
		const texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, RESULT_TEXELS, rows);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
	} else {
		const storage = gl.createRenderbuffer();
		gl.bindRenderbuffer(gl.RENDERBUFFER, storage);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA32UI, RESULT_TEXELS, rows);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, storage);
	}
	if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
		throw new Error(`the rgba32uint ${kind} target is not complete`);
}

/**
 * Binds an rgba32uint target for the results, after a probe of its 32 bits: a clear with whole
 * numbers that use both halves of each value, read back, then a shader's write of the same numbers,
 * read back. The page takes the first kind of storage that keeps every bit. When none does, the
 * device cannot hand back the library's results whole, and `deviceFault` says what each probe read.
 * The target then is the last kind tried.
 */
function integerTarget(
	gl: WebGL2RenderingContext,
	rows: number,
): { target: TargetKind; deviceFault?: string } {
	const probe = linkProgram(gl, PROBE_VERTEX, PROBE_FRAGMENT);
	const values = new Uint32Array(TARGET_PROBE);
	gl.uniform4uiv(gl.getUniformLocation(probe, 'probe'), values);
	gl.viewport(0, 0, RESULT_TEXELS, rows);
	const faults: string[] = [];
	for (const kind of TARGET_KINDS) {
		bindTarget(gl, kind, rows);
		gl.clearBufferuiv(gl.COLOR, 0, values);
		const cleared = probeFault(`a clear of the ${kind} target`, firstTexel(gl));
		gl.clearBufferuiv(gl.COLOR, 0, [0, 0, 0, 0]);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		const drawn = probeFault(`a shader's write into the ${kind} target`, firstTexel(gl));
		gl.clearBufferuiv(gl.COLOR, 0, [0, 0, 0, 0]);
		const found = [cleared, drawn].filter((fault) => fault !== undefined);
		for (const fault of found) progress(fault);
		if (found.length === 0) return { target: kind };
		faults.push(...found);
	}
	return { target: TARGET_KINDS.at(-1)!, deviceFault: faults.join('; ') };
}

run('shader-library', async () => {
	const cases = allCases();
	const input = inputTexels(cases);
	const { bits, failures, target, deviceFault } =
		tier === 'webgl2' ? runWebGL2(cases, input) : await runWebGPU(cases, input);
	// The rows of a module that could not draw hold no results, so its failure alone reports it.
	const drawn = cases.flatMap((c, row) => (failures.has(MODULES[c.function]!) ? [] : [row]));
	const drawnBits = new Uint32Array(drawn.length * RESULT_VALUES);
	drawn.forEach((row, k) => {
		drawnBits.set(bits.subarray(row * RESULT_VALUES, (row + 1) * RESULT_VALUES), k * RESULT_VALUES);
	});
	return {
		tier,
		functions: FUNCTIONS.length,
		cases: cases.length,
		failures: [...failures].map(([module, reason]) => `${module}: ${reason}`),
		...(target && { target }),
		...(deviceFault && { deviceFault }),
		mismatches: deviceFault
			? []
			: compareResults(
					drawn.map((row) => cases[row]!),
					drawnBits,
				),
	};
});
