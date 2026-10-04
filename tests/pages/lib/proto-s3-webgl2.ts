// Prototype S3 (not for merging): the AO prototype page's WebGL2 renderer. It draws the passes of
// `proto-s3-scene.ts` with WebGL2 calls of its own and the GLSL of the prototype's shaders from the
// engine's shader build. The copy path first blits the multisampled depth into one sample, as the
// engine's WebGL2 backend does. Where the browser offers WebGL2's timer queries, each pass is timed.
import {
	DEPTH_MAPPING_UNIFORM,
	type GlslProgram,
	SHADERS,
} from '../../../packages/engine/src/generated/shaders';
import {
	AO_BYTES,
	type AoInput,
	boxMesh,
	INSTANCE_FLOATS,
	type Mesh,
	type Pass,
	passKey,
	type Renderer,
	SCENE_BYTES,
	type Sizes,
	sceneInstances,
	sphereMesh,
	uniforms,
} from './proto-s3-scene';

const BACKGROUND = [0.11, 0.125, 0.15, 1] as const;

interface Program {
	program: WebGLProgram;
}

interface Drawn {
	vao: WebGLVertexArrayObject;
	count: number;
	instanceCount: number;
}

interface Target {
	texture: WebGLTexture;
	framebuffer: WebGLFramebuffer;
}

interface Targets {
	sizes: Sizes;
	/** The multisampled color and depth that the prepass and the lit pass draw into. */
	scene: WebGLFramebuffer;
	sceneBuffers: WebGLRenderbuffer[];
	/** The one-sample depth that the copy reads: the blit's target, or the scene's own depth. */
	depth: WebGLTexture;
	depthFramebuffer: WebGLFramebuffer | null;
	frame: Target;
	copied: Target;
	structure: Target;
	structureDepth: WebGLRenderbuffer;
	raw: Target;
	across: Target;
	final: Target;
	horizons: Target;
}

