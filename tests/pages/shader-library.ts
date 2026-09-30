// Runs every function of the shader library on the GPU path that ?gpu= names: core WebGPU
// (webgpu), WebGPU in compatibility mode (compat) or WebGL2 (webgl2). The library test shader
// draws one row of four rgba32uint texels per case, and the page compares the bits it reads back
// with the TypeScript references of `lib/shader-library-cases.ts`. The values are numbers, not an
// image, so the page reads them straight from the GPU objects it made. The page binds three.js's
// table of specular terms where the engine binds it, for `lighting::dfg_lut`.
import { SHADERS } from '@null3d/engine/internal';
import { DFG_SIZE, dfgTexels } from './lib/dfg-table';
import { run } from './lib/result';
import {
	allCases,
	type Case,
	compareResults,
	FUNCTIONS,
	INPUT_TEXELS,
	RESULT_VALUES,
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

const shader = SHADERS.test_library.main;
const wgsl = shader.wgsl!;
const glsl = shader.glsl!.main;

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

async function runWebGPU(input: Uint32Array, rows: number): Promise<Uint32Array> {
	const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
	if (!adapter) throw new Error('no WebGPU adapter');
	const coreFeatures = 'core-features-and-limits' as GPUFeatureName;
	const wanted = tier === 'webgpu' && adapter.features.has(coreFeatures);
	const device = await adapter.requestDevice({ requiredFeatures: wanted ? [coreFeatures] : [] });
	device.pushErrorScope('validation');
	const module = device.createShaderModule({ code: wgsl.source });
	const messages = (await module.getCompilationInfo()).messages.filter((m) => m.type === 'error');
	if (messages.length > 0)
		throw new Error(
			`WGSL: ${messages.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`,
		);
	const fragment = GPUShaderStage.FRAGMENT;
	const layout = device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: fragment, texture: { sampleType: 'uint' } },
			{ binding: 3, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
		],
	});
	const dfg = device.createTexture({
		size: [DFG_SIZE, DFG_SIZE],
		format: 'rgba32float',
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});
	device.queue.writeTexture({ texture: dfg }, dfgTexels(), { bytesPerRow: DFG_SIZE * 16 }, [
		DFG_SIZE,
		DFG_SIZE,
	]);
	const pipeline = device.createRenderPipeline({
		layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
		vertex: { module, entryPoint: wgsl.pipelines.main.vertex },
		fragment: {
			module,
			entryPoint: wgsl.pipelines.main.fragment,
			targets: [{ format: 'rgba32uint' }],
		},
	});
	const cases = device.createTexture({
		size: [CASE_TEXELS, rows],
		format: 'rgba32uint',
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});
	device.queue.writeTexture({ texture: cases }, input, { bytesPerRow: CASE_TEXELS * 16 }, [
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
	pass.setPipeline(pipeline);
	pass.setBindGroup(
		0,
		device.createBindGroup({
			layout,
			entries: [
				{ binding: 0, resource: cases.createView() },
				{ binding: 3, resource: dfg.createView() },
			],
		}),
	);
	pass.draw(3);
	pass.end();
	encoder.copyTextureToBuffer(
		{ texture: target },
		{ buffer: readback, bytesPerRow: alignedRow, rowsPerImage: rows },
		[RESULT_TEXELS, rows],
	);
	device.queue.submit([encoder.finish()]);
	const error = await device.popErrorScope();
	if (error) throw new Error(`WebGPU: ${error.message}`);
	await readback.mapAsync(GPUMapMode.READ);
	const mapped = new Uint32Array(readback.getMappedRange());
	const out = new Uint32Array(rows * RESULT_VALUES);
	const stride = alignedRow / 4;
	for (let row = 0; row < rows; row++)
		out.set(mapped.subarray(row * stride, row * stride + RESULT_VALUES), row * RESULT_VALUES);
	readback.unmap();
	device.destroy();
	return out;
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

function runWebGL2(input: Uint32Array, rows: number): Uint32Array {
	const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
	if (!gl) throw new Error('no WebGL2 context');
	const program = gl.createProgram();
	gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, glsl.vertex.source));
	gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, glsl.fragment.source));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS))
		throw new Error(`GLSL link: ${gl.getProgramInfoLog(program) ?? ''}`);
	gl.useProgram(program);

	// Integer textures are complete only with nearest filtering.
	const cases = gl.createTexture();
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, cases);
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
	// The table of specular terms goes in unit 1; its floats are read with texelFetch.
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
	for (const texture of glsl.fragment.textures)
		gl.uniform1i(gl.getUniformLocation(program, texture.name), texture.binding === 3 ? 1 : 0);

	const target = gl.createRenderbuffer();
	gl.bindRenderbuffer(gl.RENDERBUFFER, target);
	gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA32UI, RESULT_TEXELS, rows);
	const framebuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, target);
	if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
		throw new Error('the rgba32uint target is not complete');
	gl.viewport(0, 0, RESULT_TEXELS, rows);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
	// GL counts rows from the bottom, both in the fragment position and in readPixels, so row k of
	// the readback is case k, as on WebGPU.
	const out = new Uint32Array(rows * RESULT_VALUES);
	gl.readPixels(0, 0, RESULT_TEXELS, rows, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
	const error = gl.getError();
	if (error !== gl.NO_ERROR) throw new Error(`WebGL2 error ${error}`);
	gl.getExtension('WEBGL_lose_context')?.loseContext();
	return out;
}

run('shader-library', async () => {
	const cases = allCases();
	const input = inputTexels(cases);
	const bits =
		tier === 'webgl2' ? runWebGL2(input, cases.length) : await runWebGPU(input, cases.length);
	const mismatches = compareResults(cases, bits);
	return {
		tier,
		functions: FUNCTIONS.length,
		cases: cases.length,
		mismatches,
	};
});
