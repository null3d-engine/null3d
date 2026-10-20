// The ambient occlusion probe's worker: the engine draws WebGL2 from a worker, so a page that shows
// the fault must draw from one too. It receives the transferred canvas, runs the chain with the
// engine's own shaders, and posts the figures back for the page to publish.
import { SHADERS } from '../../../packages/engine/src/generated/shaders-ao-glsl.js';

interface Start {
	canvas: OffscreenCanvas;
	width: number;
	height: number;
	aoScale: number;
	mode: string;
	/** True when each frame draws to the canvas, as an engine's final pass does. */
	present: boolean;
	/** How many copies the opaque pass draws into the scene's colour, as an engine's scene does. */
	opaque: number;
	/** True for a multisampled canvas, as an engine's canvas is when it draws with MSAA. */
	msaa: boolean;
	/** The engine asks for the high-performance GPU; other pages may take the default one. */
	highPerformance: boolean;
}

interface Shader {
	vertex: { source: string };
	fragment: { source: string };
}

type Program = { program: WebGLProgram; samplers: [number, WebGLUniformLocation][] };

const WARM_UP = 60;
const MEASURED = 120;
const ROUNDS = 3;

let gl: WebGL2RenderingContext | null = null;
let width = 1;
let height = 1;
let drawnW = 1;
let drawnH = 1;
let mode = 'ao';
let copyFbo: WebGLFramebuffer | null = null;
let horizonFbo: WebGLFramebuffer | null = null;
let denoiseFbo: WebGLFramebuffer | null = null;
let sceneFbo: WebGLFramebuffer | null = null;
let sceneDepth: WebGLTexture | null = null;
let copy: WebGLTexture | null = null;
let horizon: WebGLTexture | null = null;
let denoise: WebGLTexture | null = null;
let ubo: WebGLBuffer | null = null;
let scene: WebGLProgram | null = null;
let present = true;
let presentProgram: WebGLProgram | null = null;
let opaqueProgram: WebGLProgram | null = null;
let opaqueFbo: WebGLFramebuffer | null = null;
let sceneColour: WebGLTexture | null = null;
let opaqueVao: WebGLVertexArrayObject | null = null;
let opaqueCount = 0;
let programs: Record<'depth' | 'horizon' | 'denoise', Program> | null = null;
const trail: string[] = [];

const glsl = (
	SHADERS as unknown as {
		ao: { webgl2: { glsl: Record<'depth' | 'horizon' | 'denoise', Shader> } };
	}
).ao.webgl2.glsl;

function note(step: string): void {
	trail.push(step);
}

function compile(kind: 'vertex' | 'fragment', source: string): WebGLShader {
	const shader = gl!.createShader(kind === 'vertex' ? gl!.VERTEX_SHADER : gl!.FRAGMENT_SHADER);
	if (!shader) throw new Error('no shader');
	gl!.shaderSource(shader, source);
	gl!.compileShader(shader);
	if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
		throw new Error(`${kind} shader did not compile: ${gl!.getShaderInfoLog(shader)}`);
	}
	return shader;
}

function program([vertex, fragment]: [Shader['vertex'], Shader['fragment']]): Program {
	const made = gl!.createProgram();
	if (!made) throw new Error('no program');
	gl!.attachShader(made, compile('vertex', vertex.source));
	gl!.attachShader(made, compile('fragment', fragment.source));
	gl!.linkProgram(made);
	if (!gl!.getProgramParameter(made, gl!.LINK_STATUS)) {
		throw new Error(`program did not link: ${gl!.getProgramInfoLog(made)}`);
	}
	gl!.uniformBlockBinding(made, gl!.getUniformBlockIndex(made, 'Settings_block_0Fragment'), 0);
	const samplers: [number, WebGLUniformLocation][] = [];
	for (const unit of [1, 2, 3]) {
		const at = gl!.getUniformLocation(made, `_group_0_binding_${unit}_fs`);
		if (at) samplers.push([unit, at]);
	}
	return { program: made, samplers };
}

