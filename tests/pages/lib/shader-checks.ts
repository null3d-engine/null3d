// Compiles shaders in this browser. Each GLSL program must compile and link in WebGL2, and every
// uniform block and texture that its reflection names must be declared in its source. A driver may
// remove a declared one that the program never reads, as GLSL allows: the engine then binds nothing
// to it, and the page lists it as removed. Each WGSL module must compile in WebGPU when the browser
// has it. Failures carry the browser's info logs. A link that fails with Safari's random Metal
// fault is done once more, as the engine does, and the program is listed as linked again.
import {
	declaresUniform,
	type GlslProgram,
	METAL_FAULT,
	RELINK_TAIL,
} from '@null3d/engine/internal';
import { progress } from './result';

/** A shader that the browser rejected, with the stage and the browser's log. */
export interface ShaderFailure {
	shader: string;
	stage: string;
	log: string;
}

/** A uniform block or texture that the driver removed from a linked program. */
export interface RemovedUniform {
	shader: string;
	stage: string;
	name: string;
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

/**
 * Starts one program's compile and link without waiting for either. `tail` goes at the end of both
 * sources.
 */
function startProgram(
	gl: WebGL2RenderingContext,
	name: string,
	program: GlslProgram,
	tail = '',
): PendingProgram {
	const vertex = gl.createShader(gl.VERTEX_SHADER);
	const fragment = gl.createShader(gl.FRAGMENT_SHADER);
	if (!vertex || !fragment) throw new Error(`createShader returned null for ${name}`);
	gl.shaderSource(vertex, program.vertex.source + tail);
	gl.shaderSource(fragment, program.fragment.source + tail);
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

/** True when both stages compiled and the link failed with Safari's random Metal fault. */
function metalFault(gl: WebGL2RenderingContext, p: PendingProgram): boolean {
	return (
		gl.getShaderParameter(p.vertex, gl.COMPILE_STATUS) &&
		gl.getShaderParameter(p.fragment, gl.COMPILE_STATUS) &&
		!gl.getProgramParameter(p.linked, gl.LINK_STATUS) &&
		(gl.getProgramInfoLog(p.linked)?.includes(METAL_FAULT) ?? false)
	);
}

/** Deletes a finished program and its shaders. */
function release(gl: WebGL2RenderingContext, p: PendingProgram): void {
	gl.deleteProgram(p.linked);
	gl.deleteShader(p.vertex);
	gl.deleteShader(p.fragment);
}

/**
 * Records a finished program's failures: its compiles, its link, and each name its reflection lists
 * that its source does not declare. Declared names that the linked program lacks go to `removed`.
 */
function checkProgram(
	gl: WebGL2RenderingContext,
	{ name, program, vertex, fragment, linked }: PendingProgram,
	failures: ShaderFailure[],
	removed: RemovedUniform[],
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
		const missing = (kind: string, uniform: string) => {
			if (declaresUniform(reflection.source, uniform))
				removed.push({ shader: name, stage, name: uniform });
			else failures.push({ shader: name, stage, log: `the source declares no ${kind} ${uniform}` });
		};
		for (const block of reflection.uniformBlocks)
			if (gl.getUniformBlockIndex(linked, block.name) === gl.INVALID_INDEX)
				missing('uniform block', block.name);
		for (const texture of reflection.textures)
			if (gl.getUniformLocation(linked, texture.name) === null)
				missing('texture uniform', texture.name);
	}
}

/**
 * The programs that the page compiles at once. The driver holds each one's compiled code until the
 * page deletes it, and all of the engine's programs at once ran a low-memory tablet out of memory:
 * its browser reloaded the runner page, which opened the same page again, over and over.
 */
const BATCH = 32;

/**
 * Compiles and links GLSL programs, each with its name, a batch at a time. Programs that read the
 * draw index are skipped, with a note, when the browser lacks `WEBGL_multi_draw`. Every compile and
 * link of a batch starts before its first status read, so a driver that compiles in the background
 * works on many programs at once. Where the browser has `KHR_parallel_shader_compile`, the page
 * waits for them without blocking, so the runner page around it keeps its own clock. Programs whose
 * link met Safari's random Metal fault link once more, with the engine's comment at the end of each
 * source, and go to `relinked` with the first log. A second failure counts as a failure. Each batch
 * is checked and deleted before the next starts, and the page yields between batches, so that
 * status reads get answers without that extension too.
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
	const removed: RemovedUniform[] = [];
	const compiled = programs.filter(([name, program]) => {
		if (multiDraw || !program.vertex.source.includes('GL_ANGLE_multi_draw')) return true;
		skipped.push(`${name}: no WEBGL_multi_draw`);
		return false;
	});
	const relinked: ShaderFailure[] = [];
	for (let first = 0; first < compiled.length; first += BATCH) {
		const pending = compiled
			.slice(first, first + BATCH)
			.map(([name, program]) => startProgram(gl, name, program));
		if (parallel) await finished(gl, parallel, pending);
		const retries: PendingProgram[] = [];
		for (const p of pending) {
			if (metalFault(gl, p)) {
				relinked.push({ shader: p.name, stage: 'link', log: gl.getProgramInfoLog(p.linked) ?? '' });
				retries.push(startProgram(gl, p.name, p.program, RELINK_TAIL));
			} else {
				checkProgram(gl, p, failures, removed);
			}
			release(gl, p);
		}
		if (parallel) await finished(gl, parallel, retries);
		for (const p of retries) {
			checkProgram(gl, p, failures, removed);
			release(gl, p);
		}
		progress(
			`GLSL: ${first + pending.length} of ${compiled.length} programs checked, ${relinked.length} linked again`,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	// Read only by the test harness, to refuse a software GPU in real-GPU runs.
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
	return {
		programs: compiled.length,
		multiDraw,
		parallel: parallel !== null,
		skipped,
		removed,
		relinked,
		renderer,
	};
}

/** How many WGSL modules the page checks between the steps it notes in its trail. */
const WGSL_PROGRESS_EVERY = 20;

/** True for a WGSL module that does math in 16-bit floats, which needs `shader-f16`. */
const enablesF16 = (code: string) => /^enable f16;/m.test(code);

/**
 * Compiles WGSL modules, each with its name, when the browser has WebGPU. The modules that use
 * 16-bit floats compile where the adapter offers `shader-f16`, and count as skipped elsewhere, as
 * the engine never loads them there.
 */
export async function checkWgslModules(
	modules: readonly (readonly [string, string])[],
	failures: ShaderFailure[],
): Promise<{ webgpu: boolean; modules: number; skipped: number }> {
	const adapter = await navigator.gpu?.requestAdapter();
	if (!adapter) return { webgpu: false, modules: 0, skipped: 0 };
	const f16 = adapter.features.has('shader-f16');
	const device = await adapter.requestDevice({ requiredFeatures: f16 ? ['shader-f16'] : [] });
	let checked = 0;
	let skipped = 0;
	for (const [name, code] of modules) {
		if (!f16 && enablesF16(code)) {
			skipped++;
			continue;
		}
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
		if (checked % WGSL_PROGRESS_EVERY === 0) progress(`WGSL: ${checked} modules checked`);
	}
	device.destroy();
	return { webgpu: true, modules: checked, skipped };
}
