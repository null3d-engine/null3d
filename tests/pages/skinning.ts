// The skinning measurement page on WebGL2. It draws the skinning scene of `lib/skinning.ts` in two
// ways, and times both in turns (`skinning-webgpu.ts` is its twin on WebGPU):
// - vertex-shader: every shadow cascade and the main pass skin each character in the vertex shader,
//   which reads four joint matrices from a float texture per vertex.
// - transform-feedback: one pass with the rasterizer off skins each character that some pass draws
//   into two buffers, positions and normals. The cascades and the main pass draw those buffers as
//   plain vertices.
// Both paths cull the characters per pass on the CPU and upload the joint matrices each frame. The
// page first draws one pose both ways and compares the two images. Then each path draws frames back
// to back in timed batches, and each batch ends when the GPU has finished its last frame. The
// paths take turns, so heat affects both alike. Switches: ?characters=, ?cascades=, ?rounds= and
// ?warmup= (milliseconds). The page uses no engine code: skinning comes to the engine later, and
// this page measures which design to build.
import { progress, run } from './lib/result';
import {
	type SkinningPath as AnyPath,
	type Cascade,
	cameraView,
	characterMesh,
	compareImages,
	cullCharacters,
	fitCascades,
	indexRanges,
	JOINT_FLOATS,
	MAX_CASCADES,
	type PathTiming,
	poseCharacters,
	quartiles,
	SKINNING,
	type SkinningResult,
} from './lib/skinning';
import {
	SKINNING_PROGRAMS,
	type SkinningProgram,
	type SkinningProgramName,
} from './lib/skinning-shaders';

const params = new URLSearchParams(location.search);
const characters = Number(params.get('characters') ?? 100);
const cascadeCount = Math.min(MAX_CASCADES, Math.max(1, Number(params.get('cascades') ?? 3)));
const rounds = Number(params.get('rounds') ?? SKINNING.rounds);
const warmUpMs = Number(params.get('warmup') ?? SKINNING.warmUpMs);
const [width, height] = SKINNING.size;

/** The page's two paths. */
type SkinningPath = Extract<AnyPath, 'vertex-shader' | 'transform-feedback'>;

/** The characters' color and the ground's. */
const CHARACTER_ALBEDO = [0.8, 0.45, 0.3] as const;
const GROUND_ALBEDO = [0.35, 0.5, 0.35] as const;
/** Half the ground's width, in meters. */
const GROUND = 80;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new Error('WebGL2 made no shader');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	return shader;
}

/** Links a program; transform feedback captures its outputs, if any, each into its own buffer. */
function link(
	gl: WebGL2RenderingContext,
	name: string,
	{ vertex, fragment, captured = [] }: SkinningProgram,
): WebGLProgram {
	const program = gl.createProgram();
	const shaders = [
		compile(gl, gl.VERTEX_SHADER, vertex),
		compile(gl, gl.FRAGMENT_SHADER, fragment),
	];
	for (const shader of shaders) gl.attachShader(program, shader);
	if (captured.length > 0) gl.transformFeedbackVaryings(program, captured, gl.SEPARATE_ATTRIBS);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const logs = shaders.map((shader) => gl.getShaderInfoLog(shader)).filter(Boolean);
		throw new Error(
			`the ${name} program failed: ${[gl.getProgramInfoLog(program), ...logs].join(' ')}`,
		);
	}
	return program;
}

function buffer(
	gl: WebGL2RenderingContext,
	target: number,
	data: ArrayBufferView | number,
	usage: number = gl.STATIC_DRAW,
): WebGLBuffer {
	const b = gl.createBuffer();
	gl.bindBuffer(target, b);
	if (typeof data === 'number') gl.bufferData(target, data, usage);
	else gl.bufferData(target, data, usage);
	return b;
}