function texture(
	format: 'depth' | 'r32f' | 'rgba16f',
	size: 'full' | 'half' = 'half',
): WebGLTexture {
	const made = gl!.createTexture();
	gl!.bindTexture(gl!.TEXTURE_2D, made);
	if (format === 'depth') {
		gl!.texStorage2D(gl!.TEXTURE_2D, 1, gl!.DEPTH_COMPONENT32F, width, height);
	} else {
		const w = size === 'full' ? width : Math.ceil(width / 2);
		const h = size === 'full' ? height : Math.ceil(height / 2);
		gl!.texStorage2D(gl!.TEXTURE_2D, 1, format === 'r32f' ? gl!.R32F : gl!.RGBA16F, w, h);
	}
	gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
	gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
	gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
	gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
	return made;
}

function target(attachment: WebGLTexture): WebGLFramebuffer {
	const made = gl!.createFramebuffer();
	gl!.bindFramebuffer(gl!.FRAMEBUFFER, made);
	gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, attachment, 0);
	if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) {
		throw new Error('a target is incomplete');
	}
	return made;
}

/** Draws the synthetic scene depth: a smooth field across the whole render size. */
function sceneProgram(): WebGLProgram {
	const vertex = `#version 300 es
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
	const fragment = `#version 300 es
precision highp float;
void main() {
	vec2 p = gl_FragCoord.xy;
	gl_FragDepth = 0.5 + 0.3 * (0.5 + 0.5 * sin(p.x * 0.05)) * (0.5 + 0.5 * sin(p.y * 0.07));
}`;
	const made = gl!.createProgram();
	if (!made) throw new Error('no scene program');
	gl!.attachShader(made, compile('vertex', vertex));
	gl!.attachShader(made, compile('fragment', fragment));
	gl!.linkProgram(made);
	if (!gl!.getProgramParameter(made, gl!.LINK_STATUS)) throw new Error('scene link failed');
	return made;
}

/** The program that draws a full-screen pattern to the canvas, as a final pass draws its picture. */
function presentShaders(): WebGLProgram {
	const vertex = `#version 300 es
void main() {
	vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
	const fragment = `#version 300 es
precision highp float;
out vec4 color;
void main() {
	vec2 p = gl_FragCoord.xy;
	float a = 0.5 + 0.5 * sin(p.x * 0.01) * cos(p.y * 0.013);
	color = vec4(a, 0.35 + 0.3 * a, 0.6 - 0.2 * a, 1.0);
}`;
	const made = gl!.createProgram();
	if (!made) throw new Error('no present program');
	gl!.attachShader(made, compile('vertex', vertex));
	gl!.attachShader(made, compile('fragment', fragment));
	gl!.linkProgram(made);
	if (!gl!.getProgramParameter(made, gl!.LINK_STATUS)) throw new Error('present link failed');
	return made;
}

/** The program and the copies of the scene's opaque pass: many small quads at full render size. */
function opaqueSetup(count: number): void {
	const vertex = `#version 300 es
layout(location = 0) in vec2 center;
out vec2 local;
void main() {
	vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
	local = p;
	gl_Position = vec4(center + (p * 2.0 - 1.0) * 0.02, 0.0, 1.0);
}`;
	const fragment = `#version 300 es
precision highp float;
in vec2 local;
out vec4 color;
void main() { color = vec4(local, 0.5, 1.0); }`;
	const made = gl!.createProgram();
	if (!made) throw new Error('no opaque program');
	gl!.attachShader(made, compile('vertex', vertex));
	gl!.attachShader(made, compile('fragment', fragment));
	gl!.linkProgram(made);
	if (!gl!.getProgramParameter(made, gl!.LINK_STATUS)) throw new Error('opaque link failed');
	opaqueProgram = made;
	const centers = new Float32Array(count * 2);
	for (let i = 0; i < count; i++) {
		centers[i * 2] = ((i * 0.618) % 1) * 1.8 - 0.9;
		centers[i * 2 + 1] = ((i * 0.414) % 1) * 1.8 - 0.9;
	}
	opaqueVao = gl!.createVertexArray();
	gl!.bindVertexArray(opaqueVao);
	const buffer = gl!.createBuffer();
	gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
	gl!.bufferData(gl!.ARRAY_BUFFER, centers, gl!.STATIC_DRAW);
	gl!.enableVertexAttribArray(0);
	gl!.vertexAttribPointer(0, 2, gl!.FLOAT, false, 0, 0);
	gl!.vertexAttribDivisor(0, 1);
	gl!.bindVertexArray(null);
	opaqueCount = count;
}

function setup({
	canvas,
	width: w,
	height: h,
	aoScale,
	mode: m,
	present: p,
	opaque: o,
	msaa,
	highPerformance,
}: Start): string[] {
	const failures: string[] = [];
	width = w;
	height = h;
	mode = m;
	present = p;
	drawnW = Math.max(1, Math.round(width * aoScale));
	drawnH = Math.max(1, Math.round(height * aoScale));
	gl = canvas.getContext('webgl2', {
		alpha: false,
		antialias: msaa,
		depth: false,
		preserveDrawingBuffer: false,
		...(highPerformance ? { powerPreference: 'high-performance' as const } : {}),
	}) as WebGL2RenderingContext | null;
	if (!gl) throw new Error('the worker has no WebGL2');
	if (!gl.getExtension('EXT_color_buffer_float')) failures.push('EXT_color_buffer_float is missing');
	programs = {
		depth: program([glsl.depth.vertex, glsl.depth.fragment]),
		horizon: program([glsl.horizon.vertex, glsl.horizon.fragment]),
		denoise: program([glsl.denoise.vertex, glsl.denoise.fragment]),
	};
	scene = sceneProgram();
	presentProgram = presentShaders();
	sceneColour = texture('rgba16f', 'full');
	opaqueFbo = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, opaqueFbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneColour, 0);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, sceneDepth ?? null, 0);
	if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
		throw new Error('the opaque target is incomplete');
	opaqueSetup(o);
	sceneDepth = texture('depth');
	copy = texture('r32f');
	horizon = texture('rgba16f');
	denoise = texture('rgba16f');
	sceneFbo = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, sceneDepth, 0);
	gl.drawBuffers([gl.NONE]);
	if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
		throw new Error('the scene depth target is incomplete');
	}
	copyFbo = target(copy);
	horizonFbo = target(horizon);
	denoiseFbo = target(denoise);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	// The steps' settings: identity projection matrices, the render size and the drawn corner, the
	// engine's default occlusion settings, no reflections and no contact shadow march.
	const settings = new Float32Array(60);
	const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	settings.set(identity, 0);
	settings.set(identity, 16);
	settings.set([width, height, drawnW, drawnH], 32);
	settings.set([width, height, Math.ceil(width / 2), Math.ceil(height / 2)], 36);
	settings.set([0.25, 1, 1, 1], 40);
	settings.set([1, 3, 6, 0], 44);
	settings.set([10, 2, 3, 8], 48);
	settings.set([0, 0, 1, 0], 52);
	settings.set([0, 0.1, 1, 0], 56);
	ubo = gl.createBuffer();
	gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
	gl.bufferData(gl.UNIFORM_BUFFER, settings, gl.STATIC_DRAW);
	gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
	note(`webgl2 ${width}x${height}, drawn ${drawnW}x${drawnH}, mode ${mode}`);
	return failures;
}

