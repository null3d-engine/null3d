// The renderer interface. The same renderer runs in the render worker (pipelined mode), in the sketch
// worker (low-latency mode) or on the page's main thread (single-threaded mode and ?render=main).
// Each GPU path's renderers load on demand, in a file of their own, so a thread downloads only the
// renderers of the path that it draws with.

import { FORMAT_RG11B10_UFLOAT, PERMUTATION_HALF } from '../generated/gpu';
import {
	type DeviceShaders,
	type FirstUseShaders,
	glslFirstUseFiles,
	loadGlslFeature,
	loadGlslShaders,
	loadWgslFeature,
	loadWgslShaders,
	wgslFirstUseFiles,
} from '../generated/shaders';
import type { CanvasHolder } from '../gpu/canvas-release';
import type { Completion } from '../gpu/completion';
import { DeviceShaderSet, filesFor } from '../gpu/device-shaders';
import { reclaimContext, webgl2Context } from '../gpu/webgl2/context';
import type { PowerPreference } from '../page/capabilities';
import { type CoreDevice, TEXTURE_COMPRESSION } from '../page/limits';
import type { GlTimingMode } from '../page/switches';
import type { ImageTable } from '../shared/images';
import { DrawingSteps, type FrameRecorder } from '../shared/metrics';
import type { Tier } from '../shared/tier';
import { contextLoss, contextRestored, type GpuErrorReport } from './loss';
import { freshSalt, saltShaders } from './shader-salt';

export type { Tier } from '../shared/tier';

export type RenderCanvas = OffscreenCanvas | HTMLCanvasElement;

/** What the renderer draws for one frame. */
export interface FrameInput {
	/** The frame number, counting from 1. */
	frame: number;
	/** Background color in linear RGB, 0 to 1. */
	background: readonly [number, number, number];
}

export interface Renderer extends CanvasHolder {
	readonly tier: Tier;
	/** True when the canvas keeps premultiplied alpha, so a captured image keeps the frame's alpha. */
	readonly transparent: boolean;
	/**
	 * Counts the frames that the GPU finished, and says how many it has not; undefined without a
	 * metrics buffer.
	 */
	readonly completions: Completion | undefined;
	/** The canvas it draws on. */
	readonly canvas: RenderCanvas;
	/** Resizes the drawing buffer, in device pixels. Only the thread that owns the canvas calls this. */
	resize(width: number, height: number): void;
	/**
	 * Starts to build the pipelines that a frame's list creates, the first time it is asked for that
	 * frame, and returns true when the frame may draw. Until the renderer has drawn a frame with
	 * every pipeline built, a frame waits for its pipelines. After that, a frame draws at once, and
	 * objects whose pipelines are still building appear once they are built.
	 */
	prepare(frame: number): boolean;
	/** True while a pipeline is building. */
	readonly building: boolean;
	/** Draws a frame to the canvas, adding its phase times and counters to the frame's record. */
	drawFrame(input: FrameInput, record: FrameRecorder): void;
	/**
	 * Draws the frame taken last into an offscreen target and returns its pixels as RGBA8 rows, top
	 * row first. A renderer that first waits for its pipelines reads the frame taken last again once
	 * they are built, since frames go on during the wait and `input` falls behind.
	 */
	capture(input: FrameInput): Promise<{ width: number; height: number; pixels: Uint8Array }>;
	/** Resolves with the browser's reason if it takes the GPU away; destroying the renderer does not. */
	readonly lost: Promise<string>;
	/** Acts out a loss of the GPU, as a driver reset would cause, so the page can test recovery. */
	simulateLoss(): void;
	/** Resolves when the GPU has finished every frame submitted so far. */
	finished(): Promise<void>;
	destroy(): void;
}

