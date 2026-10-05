// Prototype L1: the room's generator in three write paths and three output formats, on WebGPU
// (core or compatibility mode) and on WebGL2. It runs the engine's own steps and shader
// (packages/engine/src/gpu/environment-steps.ts, crates/null3d-shaders/wgsl/environment.wgsl),
// with the bands of each GPU step chosen by the caller, and times each step.
//
// - `pack`: the engine's path. Each draw packs shared-exponent texels into the bytes of an RGBA8
//   spare texture, and a buffer carries them into the RGB9_E5 cube. No float render target.
// - `spare`: each draw writes float light into a spare 2D texture of the output's format, with
//   the six faces side by side, and a texture copy puts each face's part into the cube.
// - `direct`: each draw writes float light straight into one face and level of the cube, six
//   draws a band. The chain's next level is drawn from the level before it in the same texture,
//   which the Galaxy S25's WebGL2 driver refused for mip levels (.dev/implementation-notes.md).
//
// The textures that hold the traced room and the blurred chain take the output's format.
import { DEPTH_SETUPS, programHost } from '@null3d/engine/internal';
import type { ShaderVariant } from '../../../packages/engine/src/generated/shaders';
import {
	type Band,
	chainLevels,
	roomSteps,
	type Step,
	type StepTexture,
} from '../../../packages/engine/src/gpu/environment-steps';

/** The start of the error of a variant that the device cannot run, which is no fault. */
export const UNSUPPORTED = 'unsupported:';

export type Format = 'rgb9e5ufloat' | 'rgba16float' | 'rg11b10ufloat';
export type Write = 'pack' | 'spare' | 'direct';
type Pipeline = Step['pipeline'];
const PIPELINES: Pipeline[] = ['trace', 'blur', 'half', 'prefilter'];

/** The face size and levels of the room's map, as the engine makes it. */
export const SIZE = 256;
export const LEVELS = 6;

/**
 * One GPU step's times: the call itself, which the thread that draws spends; from the call until
 * the GPU had finished it; and the GPU's own timer, where the device has one.
 */
export interface StepTime {
	cpuMs: number;
	wallMs: number;
	gpuMs?: number;
}

export interface Generator {
	/** What the device gave: the path's name, the format and write path it runs, and why. */
	readonly facts: Record<string, unknown>;
	readonly steps: readonly Step[];
	/** Builds the pipelines in the background, as the engine does before the first slice. */
	prepare(): Promise<void>;
	/** Runs one GPU step of bands and waits until the GPU has finished it. */
	run(bands: readonly Band[]): Promise<StepTime>;
	/**
	 * Draws one texel with each pipeline into the target it draws into, each waited for, so that
	 * the driver's work at a pipeline's first draw falls outside the map's steps.
	 */
	warm(): Promise<Record<Pipeline, StepTime>>;
	/** The map's levels as light, three floats a texel, faces in order, rows from the first. */
	read(): Promise<Float32Array[]>;
	/** Errors that the GPU reported. */
	errors(): Promise<string[]>;
	destroy(): void;
}

/** Bytes of one step's uniform values, as the shader's `Step` holds them. */
const STEP_BYTES = 32;
/** Uniform slots per step: the six faces side by side, then each face alone. */
const SLOTS_PER_STEP = 7;

/**
 * The uniform values of every step's slots and, after them, a slot per level that reads the
 * level back through the `half` pipeline. Float output sets the shader's flag for it. A face
 * alone reads its level's source as level 0 of a view, so its `half` reads level 0.
 */
function slotValues(steps: readonly Step[], stride: number, raw: boolean): ArrayBuffer {
	const buffer = new ArrayBuffer((steps.length * SLOTS_PER_STEP + LEVELS) * stride);
	const words = new Uint32Array(buffer);
	const floats = new Float32Array(buffer);
	const put = (slot: number, size: number, samples: number, flags: number, value: number) => {
		const at = (slot * stride) / 4;
		words.set([size, samples, SIZE, flags], at);
		floats[at + 4] = value;
	};
	const rawBit = raw ? 1 : 0;
	steps.forEach((step, k) => {
		put(k * SLOTS_PER_STEP, step.size, step.samples, rawBit, step.value);
		for (let face = 0; face < 6; face++) {
			const value = step.pipeline === 'half' ? 0 : step.value;
			put(
				k * SLOTS_PER_STEP + 1 + face,
				step.size,
				step.samples,
				rawBit | ((face + 1) << 1),
				value,
			);
		}
	});
	for (let level = 0; level < LEVELS; level++)
		put(steps.length * SLOTS_PER_STEP + level, SIZE >> level, 0, 0, level);
	return buffer;
}

