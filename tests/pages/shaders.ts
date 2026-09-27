// Compiles every shader in the generated shader module in this browser. Each GLSL program must
// compile and link in WebGL2, and every uniform block and texture that the reflection names must
// exist in the linked program. Each WGSL module must compile in WebGPU when the browser has it.
// Failures carry the browser's info logs.
import { type GlslProgram, SHADERS } from '@sokko3d/engine/internal';
import { run } from './lib/result';

interface Failure {
	shader: string;
	stage: string;
	log: string;
}

/** Compiles one GLSL shader; returns null and records a failure when it does not compile. */
function compile(
	gl: WebGL2RenderingContext,
	type: GLenum,
	source: string,
	name: string,
	stage: string,
	failures: Failure[],
): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) {
		failures.push({ shader: name, stage, log: 'createShader returned null' });
		return null;
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
	failures.push({ shader: name, stage, log: gl.getShaderInfoLog(shader) ?? '' });
	gl.deleteShader(shader);
	return null;
}

/** Compiles and links one program, then looks up each name the reflection lists. */
function checkProgram(
	gl: WebGL2RenderingContext,
	name: string,
	program: GlslProgram,
	failures: Failure[],
): void {
	const vertex = compile(gl, gl.VERTEX_SHADER, program.vertex.source, name, 'vertex', failures);
	const fragment = compile(
		gl,
		gl.FRAGMENT_SHADER,
		program.fragment.source,
		name,
		'fragment',
		failures,
	);
	if (!vertex || !fragment) return;
	const linked = gl.createProgram();
	gl.attachShader(linked, vertex);
	gl.attachShader(linked, fragment);
	gl.linkProgram(linked);
	if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
		failures.push({ shader: name, stage: 'link', log: gl.getProgramInfoLog(linked) ?? '' });
	} else {
		for (const [stage, reflection] of [
			['vertex', program.vertex],
			['fragment', program.fragment],
		] as const) {
			for (const block of reflection.uniformBlocks) {
				if (gl.getUniformBlockIndex(linked, block.name) === gl.INVALID_INDEX) {
					failures.push({ shader: name, stage, log: `no uniform block ${block.name}` });
				}
			}
			for (const texture of reflection.textures) {
				if (gl.getUniformLocation(linked, texture.name) === null) {
					failures.push({ shader: name, stage, log: `no texture uniform ${texture.name}` });
				}
			}
		}
	}
	gl.deleteProgram(linked);
	gl.deleteShader(vertex);
	gl.deleteShader(fragment);
}

function checkGlsl(failures: Failure[]) {
	const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
	if (!gl) throw new Error('no WebGL2 context');
	// Extensions are requested by name; the multi-draw programs need this one enabled to compile.
	const multiDraw = gl.getExtension('WEBGL_multi_draw') !== null;
	const skipped: string[] = [];
	let programs = 0;
	for (const [shaderName, variants] of Object.entries(SHADERS)) {
		for (const [variantName, variant] of Object.entries(variants)) {
			for (const [pipeline, program] of Object.entries(variant.glsl ?? {})) {
				const name = `${shaderName}.${variantName}.${pipeline}`;
				if (!multiDraw && program.vertex.source.includes('GL_ANGLE_multi_draw')) {
					skipped.push(`${name}: no WEBGL_multi_draw`);
					continue;
				}
				checkProgram(gl, name, program, failures);
				programs++;
			}
		}
	}
	// Read only by the test harness, to refuse a software GPU in real-GPU runs.
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
	return { programs, multiDraw, skipped, renderer };
}

async function checkWgsl(failures: Failure[]): Promise<{ webgpu: boolean; modules: number }> {
	const adapter = await navigator.gpu?.requestAdapter();
	if (!adapter) return { webgpu: false, modules: 0 };
	const device = await adapter.requestDevice();
	let modules = 0;
	for (const [shaderName, variants] of Object.entries(SHADERS)) {
		for (const [variantName, variant] of Object.entries(variants)) {
			if (!variant.wgsl) continue;
			device.pushErrorScope('validation');
			const module = device.createShaderModule({ code: variant.wgsl.source });
			const info = await module.getCompilationInfo();
			const error = await device.popErrorScope();
			const messages = info.messages
				.filter((m) => m.type === 'error')
				.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`);
			if (error) messages.push(error.message);
			if (messages.length > 0) {
				failures.push({
					shader: `${shaderName}.${variantName}`,
					stage: 'wgsl',
					log: messages.join('\n'),
				});
			}
			modules++;
		}
	}
	device.destroy();
	return { webgpu: true, modules };
}

run('shaders', async () => {
	const failures: Failure[] = [];
	const glsl = checkGlsl(failures);
	const wgsl = await checkWgsl(failures);
	return {
		glslPrograms: glsl.programs,
		multiDraw: glsl.multiDraw,
		skipped: glsl.skipped,
		renderer: glsl.renderer,
		webgpu: wgsl.webgpu,
		wgslModules: wgsl.modules,
		failures,
	};
});
