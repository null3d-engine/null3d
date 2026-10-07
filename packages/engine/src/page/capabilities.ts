// The capability probe. It reads what the browser and device can do, by feature tests only: the
// engine never decides anything from browser or GPU names. The report is plain JSON, so test
// runners can store it and compare it across devices.

import { EngineError } from '../errors/engine-error';
import { messageOf } from '../errors/message';
import { TEXTURE_USAGE_TRANSIENT_ATTACHMENT } from '../generated/gpu';
import type { DeviceHints } from '../quality/chooser';
import { spawnWorker } from '../shared/worker-start';
import type { ProbeMessage, WorkerProbe } from '../workers/probe-worker';

/** Limits the engine reads, from its portable WebGPU budget. */
const WEBGPU_LIMITS = [
	'maxBindGroups',
	'maxBindGroupsPlusVertexBuffers',
	'maxBindingsPerBindGroup',
	'maxBufferSize',
	'maxColorAttachmentBytesPerSample',
	'maxColorAttachments',
	'maxComputeInvocationsPerWorkgroup',
	'maxComputeWorkgroupSizeX',
	'maxComputeWorkgroupSizeY',
	'maxComputeWorkgroupSizeZ',
	'maxComputeWorkgroupStorageSize',
	'maxComputeWorkgroupsPerDimension',
	'maxDynamicStorageBuffersPerPipelineLayout',
	'maxDynamicUniformBuffersPerPipelineLayout',
	'maxInterStageShaderVariables',
	'maxSampledTexturesPerShaderStage',
	'maxSamplersPerShaderStage',
	'maxStorageBufferBindingSize',
	'maxStorageBuffersPerShaderStage',
	'maxStorageBuffersInVertexStage',
	'maxStorageBuffersInFragmentStage',
	'maxStorageTexturesPerShaderStage',
	'maxStorageTexturesInVertexStage',
	'maxStorageTexturesInFragmentStage',
	'maxTextureArrayLayers',
	'maxTextureDimension1D',
	'maxTextureDimension2D',
	'maxTextureDimension3D',
	'maxUniformBufferBindingSize',
	'maxUniformBuffersPerShaderStage',
	'maxVertexAttributes',
	'maxVertexBufferArrayStride',
	'maxVertexBuffers',
	'minStorageBufferOffsetAlignment',
	'minUniformBufferOffsetAlignment',
	'maxImmediateSize',
] as const;

/** WebGL2 extensions the engine uses or tests for, each requested by name. */
const WEBGL2_EXTENSIONS = [
	'EXT_color_buffer_float',
	'EXT_color_buffer_half_float',
	'EXT_float_blend',
	'OES_texture_float_linear',
	'WEBGL_multi_draw',
	'KHR_parallel_shader_compile',
	'EXT_disjoint_timer_query_webgl2',
	'EXT_clip_control',
	'EXT_texture_filter_anisotropic',
	'WEBGL_compressed_texture_astc',
	'WEBGL_compressed_texture_etc',
	'WEBGL_compressed_texture_s3tc',
	'WEBGL_compressed_texture_s3tc_srgb',
	'EXT_texture_compression_bptc',
	'EXT_texture_compression_rgtc',
	'WEBGL_draw_instanced_base_vertex_base_instance',
	'WEBGL_multi_draw_instanced_base_vertex_base_instance',
	'OVR_multiview2',
] as const;

/**
 * The color that the float render target test clears to. One channel is above 1, which high
 * dynamic range color needs, and every value is exact as a 16-bit float.
 */
const FLOAT_TARGET_COLOR = [2, 0.5, 0.25, 1] as const;

/**
 * What the browser's WebGPU offers, in `CapabilityReport.webgpu`.
 *
 * @category api/engine
 */