/** Points float attribute `location` at `source`, with `size` floats per vertex. */
function floats(gl: WebGL2RenderingContext, location: number, source: WebGLBuffer, size: number) {
	gl.bindBuffer(gl.ARRAY_BUFFER, source);
	gl.enableVertexAttribArray(location);
	gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

/** The scene on the GPU, and a frame of each path. */
class SkinningRenderer {
	readonly mesh = characterMesh();
	private readonly indexCount = this.mesh.indices.length;
	private readonly main = cameraView(width / height);
	private readonly cascades: Cascade[] = fitCascades(cascadeCount, width / height);
	/** The page's programs, and the plain shaded program again with the ground's color. */
	private readonly programs: Record<SkinningProgramName | 'ground', WebGLProgram>;
	/** The view matrix of each depth program, which changes with the cascade. */
	private readonly depthViewProj = new Map<WebGLProgram, WebGLUniformLocation | null>();
	private readonly jointTexture: WebGLTexture;
	readonly jointData = new Float32Array(characters * SKINNING.joints * JOINT_FLOATS);
	private readonly shadowMap: WebGLTexture;
	private readonly shadowTargets: WebGLFramebuffer[];
	readonly target: WebGLFramebuffer;
	/** The rest mesh with each character's number per instance, for the skinning programs. */
	private readonly restMesh: WebGLVertexArrayObject;
	/** The skinned characters that transform feedback writes, for the plain programs. */
	private readonly skinnedMesh: WebGLVertexArrayObject;
	private readonly groundMesh: WebGLVertexArrayObject;
	private readonly instances: WebGLBuffer;
	private readonly feedback: WebGLTransformFeedback;
	/**
	 * The characters that each pass draws, the main pass first, then the cascades, then those that
	 * some pass draws, which transform feedback skins.
	 */
	private readonly lists = new Uint32Array((MAX_CASCADES + 2) * characters);
	private readonly starts = new Int32Array(MAX_CASCADES + 2);
	readonly drawnCounts = new Int32Array(MAX_CASCADES + 2);
	/** Each character's slot in the skinned buffers, or -1 when no pass draws it. */
	private readonly slotOf = new Int32Array(characters);
	private readonly rangeCounts = new Int32Array(characters);
	private readonly rangeOffsets = new Int32Array(characters);
	readonly multiDraw: WEBGL_multi_draw | null;

	constructor(private readonly gl: WebGL2RenderingContext) {
		this.multiDraw = gl.getExtension('WEBGL_multi_draw');
		const linked = Object.entries(SKINNING_PROGRAMS).map(([name, program]) => [
			name,
			link(gl, name, program),
		]);
		this.programs = {
			...(Object.fromEntries(linked) as Record<SkinningProgramName, WebGLProgram>),
			ground: link(gl, 'ground', SKINNING_PROGRAMS.plainShaded),
		};
		this.setUniforms();

		this.jointTexture = gl.createTexture();
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.jointTexture);
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, SKINNING.joints * 3, characters);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

		const size = SKINNING.shadowMapSize;
		this.shadowMap = gl.createTexture();
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowMap);
		gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT32F, size, size, cascadeCount);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
		gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
		this.shadowTargets = this.cascades.map((_, layer) => {
			const target = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, target);
			gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, this.shadowMap, 0, layer);
			gl.drawBuffers([gl.NONE]);
			gl.readBuffer(gl.NONE);
			this.checkTarget(`shadow layer ${layer}`);
			return target;
		});

		this.target = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.target);
		for (const [format, attachment] of [
			[gl.RGBA8, gl.COLOR_ATTACHMENT0],
			[gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT],
		] as const) {
			const storage = gl.createRenderbuffer();
			gl.bindRenderbuffer(gl.RENDERBUFFER, storage);
			gl.renderbufferStorage(gl.RENDERBUFFER, format, width, height);
			gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, storage);
		}
		this.checkTarget('main');

		const { positions, normals, joints, weights, indices, vertexCount } = this.mesh;
		this.instances = buffer(gl, gl.ARRAY_BUFFER, this.lists.byteLength, gl.DYNAMIC_DRAW);
		this.restMesh = gl.createVertexArray();
		gl.bindVertexArray(this.restMesh);
		floats(gl, 0, buffer(gl, gl.ARRAY_BUFFER, positions), 3);
		floats(gl, 1, buffer(gl, gl.ARRAY_BUFFER, normals), 3);
		buffer(gl, gl.ARRAY_BUFFER, joints);
		gl.enableVertexAttribArray(2);
		gl.vertexAttribIPointer(2, 4, gl.UNSIGNED_BYTE, 0, 0);
		floats(gl, 3, buffer(gl, gl.ARRAY_BUFFER, weights), 4);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
		gl.enableVertexAttribArray(4);
		gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, 0, 0);
		gl.vertexAttribDivisor(4, 1);
		buffer(gl, gl.ELEMENT_ARRAY_BUFFER, indices);

		// The skinned buffers hold each character at a slot, so one index buffer covers every slot.
		const skinnedBytes = characters * vertexCount * 12;
		const skinnedPositions = buffer(gl, gl.ARRAY_BUFFER, skinnedBytes, gl.DYNAMIC_COPY);
		const skinnedNormals = buffer(gl, gl.ARRAY_BUFFER, skinnedBytes, gl.DYNAMIC_COPY);
		this.skinnedMesh = gl.createVertexArray();
		gl.bindVertexArray(this.skinnedMesh);
		floats(gl, 0, skinnedPositions, 3);
		floats(gl, 1, skinnedNormals, 3);
		const slotIndices = new Uint32Array(characters * this.indexCount);
		for (let slot = 0; slot < characters; slot++)
			for (let i = 0; i < this.indexCount; i++)
				slotIndices[slot * this.indexCount + i] = slot * vertexCount + indices[i]!;
		buffer(gl, gl.ELEMENT_ARRAY_BUFFER, slotIndices);

		this.groundMesh = gl.createVertexArray();
		gl.bindVertexArray(this.groundMesh);
		const g = GROUND;
		floats(
			gl,
			0,
			buffer(gl, gl.ARRAY_BUFFER, new Float32Array([-g, 0, -g, -g, 0, g, g, 0, g, g, 0, -g])),
			3,
		);
		floats(
			gl,
			1,
			buffer(gl, gl.ARRAY_BUFFER, new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])),
			3,
		);
		buffer(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]));
		gl.bindVertexArray(null);

		this.feedback = gl.createTransformFeedback();
		gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback);
		gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, skinnedPositions);
		gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, skinnedNormals);
		gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
		// A buffer that a draw reads must not stay bound for transform feedback too.
		gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);

		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);
		gl.polygonOffset(2, 2);
		gl.clearColor(0.55, 0.7, 0.9, 1);
	}

	private checkTarget(name: string): void {
		const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
		if (status !== this.gl.FRAMEBUFFER_COMPLETE)
			throw new Error(`the ${name} target is incomplete: 0x${status.toString(16)}`);
	}

	/** Sets the uniforms that stay the same through the page. */
	private setUniforms(): void {
		const { gl, main, cascades } = this;
		const each = Array.from({ length: MAX_CASCADES }, (_, i) => cascades[i]);
		const ends = each.map((cascade) => cascade?.end ?? 1e30);
		const texels = each.map((cascade) => cascade?.texel ?? 0);
		const viewProjs = new Float32Array(16 * MAX_CASCADES);
		for (const [i, cascade] of cascades.entries()) viewProjs.set(cascade.viewProj, i * 16);
		const light = SKINNING.light.map((v) => -v);
		const length = Math.hypot(...light);
		for (const [name, program] of Object.entries(this.programs)) {
			gl.useProgram(program);
			const at = (uniform: string) => gl.getUniformLocation(program, uniform);
			gl.uniform1i(at('joints'), 0);
			if (name.endsWith('Depth')) {
				this.depthViewProj.set(program, at('viewProj'));
				continue;
			}
			gl.uniformMatrix4fv(at('viewProj'), false, main.viewProj);
			gl.uniform1i(at('shadowMap'), 1);
			gl.uniformMatrix4fv(at('cascadeViewProj'), false, viewProjs);
			gl.uniform4fv(at('cascadeEnd'), ends);
			gl.uniform4fv(at('cascadeTexel'), texels);
			gl.uniform1i(at('cascades'), cascadeCount);
			gl.uniform3fv(at('eye'), main.eye);
			gl.uniform3fv(at('forward'), main.forward);
			gl.uniform3fv(
				at('toLight'),
				light.map((v) => v / length),
			);
			gl.uniform3fv(at('albedo'), name === 'ground' ? GROUND_ALBEDO : CHARACTER_ALBEDO);
		}
	}

	/**
	 * Culls the characters for each pass into the lists. With `skinOnce`, it also lists the
	 * characters that some pass draws, gives each its slot in the skinned buffers, and uploads that
	 * list; otherwise it uploads the passes' lists. It returns the characters to skin once.
	 */
	private cull(skinOnce: boolean): number {
		const { gl, lists, starts, drawnCounts: drawn, slotOf } = this;
		let at = 0;
		const views = 1 + cascadeCount;
		for (let v = 0; v < views; v++) {
			starts[v] = at;
			drawn[v] = cullCharacters(v === 0 ? this.main : this.cascades[v - 1]!, characters, lists, at);
			at += drawn[v]!;
		}
		gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
		if (!skinOnce) {
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, lists, 0, at);
			return 0;
		}
		// Marks each character that some pass draws, then numbers the marked ones in order.
		slotOf.fill(-1);
		for (let i = 0; i < at; i++) slotOf[lists[i]!] = 0;
		let skinned = 0;
		for (let c = 0; c < characters; c++)
			if (slotOf[c] === 0) {
				slotOf[c] = skinned;
				lists[at + skinned++] = c;
			}
		starts[views] = at;
		drawn[views] = skinned;
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, lists, at, skinned);
		return skinned;
	}

	/** Points the rest mesh's character input at a list in the instance buffer. */
	private listAt(byteOffset: number): void {
		this.gl.vertexAttribIPointer(4, 1, this.gl.UNSIGNED_INT, 0, byteOffset);
	}

	/** Draws the characters of pass `v` from the skinned buffers, in as few ranges as it can. */
	private drawSkinned(v: number): void {
		const { gl, rangeCounts, rangeOffsets } = this;
		const ranges = indexRanges(
			this.lists,
			this.starts[v]!,
			this.drawnCounts[v]!,
			this.slotOf,
			this.indexCount,
			rangeCounts,
			rangeOffsets,
		);
		if (this.multiDraw)
			this.multiDraw.multiDrawElementsWEBGL(
				gl.TRIANGLES,
				rangeCounts,
				0,
				gl.UNSIGNED_INT,
				rangeOffsets,
				0,
				ranges,
			);
		else
			for (let r = 0; r < ranges; r++)
				gl.drawElements(gl.TRIANGLES, rangeCounts[r]!, gl.UNSIGNED_INT, rangeOffsets[r]!);
	}

	/** Records one frame on `path` with the joint matrices that `jointData` holds now. */
	frame(path: SkinningPath): void {
		const { gl, programs, drawnCounts: drawn } = this;
		const skinOnce = path === 'transform-feedback';
		gl.activeTexture(gl.TEXTURE0);
		gl.texSubImage2D(
			gl.TEXTURE_2D,
			0,
			0,
			0,
			SKINNING.joints * 3,
			characters,
			gl.RGBA,
			gl.FLOAT,
			this.jointData,
		);
		const skinned = this.cull(skinOnce);

		if (skinOnce && skinned > 0) {
			gl.useProgram(programs.skinOnly);
			gl.bindVertexArray(this.restMesh);
			this.listAt(0);
			gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.feedback);
			gl.enable(gl.RASTERIZER_DISCARD);
			gl.beginTransformFeedback(gl.POINTS);
			gl.drawArraysInstanced(gl.POINTS, 0, this.mesh.vertexCount, skinned);
			gl.endTransformFeedback();
			gl.disable(gl.RASTERIZER_DISCARD);
			gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
		}

		// The shadow map must not be bound for sampling while its layers are drawn.
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
		gl.disable(gl.CULL_FACE);
		gl.enable(gl.POLYGON_OFFSET_FILL);
		const depth = skinOnce ? programs.plainDepth : programs.skinnedDepth;
		const viewProj = this.depthViewProj.get(depth) ?? null;
		gl.useProgram(depth);
		gl.bindVertexArray(skinOnce ? this.skinnedMesh : this.restMesh);
		gl.viewport(0, 0, SKINNING.shadowMapSize, SKINNING.shadowMapSize);
		for (let k = 0; k < cascadeCount; k++) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowTargets[k]!);
			gl.clear(gl.DEPTH_BUFFER_BIT);
			gl.uniformMatrix4fv(viewProj, false, this.cascades[k]!.viewProj);
			if (drawn[k + 1] === 0) continue;
			if (skinOnce) this.drawSkinned(k + 1);
			else {
				this.listAt(this.starts[k + 1]! * 4);
				gl.drawElementsInstanced(
					gl.TRIANGLES,
					this.indexCount,
					gl.UNSIGNED_SHORT,
					0,
					drawn[k + 1]!,
				);
			}
		}

		gl.disable(gl.POLYGON_OFFSET_FILL);
		gl.enable(gl.CULL_FACE);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowMap);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.target);
		gl.viewport(0, 0, width, height);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.useProgram(programs.ground);
		gl.bindVertexArray(this.groundMesh);
		gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
		if (drawn[0]! > 0) {
			if (skinOnce) {
				gl.useProgram(programs.plainShaded);
				gl.bindVertexArray(this.skinnedMesh);
				this.drawSkinned(0);
			} else {
				gl.useProgram(programs.skinnedShaded);
				gl.bindVertexArray(this.restMesh);
				this.listAt(0);
				gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, drawn[0]!);
			}
		}
		gl.bindVertexArray(null);
	}

	/** Characters drawn by each pass in the last frame, and those skinned once, if that path drew. */
	passCounts(): { drawn: number[]; skinned: number } {
		const drawn = Array.from(this.drawnCounts.subarray(0, 1 + cascadeCount));
		return { drawn, skinned: this.drawnCounts[1 + cascadeCount]! };
	}

	/** Vertices skinned per frame on `path`, from the last frame's counts. */
	skinnedVertices(path: SkinningPath): number {
		const { drawn, skinned } = this.passCounts();
		const characterSkins =
			path === 'transform-feedback' ? skinned : drawn.reduce((sum, count) => sum + count, 0);
		return characterSkins * this.mesh.vertexCount;
	}
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