export async function createWebGL2Renderer(
	samples: number,
	copyFormat: 'r32float' | 'r16float',
	grid: number,
): Promise<Renderer> {
	const canvas = new OffscreenCanvas(1, 1);
	const gl = canvas.getContext('webgl2', {
		antialias: false,
		alpha: false,
		depth: false,
		stencil: false,
		powerPreference: 'high-performance',
	}) as WebGL2RenderingContext | null;
	if (!gl) throw new Error('no WebGL2 context');
	const floatTargets = gl.getExtension('EXT_color_buffer_float') !== null;
	const halfTargets = floatTargets || gl.getExtension('EXT_color_buffer_half_float') !== null;
	if (!halfTargets) throw new Error('this device cannot draw into half float targets');
	if (copyFormat === 'r32float' && !floatTargets)
		throw new Error('this device cannot draw into 32-bit float targets');
	const debug = gl.getExtension('WEBGL_debug_renderer_info');
	const info = {
		renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
		vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
		floatTargets,
		maxSamples: gl.getParameter(gl.MAX_SAMPLES),
	};

	const compile = (type: number, source: string) => {
		const shader = gl.createShader(type) as WebGLShader;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		return shader;
	};
	// Programs link in parallel where the browser offers KHR_parallel_shader_compile.
	const parallel = gl.getExtension('KHR_parallel_shader_compile');
	const linking = new Map<string, { program: WebGLProgram; glsl: GlslProgram }>();
	const programs = new Map<string, Program>();
	const startProgram = (key: string, glsl: GlslProgram) => {
		if (linking.has(key) || programs.has(key)) return;
		const program = gl.createProgram() as WebGLProgram;
		gl.attachShader(program, compile(gl.VERTEX_SHADER, glsl.vertex.source));
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, glsl.fragment.source));
		gl.linkProgram(program);
		linking.set(key, { program, glsl });
	};
	const finishPrograms = async () => {
		if (parallel)
			for (let tries = 0; tries < 600; tries++) {
				const pending = [...linking.values()].some(
					({ program }) => !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR),
				);
				if (!pending) break;
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		for (const [key, { program, glsl }] of linking) {
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				const shaders = gl.getAttachedShaders(program) ?? [];
				const logs = shaders.map((shader) => gl.getShaderInfoLog(shader)).join(' ');
				throw new Error(
					`the program ${key} did not link: ${gl.getProgramInfoLog(program)} ${logs}`,
				);
			}
			gl.useProgram(program);
			for (const stage of [glsl.vertex, glsl.fragment]) {
				for (const block of stage.uniformBlocks) {
					const index = gl.getUniformBlockIndex(program, block.name);
					if (index !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, index, 0);
				}
				for (const texture of stage.textures) {
					const location = gl.getUniformLocation(program, texture.name);
					if (location) gl.uniform1i(location, texture.binding);
				}
			}
			// WebGPU's clip depth from 0 to 1 into GL's from -1 to 1, so both store the same depth.
			const mapping = gl.getUniformLocation(program, DEPTH_MAPPING_UNIFORM);
			if (mapping) gl.uniform2f(mapping, 2, -1);
			programs.set(key, { program });
		}
		linking.clear();
	};

	const sceneShader = SHADERS.proto_s3_scene as unknown as Record<
		string,
		{ glsl: Record<string, GlslProgram> | null }
	>;
	const aoShader = SHADERS.proto_s3_ao.webgl2?.glsl as Record<string, GlslProgram> | undefined;
	if (!aoShader) throw new Error('the prototype shaders have no WebGL2 build');
	const sceneProgram = (variant: string, pipeline: string) => {
		const glsl = sceneShader[`webgl2_${variant}`]?.glsl?.[pipeline];
		if (!glsl) throw new Error(`no scene variant ${variant}`);
		return glsl;
	};
	const aoProgram = (pipeline: string) => {
		const glsl = aoShader[pipeline];
		if (!glsl) throw new Error(`no AO pipeline ${pipeline}`);
		return glsl;
	};

	const meshVao = (mesh: Mesh, instances: Float32Array): Drawn => {
		const vao = gl.createVertexArray() as WebGLVertexArrayObject;
		gl.bindVertexArray(vao);
		const vertices = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
		gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
		const placed = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, placed);
		gl.bufferData(gl.ARRAY_BUFFER, instances, gl.STATIC_DRAW);
		for (let k = 0; k < 3; k++) {
			gl.enableVertexAttribArray(2 + k);
			gl.vertexAttribPointer(2 + k, 4, gl.FLOAT, false, INSTANCE_FLOATS * 4, 16 * k);
			gl.vertexAttribDivisor(2 + k, 1);
		}
		const indices = gl.createBuffer();
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
		gl.bindVertexArray(null);
		return { vao, count: mesh.indices.length, instanceCount: instances.length / INSTANCE_FLOATS };
	};
	const placed = sceneInstances(grid);
	const meshes = [meshVao(sphereMesh(), placed.spheres), meshVao(boxMesh(), placed.boxes)];
	const emptyVao = gl.createVertexArray();

	const sceneUbo = gl.createBuffer();
	gl.bindBuffer(gl.UNIFORM_BUFFER, sceneUbo);
	gl.bufferData(gl.UNIFORM_BUFFER, SCENE_BYTES, gl.DYNAMIC_DRAW);
	const aoUbo = gl.createBuffer();
	gl.bindBuffer(gl.UNIFORM_BUFFER, aoUbo);
	gl.bufferData(gl.UNIFORM_BUFFER, AO_BYTES, gl.DYNAMIC_DRAW);

	const blank = gl.createTexture() as WebGLTexture;
	gl.bindTexture(gl.TEXTURE_2D, blank);
	gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG16F, 1, 1);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

	let targets: Targets | null = null;
	let showAo = false;
	const writeUniforms = () => {
		if (!targets) return;
		const data = uniforms(targets.sizes, -1, showAo, samples);
		gl.bindBuffer(gl.UNIFORM_BUFFER, sceneUbo);
		gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data.scene);
		gl.bindBuffer(gl.UNIFORM_BUFFER, aoUbo);
		gl.bufferSubData(gl.UNIFORM_BUFFER, 0, data.ao);
	};

	const texture = (width: number, height: number, format: number, linear = false) => {
		const made = gl.createTexture() as WebGLTexture;
		gl.bindTexture(gl.TEXTURE_2D, made);
		gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
		const filter = linear ? gl.LINEAR : gl.NEAREST;
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return made;
	};
	const framebufferOf = (color: WebGLTexture | null, depth: WebGLTexture | null) => {
		const framebuffer = gl.createFramebuffer() as WebGLFramebuffer;
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		if (color)
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
		if (depth)
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		if (status !== gl.FRAMEBUFFER_COMPLETE)
			throw new Error(`a framebuffer is incomplete: 0x${status.toString(16)}`);
		return framebuffer;
	};
	const target = (width: number, height: number, format: number, linear = false): Target => {
		const made = texture(width, height, format, linear);
		return { texture: made, framebuffer: framebufferOf(made, null) };
	};
	const renderbuffer = (format: number, width: number, height: number, count: number) => {
		const made = gl.createRenderbuffer() as WebGLRenderbuffer;
		gl.bindRenderbuffer(gl.RENDERBUFFER, made);
		if (count > 1) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, count, format, width, height);
		else gl.renderbufferStorage(gl.RENDERBUFFER, format, width, height);
		return made;
	};

	const destroyTargets = (old: Targets) => {
		for (const t of [
			old.frame,
			old.copied,
			old.structure,
			old.raw,
			old.across,
			old.final,
			old.horizons,
		]) {
			gl.deleteTexture(t.texture);
			gl.deleteFramebuffer(t.framebuffer);
		}
		gl.deleteFramebuffer(old.scene);
		for (const buffer of old.sceneBuffers) gl.deleteRenderbuffer(buffer);
		gl.deleteRenderbuffer(old.structureDepth);
		gl.deleteTexture(old.depth);
		if (old.depthFramebuffer) gl.deleteFramebuffer(old.depthFramebuffer);
	};

	const resize = (sizes: Sizes) => {
		if (targets) destroyTargets(targets);
		const { width, height, aoWidth, aoHeight } = sizes;
		const frame = target(width, height, gl.RGBA8);
		const depth = texture(width, height, gl.DEPTH_COMPONENT32F);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);
		let scene: WebGLFramebuffer;
		let sceneBuffers: WebGLRenderbuffer[] = [];
		let depthFramebuffer: WebGLFramebuffer | null = null;
		if (samples > 1) {
			const color = renderbuffer(gl.RGBA8, width, height, samples);
			const sceneDepth = renderbuffer(gl.DEPTH_COMPONENT32F, width, height, samples);
			scene = gl.createFramebuffer() as WebGLFramebuffer;
			gl.bindFramebuffer(gl.FRAMEBUFFER, scene);
			gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
			gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, sceneDepth);
			sceneBuffers = [color, sceneDepth];
			depthFramebuffer = framebufferOf(null, depth);
		} else scene = framebufferOf(frame.texture, depth);
		const structureDepth = renderbuffer(gl.DEPTH_COMPONENT32F, aoWidth, aoHeight, 1);
		const structure = target(aoWidth, aoHeight, gl.R16F);
		gl.bindFramebuffer(gl.FRAMEBUFFER, structure.framebuffer);
		gl.framebufferRenderbuffer(
			gl.FRAMEBUFFER,
			gl.DEPTH_ATTACHMENT,
			gl.RENDERBUFFER,
			structureDepth,
		);
		targets = {
			sizes,
			scene,
			sceneBuffers,
			depth,
			depthFramebuffer,
			frame,
			copied: target(aoWidth, aoHeight, copyFormat === 'r32float' ? gl.R32F : gl.R16F),
			structure,
			structureDepth,
			raw: target(aoWidth, aoHeight, gl.RG16F),
			across: target(aoWidth, aoHeight, gl.RG16F),
			final: target(aoWidth, aoHeight, gl.RG16F, true),
			horizons: target(aoWidth, aoHeight, gl.RGBA16F),
		};
		writeUniforms();
	};

	const programFor = (key: string): WebGLProgram => {
		const found = programs.get(key);
		if (!found) throw new Error(`the program ${key} is not ready`);
		return found.program;
	};

	const prepare = async (passes: readonly Pass[]) => {
		for (const p of passes) {
			switch (p.kind) {
				case 'prepass':
					startProgram('prepass', sceneProgram('none', 'prepass'));
					break;
				case 'structure':
					startProgram('structure', sceneProgram('none', 'structure'));
					break;
				case 'copy':
					startProgram('copy', aoProgram('copy'));
					break;
				case 'ao':
					startProgram(passKey(p), aoProgram(passKey(p)));
					break;
				case 'blur':
					if (p.ao === 'three') startProgram('three_denoise', aoProgram('three_denoise'));
					else {
						startProgram('blur_x', aoProgram('blur_x'));
						startProgram('blur_y', aoProgram('blur_y'));
					}
					break;
				case 'lit':
					startProgram(
						passKey(p),
						sceneProgram(`${p.upsample}${p.contact ? '_contact' : ''}`, 'lit'),
					);
					break;
				case 'resolve':
					break;
			}
		}
		await finishPrograms();
	};

	const distanceOf = (t: Targets, input: AoInput | null) =>
		input === 'structure' ? t.structure.texture : input === 'copy' ? t.copied.texture : blank;

	const bindTextures = (one: WebGLTexture, two: WebGLTexture, three: WebGLTexture) => {
		for (const [unit, bound] of [one, two, three].entries()) {
			gl.activeTexture(gl.TEXTURE1 + unit);
			gl.bindTexture(gl.TEXTURE_2D, bound);
		}
	};

	const drawScene = () => {
		for (const mesh of meshes) {
			gl.bindVertexArray(mesh.vao);
			gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0, mesh.instanceCount);
		}
		gl.bindVertexArray(null);
	};

	const screen = (
		key: string,
		out: Target,
		one: WebGLTexture,
		two: WebGLTexture,
		three: WebGLTexture,
	) => {
		const t = targets as Targets;
		gl.bindFramebuffer(gl.FRAMEBUFFER, out.framebuffer);
		gl.viewport(0, 0, t.sizes.aoWidth, t.sizes.aoHeight);
		gl.disable(gl.DEPTH_TEST);
		gl.useProgram(programFor(key));
		gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, aoUbo);
		bindTextures(one, two, three);
		gl.bindVertexArray(emptyVao);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.bindVertexArray(null);
	};

	const scenePass = (
		key: string,
		framebuffer: WebGLFramebuffer,
		width: number,
		height: number,
		clearColor: readonly [number, number, number, number] | null,
		clearDepth: boolean,
		depthFunc: number,
		depthWrite: boolean,
		textures: [WebGLTexture, WebGLTexture, WebGLTexture],
	) => {
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.viewport(0, 0, width, height);
		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.depthFunc(depthFunc);
		gl.depthMask(true);
		gl.clearDepth(0);
		if (clearColor) gl.clearColor(...clearColor);
		const bits = (clearColor ? gl.COLOR_BUFFER_BIT : 0) | (clearDepth ? gl.DEPTH_BUFFER_BIT : 0);
		if (bits) gl.clear(bits);
		gl.depthMask(depthWrite);
		gl.useProgram(programFor(key));
		gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, sceneUbo);
		bindTextures(...textures);
		drawScene();
		gl.depthMask(true);
	};

	const drawPass = (p: Pass) => {
		const t = targets as Targets;
		const { width, height } = t.sizes;
		switch (p.kind) {
			case 'prepass':
				gl.colorMask(false, false, false, false);
				scenePass('prepass', t.scene, width, height, null, true, gl.GREATER, true, [
					blank,
					blank,
					blank,
				]);
				gl.colorMask(true, true, true, true);
				return;
			case 'resolve':
				if (!t.depthFramebuffer) return;
				gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.scene);
				gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.depthFramebuffer);
				gl.blitFramebuffer(
					0,
					0,
					width,
					height,
					0,
					0,
					width,
					height,
					gl.DEPTH_BUFFER_BIT,
					gl.NEAREST,
				);
				gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
				gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
				return;
			case 'structure':
				scenePass(
					'structure',
					t.structure.framebuffer,
					t.sizes.aoWidth,
					t.sizes.aoHeight,
					[0, 0, 0, 0],
					true,
					gl.GREATER,
					true,
					[blank, blank, blank],
				);
				gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.DEPTH_ATTACHMENT]);
				return;
			case 'copy':
				screen('copy', t.copied, t.depth, blank, blank);
				return;
			case 'ao':
				screen(
					passKey(p),
					p.ao === 'three' ? t.horizons : t.raw,
					blank,
					distanceOf(t, p.input),
					blank,
				);
				return;
			case 'blur':
				if (p.ao === 'three')
					screen('three_denoise', t.final, blank, distanceOf(t, p.input), t.horizons.texture);
				else {
					screen('blur_x', t.across, blank, distanceOf(t, p.input), t.raw.texture);
					screen('blur_y', t.final, blank, distanceOf(t, p.input), t.across.texture);
				}
				return;
			case 'lit': {
				scenePass(
					passKey(p),
					t.scene,
					width,
					height,
					BACKGROUND,
					!p.prepass,
					p.prepass ? gl.GEQUAL : gl.GREATER,
					!p.prepass,
					[p.input ? t.final.texture : blank, blank, distanceOf(t, p.input)],
				);
				if (samples > 1) {
					gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.scene);
					gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.frame.framebuffer);
					gl.blitFramebuffer(
						0,
						0,
						width,
						height,
						0,
						0,
						width,
						height,
						gl.COLOR_BUFFER_BIT,
						gl.NEAREST,
					);
					gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.scene);
					gl.invalidateFramebuffer(gl.READ_FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]);
					gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
					gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
				}
				return;
			}
		}
	};

	const pixel = new Uint8Array(4);
	const finish = () => {
		const t = targets as Targets;
		gl.bindFramebuffer(gl.FRAMEBUFFER, t.frame.framebuffer);
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
		const error = gl.getError();
		if (error !== gl.NO_ERROR) throw new Error(`WebGL error 0x${error.toString(16)}`);
	};

	const throughput = async (passes: readonly Pass[], frames: number) => {
		const started = performance.now();
		for (let f = 0; f < frames; f++) {
			for (const p of passes) drawPass(p);
			gl.flush();
		}
		const issueMs = performance.now() - started;
		finish();
		return { ms: performance.now() - started, issueMs };
	};

	// WebGL2's GPU timer, where the browser offers it: one query per pass, one frame at a time.
	const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
	const queries: WebGLQuery[] = [];
	const timed = async (passes: readonly Pass[], frames: number) => {
		if (!timer) return null;
		while (queries.length < passes.length) queries.push(gl.createQuery() as WebGLQuery);
		const sums: Record<string, number> = {};
		const totals: number[] = [];
		let counted = 0;
		for (let f = 0; f < frames; f++) {
			gl.getParameter(timer.GPU_DISJOINT_EXT);
			for (const [i, p] of passes.entries()) {
				gl.beginQuery(timer.TIME_ELAPSED_EXT, queries[i] as WebGLQuery);
				drawPass(p);
				gl.endQuery(timer.TIME_ELAPSED_EXT);
			}
			gl.flush();
			const last = queries[passes.length - 1] as WebGLQuery;
			for (let tries = 0; tries < 2000; tries++) {
				if (gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) break;
				await new Promise((resolve) => setTimeout(resolve, 1));
			}
			if (gl.getParameter(timer.GPU_DISJOINT_EXT)) continue;
			let total = 0;
			for (const [i, p] of passes.entries()) {
				const ms = gl.getQueryParameter(queries[i] as WebGLQuery, gl.QUERY_RESULT) / 1e6;
				const key = passKey(p);
				sums[key] = (sums[key] ?? 0) + ms;
				total += ms;
			}
			totals.push(total);
			counted++;
		}
		const passMs: Record<string, number> = {};
		for (const key of Object.keys(sums)) passMs[key] = (sums[key] as number) / Math.max(1, counted);
		return { frameMs: totals.reduce((a, b) => a + b, 0) / Math.max(1, totals.length), passMs };
	};

	const picture = async (passes: readonly Pass[]) => {
		const t = targets as Targets;
		for (const p of passes) drawPass(p);
		const { width, height } = t.sizes;
		const rows = new Uint8Array(width * height * 4);
		gl.bindFramebuffer(gl.FRAMEBUFFER, t.frame.framebuffer);
		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rows);
		// GL reads the bottom row first.
		const pixels = new Uint8Array(rows.length);
		const stride = width * 4;
		for (let y = 0; y < height; y++)
			pixels.set(rows.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride);
		const error = gl.getError();
		if (error !== gl.NO_ERROR) throw new Error(`WebGL error 0x${error.toString(16)}`);
		return pixels;
	};

	return {
		tier: 'webgl2',
		info,
		timer: timer ? 'timer-query' : null,
		resolvesDepth: samples > 1,
		resize,
		setShowAo: (value) => {
			showAo = value;
			writeUniforms();
		},
		prepare,
		throughput,
		timed,
		picture,
		destroy: () => {
			if (targets) destroyTargets(targets);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		},
	};
}