export interface WebGPUReport {
	/** True when the browser has WebGPU. */
	available: boolean;
	/** An adapter from a compatibility-mode request (the engine's normal request). */
	compatibilityAdapter: boolean;
	/** The adapter offers `core-features-and-limits`, so the device can run as core WebGPU. */
	coreFeaturesAndLimits: boolean;
	/** The adapter's optional features, sorted. */
	features: string[];
	/** Each limit, or null when the adapter does not report it (absent, never zero). */
	limits: Record<string, number | null>;
	/** The WGSL language features the browser supports, sorted. */
	wgslLanguageFeatures: string[];
	/** The canvas texture format the browser prefers, or null without WebGPU. */
	preferredCanvasFormat: string | null;
	/**
	 * True when the browser's WebGPU has the transient attachment texture usage (Chrome 146 and
	 * later). A render target with it can stay in a tile-based GPU's own memory. The engine gives
	 * it to the targets that live within one render pass, such as the multisampled color and depth.
	 */
	transientAttachments: boolean;
	/**
	 * Reported for the record. The engine reads no meaning from it, and only compares it with an
	 * earlier start's, to tell whether a stored preset check came from the same GPU.
	 */
	adapterInfo: { vendor: string; architecture: string; device: string; description: string } | null;
	/** Why the probe failed, when it did. */
	error?: string;
}

/**
 * What the browser's WebGL2 offers, in `CapabilityReport.webgl2`.
 *
 * @category api/engine
 */
export interface WebGL2Report {
	/** True when the browser can make a WebGL2 context. */
	available: boolean;
	/** Each extension the engine uses or tests for, and whether the browser has it. */
	extensions: Record<string, boolean>;
	/** The list as the browser reports it, in its order; some browsers shuffle it, so it is only recorded. */
	supportedExtensions: string[];
	/** The most samples per pixel for antialiasing, or null without WebGL2. */
	maxSamples: number | null;
	/** The largest texture width and height in pixels, or null without WebGL2. */
	maxTextureSize: number | null;
	/** The largest renderbuffer width and height in pixels, or null without WebGL2. */
	maxRenderbufferSize: number | null;
	/** The largest viewport width and height in pixels, or null without WebGL2. */
	maxViewportDims: [width: number, height: number] | null;
	/** The largest uniform block in bytes, or null without WebGL2. */
	maxUniformBlockSize: number | null;
	/** Whether WebGL accepts views on shared memory for buffer and texture uploads. Null without shared memory. */
	sharedMemoryUploads: {
		bufferSubData: boolean;
		texSubImage2D: boolean;
	} | null;
	/**
	 * Whether the device renders into float textures, which high dynamic range color needs. The
	 * engine tests a 16-bit and a 32-bit float RGBA texture. `complete` says whether a framebuffer
	 * with the texture is complete. `readsBack` says whether a clear to a known color, with a value
	 * above 1, reads back as floats. `samples` is the most samples per pixel for antialiasing that
	 * the format takes, or 0 where the device does not render into it. WebGL2 renders into both
	 * formats with `EXT_color_buffer_float`, and into the 16-bit one with
	 * `EXT_color_buffer_half_float`. The engine draws high dynamic range color where the 16-bit
	 * format passes both tests, and with MSAA takes 4 samples. Null without WebGL2.
	 */
	floatRenderTargets: {
		rgba16f: { complete: boolean; readsBack: boolean; samples: number };
		rgba32f: { complete: boolean; readsBack: boolean; samples: number };
	} | null;
	/**
	 * Reported for the record. The engine reads no meaning from it, and only compares it with an
	 * earlier start's, to tell whether a stored preset check came from the same GPU.
	 */
	renderer: string | null;
	/** Why the probe failed, when it did. */
	error?: string;
}

/**
 * What the browser and device can do, as plain JSON. The engine picks its build and GPU path from
 * these feature tests, and its quality preset from the device hints. It never decides from browser
 * or GPU names.
 *
 * @category api/engine
 */
export interface CapabilityReport extends DeviceHints {
	/** True when the page is cross-origin isolated, which shared memory needs. */
	crossOriginIsolated: boolean;
	/** True when the page can make shared memory. */
	sharedArrayBuffer: boolean;
	/** True when the browser has `Atomics.waitAsync`. */
	atomicsWaitAsync: boolean;
	/** The logical cores that the browser reports. */
	hardwareConcurrency: number;
	/** Device pixels per CSS pixel when the probe ran. */
	devicePixelRatio: number;
	/** True when the browser has `OffscreenCanvas`. */
	offscreenCanvas: boolean;
	/** True when a page canvas can hand its drawing to a worker. */
	transferControlToOffscreen: boolean;
	/** What WebGPU offers. */
	webgpu: WebGPUReport;
	/** What WebGL2 offers. */
	webgl2: WebGL2Report;
	/** What a dedicated worker can do, or why the probe worker gave no answer. */
	worker: WorkerProbe | WorkerProbeFailure;
}