export interface RendererOptions {
	tier: Tier;
	/** Requests a compatibility-mode device without `core-features-and-limits` (the ?gpu=compat switch). */
	forceCompat?: boolean;
	/** The metrics buffer, which receives GPU times where the device has timestamp queries. */
	metrics?: ArrayBufferLike;
	/**
	 * The device and the canvas as the engine uses them: the storage binding to request, how WebGL2
	 * uploads and stores depth, the scene color's format and whether the canvas is transparent.
	 */
	device: CoreDevice;
	/** Which GPU to draw with on a device with two; the browser chooses without it. */
	powerPreference?: PowerPreference;
	/**
	 * Engine memory and the control block: with both, the renderer draws the scene from the draw
	 * lists the sketch thread records; without them it clears to the frame's background.
	 */
	scene?: { memory: WebAssembly.Memory; control: ArrayBufferLike };
	/** The images that texture uploads read, which the thread keeps across GPU devices. */
	imageTable?: ImageTable;
	/** How to time each WebGL call of the scene's renderer, for a benchmark page (?gl-timing). */
	glTiming?: GlTimingMode;
	/**
	 * `every` for `?gpu-samples=every`, which times every drawn frame rather than one in eleven, so
	 * a page can read the parts of a single long frame. It costs the draw's own time.
	 */
	gpuSamples?: 'every';
	/**
	 * Hears a WebGPU error that no error scope caught: with `outOfMemory`, the GPU had no room for
	 * an object, else it rejected a command. `message` is the GPU path's own text. The thread that
	 * draws reports each kind once per device, as E1304 or E1305.
	 */
	gpuError?: GpuErrorReport;
	/**
	 * The features whose shader files load with the start's, before the first frame, as
	 * `createEngine`'s `preload` lists them.
	 */
	preload?: readonly string[];
	/**
	 * What the thread started before its first renderer: the times of its start's steps, and on
	 * WebGPU the device that it asked for, which the first renderer takes.
	 */
	early?: EarlyStart;
	/**
	 * The pipeline list of the pipelines that the first frame of the sketch's last start built,
	 * which a scene's renderer starts to build at once (`gpu/early-builds.ts`).
	 */
	earlyBuilds?: Uint32Array;
	/**
	 * Hears the pipeline list of the pipelines that a scene's renderer built for its first frame,
	 * once that frame has drawn.
	 */
	listBuilds?: (list: Uint32Array) => void;
}

/** What a scene's renderer does with pipeline lists, as `RendererOptions` gives it. */
export type PipelineLists = Pick<RendererOptions, 'earlyBuilds' | 'listBuilds'>;

/**
 * What the thread that draws can start as soon as the probe has chosen the GPU path, before the
 * core arrives: the downloads of its renderers, of its device's shader file and of the files of the
 * features that `createEngine` preloads, and on WebGPU the request for its device.
 */
export interface DrawingPreload {
	tier: Tier;
	/**
	 * The device as the engine uses it: its fixed bits pick the shader file, and it says what the
	 * GPU device needs.
	 */
	device: CoreDevice;
	/** Requests a compatibility-mode device without `core-features-and-limits`. */
	forceCompat?: boolean;
	/** Which GPU to draw with on a device with two; the browser chooses without it. */
	powerPreference?: PowerPreference;
	/** The features whose shader files load before the first frame, as `createEngine` lists them. */
	preload?: readonly string[];
}