function drawSceneDepth(): void {
	gl!.bindFramebuffer(gl!.FRAMEBUFFER, sceneFbo);
	gl!.viewport(0, 0, width, height);
	gl!.enable(gl!.DEPTH_TEST);
	gl!.depthFunc(gl!.ALWAYS);
	gl!.depthMask(true);
	gl!.useProgram(scene);
	gl!.drawArrays(gl!.TRIANGLES, 0, 3);
	gl!.disable(gl!.DEPTH_TEST);
}

function drawInto(
	framebuffer: WebGLFramebuffer,
	{ program: drawn, samplers }: Program,
	sources: [number, WebGLTexture][],
): void {
	gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer);
	gl!.viewport(0, 0, drawnW, drawnH);
	gl!.useProgram(drawn);
	for (const [unit, at] of samplers) gl!.uniform1i(at, unit);
	for (const [unit, source] of sources) {
		gl!.activeTexture(gl!.TEXTURE0 + unit);
		gl!.bindTexture(gl!.TEXTURE_2D, source);
	}
	gl!.bindBufferBase(gl!.UNIFORM_BUFFER, 0, ubo);
	gl!.drawArrays(gl!.TRIANGLES, 0, 3);
}

/** Draws one frame's passes and fences it as the engine's completion path does. */
let previous: WebGLSync | null = null;
function frame(side: 'off' | 'on'): number {
	const started = performance.now();
	if (previous) {
		gl!.getSyncParameter(previous, gl!.SYNC_STATUS);
		gl!.deleteSync(previous);
		previous = null;
	}
	drawSceneDepth();
	if (side === 'on' && mode !== 'none') {
		drawInto(copyFbo!, programs!.depth, [[1, sceneDepth!]]);
		if (mode === 'ao') {
			drawInto(horizonFbo!, programs!.horizon, [[1, copy!]]);
			drawInto(denoiseFbo!, programs!.denoise, [
				[1, copy!],
				[2, horizon!],
				[3, horizon!],
			]);
		}
	}
	// The scene's opaque pass: many copies into the colour target, after the occlusion chain.
	if (opaqueCount > 0) {
		gl!.bindFramebuffer(gl!.FRAMEBUFFER, opaqueFbo);
		gl!.viewport(0, 0, width, height);
		gl!.enable(gl!.DEPTH_TEST);
		gl!.depthFunc(gl!.LEQUAL);
		gl!.depthMask(false);
		gl!.useProgram(opaqueProgram);
		gl!.bindVertexArray(opaqueVao);
		gl!.drawArraysInstanced(gl!.TRIANGLES, 0, 3, opaqueCount);
		gl!.bindVertexArray(null);
		gl!.disable(gl!.DEPTH_TEST);
	}
	// The engine's final pass draws the frame to the canvas; a probe that stops at its targets never
	// presents, and the canvas then shows nothing.
	if (present) {
		gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
		gl!.viewport(0, 0, width, height);
		gl!.useProgram(presentProgram);
		gl!.drawArrays(gl!.TRIANGLES, 0, 3);
	}
	previous = gl!.fenceSync(gl!.SYNC_GPU_COMMANDS_COMPLETE, 0);
	gl!.flush();
	return performance.now() - started;
}