run('skinning', async (): Promise<SkinningResult & Record<string, unknown>> => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	canvas.width = width;
	canvas.height = height;
	const gl = canvas.getContext('webgl2', {
		alpha: false,
		antialias: false,
		depth: false,
		stencil: false,
		powerPreference: 'high-performance',
	});
	if (!gl) throw new Error('no WebGL2 context');
	const renderer = new SkinningRenderer(gl);
	const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
	progress(`built the scene: ${characters} characters, ${cascadeCount} cascades`);

	const pixel = new Uint8Array(4);
	/** Waits until the GPU has finished every frame so far, by reading a pixel of the last one. */
	const finish = () => {
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderer.target);
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
	};
	const present = () => {
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderer.target);
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
		gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
	};
	const glError = () => {
		const error = gl.getError();
		if (error !== gl.NO_ERROR) throw new Error(`WebGL error 0x${error.toString(16)}`);
	};

	// One pose, drawn both ways.
	poseCharacters(renderer.jointData, characters, SKINNING.checkTime);
	const images = (['vertex-shader', 'transform-feedback'] as const).map((path) => {
		renderer.frame(path);
		const image = new Uint8Array(width * height * 4);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, renderer.target);
		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, image);
		return image;
	});
	glError();
	const image = compareImages(images[0]!, images[1]!);
	const counts = renderer.passCounts();
	progress(`image check: ${image.differing} of ${image.pixels} pixels differ`);

	/** Draws `frames` frames of `path` back to back; returns ms per frame, and CPU ms per frame. */
	const batch = (path: SkinningPath, frames: number) => {
		poseCharacters(renderer.jointData, characters, performance.now() / 1000);
		const query = timer ? gl.createQuery() : null;
		if (timer && query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
		const start = performance.now();
		let cpu = 0;
		for (let i = 0; i < frames; i++) {
			const before = performance.now();
			renderer.frame(path);
			cpu += performance.now() - before;
		}
		if (timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
		finish();
		const ms = (performance.now() - start) / frames;
		present();
		return { ms, cpu: cpu / frames, query };
	};

	const paths = ['vertex-shader', 'transform-feedback'] as const;
	const batchFrames = { 'vertex-shader': 1, 'transform-feedback': 1 };
	const warmUp: Record<SkinningPath, number[]> = { 'vertex-shader': [], 'transform-feedback': [] };
	const warmUntil = performance.now() + warmUpMs;
	for (let turn = 0; performance.now() < warmUntil || turn < 2; turn++) {
		const path = paths[turn % 2]!;
		await nextFrame();
		const { ms, query } = batch(path, 1);
		if (query) gl.deleteQuery(query);
		warmUp[path].push(ms);
	}
	for (const path of paths) {
		const single = quartiles(warmUp[path])[1];
		batchFrames[path] = Math.max(
			1,
			Math.min(SKINNING.maxBatchFrames, Math.round(SKINNING.batchMs / Math.max(single, 0.1))),
		);
	}
	progress(
		`warmed up: ${batchFrames['vertex-shader']} and ${batchFrames['transform-feedback']} frames a batch`,
	);

	const samples: Record<SkinningPath, { ms: number[]; cpu: number[]; queries: WebGLQuery[] }> = {
		'vertex-shader': { ms: [], cpu: [], queries: [] },
		'transform-feedback': { ms: [], cpu: [], queries: [] },
	};
	for (let round = 0; round < rounds; round++) {
		for (const path of round % 2 === 0 ? paths : [...paths].reverse()) {
			await nextFrame();
			const { ms, cpu, query } = batch(path, batchFrames[path]);
			samples[path].ms.push(ms);
			samples[path].cpu.push(cpu);
			if (query) samples[path].queries.push(query);
		}
		progress(`round ${round + 1} of ${rounds}`);
	}
	glError();

	// GPU timer results arrive a few frames later. A disjoint event spoils every result.
	const gpuMs = async (path: SkinningPath): Promise<number | null> => {
		if (!timer) return null;
		const { queries } = samples[path];
		for (let wait = 0; wait < 60; wait++) {
			const last = queries.at(-1);
			if (!last || gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) break;
			await nextFrame();
		}
		if (gl.getParameter(timer.GPU_DISJOINT_EXT)) return null;
		const each = queries.flatMap((query) =>
			gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)
				? [Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6 / batchFrames[path]]
				: [],
		);
		for (const query of queries) gl.deleteQuery(query);
		return each.length > 0 ? quartiles(each)[1] : null;
	};
	const timing = async (path: SkinningPath): Promise<PathTiming> => {
		const [low, middle, high] = quartiles(samples[path].ms);
		return {
			frameMs: middle,
			frameMsQuartiles: [low, high],
			cpuMs: quartiles(samples[path].cpu)[1],
			gpuMs: await gpuMs(path),
			batchFrames: batchFrames[path],
			batches: samples[path].ms.length,
			skinnedVertices: renderer.skinnedVertices(path),
		};
	};
	return {
		gpu: 'webgl2',
		characters,
		cascades: cascadeCount,
		size: SKINNING.size,
		vertices: renderer.mesh.vertexCount,
		joints: SKINNING.joints,
		multiDraw: renderer.multiDraw !== null,
		gpuTimer: timer !== null,
		drawn: counts.drawn,
		skinned: counts.skinned,
		image,
		paths: {
			'vertex-shader': await timing('vertex-shader'),
			'transform-feedback': await timing('transform-feedback'),
		},
	};
});