/**
 * Why the probe worker gave no answer, in `CapabilityReport.worker`. The engine then draws on the
 * page's thread, and `engine.mode.renderFallback` names the reason.
 *
 * @category api/engine
 */
export interface WorkerProbeFailure {
	/**
	 * `no-answer` when neither probe worker answered within its time limit, which a stalled GPU
	 * call or a very busy machine causes. `failed-to-start` when the worker's script failed to load
	 * or run.
	 */
	failure: 'no-answer' | 'failed-to-start';
	/** The failure in words. */
	error: string;
}

async function probeWebGPU(powerPreference?: PowerPreference): Promise<WebGPUReport> {
	const empty: WebGPUReport = {
		available: false,
		compatibilityAdapter: false,
		coreFeaturesAndLimits: false,
		features: [],
		limits: {},
		wgslLanguageFeatures: [],
		preferredCanvasFormat: null,
		transientAttachments: false,
		adapterInfo: null,
	};
	const gpu = globalThis.navigator?.gpu;
	if (!gpu) return empty;
	try {
		const adapter = await gpu.requestAdapter({ featureLevel: 'compatibility', powerPreference });
		const limits: Record<string, number | null> = {};
		for (const name of WEBGPU_LIMITS) {
			const value = adapter
				? (adapter.limits as unknown as Record<string, unknown>)[name]
				: undefined;
			limits[name] = typeof value === 'number' ? value : null;
		}
		const info = adapter?.info;
		return {
			available: true,
			compatibilityAdapter: adapter !== null,
			coreFeaturesAndLimits: adapter?.features.has('core-features-and-limits') ?? false,
			features: adapter ? [...adapter.features].sort() : [],
			limits,
			wgslLanguageFeatures: [...(gpu.wgslLanguageFeatures ?? [])].sort(),
			preferredCanvasFormat: gpu.getPreferredCanvasFormat(),
			// The engine passes its own usage bits to WebGPU, so the browser's must match them.
			transientAttachments:
				(globalThis.GPUTextureUsage as unknown as Record<string, number> | undefined)
					?.TRANSIENT_ATTACHMENT === TEXTURE_USAGE_TRANSIENT_ATTACHMENT,
			adapterInfo: info
				? {
						vendor: info.vendor,
						architecture: info.architecture,
						device: info.device,
						description: info.description,
					}
				: null,
		};
	} catch (e) {
		return { ...empty, available: true, error: messageOf(e) };
	}
}

function probeSharedUploads(gl: WebGL2RenderingContext): WebGL2Report['sharedMemoryUploads'] {
	if (typeof SharedArrayBuffer !== 'function') return null;
	const shared = new Uint8Array(new SharedArrayBuffer(64));
	let bufferSubData = false;
	let texSubImage2D = false;
	const buffer = gl.createBuffer();
	try {
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, 64, gl.DYNAMIC_DRAW);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, shared);
		bufferSubData = gl.getError() === gl.NO_ERROR;
	} catch {
		bufferSubData = false;
	}
	gl.deleteBuffer(buffer);
	const texture = gl.createTexture();
	try {
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 4, 4);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, shared);
		texSubImage2D = gl.getError() === gl.NO_ERROR;
	} catch {
		texSubImage2D = false;
	}
	gl.deleteTexture(texture);
	return { bufferSubData, texSubImage2D };
}

/** Reads the errors that earlier calls left, so they do not reach later checks. Each read clears one. */
function clearErrors(gl: WebGL2RenderingContext): void {
	for (let k = 0; k < 8 && gl.getError() !== gl.NO_ERROR; k++) {
		// Read until clear.
	}
}

type FloatTargetTest = NonNullable<WebGL2Report['floatRenderTargets']>['rgba16f'];

/**
 * The most samples per pixel that a renderbuffer of a color format takes, or 0 where the device
 * does not render into the format. The driver answers without waiting for the GPU.
 */
function formatSamples(gl: WebGL2RenderingContext, format: number): number {
	try {
		const counts = gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES) as
			| Int32Array
			| null
			| undefined;
		// The driver lists the counts from the most samples down.
		return counts?.[0] ?? 0;
	} catch {
		return 0;
	}
}