/** WebGPU's default `maxBufferSize`, which every device offers. */
const DEFAULT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/** Encodes a linear color channel as sRGB, the way the final output does. */
export function linearToSrgb(c: number): number {
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** The shader modules of a GPU path, which a thread that draws on that path loads. */
interface PathShaders {
	/** Loads the device module of the fixed bits that it is given. */
	load: (bits: number) => Promise<DeviceShaders>;
	/** Loads a module of features that load on first use, by its key, for the fixed bits given. */
	loadFeature: (file: string, bits: number) => Promise<FirstUseShaders>;
	/** The keys of the modules of features that load on first use. */
	files: () => readonly string[];
	/** For a feature whose work this path does with another feature's builds, that feature. */
	featureFiles: Readonly<Record<string, string>>;
}

/**
 * The feature whose file holds another feature's work on WebGPU. WebGPU morphs in the skinning
 * pass and has no MORPH builds (decision record D-51), so a morphed mesh there needs the skinning
 * file.
 */
const WGSL_FEATURE_FILES: Readonly<Record<string, string>> = { morph: 'skinning' };

const WGSL: PathShaders = {
	load: loadWgslShaders,
	loadFeature: loadWgslFeature,
	files: wgslFirstUseFiles,
	featureFiles: WGSL_FEATURE_FILES,
};

const GLSL: PathShaders = {
	load: loadGlslShaders,
	loadFeature: loadGlslFeature,
	files: glslFirstUseFiles,
	featureFiles: {},
};

const pathShaders = (tier: Tier): PathShaders => (tier === 'webgl2' ? GLSL : WGSL);

/**
 * Starts the downloads of the shader files of features as they are named, for a device with fixed
 * bits: each feature's own file, and each file of the builds that need several features once all
 * of them are named. Each file downloads once. The device's set takes the modules later, and the
 * browser then gives it the module that is already on its way.
 */
class FeatureDownloads {
	private readonly wanted = new Set<string>();
	private readonly started = new Set<string>();

	constructor(
		private readonly path: PathShaders,
		private readonly bits: number,
	) {}

	add(features: Iterable<string>): void {
		for (const feature of features) this.wanted.add(this.path.featureFiles[feature] ?? feature);
		for (const file of filesFor(this.path.files(), this.wanted)) {
			if (this.started.has(file)) continue;
			this.started.add(file);
			// The set's own load of the module reports a failure.
			this.path.loadFeature(file, this.bits).catch(() => undefined);
		}
	}
}

/** The loaded shaders, or a fresh copy that the browser must compile again when the device asks. */
const freshIf = <Shaders extends FirstUseShaders>(device: CoreDevice, shaders: Promise<Shaders>) =>
	device.freshShaders ? shaders.then((loaded) => saltShaders(loaded, freshSalt())) : shaders;

/**
 * The device's shaders on a GPU path, from the start's module of its fixed bits, as a set that
 * loads the module of other fixed bits, and a module of features that load on first use, when a
 * pipeline needs it. The modules of the features that `options` preloads download with the
 * start's, and the set holds them before the renderer starts. The features that the sketch asks
 * for through the image table download as soon as they are asked for, also while the start's
 * module downloads.
 */
async function deviceShaders(
	device: CoreDevice,
	options: RendererOptions,
	path: PathShaders,
): Promise<DeviceShaderSet> {
	const fileOf = (feature: string) => path.featureFiles[feature] ?? feature;
	const bits = device.shaderBits;
	const preload = (options.preload ?? []).map(fileOf);
	const table = options.imageTable;
	const downloads = new FeatureDownloads(path, bits);
	downloads.add(preload);
	if (table) {
		downloads.add(table.preloads);
		table.onPreload = (feature) => downloads.add([feature]);
	}
	const shaders = new DeviceShaderSet(
		await freshIf(device, path.load(bits)),
		bits,
		(more, file) =>
			freshIf(device, file === undefined ? path.load(more) : path.loadFeature(file, more)),
		path.files(),
	);
	options.early?.steps.mark('shaders');
	await shaders.preload(preload);
	if (table) {
		void shaders.preload([...table.preloads].map(fileOf));
		table.onPreload = (feature) => void shaders.preload([fileOf(feature)]);
	}
	return shaders;
}

/** Loads the renderers of the WebGPU path, which a thread downloads only to draw with WebGPU. */
const loadWebGPURenderers = () => import('./webgpu-renderers');

/** Loads the renderers of the WebGL2 path, which a thread downloads only to draw with WebGL2. */
const loadWebGL2Renderers = () => import('./webgl2-renderers');

/**
 * Starts what a renderer that `preload` describes needs first: the downloads of its GPU path's
 * renderers, of its device module of shaders and of the modules of the features that it preloads,
 * and on WebGPU the request for its device. They then overlap the core's download. The renderer's
 * own loads later get the same modules, because the browser keeps one module for each address,
 * and the first renderer takes the device. Those loads report a failure, so these ignore it.
 */
export function startEarly(preload: DrawingPreload): EarlyStart {
	const early = new EarlyStart();
	early.steps.mark('request');
	const webgl2 = preload.tier === 'webgl2';
	(webgl2 ? loadWebGL2Renderers() : loadWebGPURenderers()).catch(() => undefined);
	const path = pathShaders(preload.tier);
	const bits = preload.device.shaderBits;
	path.load(bits).then(
		() => early.steps.mark('shaders'),
		() => undefined,
	);
	new FeatureDownloads(path, bits).add(preload.preload ?? []);
	// Every thread that draws times its frames, so its device asks for the GPU timer.
	if (!webgl2) early.requestDevice({ ...preload, timestamps: true });
	return early;
}

/**
 * Creates the renderer for a tier on the canvas this thread owns, with the renderers of the tier's
 * GPU path, which load here unless a preload started them.
 */
export async function createRenderer(
	canvas: RenderCanvas,
	options: RendererOptions,
): Promise<Renderer> {
	const { scene, device } = options;
	const path = pathShaders(options.tier);
	const steps = options.early?.steps;
	if (options.tier === 'webgl2') {
		// A canvas keeps the settings of the first request for its context and ignores later ones,
		// so the context is made here with the engine's settings, before anything else asks for it.
		const gl = webgl2Context(canvas, options.powerPreference, device.transparent);
		// Until the renderer listens for a loss itself, this listener asks the browser to offer the
		// context back after one. Without it, a loss while the shaders download would never end.
		const starting = new AbortController();
		void contextLoss(canvas, starting.signal);
		try {
			// After a loss, the context must come back before the engine can draw with it again. A
			// context that an earlier engine on the canvas gave up comes back when asked. A scene's
			// shaders and the path's renderers download meanwhile.
			const [, , shaders, timing, renderers] = await Promise.all([
				reclaimContext(canvas),
				contextRestored(gl),
				scene && deviceShaders(device, options, path),
				options.glTiming && import('../gpu/webgl2/call-timing'),
				loadWebGL2Renderers(),
			]);
			// The context may have been lost again during the downloads. The renderer starts on a
			// context that is back, in the same task, so its own listener hears the next loss.
			while (gl.isContextLost()) await contextRestored(gl);
			const renderer = renderers.webgl2Renderer(canvas, gl, options, shaders, timing || undefined);
			steps?.mark('renderer');
			return renderer;
		} finally {
			starting.abort();
		}
	}
	const request: DeviceRequest = { ...options, timestamps: options.metrics !== undefined };
	const gpuRequest = options.early?.takeDevice(request) ?? requestDevice(request, steps);
	try {
		const [gpu, shaders, renderers] = await Promise.all([
			gpuRequest,
			scene && deviceShaders(device, options, path),
			loadWebGPURenderers(),
		]);
		const renderer = renderers.webgpuRenderer(gpu, canvas, options, shaders);
		steps?.mark('renderer');
		return renderer;
	} catch (error) {
		// A device that no renderer holds goes now, not when the browser collects it.
		gpuRequest.then(
			(gpu) => gpu.device.destroy(),
			() => undefined,
		);
		throw error;
	}
}

/**
 * A feature that the engine chose to draw with, which the adapter must offer. `use` says what the
 * engine draws with it.
 */
function adapterFeature(adapter: GPUAdapter, feature: GPUFeatureName, use: string): GPUFeatureName {
	if (!adapter.features.has(feature))
		throw new Error(
			`the GPU adapter lacks the WebGPU feature ${feature}, which the engine chose for ${use} on the GPU it started with`,
		);
	return feature;
}

/** What a WebGPU device request reads. */
interface DeviceRequest
	extends Pick<RendererOptions, 'forceCompat' | 'powerPreference' | 'device'> {
	/**
	 * True when the renderer times frames on the GPU, which asks for the GPU timer where the adapter
	 * has it.
	 */
	timestamps: boolean;
}

/** A WebGPU device and the tier that it runs. */
interface GpuDevice {
	tier: Tier;
	device: GPUDevice;
}

/**
 * The values of `request` that `requestDevice` reads, as one string: two requests with the same key
 * ask for the same device.
 */
function requestKey({ forceCompat, powerPreference, timestamps, device }: DeviceRequest): string {
	const { capabilities, sceneColor, effectsSceneColor, shaderBits, storageBindingBytes } = device;
	return [
		forceCompat === true,
		powerPreference,
		timestamps,
		capabilities,
		sceneColor,
		effectsSceneColor,
		shaderBits & PERMUTATION_HALF,
		storageBindingBytes,
	].join();
}

/**
 * The start of the thread that draws, from the page's message after the probe: the times of its
 * steps, and on WebGPU the device that it asked for before its first renderer, so the request
 * overlaps the core's download. That renderer takes the device when it asks for the same one. A
 * device that no renderer takes goes on `release`.
 */
export class EarlyStart {
	readonly steps = new DrawingSteps();
	/** The early device, until a renderer takes it or the start lets it go. */
	private device: Promise<GpuDevice> | undefined;
	/** The key of what the early device was asked for. */
	private key = '';
	/** True once the browser took the early device away, as when its GPU process restarts. */
	private lost = false;

	/** Asks for the device that `request` describes, ahead of the renderer. */
	requestDevice(request: DeviceRequest): void {
		this.release();
		this.key = requestKey(request);
		this.lost = false;
		const device = requestDevice(request, this.steps);
		this.device = device;
		// A failure waits for the renderer that takes the device, which reports it.
		device.then(
			(gpu) =>
				gpu.device.lost.then(() => {
					if (this.device === device) this.lost = true;
				}),
			() => undefined,
		);
	}

	/**
	 * The early device for a renderer that asks for `request`, once, or undefined where no early
	 * device waits or it was asked for another device. A device that the browser took away meanwhile
	 * is asked for again.
	 */
	takeDevice(request: DeviceRequest): Promise<GpuDevice> | undefined {
		const device = this.device;
		if (!device) return undefined;
		if (requestKey(request) !== this.key) {
			this.release();
			return undefined;
		}
		this.device = undefined;
		return device.then((gpu) => (this.lost ? requestDevice(request, this.steps) : gpu));
	}

	/** Destroys the early device unless a renderer took it. */
	release(): void {
		const device = this.device;
		this.device = undefined;
		device?.then(
			(gpu) => gpu.device.destroy(),
			() => undefined,
		);
	}
}

/**
 * Requests a WebGPU device with the features and limits that the engine uses, and its tier, and
 * notes in `steps` when the adapter and the device arrive.
 */
async function requestDevice(request: DeviceRequest, steps?: DrawingSteps): Promise<GpuDevice> {
	const adapter = await navigator.gpu?.requestAdapter({
		featureLevel: 'compatibility',
		powerPreference: request.powerPreference,
	});
	if (!adapter) throw new Error('no WebGPU adapter');
	steps?.mark('adapter');
	const core = !request.forceCompat && adapter.features.has('core-features-and-limits');
	const requiredFeatures: GPUFeatureName[] = [];
	if (core) requiredFeatures.push('core-features-and-limits' as GPUFeatureName);
	if (request.timestamps && adapter.features.has('timestamp-query'))
		requiredFeatures.push('timestamp-query');
	// The compressed formats that the sketch thread picks for KTX2 files, from the same adapter.
	for (const [flag, feature] of TEXTURE_COMPRESSION)
		if (request.device.capabilities & flag && adapter.features.has(feature))
			requiredFeatures.push(feature);
	// The scene color at the start, or after an effect that needs HDR color switches to it. The
	// engine chose these from the page's adapter, and a new adapter, as after a GPU loss on a
	// machine with two GPUs, can lack them.
	const { sceneColor, effectsSceneColor } = request.device;
	if (sceneColor === FORMAT_RG11B10_UFLOAT || effectsSceneColor === FORMAT_RG11B10_UFLOAT)
		requiredFeatures.push(adapterFeature(adapter, 'rg11b10ufloat-renderable', 'its HDR color'));
	// The device chose half precision only where the adapter offers 16-bit floats.
	if (request.device.shaderBits & PERMUTATION_HALF)
		requiredFeatures.push(adapterFeature(adapter, 'shader-f16', 'its half precision shaders'));
	const binding = request.device.storageBindingBytes;
	const device = await adapter.requestDevice({
		requiredFeatures,
		// A buffer as large as a binding must fit the device's largest buffer too.
		requiredLimits: {
			maxStorageBufferBindingSize: binding,
			maxBufferSize: Math.max(binding, DEFAULT_MAX_BUFFER_BYTES),
		},
	});
	steps?.mark('device');
	return { tier: core ? 'webgpu' : 'webgpu-compat', device };
}