const readSlot = (steps: readonly Step[], level: number) => steps.length * SLOTS_PER_STEP + level;

/** A shared-exponent texel's light. */
export function fromRgb9e5(texel: number): number {
	return (texel & 511) * 2 ** ((texel >>> 27) - 24);
}

function fromHalf(bits: number): number {
	const exponent = (bits >> 10) & 0x1f;
	const fraction = bits & 0x3ff;
	if (exponent === 0) return fraction * 2 ** -24;
	if (exponent === 31) return fraction ? Number.NaN : Number.POSITIVE_INFINITY;
	return (1 + fraction / 1024) * 2 ** (exponent - 15);
}

/** An unsigned small float with `m` mantissa bits and 5 exponent bits. */
function fromSmallFloat(bits: number, m: number): number {
	const exponent = bits >> m;
	const fraction = bits & ((1 << m) - 1);
	if (exponent === 0) return (fraction / (1 << m)) * 2 ** -14;
	if (exponent === 31) return fraction ? Number.NaN : Number.POSITIVE_INFINITY;
	return (1 + fraction / (1 << m)) * 2 ** (exponent - 15);
}

/** Texels of one level of a format's bytes, as three floats each. */
function decode(format: Format, bytes: Uint8Array, texels: number): Float32Array {
	const out = new Float32Array(texels * 3);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let t = 0; t < texels; t++) {
		if (format === 'rgba16float') {
			for (let c = 0; c < 3; c++) out[t * 3 + c] = fromHalf(view.getUint16(t * 8 + c * 2, true));
		} else {
			const word = view.getUint32(t * 4, true);
			if (format === 'rgb9e5ufloat') {
				const unit = 2 ** ((word >>> 27) - 24);
				out[t * 3] = (word & 511) * unit;
				out[t * 3 + 1] = ((word >>> 9) & 511) * unit;
				out[t * 3 + 2] = ((word >>> 18) & 511) * unit;
			} else {
				out[t * 3] = fromSmallFloat(word & 0x7ff, 6);
				out[t * 3 + 1] = fromSmallFloat((word >>> 11) & 0x7ff, 6);
				out[t * 3 + 2] = fromSmallFloat(word >>> 22, 5);
			}
		}
	}
	return out;
}

const bytesPerTexel = (format: Format) => (format === 'rgba16float' ? 8 : 4);

/**
 * The filter's directions per texel: `first` at level 1, twice as many at each smaller level, up to
 * `most`. The engine and the asset tool take 512 and 8192.
 */
export interface SampleSchedule {
	first: number;
	most: number;
}

/** The room's steps, with the filter's directions per texel from `samples` when it is given. */
function stepsOf(stride: number, samples?: SampleSchedule): Step[] {
	const [steps] = roomSteps(SIZE, LEVELS, stride);
	if (!samples) return steps;
	return steps.map((step) =>
		step.pipeline === 'prefilter'
			? { ...step, samples: Math.min(samples.first << (step.level - 1), samples.most) }
			: step,
	);
}

// ---------------------------------------------------------------------------------------------
// WebGPU

/** WebGPU aligns dynamic uniform offsets, and buffer rows of texel copies, to 256 bytes. */
const ALIGNMENT = 256;
const alignRow = (bytes: number) => Math.ceil(bytes / ALIGNMENT) * ALIGNMENT;