/**
 * Tests a 1 x 1 texture of a float format as a render target: whether the framebuffer is complete,
 * and whether a clear to a known color reads back as floats. It also asks how many samples a
 * multisampled renderbuffer of the format takes. The test runs at every engine start. Each
 * readback and each error check waits for the GPU, so it reads one pixel and checks for errors
 * only after a failure. WebGL turns on the float color-buffer extensions only when they are asked
 * for by name, so this runs after those requests.
 */
export function probeFloatTarget(gl: WebGL2RenderingContext, format: number): FloatTargetTest {
	const texture = gl.createTexture();
	const framebuffer = gl.createFramebuffer();
	let complete = false;
	let readsBack = false;
	let samples = 0;
	try {
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texStorage2D(gl.TEXTURE_2D, 1, format, 1, 1);
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
		if (complete) {
			gl.clearColor(...FLOAT_TARGET_COLOR);
			gl.clear(gl.COLOR_BUFFER_BIT);
			// A refused read leaves the pixel at zero, so the values alone show whether it worked.
			const pixel = new Float32Array(4);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);
			readsBack = FLOAT_TARGET_COLOR.every((value, channel) => pixel[channel] === value);
			samples = formatSamples(gl, format);
		}
	} catch {
		// A browser that throws here cannot render into the format.
	} finally {
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.deleteFramebuffer(framebuffer);
		gl.deleteTexture(texture);
		// Only a test that failed can leave errors.
		if (!readsBack) clearErrors(gl);
	}
	return { complete, readsBack, samples };
}

function probeWebGL2(powerPreference?: PowerPreference): WebGL2Report {
	const empty: WebGL2Report = {
		available: false,
		extensions: {},
		supportedExtensions: [],
		maxSamples: null,
		maxTextureSize: null,
		maxRenderbufferSize: null,
		maxViewportDims: null,
		maxUniformBlockSize: null,
		sharedMemoryUploads: null,
		floatRenderTargets: null,
		renderer: null,
	};
	try {
		const canvas =
			typeof OffscreenCanvas === 'function'
				? new OffscreenCanvas(1, 1)
				: document.createElement('canvas');
		const gl = canvas.getContext('webgl2', { powerPreference }) as WebGL2RenderingContext | null;
		if (!gl) return empty;
		const extensions: Record<string, boolean> = {};
		for (const name of WEBGL2_EXTENSIONS) extensions[name] = gl.getExtension(name) !== null;
		const debug = gl.getExtension('WEBGL_debug_renderer_info');
		const report: WebGL2Report = {
			available: true,
			extensions,
			supportedExtensions: gl.getSupportedExtensions() ?? [],
			maxSamples: gl.getParameter(gl.MAX_SAMPLES) as number,
			maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
			maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
			maxViewportDims: [...(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array)] as [
				number,
				number,
			],
			maxUniformBlockSize: gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) as number,
			sharedMemoryUploads: probeSharedUploads(gl),
			floatRenderTargets: {
				rgba16f: probeFloatTarget(gl, gl.RGBA16F),
				rgba32f: probeFloatTarget(gl, gl.RGBA32F),
			},
			renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null,
		};
		gl.getExtension('WEBGL_lose_context')?.loseContext();
		return report;
	} catch (e) {
		return { ...empty, error: messageOf(e) };
	}
}

/**
 * How long the probe worker's GPU checks may take once its script runs. A GPU call that never
 * returns ends the wait. The script's download does not count: the network or the server can delay
 * it for any time, and the browser reports a download that fails. The checks take milliseconds,
 * so a worker that has not answered by then is stalled. A second worker then gets a longer wait,
 * because a page that gives up draws on its own thread for the whole session.
 */
const WORKER_PROBE_TIMEOUTS_MS = [5000, 10_000] as const;

/**
 * Runs the probe worker, with each of `timeoutsMs` in turn as its time limit while it gives no
 * answer. A worker that fails to start is not tried again.
 */
export async function probeWorker(
	timeoutsMs: readonly number[] = WORKER_PROBE_TIMEOUTS_MS,
): Promise<WorkerProbe | WorkerProbeFailure> {
	for (const timeoutMs of timeoutsMs) {
		const result = await probeWorkerOnce(timeoutMs);
		if (!('failure' in result) || result.failure !== 'no-answer') return result;
	}
	const limits = timeoutsMs.map((ms) => `${ms / 1000} s`).join(', then ');
	return {
		failure: 'no-answer',
		error: `no probe worker answered within its time limit (${limits})`,
	};
}