const median = (values: number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

async function nextFrame(): Promise<void> {
	// A worker that owns a canvas may ask for animation frames; one that may not waits a frame's
	// time instead, so the chain runs at the display's pace either way.
	await new Promise<void>((resolve) => {
		if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
		else setTimeout(resolve, 16);
	});
}

/** Runs `count` frames of one side, returning each frame's work time and the intervals between. */
async function measure(
	side: 'off' | 'on',
	count: number,
): Promise<{ work: number[]; interval: number[] }> {
	const work: number[] = [];
	const interval: number[] = [];
	let last = performance.now();
	for (let i = 0; i < count; i++) {
		await nextFrame();
		const begin = performance.now();
		interval.push(begin - last);
		work.push(frame(side));
		last = begin;
	}
	return { work, interval };
}

async function run(start: Start): Promise<void> {
	const failures = setup(start);
	for (let i = 0; i < WARM_UP; i++) {
		const ms = frame('on');
		if (i % 20 === 0) note(`warm-up ${i}: ${ms.toFixed(1)} ms`);
		await nextFrame();
	}
	const sides = { off: [] as number[], on: [] as number[] };
	const intervals = { off: [] as number[], on: [] as number[] };
	for (let round = 0; round < ROUNDS; round++) {
		for (const side of ['off', 'on'] as const) {
			const { work, interval } = await measure(side, MEASURED);
			sides[side].push(median(work));
			intervals[side].push(median(interval));
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	const summary = (side: 'off' | 'on') => ({
		intervalMs: median(intervals[side]),
		cpuMs: median(sides[side]),
		threads: { 'render-worker': median(sides[side]) },
	});
	self.postMessage({
		type: 'done',
		failures,
		off: summary('off'),
		on: summary('on'),
		trail,
	});
}

self.onmessage = (event: MessageEvent<Start & { type: string }>) => {
	const start = event.data;
	run(start).catch((error) => {
		self.postMessage({
			type: 'done',
			failures: [`the worker failed: ${(error as Error).message}`],
			trail,
		});
	});
};