export async function webgpuGenerator(
	shader: ShaderVariant<Pipeline>,
	compat: boolean,
	format: Format,
	write: Write,
	samples?: SampleSchedule,
): Promise<Generator> {
	const wgsl = shader.wgsl;
	if (!wgsl) throw new Error('the environment shader has no WebGPU build');
	const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'compatibility' });
	if (!adapter) throw new Error('no WebGPU adapter');
	const core = 'core-features-and-limits' as GPUFeatureName;
	const wanted: GPUFeatureName[] = [];
	if (!compat && adapter.features.has(core)) wanted.push(core);
	if (adapter.features.has('timestamp-query')) wanted.push('timestamp-query');
	if (adapter.features.has('rg11b10ufloat-renderable')) wanted.push('rg11b10ufloat-renderable');
	const device = await adapter.requestDevice({ requiredFeatures: wanted });
	const facts: Record<string, unknown> = {
		path: compat ? 'webgpu-compat' : 'webgpu',
		core: device.features.has(core),
		adapter:
			`${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}`.trim(),
		timestamps: device.features.has('timestamp-query'),
		rg11b10Renderable: device.features.has('rg11b10ufloat-renderable'),
	};
	// A browser that lists no core feature runs every device as core WebGPU, and one that gives only
	// compatibility mode gives no core device. The facts say which device each page ran on.
	if (compat && device.features.has(core))
		throw new Error(`${UNSUPPORTED} the adapter gives core WebGPU only`);
	facts.adapterListsCore = adapter.features.has(core);
	if (write === 'pack') format = 'rgb9e5ufloat';
	else if (format === 'rgb9e5ufloat') throw new Error('rgb9e5ufloat is drawn only by packing');
	if (format === 'rg11b10ufloat' && write !== 'pack' && !facts.rg11b10Renderable)
		throw new Error(`${UNSUPPORTED} the device cannot draw into rg11b10ufloat`);
	facts.format = format;
	facts.write = write;
	const errorList: string[] = [];
	device.addEventListener('uncapturederror', (event) =>
		errorList.push((event as GPUUncapturedErrorEvent).error.message),
	);
	device.lost.then((info) => {
		if (info.reason !== 'destroyed') errorList.push(`device lost: ${info.message}`);
	});
	const steps = stepsOf(ALIGNMENT, samples);
	const raw = write !== 'pack';
	const values = slotValues(steps, ALIGNMENT, raw);
	const target: GPUTextureFormat = write === 'pack' ? 'rgba8unorm' : format;
	const fragment = GPUShaderStage.FRAGMENT;
	const layout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: fragment,
				buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: STEP_BYTES },
			},
			{ binding: 1, visibility: fragment, texture: { viewDimension: 'cube' } },
			{ binding: 2, visibility: fragment, sampler: {} },
		],
	});
	const module = device.createShaderModule({ code: wgsl.source });
	const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
	const pipelines = {} as Record<Pipeline, GPURenderPipeline>;
	const describe = (name: Pipeline): GPURenderPipelineDescriptor => ({
		layout: pipelineLayout,
		vertex: { module, entryPoint: wgsl.pipelines[name].vertex },
		fragment: { module, entryPoint: wgsl.pipelines[name].fragment, targets: [{ format: target }] },
	});
	const sampler = device.createSampler({
		magFilter: 'linear',
		minFilter: 'linear',
		mipmapFilter: 'linear',
	});
	const usage =
		GPUTextureUsage.TEXTURE_BINDING |
		GPUTextureUsage.COPY_DST |
		GPUTextureUsage.COPY_SRC |
		(write === 'direct' ? GPUTextureUsage.RENDER_ATTACHMENT : 0);
	const cube = (levels: number) =>
		device.createTexture({
			size: [SIZE, SIZE, 6],
			format,
			usage,
			mipLevelCount: levels,
			textureBindingViewDimension: 'cube',
		});
	const textures: Record<StepTexture, GPUTexture> = {
		traced: cube(1),
		chain: cube(chainLevels(SIZE)),
		target: cube(LEVELS),
	};
	const staging =
		write === 'direct'
			? undefined
			: device.createTexture({
					size: [6 * SIZE, SIZE],
					format: target,
					usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
				});
	const stagingView = staging?.createView();
	const copies = device.createBuffer({
		size: alignRow(6 * SIZE * 4) * SIZE,
		usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
	});
	const uniforms = device.createBuffer({
		size: values.byteLength,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(uniforms, 0, values);
	const group = (view: GPUTextureView) =>
		device.createBindGroup({
			layout,
			entries: [
				{ binding: 0, resource: { buffer: uniforms, size: STEP_BYTES } },
				{ binding: 1, resource: view },
				{ binding: 2, resource: sampler },
			],
		});
	const cubeView = (texture: GPUTexture, base = 0, count?: number) =>
		texture.createView({ dimension: 'cube', baseMipLevel: base, mipLevelCount: count });
	const groups = {
		traced: group(cubeView(textures.traced)),
		chain: group(cubeView(textures.chain)),
	};
	const chainLevel =
		write === 'direct'
			? Array.from({ length: chainLevels(SIZE) }, (_, level) =>
					group(cubeView(textures.chain, level, 1)),
				)
			: [];
	const faceViews = new Map<string, GPUTextureView>();
	const faceView = (into: StepTexture, level: number, face: number) => {
		const key = `${into}/${level}/${face}`;
		let view = faceViews.get(key);
		if (!view) {
			view = textures[into].createView({
				dimension: '2d',
				baseMipLevel: level,
				mipLevelCount: 1,
				baseArrayLayer: face,
				arrayLayerCount: 1,
			});
			faceViews.set(key, view);
		}
		return view;
	};
	// Timestamps: at the start of a step's first pass and the end of its last.
	const timed = device.features.has('timestamp-query');
	const querySet = timed ? device.createQuerySet({ type: 'timestamp', count: 2 }) : undefined;
	const resolved = timed
		? device.createBuffer({
				size: 16,
				usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
			})
		: undefined;
	const readable = timed
		? device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
		: undefined;
	/** The passes of the step being recorded: how many, and how many so far. */
	const passes = { count: 0, done: 0 };
	const begin = (encoder: GPUCommandEncoder, attachment: GPURenderPassColorAttachment) => {
		const at = passes.done++;
		const writes: GPURenderPassTimestampWrites | undefined = querySet
			? {
					querySet,
					...(at === 0 && { beginningOfPassWriteIndex: 0 }),
					...(at === passes.count - 1 && { endOfPassWriteIndex: 1 }),
				}
			: undefined;
		return encoder.beginRenderPass({
			colorAttachments: [attachment],
			...(writes && (at === 0 || at === passes.count - 1) && { timestampWrites: writes }),
		});
	};
	const mainOf = (step: Step): StepTexture =>
		step.into.includes('target') ? 'target' : (step.into[0] as StepTexture);
	const band = (encoder: GPUCommandEncoder, { step: k, y, rows }: Band, warm = false) => {
		const step = steps[k] as Step;
		const pipeline = pipelines[step.pipeline];
		if (write !== 'direct') {
			const pass = begin(encoder, {
				view: stagingView as GPUTextureView,
				loadOp: 'clear',
				storeOp: 'store',
			});
			if (warm) pass.setViewport(0, 0, 1, 1, 0, 1);
			else pass.setViewport(0, y, 6 * step.size, rows, 0, 1);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, groups[step.source], [k * SLOTS_PER_STEP * ALIGNMENT]);
			pass.draw(3);
			pass.end();
			if (warm) return;
			if (write === 'pack') {
				const bytesPerRow = alignRow(6 * step.size * 4);
				const strip = { buffer: copies, bytesPerRow, rowsPerImage: rows };
				encoder.copyTextureToBuffer({ texture: staging as GPUTexture, origin: [0, y] }, strip, [
					6 * step.size,
					rows,
					1,
				]);
				for (let face = 0; face < 6; face++)
					for (const into of step.into)
						encoder.copyBufferToTexture(
							{ ...strip, offset: face * step.size * 4 },
							{ texture: textures[into], mipLevel: step.level, origin: [0, y, face] },
							[step.size, rows, 1],
						);
			} else {
				for (let face = 0; face < 6; face++)
					for (const into of step.into)
						encoder.copyTextureToTexture(
							{ texture: staging as GPUTexture, origin: [face * step.size, y, 0] },
							{ texture: textures[into], mipLevel: step.level, origin: [0, y, face] },
							[step.size, rows, 1],
						);
			}
			return;
		}
		// Direct: the blur draws into the map and copies into the chain. The trace binds the chain,
		// which it never reads, so that no texture is both read and drawn in one pass.
		const main = mainOf(step);
		const source =
			step.pipeline === 'half'
				? (chainLevel[step.level - 1] as GPUBindGroup)
				: step.pipeline === 'trace'
					? groups.chain
					: groups[step.source];
		for (let face = 0; face < (warm ? 1 : 6); face++) {
			const pass = begin(encoder, {
				view: faceView(main, step.level, face),
				loadOp: 'load',
				storeOp: 'store',
			});
			if (warm) pass.setViewport(0, 0, 1, 1, 0, 1);
			else pass.setViewport(0, y, step.size, rows, 0, 1);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, source, [(k * SLOTS_PER_STEP + 1 + face) * ALIGNMENT]);
			pass.draw(3);
			pass.end();
		}
		if (warm) return;
		for (const into of step.into)
			if (into !== main)
				encoder.copyTextureToTexture(
					{ texture: textures[main], mipLevel: step.level, origin: [0, y, 0] },
					{ texture: textures[into], mipLevel: step.level, origin: [0, y, 0] },
					[step.size, rows, 6],
				);
	};
	const submit = async (record: (encoder: GPUCommandEncoder) => void, count: number) => {
		const start = performance.now();
		passes.count = count;
		passes.done = 0;
		const encoder = device.createCommandEncoder();
		record(encoder);
		if (querySet && resolved && readable && count > 0) {
			encoder.resolveQuerySet(querySet, 0, 2, resolved, 0);
			encoder.copyBufferToBuffer(resolved, 0, readable, 0, 16);
		}
		device.queue.submit([encoder.finish()]);
		const cpuMs = performance.now() - start;
		await device.queue.onSubmittedWorkDone();
		const wallMs = performance.now() - start;
		if (!readable || count === 0) return { cpuMs, wallMs };
		await readable.mapAsync(GPUMapMode.READ);
		const [first, last] = new BigUint64Array(readable.getMappedRange());
		const gpuMs = Number((last as bigint) - (first as bigint)) / 1e6;
		readable.unmap();
		return { cpuMs, wallMs, gpuMs };
	};
	const passesPerBand = write === 'direct' ? 6 : 1;
	return {
		facts,
		steps,
		async prepare() {
			await Promise.all(
				PIPELINES.map(async (name) => {
					pipelines[name] = await device.createRenderPipelineAsync(describe(name));
				}),
			);
		},
		run(bands) {
			return submit((encoder) => {
				for (const b of bands) band(encoder, b);
			}, bands.length * passesPerBand);
		},
		async warm() {
			const out = {} as Record<Pipeline, StepTime>;
			for (const name of PIPELINES) {
				const k = steps.findIndex((s) => s.pipeline === name);
				out[name] = await submit((encoder) => band(encoder, { step: k, y: 0, rows: 1 }, true), 1);
			}
			return out;
		},
		async read() {
			const levels: Float32Array[] = [];
			const texel = bytesPerTexel(format);
			for (let level = 0; level < LEVELS; level++) {
				const side = SIZE >> level;
				const rowBytes = side * texel;
				const bytesPerRow = alignRow(rowBytes);
				const buffer = device.createBuffer({
					size: bytesPerRow * side * 6,
					usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
				});
				const encoder = device.createCommandEncoder();
				encoder.copyTextureToBuffer(
					{ texture: textures.target, mipLevel: level },
					{ buffer, bytesPerRow, rowsPerImage: side },
					[side, side, 6],
				);
				device.queue.submit([encoder.finish()]);
				await buffer.mapAsync(GPUMapMode.READ);
				const mapped = new Uint8Array(buffer.getMappedRange());
				const packed = new Uint8Array(6 * side * rowBytes);
				for (let row = 0; row < 6 * side; row++)
					packed.set(
						mapped.subarray(row * bytesPerRow, row * bytesPerRow + rowBytes),
						row * rowBytes,
					);
				buffer.unmap();
				buffer.destroy();
				levels.push(decode(format, packed, 6 * side * side));
			}
			return levels;
		},
		async errors() {
			return [...errorList];
		},
		destroy() {
			device.destroy();
		},
	};
}