/**
 * The probe worker's answer that the page's engine starts share. Firefox makes a new WebGL2
 * context wait for the WebGL work that other contexts have queued, such as a shader link. On a
 * software renderer an engine's links take seconds, so a start's probe can outlast its time
 * limits while another engine on the page starts. A worker's abilities hold for the page's life,
 * so one full answer serves every later start. A failure is not kept.
 */
let pageProbe: Promise<WorkerProbe | WorkerProbeFailure> | undefined;

/**
 * The probe worker's answer for the page: the kept answer, the answer of a probe that is running,
 * or a new probe's, with `timeoutsMs` as its time limits.
 */
export function pageWorkerProbe(
	timeoutsMs: readonly number[] = WORKER_PROBE_TIMEOUTS_MS,
): Promise<WorkerProbe | WorkerProbeFailure> {
	if (pageProbe) return pageProbe;
	const probe = probeWorker(timeoutsMs);
	pageProbe = probe;
	void probe.then((result) => {
		if ('failure' in result && pageProbe === probe) pageProbe = undefined;
	});
	return probe;
}

/** Drops the kept answer, as after a lost GPU, so that the next start probes again. */
export function forgetWorkerProbe(): void {
	pageProbe = undefined;
}

/** Runs one probe worker, which must answer within `timeoutMs` of its script's start. */
function probeWorkerOnce(timeoutMs: number): Promise<WorkerProbe | WorkerProbeFailure> {
	return new Promise((resolve) => {
		let worker: Worker;
		try {
			worker = spawnWorker(
				() =>
					new Worker(new URL('../workers/probe-worker.ts', import.meta.url), {
						type: 'module',
						name: 'null3d-probe',
					}),
				(code, message) => new EngineError(code, message),
			);
		} catch (e) {
			resolve({ failure: 'failed-to-start', error: messageOf(e) });
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (result: WorkerProbe | WorkerProbeFailure) => {
			clearTimeout(timer);
			worker.terminate();
			resolve(result);
		};
		worker.onmessage = ({ data }: MessageEvent<ProbeMessage>) => {
			if (data !== 'loaded') return finish(data);
			timer = setTimeout(
				() => finish({ failure: 'no-answer', error: 'the probe worker did not answer' }),
				timeoutMs,
			);
		};
		worker.onerror = (event) =>
			finish({
				failure: 'failed-to-start',
				error: event.message || 'the probe worker failed to start',
			});
	});
}

/**
 * Which GPU to use on a device with two: the faster one, or the one that saves battery. Without
 * it, the browser chooses.
 */
export type PowerPreference = 'high-performance' | 'low-power';

/**
 * Reads the device hints on the page's main thread, which workers cannot: they have no media
 * queries and no screen.
 */
export function readDeviceHints(): DeviceHints {
	const screen = globalThis.screen;
	const memory = (globalThis.navigator as { deviceMemory?: unknown } | undefined)?.deviceMemory;
	return {
		coarsePointer: globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
		screenMinEdge: screen ? Math.min(screen.width, screen.height) : 0,
		deviceMemoryGB: typeof memory === 'number' ? memory : null,
	};
}

/**
 * Probes the browser and device, on the GPU that `powerPreference` picks. Runs on the page's main
 * thread. `hints` are the device hints when the page has read them already.
 */
export async function probeCapabilities(
	powerPreference?: PowerPreference,
	hints: DeviceHints = readDeviceHints(),
): Promise<CapabilityReport> {
	const [webgpu, worker] = await Promise.all([probeWebGPU(powerPreference), pageWorkerProbe()]);
	return {
		crossOriginIsolated: globalThis.crossOriginIsolated === true,
		sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
		atomicsWaitAsync: typeof Atomics.waitAsync === 'function',
		hardwareConcurrency: navigator.hardwareConcurrency ?? 1,
		devicePixelRatio: globalThis.devicePixelRatio ?? 1,
		...hints,
		offscreenCanvas: typeof OffscreenCanvas === 'function',
		transferControlToOffscreen:
			typeof HTMLCanvasElement === 'function' &&
			'transferControlToOffscreen' in HTMLCanvasElement.prototype,
		webgpu,
		webgl2: probeWebGL2(powerPreference),
		worker,
	};
}
