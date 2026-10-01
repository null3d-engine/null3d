// Compiles shaders in this browser. Each GLSL program must compile and link in WebGL2, and every
// uniform block and texture that its reflection names must exist in the linked program. Each WGSL
// module must compile in WebGPU when the browser has it. Failures carry the browser's info logs.
import type { GlslProgram } from '@null3d/engine/internal';
import { progress } from './result';

/** A shader that the browser rejected, with the stage and the browser's log. */
export interface ShaderFailure {
	shader: string;
	stage: string;
	log: string;
}

/** A program whose compile and link the driver may still run. */
interface PendingProgram {
	name: string;
	program: GlslProgram;
	vertex: WebGLShader;
	fragment: WebGLShader;
	linked: WebGLProgram;
}

/** The time between two reads of the programs' completion status. */
const POLL_MS = 10;

/** Starts one program's compile and link without waiting for either. */
function startProgram(
	gl: WebGL2RenderingContext,
	name: string,
	program: GlslProgram,
): PendingProgram {
	const vertex = gl.createShader(gl.VERTEX_SHADER);
	const fragment = gl.createShader(gl.FRAGMENT_SHADER);
	if (!vertex || !fragment) throw new Error(`createShader returned null for ${name}`);
	gl.shaderSource(vertex, program.vertex.source);
	gl.shaderSource(fragment, program.fragment.source);
	gl.compileShader(vertex);
	gl.compileShader(fragment);
	const linked = gl.createProgram();
	gl.attachShader(linked, vertex);
	gl.attachShader(linked, fragment);
	gl.linkProgram(linked);
	return { name, program, vertex, fragment, linked };
}

/**
 * Waits, without blocking the page, until the driver has finished every program. A status read
 * before then blocks the page until that program is done.
 */
async function finished(
	gl: WebGL2RenderingContext,
	parallel: KHR_parallel_shader_compile,
	pending: readonly PendingProgram[],
): Promise<void> {
	let next = 0;
	while (next < pending.length) {
		const linked = pending[next]?.linked;
		if (linked && gl.getProgramParameter(linked, parallel.COMPLETION_STATUS_KHR) !== true) {
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		} else {
			next++;
		}
	}
}

/** Records a finished program's failures: its compiles, its link, and each name its reflection lists. */
function checkProgram(
	gl: WebGL2RenderingContext,
	{ name, program, vertex, fragment, linked }: PendingProgram,
	failures: ShaderFailure[],
): void {
	let compiled = true;
	for (const [stage, shader] of [
		['vertex', vertex],
		['fragment', fragment],
	] as const) {
		if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) continue;
		compiled = false;
		failures.push({ shader: name, stage, log: gl.getShaderInfoLog(shader) ?? '' });
	}
	if (!compiled) return;
	if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
		failures.push({ shader: name, stage: 'link', log: gl.getProgramInfoLog(linked) ?? '' });
		return;
	}
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

/**
 * Compiles and links GLSL programs, each with its name. Programs that read the draw index are
 * skipped, with a note, when the browser lacks `WEBGL_multi_draw`. Every compile and link starts
 * before the first status read, so a driver that compiles in the background works on many programs
 * at once. Where the browser has `KHR_parallel_shader_compile`, the page waits for them without
 * blocking, so the runner page around it keeps its own clock.
 */
export async function checkGlslPrograms(
	programs: readonly (readonly [string, GlslProgram])[],
	failures: ShaderFailure[],
) {
	const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
	if (!gl) throw new Error('no WebGL2 context');
	// Extensions are requested by name; the multi-draw programs need this one enabled to compile.
	const multiDraw = gl.getExtension('WEBGL_multi_draw') !== null;
	const parallel = gl.getExtension('KHR_parallel_shader_compile');
	const skipped: string[] = [];
	const pending: PendingProgram[] = [];
	for (const [name, program] of programs) {
		if (!multiDraw && program.vertex.source.includes('GL_ANGLE_multi_draw')) {
			skipped.push(`${name}: no WEBGL_multi_draw`);
			continue;
		}
		pending.push(startProgram(gl, name, program));
	}
	progress(`GLSL: ${pending.length} programs started`);
	if (parallel) await finished(gl, parallel, pending);
	for (const p of pending) {
		checkProgram(gl, p, failures);
		gl.deleteProgram(p.linked);
		gl.deleteShader(p.vertex);
		gl.deleteShader(p.fragment);
	}
	progress(`GLSL: ${pending.length} programs checked`);
	// Read only by the test harness, to refuse a software GPU in real-GPU runs.
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
	return { programs: pending.length, multiDraw, parallel: parallel !== null, skipped, renderer };
}

/** Compiles WGSL modules, each with its name, when the browser has WebGPU. */
export async function checkWgslModules(
	modules: readonly (readonly [string, string])[],
	failures: ShaderFailure[],
): Promise<{ webgpu: boolean; modules: number }> {
	const adapter = await navigator.gpu?.requestAdapter();
	if (!adapter) return { webgpu: false, modules: 0 };
	const device = await adapter.requestDevice();
	let checked = 0;
	for (const [name, code] of modules) {
		device.pushErrorScope('validation');
		const module = device.createShaderModule({ code });
		const info = await module.getCompilationInfo();
		const error = await device.popErrorScope();
		const messages = info.messages
			.filter((m) => m.type === 'error')
			.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`);
		if (error) messages.push(error.message);
		if (messages.length > 0)
			failures.push({ shader: name, stage: 'wgsl', log: messages.join('\n') });
		checked++;
	}
	device.destroy();
	return { webgpu: true, modules: checked };
}