// ---------------------------------------------------------------------------------------------
// WebGL2

/** WebGL2's timer queries, which TypeScript's DOM types do not describe. */
interface TimerQuery {
	readonly TIME_ELAPSED_EXT: number;
	readonly GPU_DISJOINT_EXT: number;
}

/** Resolves on the next turn of the page's event loop, with no timer's least delay. */
const turn = () =>
	new Promise<void>((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => resolve();
		channel.port2.postMessage(0);
	});

export async function webgl2Generator(
	shader: ShaderVariant<Pipeline>,
	format: Format,
	write: Write,
	noFloat: boolean,
	debug = false,
	samples?: SampleSchedule,
): Promise<Generator> {
	const canvas = new OffscreenCanvas(1, 1);
	const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false });
	if (!gl) throw new Error('no WebGL2 context');
	const floatColor = noFloat ? null : gl.getExtension('EXT_color_buffer_float');
	const halfColor = noFloat ? null : gl.getExtension('EXT_color_buffer_half_float');
	const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQuery | null;
	const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
	const facts: Record<string, unknown> = {
		path: 'webgl2',
		renderer: rendererInfo
			? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
			: gl.getParameter(gl.RENDERER),
		floatColor: Boolean(floatColor),
		halfColor: Boolean(halfColor),
		timer: Boolean(timer),
		askedFormat: format,
		askedWrite: write,
	};
	if (write === 'pack') format = 'rgb9e5ufloat';
	else if (format === 'rgb9e5ufloat') throw new Error('rgb9e5ufloat is drawn only by packing');
	// A device that cannot draw the format falls back to packing, as the engine would.
	const renderable =
		format === 'rgba16float' ? Boolean(floatColor || halfColor) : Boolean(floatColor);
	if (write !== 'pack' && !renderable) {
		facts.fallback = `the context cannot draw ${format}, so the generator packs RGB9_E5 bytes`;
		format = 'rgb9e5ufloat';
		write = 'pack';
	}
	facts.format = format;
	facts.write = write;
	const internal = {
		rgb9e5ufloat: gl.RGB9_E5,
		rgba16float: gl.RGBA16F,
		rg11b10ufloat: gl.R11F_G11F_B10F,
	}[format];
	const parallel = gl.getExtension('KHR_parallel_shader_compile');
	const host = programHost(gl, DEPTH_SETUPS.reversed, parallel);
	const variants = { webgl2: shader };
	const programs = {} as Record<Pipeline, WebGLProgram>;
	const alignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
	const stride = Math.ceil(STEP_BYTES / alignment) * alignment;
	const steps = stepsOf(stride, samples);
	const values = slotValues(steps, stride, write !== 'pack');
	const made: WebGLTexture[] = [];
	const texture = (kind: number, storage: (kind: number) => void) => {
		const t = gl.createTexture();
		if (!t) throw new Error('WebGL2 could not create a texture');
		gl.bindTexture(kind, t);
		storage(kind);
		made.push(t);
		return t;
	};
	const cube = (count: number) =>
		texture(gl.TEXTURE_CUBE_MAP, (t) => gl.texStorage2D(t, count, internal, SIZE, SIZE));
	const textures: Record<StepTexture, WebGLTexture> = {
		traced: cube(1),
		chain: cube(chainLevels(SIZE)),
		target: cube(LEVELS),
	};
	const bytesStaging = () =>
		texture(gl.TEXTURE_2D, (t) => gl.texStorage2D(t, 1, gl.RGBA8, 6 * SIZE, SIZE));
	const staging =
		write === 'pack'
			? bytesStaging()
			: write === 'spare'
				? texture(gl.TEXTURE_2D, (t) => gl.texStorage2D(t, 1, internal, 6 * SIZE, SIZE))
				: undefined;
	const framebuffer = gl.createFramebuffer();
	const texels = gl.createBuffer();
	gl.bindBuffer(gl.PIXEL_PACK_BUFFER, texels);
	gl.bufferData(gl.PIXEL_PACK_BUFFER, 6 * SIZE * SIZE * 4, gl.STREAM_COPY);
	gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
	const uniforms = gl.createBuffer();
	gl.bindBuffer(gl.UNIFORM_BUFFER, uniforms);
	gl.bufferData(gl.UNIFORM_BUFFER, values, gl.STATIC_DRAW);
	const sampler = gl.createSampler();
	gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
	gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
		gl.samplerParameteri(sampler, wrap, gl.CLAMP_TO_EDGE);
	const errorList: string[] = [];
	const checkFramebuffer = (where: string) => {
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		if (status !== gl.FRAMEBUFFER_COMPLETE && errorList.length < 8)
			errorList.push(`${where}: framebuffer incomplete, 0x${status.toString(16)}`);
	};
	const unit = () => host.slot(0, 1);
	const binding = () => host.slot(0, 0);
	const useStep = (pipeline: Pipeline, slot: number) => {
		gl.useProgram(programs[pipeline]);
		gl.bindBufferRange(gl.UNIFORM_BUFFER, binding(), uniforms, slot * stride, STEP_BYTES);
	};
	const face = (f: number) => gl.TEXTURE_CUBE_MAP_POSITIVE_X + f;
	const band = ({ step: k, y, rows }: Band, warm = false) => {
		const step = steps[k] as Step;
		const width = 6 * step.size;
		if (write !== 'direct') {
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				gl.TEXTURE_2D,
				staging as WebGLTexture,
				0,
			);
			useStep(step.pipeline, k * SLOTS_PER_STEP);
			gl.bindTexture(gl.TEXTURE_CUBE_MAP, textures[step.source]);
			if (warm) gl.viewport(0, 0, 1, 1);
			else gl.viewport(0, y, width, rows);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			if (warm) return;
			if (write === 'pack') {
				gl.bindBuffer(gl.PIXEL_PACK_BUFFER, texels);
				gl.readPixels(0, y, width, rows, gl.RGBA, gl.UNSIGNED_BYTE, 0);
				gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
				gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, texels);
				gl.pixelStorei(gl.UNPACK_ROW_LENGTH, width);
				for (const into of step.into) {
					gl.bindTexture(gl.TEXTURE_CUBE_MAP, textures[into]);
					for (let f = 0; f < 6; f++)
						gl.texSubImage2D(
							face(f),
							step.level,
							0,
							y,
							step.size,
							rows,
							gl.RGB,
							gl.UNSIGNED_INT_5_9_9_9_REV,
							f * step.size * 4,
						);
				}
				gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
				gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
			} else {
				for (const into of step.into) {
					gl.bindTexture(gl.TEXTURE_CUBE_MAP, textures[into]);
					for (let f = 0; f < 6; f++)
						gl.copyTexSubImage2D(face(f), step.level, 0, y, f * step.size, y, step.size, rows);
				}
			}
			return;
		}
		// Direct: each face's level is the draw's target. The chain's draws read only the level before
		// theirs. The blur draws into the map, then copies into the chain. The trace binds no texture.
		const main: StepTexture = step.into.includes('target')
			? 'target'
			: (step.into[0] as StepTexture);
		const half = step.pipeline === 'half';
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, step.pipeline === 'trace' ? null : textures[step.source]);
		if (half) {
			gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, step.level - 1);
			gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, step.level - 1);
		}
		if (warm) gl.viewport(0, 0, 1, 1);
		else gl.viewport(0, y, step.size, rows);
		for (let f = 0; f < (warm ? 1 : 6); f++) {
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				face(f),
				textures[main],
				step.level,
			);
			useStep(step.pipeline, k * SLOTS_PER_STEP + 1 + f);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		}
		if (half) {
			gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_BASE_LEVEL, 0);
			gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, chainLevels(SIZE) - 1);
		}
		if (warm) return;
		for (const into of step.into) {
			if (into === main) continue;
			gl.bindTexture(gl.TEXTURE_CUBE_MAP, textures[into]);
			for (let f = 0; f < 6; f++) {
				gl.framebufferTexture2D(
					gl.FRAMEBUFFER,
					gl.COLOR_ATTACHMENT0,
					face(f),
					textures[main],
					step.level,
				);
				gl.copyTexSubImage2D(face(f), step.level, 0, y, 0, y, step.size, rows);
			}
		}
	};
	const begin = () => {
		gl.activeTexture(gl.TEXTURE0 + unit());
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.bindVertexArray(null);
		gl.bindSampler(unit(), sampler);
	};
	const finish = () => {
		gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
		gl.bindSampler(unit(), null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	};
	let checked = false;
	/** Notes the first GL error after a band of each kind of draw, for ?debug=1. */
	const noted = new Set<string>();
	const noteError = ({ step: k, y }: Band) => {
		const error = gl.getError();
		const step = steps[k] as Step;
		const kind = `${step.pipeline} ${step.level}`;
		if (error !== gl.NO_ERROR && !noted.has(kind)) {
			noted.add(kind);
			errorList.push(`${kind}, row ${y}: WebGL error 0x${error.toString(16)}`);
		}
	};
	/** Runs `record` in a timer query, where the context has one, and waits on a fence for the GPU. */
	const submit = async (record: () => void): Promise<StepTime> => {
		const query = timer && gl.createQuery();
		if (timer && query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
		const start = performance.now();
		begin();
		if (!checked) {
			// The first target shows whether the context can draw the format at all.
			if (write === 'direct')
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, face(0), textures.traced, 0);
			else
				gl.framebufferTexture2D(
					gl.FRAMEBUFFER,
					gl.COLOR_ATTACHMENT0,
					gl.TEXTURE_2D,
					staging as WebGLTexture,
					0,
				);
			checkFramebuffer(`${write} ${format}`);
			checked = true;
		}
		record();
		finish();
		if (timer) gl.endQuery(timer.TIME_ELAPSED_EXT);
		const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
		gl.flush();
		const cpuMs = performance.now() - start;
		while (fence && gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) await turn();
		gl.deleteSync(fence);
		const wallMs = performance.now() - start;
		if (!timer || !query) return { cpuMs, wallMs };
		for (
			let wait = 0;
			!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && wait < 200;
			wait++
		)
			await turn();
		const ready = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean;
		const gpuMs =
			ready && !gl.getParameter(timer.GPU_DISJOINT_EXT)
				? (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6
				: undefined;
		gl.deleteQuery(query);
		return { cpuMs, wallMs, gpuMs };
	};
	return {
		facts,
		steps,
		async prepare() {
			await Promise.all(
				PIPELINES.map(async (pipeline) => {
					programs[pipeline] = await host.programLater({ shader: variants, pipeline });
				}),
			);
		},
		run(bands) {
			return submit(() => {
				for (const b of bands) {
					band(b);
					if (debug) noteError(b);
				}
			});
		},
		async warm() {
			const out = {} as Record<Pipeline, StepTime>;
			for (const pipeline of PIPELINES) {
				const k = steps.findIndex((s) => s.pipeline === pipeline);
				out[pipeline] = await submit(() => band({ step: k, y: 0, rows: 1 }, true));
			}
			return out;
		},
		async read() {
			const levels: Float32Array[] = [];
			begin();
			if (floatColor && format !== 'rgb9e5ufloat') {
				// Float maps read back as floats, face by face.
				for (let level = 0; level < LEVELS; level++) {
					const side = SIZE >> level;
					const out = new Float32Array(6 * side * side * 3);
					const rgba = new Float32Array(side * side * 4);
					for (let f = 0; f < 6; f++) {
						gl.framebufferTexture2D(
							gl.FRAMEBUFFER,
							gl.COLOR_ATTACHMENT0,
							face(f),
							textures.target,
							level,
						);
						gl.readPixels(0, 0, side, side, gl.RGBA, gl.FLOAT, rgba);
						for (let t = 0; t < side * side; t++)
							out.set(rgba.subarray(t * 4, t * 4 + 3), (f * side * side + t) * 3);
					}
					levels.push(out);
				}
			} else {
				// WebGL2 reads no shared-exponent texture, so the `half` pipeline packs each level's
				// texels into RGBA8 bytes, exact for shared-exponent texels.
				const bytes = write === 'pack' ? (staging as WebGLTexture) : bytesStaging();
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bytes, 0);
				gl.bindTexture(gl.TEXTURE_CUBE_MAP, textures.target);
				for (let level = 0; level < LEVELS; level++) {
					const side = SIZE >> level;
					useStep('half', readSlot(steps, level));
					gl.viewport(0, 0, 6 * side, side);
					gl.drawArrays(gl.TRIANGLES, 0, 3);
					const strip = new Uint8Array(6 * side * side * 4);
					gl.readPixels(0, 0, 6 * side, side, gl.RGBA, gl.UNSIGNED_BYTE, strip);
					const ordered = new Uint8Array(strip.length);
					for (let row = 0; row < side; row++)
						for (let f = 0; f < 6; f++) {
							const from = (row * 6 + f) * side * 4;
							ordered.set(strip.subarray(from, from + side * 4), (f * side + row) * side * 4);
						}
					levels.push(decode('rgb9e5ufloat', ordered, 6 * side * side));
				}
			}
			finish();
			return levels;
		},
		async errors() {
			for (
				let error = gl.getError();
				error !== gl.NO_ERROR && errorList.length < 8;
				error = gl.getError()
			)
				errorList.push(`WebGL error 0x${error.toString(16)}`);
			return errorList;
		},
		destroy() {
			gl.deleteFramebuffer(framebuffer);
			gl.deleteBuffer(texels);
			gl.deleteBuffer(uniforms);
			gl.deleteSampler(sampler);
			for (const t of made) gl.deleteTexture(t);
			for (const p of Object.values(programs)) gl.deleteProgram(p);
			gl.getExtension('WEBGL_lose_context')?.loseContext();
		},
	};
}
