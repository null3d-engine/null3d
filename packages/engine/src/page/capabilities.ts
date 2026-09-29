// The capability probe. It reads what the browser and device can do, by feature tests only: the
// engine never decides anything from browser or GPU names. The report is plain JSON, so test
// runners can store it and compare it across devices.

import type { WorkerProbe } from '../workers/probe-worker';

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
	/** Reported for the record only; the engine never branches on it. */
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
	/** The largest uniform block in bytes, or null without WebGL2. */
	maxUniformBlockSize: number | null;
	/** Whether WebGL accepts views on shared memory for buffer and texture uploads. Null without shared memory. */
	sharedMemoryUploads: {
		bufferSubData: boolean;
		texSubImage2D: boolean;
	} | null;
	/** Reported for the record only; the engine never branches on it. */
	renderer: string | null;
	/** Why the probe failed, when it did. */
	error?: string;
}

/**
 * What the browser and device can do, as plain JSON. The engine picks its build and GPU path from
 * these feature tests, never from browser or GPU names.
 *
 * @category api/engine
 */
export interface CapabilityReport {
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
	/** What a dedicated worker can do, or why the probe worker failed. */
	worker: WorkerProbe | { error: string };
}

function messageOf(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
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

function probeWebGL2(powerPreference?: PowerPreference): WebGL2Report {
	const empty: WebGL2Report = {
		available: false,
		extensions: {},
		supportedExtensions: [],
		maxSamples: null,
		maxTextureSize: null,
		maxUniformBlockSize: null,
		sharedMemoryUploads: null,
		renderer: null,
	};
	try {
		const canvas =
			typeof OffscreenCanvas === 'function'
				? new OffscreenCanvas(4, 4)
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
			maxUniformBlockSize: gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) as number,
			sharedMemoryUploads: probeSharedUploads(gl),
			renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null,
		};
		gl.getExtension('WEBGL_lose_context')?.loseContext();
		return report;
	} catch (e) {
		return { ...empty, error: messageOf(e) };
	}
}

const WORKER_PROBE_TIMEOUT_MS = 5000;

function probeWorker(): Promise<WorkerProbe | { error: string }> {
	return new Promise((resolve) => {
		let worker: Worker;
		try {
			worker = new Worker(new URL('../workers/probe-worker.ts', import.meta.url), {
				type: 'module',
			});
		} catch (e) {
			resolve({ error: messageOf(e) });
			return;
		}
		const timer = setTimeout(() => {
			worker.terminate();
			resolve({ error: 'the probe worker did not answer' });
		}, WORKER_PROBE_TIMEOUT_MS);
		worker.onmessage = (event: MessageEvent<WorkerProbe>) => {
			clearTimeout(timer);
			worker.terminate();
			resolve(event.data);
		};
		worker.onerror = (event) => {
			clearTimeout(timer);
			worker.terminate();
			resolve({ error: event.message || 'the probe worker failed to start' });
		};
	});
}

/**
 * Which GPU to use on a device with two: the faster one, or the one that saves battery. Without
 * it, the browser chooses.
 */
export type PowerPreference = 'high-performance' | 'low-power';

/**
 * Probes the browser and device, on the GPU that `powerPreference` picks. Runs on the page's main
 * thread.
 */
export async function probeCapabilities(
	powerPreference?: PowerPreference,
): Promise<CapabilityReport> {
	const [webgpu, worker] = await Promise.all([probeWebGPU(powerPreference), probeWorker()]);
	return {
		crossOriginIsolated: globalThis.crossOriginIsolated === true,
		sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
		atomicsWaitAsync: typeof Atomics.waitAsync === 'function',
		hardwareConcurrency: navigator.hardwareConcurrency ?? 1,
		devicePixelRatio: globalThis.devicePixelRatio ?? 1,
		offscreenCanvas: typeof OffscreenCanvas === 'function',
		transferControlToOffscreen:
			typeof HTMLCanvasElement === 'function' &&
			'transferControlToOffscreen' in HTMLCanvasElement.prototype,
		webgpu,
		webgl2: probeWebGL2(powerPreference),
		worker,
	};
}
