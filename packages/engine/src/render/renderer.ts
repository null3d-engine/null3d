// The renderer interface. The same renderer runs in the render worker (pipelined mode), in the sketch
// worker (low-latency mode) or on the page's main thread (single-threaded mode and ?render=main).
// Each GPU path's renderers load on demand, in a file of their own, so a thread downloads only the
// renderers of the path that it draws with.

import { FORMAT_RG11B10_UFLOAT, PERMUTATION_HALF } from '../generated/gpu';
import {
	type DeviceShaders,
	type FirstUseShaders,
	loadGlslFeature,
	loadGlslShaders,
	loadWgslFeature,
	loadWgslShaders,
} from '../generated/shaders';
import type { CanvasHolder } from '../gpu/canvas-release';
import type { Completion } from '../gpu/completion';
import { DeviceShaderSet } from '../gpu/device-shaders';
import { reclaimContext, webgl2Context } from '../gpu/webgl2/context';
import type { PowerPreference } from '../page/capabilities';
import { type CoreDevice, TEXTURE_COMPRESSION } from '../page/limits';
import type { GlTimingMode } from '../page/switches';
import type { ImageTable } from '../shared/images';
import type { FrameRecorder } from '../shared/metrics';
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
}

/** WebGPU's default `maxBufferSize`, which every device offers. */
const DEFAULT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;

/** Encodes a linear color channel as sRGB, the way the final output does. */
export function linearToSrgb(c: number): number {
	return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** The loaded shaders, or a fresh copy that the browser must compile again when the device asks. */
const freshIf = <Shaders extends FirstUseShaders>(device: CoreDevice, shaders: Promise<Shaders>) =>
	device.freshShaders ? shaders.then((loaded) => saltShaders(loaded, freshSalt())) : shaders;

/**
 * The feature whose file holds another feature's work on WebGPU. WebGPU morphs in the skinning
 * pass and has no MORPH builds (decision record D-51), so a morphed mesh there needs the skinning
 * file.
 */
const WGSL_FEATURE_FILES: Readonly<Record<string, string>> = { morph: 'skinning' };

/**
 * The device's shaders, from the start's module of its fixed bits, as a set that loads the module
 * of other fixed bits through `load`, and the module of a feature that loads on first use through
 * `loadFeature`, when a pipeline needs it. The modules of the features that `options` preloads
 * download with the start's, and the set holds them before the renderer starts. The features that
 * the sketch asks for later, through the image table, load as soon as they are asked for.
 * `featureFiles` names, for a feature whose work this path does with another feature's builds,
 * the feature whose file to load in its place.
 */
async function deviceShaders(
	device: CoreDevice,
	options: RendererOptions,
	load: (bits: number) => Promise<DeviceShaders>,
	loadFeature: (feature: string, bits: number) => Promise<FirstUseShaders>,
	featureFiles: Readonly<Record<string, string>> = {},
): Promise<DeviceShaderSet> {
	const fileOf = (feature: string) => featureFiles[feature] ?? feature;
	const bits = device.shaderBits;
	const preload = (options.preload ?? []).map(fileOf);
	// Every download starts at once: a module that the set imports again comes from the cache.
	for (const feature of preload) loadFeature(feature, bits).catch(() => undefined);
	const shaders = new DeviceShaderSet(await freshIf(device, load(bits)), bits, (more, feature) =>
		freshIf(device, feature === undefined ? load(more) : loadFeature(feature, more)),
	);
	await shaders.preload(preload);
	const table = options.imageTable;
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
 * Starts the downloads of what a renderer on `tier` with the fixed bits `bits` loads first: its
 * GPU path's renderers and its device module of shaders. They then overlap the core's download.
 * The renderer's own loads later get the same modules, because the browser keeps one module for
 * each address. Those loads report a failure, so these ignore it.
 */
export function preloadDeviceFiles(tier: Tier, bits: number): void {
	const webgl2 = tier === 'webgl2';
	(webgl2 ? loadWebGL2Renderers() : loadWebGPURenderers()).catch(() => undefined);
	(webgl2 ? loadGlslShaders : loadWgslShaders)(bits).catch(() => undefined);
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
				scene && deviceShaders(device, options, loadGlslShaders, loadGlslFeature),
				options.glTiming && import('../gpu/webgl2/call-timing'),
				loadWebGL2Renderers(),
			]);
			// The context may have been lost again during the downloads. The renderer starts on a
			// context that is back, in the same task, so its own listener hears the next loss.
			while (gl.isContextLost()) await contextRestored(gl);
			return renderers.webgl2Renderer(canvas, gl, options, shaders, timing || undefined);
		} finally {
			starting.abort();
		}
	}
	const [gpu, shaders, renderers] = await Promise.all([
		requestDevice(options),
		scene && deviceShaders(device, options, loadWgslShaders, loadWgslFeature, WGSL_FEATURE_FILES),
		loadWebGPURenderers(),
	]);
	return renderers.webgpuRenderer(gpu, canvas, options, shaders);
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

/** Requests a WebGPU device with the features and limits that the engine uses, and its tier. */
async function requestDevice(options: RendererOptions): Promise<{ tier: Tier; device: GPUDevice }> {
	const adapter = await navigator.gpu?.requestAdapter({
		featureLevel: 'compatibility',
		powerPreference: options.powerPreference,
	});
	if (!adapter) throw new Error('no WebGPU adapter');
	const core = !options.forceCompat && adapter.features.has('core-features-and-limits');
	const requiredFeatures: GPUFeatureName[] = [];
	if (core) requiredFeatures.push('core-features-and-limits' as GPUFeatureName);
	if (options.metrics && adapter.features.has('timestamp-query'))
		requiredFeatures.push('timestamp-query');
	// The compressed formats that the sketch thread picks for KTX2 files, from the same adapter.
	for (const [flag, feature] of TEXTURE_COMPRESSION)
		if (options.device.capabilities & flag && adapter.features.has(feature))
			requiredFeatures.push(feature);
	// The scene color at the start, or after an effect that needs HDR color switches to it. The
	// engine chose these from the page's adapter, and a new adapter, as after a GPU loss on a
	// machine with two GPUs, can lack them.
	const { sceneColor, effectsSceneColor } = options.device;
	if (sceneColor === FORMAT_RG11B10_UFLOAT || effectsSceneColor === FORMAT_RG11B10_UFLOAT)
		requiredFeatures.push(adapterFeature(adapter, 'rg11b10ufloat-renderable', 'its HDR color'));
	// The device chose half precision only where the adapter offers 16-bit floats.
	if (options.device.shaderBits & PERMUTATION_HALF)
		requiredFeatures.push(adapterFeature(adapter, 'shader-f16', 'its half precision shaders'));
	const binding = options.device.storageBindingBytes;
	const device = await adapter.requestDevice({
		requiredFeatures,
		// A buffer as large as a binding must fit the device's largest buffer too.
		requiredLimits: {
			maxStorageBufferBindingSize: binding,
			maxBufferSize: Math.max(binding, DEFAULT_MAX_BUFFER_BYTES),
		},
	});
	return { tier: core ? 'webgpu' : 'webgpu-compat', device };
}
