// createEngine: the page side of the engine. It probes the device, picks the build, the GPU tier
// and the quality preset, starts the workers, and hands the canvas to the thread that draws. The
// page loads the renderer only when it draws itself, and the sketch runner and the scene API only
// when it runs the sketch itself: in the single-threaded build, and with sketchThread: 'main'.

import { DEV } from '../errors/checks';
import { EngineError, isErrorCode, setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { messageOf } from '../errors/message';
import { FORMAT_CANVAS, PERMUTATION_HALF } from '../generated/gpu';
import { SHADER_FEATURES, type ShaderFeature } from '../generated/shader-features';
import type { PresetCheck } from '../quality/check';
import {
	choosePreset,
	crashTier,
	memoryPreset,
	type PresetRequest,
	withinTier,
} from '../quality/chooser';
import {
	checkedSettings,
	checkSettings,
	presetOption,
	presetValue,
	type QualityPreset,
} from '../quality/presets';
import type { DrawingSetup } from '../render/draw';
import { type DrawModule, loadDrawModule, preloadShaders } from '../render/load-draw';
import type { Drawing } from '../render/recovery';
import type { Renderer, Tier } from '../render/renderer';
import { awaitLater } from '../shared/await-later';
import { controlViews, createControlBuffer, Slot } from '../shared/control';
import { type Build, type CoreGlue, loadGlue, startCore } from '../shared/core';
import { URL_SWITCHES } from '../shared/dev';
import { encodeFrame } from '../shared/frame-image';
import { drawingSenders, ImageTable } from '../shared/images';
import { KEY_CODES } from '../shared/key-codes';
import { createMetricsBuffer, MetricsReader } from '../shared/metrics';
import { clearJobTasks, type JobTaskHost, setJobTasks } from '../shared/task-host';
import { notifySlot, setWakeByMessage } from '../shared/wake';
import { spawnWorker } from '../shared/worker-start';
import { loadSketch } from '../sketch/define-sketch';
import type { QualityStart, QualityUpdate } from '../sketch/quality';
import type { SketchRunner } from '../sketch/runner';
import type { LabelSlotSender } from '../sketch/ui';
import type {
	CapturedFrame,
	CoreHandoff,
	RendererRequest,
	RendererSetup,
	ShaderPreload,
	SketchWorkerInit,
	WorkerReply,
} from '../workers/protocol';
import { abortable } from './abortable';
import { checkBrowser } from './browser-check';
import { type CanvasWatch, watchCanvas } from './canvas-watch';
import {
	type CapabilityReport,
	type PowerPreference,
	probeCapabilities,
	readDeviceHints,
} from './capabilities';
import { CheckStore, checkConditions } from './check-store';
import { watchDisplay } from './display';
import {
	type FrameMetrics,
	HeapSampler,
	secondRates,
	summarizeFrames,
	threadRoles,
	wasmDownloadBytes,
} from './frame-stats';
import { holdFailure, holdSeconds, publishHold } from './hold';
import { captureInput } from './input';
import { type EngineLabels, labelCapacity, PageLabels } from './labels';
import { coreDevice, maxCanvasSize, maxInstances } from './limits';
import { loadCore, memoryMaximumMiB } from './loader';
import { MainThreadWatch } from './main-thread';
import {
	type CanvasHold,
	canvasHold,
	type DrawingRole,
	Holder,
	parkWorker,
	takeParkedWorker,
	takeWhenFree,
} from './ownership';
import { watchPreferences } from './preferences';
import { NO_HISTORY, StartMarker } from './start-marker';
import { StatsSwitch } from './stats-switch';
import { stopJobWorkers, waitForJobWorkersToLeave } from './stop-jobs';
import {
	type DepthMode,
	type GpuSwitch,
	jobWorkerCount,
	type LatencyMode,
	parseSwitches,
	type SketchThread,
	type Switches,
} from './switches';

/**
 * Options for `createEngine`.
 *
 * @category api/engine
 */
export interface EngineOptions {
	/**
	 * The canvas to draw into, sized by CSS. On a canvas that no CSS sizes, the engine sets the CSS
	 * width and height that it shows when the engine starts. One engine draws on a canvas at a time:
	 * a start on the canvas of an engine that is stopping, or still starting and then destroyed,
	 * waits for that engine to stop. A canvas whose engine runs on fails with E1419.
	 */
	canvas: HTMLCanvasElement;
	/** The sketch module, which runs in the sketch worker; `new URL('./sketch.ts', import.meta.url)`. */
	sketch: URL | string;
	/**
	 * The quality preset: `auto`, the default, lets the engine choose one for the device, and
	 * `low`, `medium`, `high` or `ultra` names one. The GPU path caps it: WebGL2 and WebGPU's
	 * compatibility mode run at most `medium`. After a start that crashed the tab, the engine starts
	 * a preset lower. Another value fails with E1213. The `?preset=` switch wins over it.
	 */
	preset?: 'auto' | QualityPreset;
	/**
	 * Cap for the device pixel ratio, a number from 0.5 up. Without it, the quality preset sets the
	 * cap. `ctx.quality.set` changes it during play.
	 */
	maxPixelRatio?: number;
	/** Forces a GPU tier, for testing only. */
	gpu?: 'auto' | 'webgpu' | 'webgl2';
	/**
	 * Which GPU to draw with on a device that has two, such as a laptop with a separate graphics
	 * chip: `high-performance`, the default, for the faster one, or `low-power` to save battery.
	 * The browser treats it as a request. A device with one GPU ignores it.
	 */
	powerPreference?: 'high-performance' | 'low-power';
	/**
	 * The latency mode. The default is `pipelined`. Low latency needs a worker that draws: where
	 * no worker can draw, the engine runs in pipelined mode, and `engine.mode` says so.
	 */
	latency?: LatencyMode;
	/**
	 * How the engine smooths the edges of what it draws: `msaa` draws 4 samples per pixel, `fxaa`
	 * smooths edges in the final pass, and `none` leaves them sharp. Without it, the quality preset
	 * sets the mode: FXAA on Low, MSAA from Medium up. Each mode works on every GPU path, and the
	 * mode stays fixed while the engine runs. Another value fails with E1213.
	 */
	antialias?: 'msaa' | 'fxaa' | 'none';
	/**
	 * The cascades of a directional light's shadows, a whole number from 1 to 4, for each light
	 * whose `shadow` options name none. Without it, the quality preset sets it. Another value fails
	 * with E1213.
	 */
	shadowCascades?: number;
	/**
	 * Texels on each side of each cascade's shadow map, for each directional light whose `shadow`
	 * options name no `mapSize`: 512, 1,024, 2,048 or 4,096. Without it, the quality preset sets
	 * it. Another value fails with E1213.
	 */
	shadowMapSize?: number;
	/**
	 * The most tiles of the shadow atlas that spot and point lights cast their shadows into, a
	 * whole number from 0 to 24. Without it, the quality preset sets it. 0 turns the shadows of
	 * spot and point lights off. Another value fails with E1213.
	 */
	shadowTiles?: number;
	/**
	 * Texels on each side of each tile of the shadow atlas: 256, 512, 1,024 or 2,048. Without it,
	 * the quality preset sets it. Another value fails with E1213.
	 */
	shadowTileSize?: number;
	/**
	 * True makes point lights cast shadows, false keeps them from it. Without it, the quality
	 * preset decides: High and Ultra turn them on. Another value fails with E1213.
	 */
	pointLightShadows?: boolean;
	/**
	 * True to draw the depth of the opaque objects before the engine shades them, so each pixel is
	 * shaded once, for its nearest surface. It saves GPU time in scenes where objects hide many
	 * others and shading costs much, and costs a second pass over the objects' vertices. Without
	 * it, the quality preset decides. The prepass stays fixed while the engine runs, and the
	 * `?prepass=on` or `?prepass=off` switch wins over this option.
	 * Another value fails with E1213.
	 */
	depthPrepass?: boolean;
	/**
	 * True to run GPU occlusion culling on WebGPU: objects that `setOccluder(true)` marks hide the
	 * objects that lie wholly behind them, so the GPU skips those. Each camera view draws the depth
	 * of the marked objects that it showed in the last frame and tests every object against it. It
	 * saves GPU time where walls and large objects hide many detailed ones; a scene that marks no
	 * object pays nothing. Every quality preset leaves it off: measure your scene's GPU time with it
	 * first, as its passes can cost more than they save. It stays fixed while the engine runs, and
	 * the `?occlusion=on` or `?occlusion=off` switch wins over this option. WebGL2 and the depth
	 * prepass draw without it. Another value fails with E1213.
	 */
	gpuOcclusion?: boolean;
	/**
	 * The most morph target weights of each object that a WebGL2 device draws, a whole number from
	 * 1 to 256. Each object keeps the weights farthest from 0. Without it, the quality preset sets
	 * it. WebGPU draws every weight. Another value fails with E1213.
	 */
	morphTargets?: number;
	/**
	 * True to run software occlusion culling on WebGL2: objects that `setOccluder(true)` marks hide
	 * the objects that lie wholly behind them, so the GPU skips those. False turns it off. Without
	 * it, the quality preset decides, and a sketch can change it during play with `quality.set`.
	 * The `?occlusion=on` or `?occlusion=off` switch wins over this option. WebGPU ignores it.
	 * Another value fails with E1213.
	 */
	softwareOcclusion?: boolean;
	/**
	 * True for a see-through canvas: the page shows through wherever no object draws, until the
	 * sketch sets a background color. The canvas holds premultiplied alpha, as a browser composites
	 * it. The default is false, an opaque canvas.
	 */
	transparent?: boolean;
	/**
	 * True for scenes that reach far beyond a city, such as a planet. Object positions then keep the
	 * precision of JavaScript's numbers at any distance from the origin: 0.03 mm or better. Without
	 * it, positions are 32-bit floats, which move in steps of 6 cm at 1,000 km from the origin and
	 * 0.5 m at the Earth's radius. It costs 12 bytes of memory per object and a little work in each
	 * position setter. The default is false. Instance batches need no mode: give each one an
	 * `origin` near its rows.
	 */
	largeWorld?: boolean;
	/**
	 * The thread that runs the sketch's code and the engine core: `worker`, the default, or `main`
	 * for the page's main thread, where the sketch can reach the DOM. Use `main` for apps that work
	 * mostly with the DOM, and for debugging. The render worker still draws in pipelined mode, and
	 * the page draws in low-latency mode. The sketch's frames then share the page's thread with the
	 * page's own work, so each can slow the other. The single-threaded build always runs the sketch
	 * on the page's thread. The `?sketch-thread=` switch wins over this option.
	 */
	sketchThread?: SketchThread;
	/**
	 * The engine's memory. `maximumMiB` sets the most memory that the engine's threads share, in
	 * MiB: a whole number from 256 to 4096, 1024 by default. Another value fails with E1409. The
	 * browser reserves address space for the whole maximum when the engine starts. So a larger
	 * maximum leaves less room for other engines and WebAssembly modules on the page. Ask for more
	 * only when a scene needs it. The single-threaded build's memory is not shared, so this option
	 * does not change it. The `?memory=<MiB>` switch wins over it.
	 */
	memory?: { maximumMiB: number };
	/**
	 * The most HTML labels that the sketch can track at once with `ui.trackLabel`: a whole number
	 * from 1 to 65,536, 4,096 by default. Another value fails with E1213. The engine keeps three
	 * tables of 16 bytes per label in memory that its threads share, so 4,096 labels take 192 KB.
	 */
	maxLabels?: number;
	/**
	 * Called as the start reaches each stage, in this order: `core` once the engine core is compiled
	 * and the GPU paths are tested, `sketch` once the sketch's setup has run, and `first-frame` once the
	 * GPU has finished the first frame.
	 */
	onProgress?: (stage: StartupStage) => void;
	/**
	 * Receives the messages the sketch sends with `ctx.page.post`, from the start of the sketch's setup.
	 * Use it for progress that the sketch reports while it loads. `engine.onSketchMessage` adds more
	 * handlers once the engine has started.
	 */
	onSketchMessage?: (name: string, data: unknown) => void;
	/**
	 * Cancels a start in progress, for example when the user leaves the page. `createEngine` then
	 * stops the engine's threads and rejects with the signal's reason.
	 */
	signal?: AbortSignal;
	/**
	 * Starts the engine in hold mode for image tests, held at this many seconds of sketch time. The
	 * engine steps the sketch from 0 to the time in fixed steps of 1/60 second, with no frame loop.
	 * `math.random` and `Math.random` in the sketch's thread give the same numbers on every run, and
	 * the sketch gets no input: every key and button stays up. The engine then draws that one frame
	 * and reads it back, and `createEngine` resolves. The `?hold=<seconds>`
	 * switch overrides this time, and a bare `?hold` holds at it, or at 0 without it.
	 */
	hold?: number;
	/**
	 * Features whose shaders load before the first frame, for a game that must fetch nothing while
	 * it plays. Each feature's shaders otherwise download the first time the sketch uses it:
	 * `'skinning'` with the first skinned mesh, `'morph'` with the first morphed mesh,
	 * `'bloom'` and `'ao'` when `post.set` turns them on, `'sprites'` and `'lines'` with the first
	 * batch, `'background'` with a texture, environment or cube map background, `'sky'` with the
	 * sky, and `'occlusion'` with the first object that `setOccluder(true)` marks while GPU
	 * occlusion culling runs on WebGPU. WebGPU morphs in the skinning pass, so there `'morph'` loads
	 * the skinning shaders, and WebGL2 has no `'occlusion'` shaders to load. Listed features
	 * download beside the engine's own
	 * shaders, so the start waits only for the largest. Loading a glTF file with skins or morph
	 * targets, or making a batch, also starts its feature's download at once, before the objects
	 * draw. Throws E1421 for a name it does not know.
	 */
	preload?: readonly ShaderFeature[];
}

/**
 * A stage of the engine's start, as `onProgress` reports it.
 *
 * @category api/engine
 */
export type StartupStage = 'core' | 'sketch' | 'first-frame';

/**
 * The GPU path the engine chose, and what it offers.
 *
 * @category api/engine
 */
export interface EngineCapabilities {
	/** The GPU path the engine draws with. */
	tier: Tier;
	/** True when the engine runs the threaded build. */
	threaded: boolean;
	/** The optional features of the GPU path: WebGPU features, or the WebGL2 extensions present. */
	features: string[];
	/** The WebGPU limits, or an empty object on WebGL2. */
	limits: Record<string, number | null>;
	/**
	 * True when the scene draws high dynamic range color, which the final pass tone maps into the
	 * canvas. False on the 8-bit path, where each shader tone maps its own output: in WebGPU's
	 * compatibility mode with MSAA, and on WebGL2 devices whose float targets fail the engine's
	 * test. Both paths show the same colors. Edges differ a little with MSAA, because the 8-bit path
	 * averages the samples after the tone mapping. It reports the path that the engine started on:
	 * in compatibility mode, bloom moves the engine to HDR color with FXAA when a sketch turns it on.
	 */
	hdr: boolean;
	/**
	 * True when the scene shaders do their color math at half precision: lighting, tone mapping and
	 * sRGB encoding. On WebGPU it needs the device feature `shader-f16`, and WebGL2 runs that math at
	 * `mediump`. Positions, depth and shadow lookups keep full precision either way.
	 */
	halfPrecision: boolean;
	/**
	 * The most objects and instance rows, counted together, that a scene can draw on this device.
	 * On WebGPU every device draws at least 2,097,152, and a device with larger GPU buffers draws
	 * more, up to 8,388,480. On WebGL2 the number follows the largest texture the device allows:
	 * 2,097,152 at 4,096 pixels, and 1,048,576 at the 2,048 that every WebGL2 device allows. Engine
	 * memory can run out first: see E1109.
	 */
	maxInstances: number;
	/**
	 * The widest and tallest drawing buffer, in device pixels, that the GPU path draws into: 8,192
	 * on WebGPU, 4,096 in its compatibility mode, and on WebGL2 the smallest of the device's texture,
	 * renderbuffer and viewport limits. A canvas larger than that at the screen's pixel ratio draws
	 * at a lower ratio, which `engine.viewport.pixelRatio` in the sketch reports.
	 */
	maxCanvasSize: number;
	/**
	 * How the GPU path stores depth. WebGPU, and WebGL2 in browsers with `EXT_clip_control`, draw
	 * `reversed` depth, which stays precise far from the camera.
	 */
	depth: DepthMode;
}

/**
 * How the engine runs on this device: its build, its latency mode and its threads.
 *
 * @category api/engine
 */
export interface EngineMode {
	/**
	 * With `threaded`, the sketch and the render step run in workers, helped by job workers. With
	 * `single`, everything runs on the page's thread, for pages without shared memory.
	 */
	build: 'threaded' | 'single';
	/**
	 * The latency mode in use, or `single` for the single-thread build. A page that runs the sketch
	 * and draws steps the sketch right before each draw, which is `low`.
	 */
	latency: LatencyMode | 'single';
	/** The thread that runs the sketch and the engine core. */
	sketchThread: SketchThread;
	/** The thread that owns the canvas and draws. */
	renderThread: 'render-worker' | 'sketch-worker' | 'main';
	/** The job workers that share the engine's parallel work. */
	jobWorkers: number;
	/** The sketch time in seconds that hold mode holds the sketch at, or null for a live engine. */
	hold: number | null;
	/**
	 * The quality preset that the engine runs. The preset check can lower it before `createEngine`
	 * resolves, and `ctx.quality.setPreset` in the sketch changes it later.
	 */
	preset: QualityPreset;
	/**
	 * What the preset check measured, or null when no check ran. The engine checks the preset when
	 * it chose it from the device: after the first frame, it measures the frame rate of the scene
	 * that the setup built, and lowers the preset until one holds the target. A later start of the
	 * sketch in the same browser on the same device takes the stored result instead, and starts at
	 * its preset. `reused` is then true.
	 */
	presetCheck: PresetCheck | null;
	/**
	 * The starts of this sketch before this one that crashed the tab, one after another, as the
	 * engine's note in `localStorage` records them. After one, the engine starts a preset lower, and
	 * after two at `low`.
	 */
	crashedStarts: number;
	/**
	 * The shared memory's maximum in MiB, or null for the single-threaded build, whose memory is not
	 * shared.
	 */
	memoryMaximumMiB: number | null;
}

/**
 * A running engine, as `createEngine` returns it.
 *
 * @category api/engine
 */
export interface Engine {
	/** The GPU path the engine chose, and what it offers. */
	readonly capabilities: EngineCapabilities;
	/** The full capability report, as plain JSON. */
	readonly report: CapabilityReport;
	/** How the engine runs on this device. */
	readonly mode: EngineMode;
	/**
	 * Resolves once the GPU has finished the first frame, so it is on screen: the moment to remove
	 * a loading screen. It never resolves when the engine is destroyed first.
	 */
	readonly firstFrame: Promise<void>;
	/** The HTML elements that follow the labels the sketch tracks with `ui.trackLabel`. */
	readonly labels: EngineLabels;
	/** Sends a message to the sketch, which receives it through `ctx.page.onMessage`. */
	postToSketch(name: string, data?: unknown, transfer?: Transferable[]): void;
	/**
	 * Receives the messages the sketch sends with `ctx.page.post`. When no handler listened from the
	 * start, the first handler also receives the messages sent before it was registered. Returns a
	 * function that removes the handler.
	 */
	onSketchMessage(handler: (name: string, data: unknown) => void): () => void;
	/**
	 * Receives a failure after the engine started: the browser took the GPU away and the engine could
	 * not carry on with a new device (E1302), or an engine thread failed (E1404). After E1404 the
	 * engine draws no new frames: destroy it and start a new one. On WebGPU, the GPU can also run out
	 * of memory (E1304) or reject the engine's work (E1305), and the engine draws on without the
	 * objects that failed. The engine reports each failure once. Without a handler, it logs the
	 * failure to the console. Returns a function that removes the handler.
	 */
	onFailure(handler: (error: EngineError) => void): () => void;
	/**
	 * Pauses or resumes the sketch's frames. A pause also stops input: the sketch sees every key and
	 * button that was down come up, and input that comes during the pause never reaches it.
	 */
	setPaused(paused: boolean): void;
	/**
	 * Takes the canvas off the page and pauses the engine. The engine keeps its threads, its GPU
	 * resources and the scene, and stops reading input. Use it when a single-page app leaves the
	 * view that shows the canvas, and `attach` when the view comes back.
	 */
	detach(): void;
	/**
	 * Puts the canvas at the end of `container` and resumes the engine where it stopped, unless
	 * `setPaused(true)` paused it.
	 */
	attach(container: Element): void;
	/**
	 * Measures the running engine for a number of seconds, then returns CPU time per frame by thread
	 * and phase, GPU time, frame intervals, uploads, draw calls, memory and load time.
	 */
	measure(seconds: number): Promise<FrameMetrics>;
	/**
	 * Resolves with an image of the next frame that the engine draws, as a PNG file. The thread
	 * that draws reads the frame back and encodes it, so the page's thread does no work for it when
	 * a worker draws. In hold mode it is an image of the held frame, whose pixels the page keeps, so
	 * the GPU draws nothing for it. While the engine is paused, the image shows the frame on the
	 * canvas. A hidden page draws no frames, so its image comes once the page shows again. When no
	 * new frame comes within a second or two, as after a sketch error, the image shows the frame
	 * drawn last. Fails with E1414 once the engine has stopped, or when the thread that draws could
	 * not read the frame back, with the cause that the GPU gave, such as a lost device or too little
	 * memory.
	 */
	capture(): Promise<Blob>;
	/**
	 * Resolves with the pixels of the next frame that the engine draws, as RGBA8 rows, top row
	 * first, for tests. The thread that draws waits until its frame loop has taken a new frame, then
	 * draws that frame again offscreen and reads it back, so captures back to back give newer frames
	 * even where each readback holds that thread up. In hold mode, and while the engine is paused,
	 * it returns the frame on the canvas. A hidden page draws no frames, so its pixels come once the
	 * page shows again. When no new frame comes within a second or two, as after a
	 * sketch error, it returns the frame drawn last.
	 */
	captureFrame(): Promise<{ width: number; height: number; pixels: Uint8Array }>;
	/**
	 * Acts out a loss of the GPU, as a driver reset causes. The engine starts a new GPU device and
	 * draws the whole scene again, as it does after a real loss. Use it to test how your page
	 * handles one.
	 */
	simulateGpuLoss(): void;
	/**
	 * Stops the engine and its workers. The engine cannot start again. The sketch's `onDestroy` runs
	 * first, and later calls from the sketch's code fail with E1420. The thread that draws destroys
	 * the engine's GPU textures and buffers and its GPU device, so the GPU's memory comes back at
	 * once. It also leaves the canvas blank, at its size, because Safari keeps the GPU memory of a
	 * canvas's last frame until the canvas shows another. The promise resolves once every worker has
	 * stopped, when the browser can free the engine's memory. Wait for it before you start another
	 * engine on the same page: an iPad has room for only a few engines' memory. A new engine can
	 * start on the same canvas, with the same thread options; `createEngine` waits for this stop.
	 */
	destroy(): Promise<void>;
}

/** The global where the `?bench` switch publishes the running engine. */
const BENCH_GLOBAL = '__null3dEngine';
/** The GPU the engine asks for on a device with two: the faster one. */
const DEFAULT_POWER_PREFERENCE: PowerPreference = 'high-performance';
/** How often the page reads the frame records while it measures. */
const DRAIN_INTERVAL_MS = 250;
/** How many sketch messages the page keeps while no handler listens. */
const MAX_EARLY_MESSAGES = 256;
/** How long stopping the engine waits for its job workers and the worker that draws to stop. */
const STOP_TIMEOUT_MS = 2_000;

interface TierChoice {
	tier: Tier;
	forceCompat: boolean;
}

/** Picks the GPU tier from feature tests, never from browser or GPU names. */
export function chooseTier(
	report: CapabilityReport,
	wanted: GpuSwitch,
	inWorker: boolean,
): TierChoice | null {
	const worker = 'error' in report.worker ? undefined : report.worker;
	const webgpu =
		report.webgpu.compatibilityAdapter && (!inWorker || worker?.offscreenWebGPU === true);
	const webgl2 = inWorker ? worker?.offscreenWebGL2 === true : report.webgl2.available;
	if (wanted === 'webgl2') return webgl2 ? { tier: 'webgl2', forceCompat: false } : null;
	if (wanted === 'compat') return webgpu ? { tier: 'webgpu-compat', forceCompat: true } : null;
	if (wanted === 'webgpu')
		return webgpu && report.webgpu.coreFeaturesAndLimits
			? { tier: 'webgpu', forceCompat: false }
			: null;
	if (webgpu)
		return {
			tier: report.webgpu.coreFeaturesAndLimits ? 'webgpu' : 'webgpu-compat',
			forceCompat: false,
		};
	return webgl2 ? { tier: 'webgl2', forceCompat: false } : null;
}

type Pending = { resolve: (reply: WorkerReply) => void; reject: (error: Error) => void };

/**
 * The error of a worker that failed to start. An engine error keeps its code and message; any
 * other failure becomes E1405.
 */
export function startError(role: string, message: string): EngineError {
	const code = /^(E\d{4}): /.exec(message)?.[1];
	if (code && isErrorCode(code)) {
		const error = new EngineError(code, '');
		error.message = message;
		return error;
	}
	return new EngineError('E1405', `the ${role} worker did not start: ${message}.`);
}

type RunnerModule = typeof import('../sketch/runner');

/** The engine that runs its sketch on this page, where the page's copy of the core serves it. */
let pageSketch: Holder | undefined;

/**
 * Starts loading the sketch runner and the scene API, which the page needs only when it runs the
 * sketch itself. The bundler puts them in a file of their own.
 */
function loadRunnerModule(): Promise<RunnerModule> {
	return awaitLater(import('../sketch/runner'));
}

/** What the page does with the replies of a worker that answer no request. */
interface WorkerEvents {
	/** A message that the sketch sent with `ctx.page.post`. */
	sketchMessage(name: string, data: unknown): void;
	/**
	 * A failure of a thread. It ends a start that is still under way, unless `endsStart` is false:
	 * the engine then runs on without the thread.
	 */
	failure(error: EngineError, endsStart?: boolean): void;
	/** The quality preset and settings after a change, and the preset check's result. */
	quality(update: QualityUpdate): void;
	/** The sketch asked to show or hide the stats overlay. */
	stats(show: boolean): void;
	/** The slot in the label table of a label's id, or -1 once it has none. */
	labelSlot: LabelSlotSender;
}

/**
 * The error of a GPU that ran out of memory (E1304) or rejected a command (E1305), on `thread`, such
 * as "the render worker".
 */
export function gpuFailure(thread: string, outOfMemory: boolean, message: string): EngineError {
	return outOfMemory
		? new EngineError('E1304', `${thread}'s GPU ran out of memory: ${message}.`)
		: new EngineError('E1305', `${thread}'s GPU rejected a command: ${message}.`);
}

/**
 * A worker whose replies are routed: events to the page's handlers, answers to the oldest request.
 * A failure that a started worker reports, or that ends it, reaches the page as E1404.
 */
export class EngineWorker {
	private readonly waiting: Pending[] = [];
	private readyPromise: Promise<WorkerReply>;
	private readonly stoppedPromise: Promise<void>;
	private started = false;
	/** True once the worker answered a stop, and false while it has not or once it failed. */
	private stoppedCleanly = false;
	/** Settles the wait for the worker's answer to a stop of its drawing. */
	private answerStop: (() => void) | undefined;

	constructor(
		readonly worker: Worker,
		role: string,
		events: WorkerEvents,
	) {
		this.readyPromise = new Promise((resolve, reject) => {
			this.waiting.push({ resolve, reject });
		});
		void this.readyPromise.then(
			() => {
				this.started = true;
			},
			() => {},
		);
		let markStopped = () => {};
		this.stoppedPromise = new Promise((resolve) => {
			markStopped = resolve;
		});
		/**
		 * A failure that ends the worker's loop: it fails the request that waits, such as the start's,
		 * and once the worker has started, it reaches the page's failure handler.
		 */
		const failed = (message: string) => {
			this.stoppedCleanly = false;
			this.waiting.shift()?.reject(startError(role, message));
			if (this.started)
				events.failure(new EngineError('E1404', `the ${role} worker failed: ${message}.`));
		};
		worker.onmessage = (event: MessageEvent<WorkerReply>) => {
			const reply = event.data;
			switch (reply.type) {
				case 'sketch-message':
					events.sketchMessage(reply.name, reply.data);
					return;
				case 'quality':
					events.quality(reply.update);
					return;
				case 'stats':
					events.stats(reply.show);
					return;
				case 'label':
					events.labelSlot(reply.id, reply.slot, reply.generation);
					return;
				case 'lost':
					events.failure(
						new EngineError('E1302', `the ${reply.role} worker lost its GPU: ${reply.reason}.`),
					);
					return;
				case 'gpu-error':
					events.failure(
						gpuFailure(`the ${reply.role} worker`, reply.outOfMemory, reply.message),
						false,
					);
					return;
				case 'fault':
					// A job worker that failed has left the job system, so a stop need not wait for it.
					if (reply.role === 'job') markStopped();
					failed(reply.message);
					return;
				case 'progress':
					return;
				case 'stopped':
					this.stoppedCleanly = true;
					markStopped();
					this.answerStop?.();
					return;
			}
			if (reply.type === 'error') {
				markStopped();
				// A worker that started and then failed has no request waiting for the error.
				if (this.started && this.waiting.length === 0) {
					failed(reply.message);
					return;
				}
			}
			const pending = this.waiting.shift();
			if (!pending) return;
			if (reply.type === 'error') pending.reject(startError(reply.role, reply.message));
			else pending.resolve(reply);
		};
		worker.onerror = (event) => {
			markStopped();
			// A browser sends an error event without a message when the worker's script, or a file
			// that the script imports, did not load.
			const message = event.message || 'its script or a file it imports did not load';
			failed(message);
			this.answerStop?.();
		};
	}

	/**
	 * Asks the worker to stop: to run the sketch's onDestroy, and to free its GPU objects and device
	 * where it draws. Settles once it answers or fails.
	 */
	stopDrawing(): Promise<void> {
		this.stoppedCleanly = false;
		const answered = new Promise<void>((resolve) => {
			this.answerStop = resolve;
		});
		this.worker.postMessage({ type: 'stop-drawing' } satisfies RendererRequest);
		return answered;
	}

	/** True when the worker answered the page's stop, so it is in a state to start again. */
	get cleanStop(): boolean {
		return this.stoppedCleanly;
	}

	ready(): Promise<WorkerReply> {
		return this.readyPromise;
	}

	/**
	 * Settles once a job worker has left the job system, once the worker that draws has destroyed
	 * its GPU objects, or once the worker has failed.
	 */
	stopped(): Promise<void> {
		return this.stoppedPromise;
	}

	/** Stops the worker, and fails each request that still waits for its answer. */
	terminate(): void {
		this.worker.terminate();
		for (const pending of this.waiting.splice(0)) pending.reject(new Error('the engine stopped'));
	}

	request(message: RendererRequest): Promise<WorkerReply> {
		return new Promise((resolve, reject) => {
			this.waiting.push({ resolve, reject });
			this.worker.postMessage(message);
		});
	}
}

/**
 * Stops the workers once each worker in `waitFor` reports that it stopped, or after a timeout. A job
 * worker without work blocks its thread in a wait. When Safari stops a thread inside such a wait,
 * it keeps the thread's shared memory until the tab closes, even across reloads. The worker that
 * draws destroys its GPU objects first, because a browser frees what a stopped worker held only
 * when it collects the worker's objects, and Safari does that late.
 */
async function stopWorkers(
	workers: readonly EngineWorker[],
	waitFor: readonly Promise<void>[],
	keep?: EngineWorker,
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	await Promise.race([
		Promise.all(waitFor),
		new Promise((resolve) => {
			timer = setTimeout(resolve, STOP_TIMEOUT_MS);
		}),
	]);
	clearTimeout(timer);
	for (const w of workers) if (w !== keep) w.terminate();
}

/** The engine's workers, which the page starts before the core has compiled. */
interface EngineWorkers {
	/** The sketch worker, unless the page runs the sketch. */
	sketch: EngineWorker | undefined;
	/** The render worker, in the mode where it draws. */
	render: EngineWorker | undefined;
	jobs: EngineWorker[];
}

/** Every worker of a set, in the order the page stops them. */
function allWorkers(workers: EngineWorkers | undefined): EngineWorker[] {
	if (!workers) return [];
	return [workers.sketch, workers.render, ...workers.jobs].filter((w) => w !== undefined);
}

/**
 * Starts the engine's workers: the sketch worker unless the page runs the sketch, the render worker
 * when it draws, and the job workers. The page starts them before the core has compiled, so their
 * scripts and the core's loader download while the core does. Each worker waits for its start
 * message, which carries the core. A job worker that fails to start is reported as a failure of the
 * running engine, and never holds up the start. `reused` is the drawing worker that kept the canvas
 * when an engine before stopped, which serves in its role again.
 */
function startWorkers(
	sketchWorker: boolean,
	renderWorker: boolean,
	jobWorkers: number,
	slots: Int32Array,
	events: WorkerEvents,
	reused?: { worker: Worker; role: DrawingRole },
): EngineWorkers {
	/** Each worker as it starts, so that a refusal can stop the ones before it. */
	const made: Worker[] = [];
	const kept = (start: () => Worker) => {
		const worker = spawnWorker(start, (code, message) => new EngineError(code, message));
		made.push(worker);
		return worker;
	};
	try {
		const sketch = sketchWorker
			? new EngineWorker(
					reused?.role === 'sketch'
						? reused.worker
						: kept(
								() =>
									new Worker(new URL('../workers/sketch-worker.ts', import.meta.url), {
										type: 'module',
										name: 'null3d-sketch',
									}),
							),
					'sketch',
					events,
				)
			: undefined;
		const render = renderWorker
			? new EngineWorker(
					reused?.role === 'render'
						? reused.worker
						: kept(
								() =>
									new Worker(new URL('../workers/render-worker.ts', import.meta.url), {
										type: 'module',
										name: 'null3d-render',
									}),
							),
					'render',
					events,
				)
			: undefined;
		const jobs = Array.from({ length: jobWorkers }, (_, index) => {
			const job = new EngineWorker(
				kept(
					() =>
						new Worker(new URL('../workers/job-worker.ts', import.meta.url), {
							type: 'module',
							name: `null3d-job-${index}`,
						}),
				),
				`job ${index}`,
				events,
			);
			// Job workers join the job system as each becomes ready: until then the sketch thread and
			// the job workers already running take every chunk, so no frame waits for them.
			job.ready().catch((error: unknown) => {
				if (Atomics.load(slots, Slot.Running) !== 0)
					events.failure(
						error instanceof EngineError ? error : startError(`job ${index}`, String(error)),
						false,
					);
			});
			return job;
		});
		return { sketch, render, jobs };
	} catch (thrown) {
		// A browser that refuses a worker at once, such as for a script address it cannot read.
		for (const worker of made) worker.terminate();
		const reason = thrown instanceof Error ? thrown.message : String(thrown);
		throw new EngineError('E1405', `the browser refused to start an engine worker: ${reason}.`);
	}
}

/**
 * Downloads a file into the browser's cache, for a worker that imports it later. A host that lets
 * the browser keep build files, as the null3D Vite plugin asks, then saves the worker a round trip.
 * A failed download only loses that head start: the worker's own import reports the failure.
 */
function prefetch(url: string): void {
	fetch(url)
		.then((response) => response.arrayBuffer())
		.catch(() => {});
}

/**
 * Starts the engine on the page. It tests the device, picks the build and the GPU path, starts the
 * workers, and runs the sketch module. In hold mode it also steps the sketch to the held time, then
 * draws that frame and reads it back. It publishes the frame, or the error that stopped it, as
 * `window.__null3dHold` for test tools. With the `?bench` switch, it publishes the running engine
 * as `window.__null3dEngine`, where a benchmark tool calls `measure`.
 *
 * @category api/engine
 */
export async function createEngine(options: EngineOptions): Promise<Engine> {
	// The page's errors end with the fixes from its own table, and each worker gets the same table
	// in its handoff.
	setErrorFixes(ERROR_FIXES);
	const switches = parseSwitches(URL_SWITCHES ? (globalThis.location?.search ?? '') : '');
	const holding = options.hold !== undefined || switches.hold !== undefined;
	const place = placement(options, switches);
	const canvas = canvasHold(options.canvas);
	// This engine's hold on the canvas, and on the page's copy of the core when its sketch runs on
	// the page. Each serves one engine at a time.
	const holder = new Holder();
	const release = () => {
		if (pageSketch === holder) pageSketch = undefined;
		if (canvas.holder === holder) canvas.holder = undefined;
		holder.endStop();
	};
	try {
		checkPreload(options.preload);
		const hold = holdSeconds(options.hold, switches.hold);
		if (holding) publishHold(undefined);
		if (place.sketchThread === 'main')
			await takeWhenFree(
				() => pageSketch,
				() => {
					pageSketch = holder;
				},
				() =>
					new EngineError(
						'E1415',
						'createEngine() found another engine that runs its sketch on this page, which has not stopped.',
					),
			);
		await takeWhenFree(
			() => canvas.holder,
			() => {
				canvas.holder = holder;
			},
			() =>
				new EngineError(
					'E1419',
					'createEngine() got a canvas that another engine draws on, which has not stopped.',
				),
		);
		if (canvas.dead)
			throw new EngineError(
				'E1419',
				`createEngine() got a canvas that no engine can draw on again: ${canvas.dead}.`,
			);
		return await startEngine(options, switches, hold, place, canvas, holder, release);
	} catch (error) {
		release();
		if (holding) publishHold(holdFailure(error));
		throw error;
	} finally {
		holder.startSettled();
	}
}

/** Throws E1421 for a name in `preload` that names no feature whose shaders load on first use. */
function checkPreload(preload: readonly string[] | undefined): void {
	const known: readonly string[] = SHADER_FEATURES;
	for (const feature of preload ?? [])
		if (!known.includes(feature))
			throw new EngineError(
				'E1421',
				`createEngine() got '${feature}' in preload. The features are ${known.join(', ')}.`,
			);
}

/** Where the engine runs: its build, and the thread that runs the sketch and the core. */
interface Placement {
	threaded: boolean;
	sketchThread: SketchThread;
}

/**
 * Picks the build and the sketch's thread from facts the page has at once, so the core downloads
 * and compiles while the probe tests the GPU paths. The threaded build needs shared memory, and the
 * single-threaded build runs the sketch on the page's thread.
 */
function placement(options: EngineOptions, switches: Switches): Placement {
	const threaded =
		globalThis.crossOriginIsolated === true &&
		typeof SharedArrayBuffer === 'function' &&
		switches.threads;
	const main = !threaded || (switches.sketchThread ?? options.sketchThread) === 'main';
	return { threaded, sketchThread: main ? 'main' : 'worker' };
}

/**
 * Starts the engine with the page's switches. With a hold time, it resolves once the held frame
 * is read back, and publishes it.
 */
async function startEngine(
	options: EngineOptions,
	switches: Switches,
	hold: number | undefined,
	{ threaded, sketchThread }: Placement,
	canvasHold: CanvasHold,
	holder: Holder,
	release: () => void,
): Promise<Engine> {
	const startedAt = performance.now();
	const { signal } = options;
	// A page's progress handler that throws is the page's error: the console shows it, and the
	// start goes on.
	const onProgress = (stage: StartupStage) => {
		try {
			options.onProgress?.(stage);
		} catch (error) {
			console.error(error);
		}
	};
	signal?.throwIfAborted();
	const pageUrl = globalThis.location?.href;
	const sketchUrl = new URL(options.sketch, pageUrl).href;
	// The quality preset follows the device hints and the crash marker, which the page has at once,
	// so its memory maximum is known before the core loads. Hold mode and the ?preset= switch fix
	// the preset for tests, so they neither read nor write the marker.
	const marker =
		hold === undefined && switches.preset === undefined ? new StartMarker(sketchUrl) : undefined;
	const history = marker?.read() ?? NO_HISTORY;
	const optionPreset = presetOption(options.preset);
	const pageSettings = {
		maxPixelRatio: options.maxPixelRatio,
		antialias: options.antialias,
		shadowCascades: options.shadowCascades,
		shadowMapSize: options.shadowMapSize,
		shadowTiles: options.shadowTiles,
		shadowTileSize: options.shadowTileSize,
		pointLightShadows: options.pointLightShadows,
		depthPrepass: switches.prepass ?? options.depthPrepass,
		gpuOcclusion: switches.occlusion ?? options.gpuOcclusion,
		morphTargets: options.morphTargets,
		softwareOcclusion: switches.occlusion ?? options.softwareOcclusion,
	};
	checkSettings('createEngine()', pageSettings);
	const presetRequest: PresetRequest = {
		wanted: switches.preset ?? optionPreset,
		hints: readDeviceHints(),
		crashedStarts: history.crashed,
	};
	const maximumMiB = memoryMaximumMiB(
		options.memory?.maximumMiB,
		switches.memoryMiB,
		presetValue('memoryMaximumMiB', memoryPreset(presetRequest)),
	);
	// Checked before any download, so an old browser learns at once why the engine cannot run.
	checkBrowser();
	const build: Build = threaded ? 'threaded' : 'single';
	let latency: EngineMode['latency'] = threaded
		? (switches.latency ?? options.latency ?? 'pipelined')
		: 'single';
	const sketchOnPage = sketchThread === 'main';
	let coreMs = 0;
	const coreLoad = awaitLater(
		loadCore(build, maximumMiB).then((loaded) => {
			coreMs = performance.now() - startedAt;
			return loaded;
		}),
	);
	// A page that runs the sketch itself needs the core's loader, the sketch runner and the sketch
	// module right after the core, so they download while the core does: each later start delays the
	// first frame by a round trip on a slow network. The sketch module's top-level code then runs when
	// the module arrives. Hold mode loads the module once the runner has seeded the thread's random
	// numbers, so that code draws the same numbers on every run.
	if (sketchOnPage) void awaitLater(loadGlue(build));
	const runnerModule = sketchOnPage ? loadRunnerModule() : undefined;
	const sketchModule =
		sketchOnPage && hold === undefined ? awaitLater(loadSketch(sketchUrl)) : undefined;
	const powerPreference = options.powerPreference ?? DEFAULT_POWER_PREFERENCE;

	const messageHandlers = new Set<(name: string, data: unknown) => void>();
	if (options.onSketchMessage) messageHandlers.add(options.onSketchMessage);
	// Messages sent before the page listens wait for the first handler. The newest are kept when a
	// sketch sends many.
	let earlyMessages: [string, unknown][] | undefined = options.onSketchMessage ? undefined : [];
	const onSketchMessage = (name: string, data: unknown) => {
		if (earlyMessages) {
			if (earlyMessages.push([name, data]) > MAX_EARLY_MESSAGES) earlyMessages.shift();
			return;
		}
		for (const handler of messageHandlers) handler(name, data);
	};
	const failureHandlers = new Set<(error: EngineError) => void>();
	const reported = new Set<string>();
	/** Where a start that checks its preset keeps the check's result for later starts. */
	let checkStore: CheckStore | undefined;
	/**
	 * Ends the start when the caller cancels it, or when a thread fails before the engine has
	 * started. A thread that fails then, such as the one that draws, leaves the start waiting for
	 * frames that never come, and the page could never stop the engine that it never got.
	 */
	const start = new AbortController();
	let starting = true;
	const cancelStart = () => start.abort(signal?.reason);
	signal?.addEventListener('abort', cancelStart, { once: true });
	const onFailure = (error: EngineError, endsStart = true) => {
		if (reported.has(error.message)) return;
		reported.add(error.message);
		if (starting && endsStart) {
			start.abort(error);
			return;
		}
		if (failureHandlers.size === 0) console.error(error);
		for (const handler of failureHandlers) handler(error);
	};
	// The GPU path, the mode and the threads, which the start sets once the probe has run. The
	// handlers below read them only after that.
	let tier!: Tier;
	let mode!: EngineMode;
	let engineThreads!: [string, number[]][];
	const events: WorkerEvents = {
		sketchMessage: onSketchMessage,
		failure: onFailure,
		// The page applies the settings that it owns: the pixel ratio cap sizes the canvas. The
		// engine's mode reports the preset and the preset check, which the page stores for later
		// starts.
		quality: (update) => {
			canvasWatch?.setMaxPixelRatio(update.settings.maxPixelRatio);
			mode.preset = update.preset;
			if (!update.check) return;
			mode.presetCheck = update.check;
			checkStore?.save(update.check, switches.fps);
		},
		stats: (show) => statsSwitch.show(show),
		labelSlot: (id, slot, generation) => pageLabels?.setSlot(id, slot, generation),
	};
	/** The page's labels, once the page knows which thread draws. */
	let pageLabels: PageLabels | undefined;

	const jobWorkers = threaded
		? jobWorkerCount(switches.jobs, navigator.hardwareConcurrency ?? 1)
		: 0;
	const control = createControlBuffer(threaded, labelCapacity(options.maxLabels));
	const metrics = createMetricsBuffer(threaded, jobWorkers);
	const views = controlViews(control);
	const { slots } = views;
	const statsSwitch = new StatsSwitch(() => ({
		canvas: options.canvas,
		metrics,
		threads: engineThreads,
		sources: {
			tier,
			preset: () => mode.preset,
			renderScaleThousandths: () => Atomics.load(slots, Slot.RenderScale),
		},
	}));
	Atomics.store(slots, Slot.Running, 1);
	/**
	 * The thread that draws, unless the probe finds that a worker cannot draw here. In low-latency
	 * mode the thread that runs the sketch draws too.
	 */
	let renderThread: EngineMode['renderThread'] =
		latency === 'single' || switches.renderOnMain
			? 'main'
			: latency === 'low'
				? sketchOnPage
					? 'main'
					: 'sketch-worker'
				: 'render-worker';
	// A canvas that an engine before drew on keeps the thread that drew: the page, whose context it
	// has, or the worker that it moved to, which the page can never take it back from.
	if (canvasHold.pageContext && renderThread !== 'main') {
		latency = 'pipelined';
		renderThread = 'main';
	}
	const movedTo = canvasHold.movedTo;
	if (movedTo === 'render' && renderThread === 'sketch-worker') {
		latency = 'pipelined';
		renderThread = 'render-worker';
	}
	const drawingRole =
		renderThread === 'render-worker'
			? 'render'
			: renderThread === 'sketch-worker'
				? 'sketch'
				: undefined;
	if (movedTo && movedTo !== drawingRole)
		throw new EngineError(
			'E1419',
			`createEngine() got a canvas whose ${movedTo} worker drew for an engine before, and this engine draws ${renderThread === 'main' ? 'on the page' : 'in its sketch worker'}. Start it with the same options as that engine, or on a new canvas element`,
		);
	// A page that draws loads the renderer while the core downloads too. When the probe finds that a
	// worker cannot draw here, the page loads it as soon as the probe ends.
	let drawModule = renderThread === 'main' ? loadDrawModule() : undefined;
	/** The worker that keeps the canvas from an engine before, which draws for this one. */
	const keptWorker = movedTo ? takeParkedWorker(options.canvas, canvasHold) : undefined;
	// With worker threads the page starts the workers now. A sketch worker gets the sketch module
	// into the browser's cache, and still runs the module only after it has started the core.
	const threads = threaded
		? startWorkers(
				!sketchOnPage,
				renderThread === 'render-worker',
				jobWorkers,
				slots,
				events,
				keptWorker && movedTo && { worker: keptWorker, role: movedTo },
			)
		: undefined;
	if (threads?.sketch) {
		prefetch(sketchUrl);
		// In low-latency mode the sketch worker draws, so it loads the renderer now too.
		if (renderThread === 'sketch-worker')
			threads.sketch.worker.postMessage({ type: 'load-renderer' });
	}

	// What the start sets up, which a stop takes down again, from any point of the start.
	let coreMemory: WebAssembly.Memory | undefined;
	let canvasWatch: CanvasWatch | undefined;
	let input: ReturnType<typeof captureInput> | undefined;
	let stopPreferences: (() => void) | undefined;
	let stopDisplay: (() => void) | undefined;
	let rendererHost: EngineWorker | undefined;
	/** The job workers that got the core, which a stop waits for. */
	let jobsWithCore: readonly EngineWorker[] = [];
	/** The sketch worker and the render worker once they got the core, which a stop asks to stop. */
	const withCore = new Set<EngineWorker>();
	/** The worker that holds the canvas, or will once the start moves it there. */
	let canvasWorker = movedTo === 'render' ? threads?.render : movedTo ? threads?.sketch : undefined;
	let localDrawing: Drawing<Renderer> | undefined;
	let localRunner: SketchRunner | undefined;
	/**
	 * The page's core, when the page runs the sketch. The page keeps the single-threaded build's core
	 * for the next engine it starts. The threaded build's core lives in the engine's own shared
	 * memory, so each engine starts a core of its own.
	 */
	let localCore: CoreGlue | undefined;
	/** The job workers' task ports that the page's on-demand loader uses, when the page runs the sketch. */
	let jobTaskHost: JobTaskHost | undefined;
	let stopping: Promise<void> | undefined;
	/** The marker of a start that may crash the tab, which the start sets once it knows the tier. */
	let markerSet = false;
	/**
	 * Ends the job workers' loops at once. A page that leaves without stopping the engine, such as a
	 * page in a frame that goes away, does it too, because the browser then stops the workers
	 * wherever they are.
	 */
	const stopJobs = () => {
		if (coreMemory) stopJobWorkers(coreMemory, slots);
	};
	const stopJobsAsPageLeaves = () => {
		stopJobs();
		waitForJobWorkersToLeave(slots);
	};
	/**
	 * Stops every loop and then the workers, and wakes each thread that waits, so it sees the stop.
	 * It works from any point of the start. Then it drops the page's engine, lets go of the page's
	 * threaded core, and leaves the canvas to the next engine: a worker that holds it stays, without
	 * the core and the GPU device, unless it failed. A second call returns the first call's promise.
	 */
	const stop = () => {
		stopping ??= (async () => {
			holder.beginStop();
			Atomics.store(slots, Slot.Running, 0);
			// A thread that checked the slots just before the stop and is about to wait on one finds
			// its value changed, so it never sleeps through the stop.
			Atomics.store(slots, Slot.JobsReady, 1);
			Atomics.store(slots, Slot.Paused, 2);
			stopJobs();
			globalThis.removeEventListener?.('pagehide', stopJobsAsPageLeaves);
			statsSwitch.show(false);
			for (const slot of [
				Slot.Running,
				Slot.FramesTaken,
				Slot.Paused,
				Slot.JobsReady,
				Slot.PipelinesBuilt,
			])
				notifySlot(slots, slot, threads?.sketch?.worker);
			await localDrawing?.stop();
			localRunner?.dispose();
			input?.listen(false);
			canvasWatch?.listen(false);
			stopPreferences?.();
			stopDisplay?.();
			// A start that fails or stops has not crashed the tab.
			if (markerSet) marker?.end();
			const waitFor = jobsWithCore.map((job) => job.stopped());
			// The sketch worker runs the sketch's onDestroy, and the worker that draws destroys its GPU
			// objects and its device, before each answers.
			for (const worker of withCore)
				if (!jobsWithCore.includes(worker)) waitFor.push(worker.stopDrawing());
			await stopWorkers(allWorkers(threads), waitFor, canvasWorker);
			leaveCanvas();
			// The render worker may have been inside a frame when the engine stopped, replaying a draw
			// list that the page's engine holds, so the engine stays until that worker has stopped.
			localCore?.destroyEngine();
			// The job workers have left the job system, so the page's threaded core has no more work,
			// and the browser can free the engine's memory once the page lets go of the core and of the
			// loader's call into it.
			clearJobTasks(jobTaskHost);
			localCore?.releaseInstance?.();
			release();
		})();
		return stopping;
	};
	/**
	 * Leaves the canvas to the next engine. A worker that holds it and answered the stop, or never
	 * got this engine's core, stays with it; one that failed ends, and the canvas with it.
	 */
	const leaveCanvas = () => {
		if (!canvasWorker || !canvasHold.movedTo) return;
		if (withCore.has(canvasWorker) && !canvasWorker.cleanStop) {
			canvasWorker.terminate();
			canvasHold.dead = `its ${canvasHold.movedTo} worker did not stop cleanly`;
			return;
		}
		canvasWorker.worker.postMessage({ type: 'park' } satisfies RendererRequest);
		parkWorker(options.canvas, canvasHold, canvasWorker.worker, canvasHold.movedTo);
	};
	try {
		const report = await abortable(probeCapabilities(powerPreference, presetRequest.hints), signal);
		const probeMs = performance.now() - startedAt;
		const requested = switches.gpu !== 'auto' ? switches.gpu : (options.gpu ?? 'auto');
		// After starts that crashed on WebGPU, WebGL2 comes first, unless the page names a GPU path.
		const safeGpu = requested === 'auto' ? crashTier(history.crashed, history.lastTier) : undefined;
		const pickTier = (inWorker: boolean) =>
			(safeGpu && chooseTier(report, safeGpu, inWorker)) || chooseTier(report, requested, inWorker);

		let choice = pickTier(renderThread !== 'main');
		if (!choice && renderThread !== 'main' && !movedTo) {
			// Worker rendering is unavailable here, so the page draws while the sketch worker computes
			// the frames, in pipelined mode. Low latency needs the sketch worker to draw.
			if (DEV && latency === 'low')
				console.warn(
					'null3D: low latency needs a worker that draws, and this browser cannot draw in a worker. The engine runs in pipelined mode, and the page draws.',
				);
			latency = 'pipelined';
			renderThread = 'main';
			choice = pickTier(false);
			threads?.render?.terminate();
			if (threads) threads.render = undefined;
			drawModule ??= loadDrawModule();
		}
		if (!choice)
			throw new EngineError('E1301', `no usable GPU path for ?gpu=${requested} in this browser.`);
		tier = choice.tier;
		const { forceCompat } = choice;
		// Where the page draws, it moves the label elements right after each frame it draws.
		const labels = new PageLabels(views, renderThread === 'main');
		pageLabels = labels;
		const chosen = choosePreset(presetRequest, tier);
		// The engine checks a preset that it chose itself, when a lighter one exists. A preset that the
		// page, a switch or hold mode fixes stays as it is. A start after a crash measures again, and
		// so does one that ?check=fresh asks to. Otherwise the result of an earlier check of the sketch
		// on this device and browser gives the preset at once, while it applies.
		const checks =
			optionPreset === 'auto' &&
			switches.preset === undefined &&
			hold === undefined &&
			chosen !== 'low';
		if (checks && history.crashed === 0) {
			const { width, height } = options.canvas.getBoundingClientRect();
			const conditions = checkConditions(report, tier, chosen, switches.fps);
			checkStore = new CheckStore(sketchUrl, conditions, width * height);
		}
		const storedCheck = switches.freshCheck ? undefined : checkStore?.read();
		const preset = storedCheck?.rounds.at(-1)?.preset ?? chosen;
		// Occlusion culling on the GPU needs WebGPU's compute passes, and does not run with the depth
		// prepass, which only the page turns on.
		const tierSettings =
			tier === 'webgl2' || pageSettings.depthPrepass
				? { ...pageSettings, gpuOcclusion: false }
				: pageSettings;
		const quality: QualityStart = {
			preset,
			settings: checkedSettings(chosen, preset, tierSettings),
			options: tierSettings,
			highest: withinTier('ultra', tier),
			check: checks && !storedCheck ? { fps: switches.fps } : undefined,
		};
		mode = {
			build,
			latency: latency === 'pipelined' && sketchOnPage && renderThread === 'main' ? 'low' : latency,
			sketchThread,
			renderThread,
			jobWorkers,
			hold: hold ?? null,
			preset,
			presetCheck: storedCheck ?? null,
			crashedStarts: history.crashed,
			memoryMaximumMiB: threaded ? maximumMiB : null,
		};
		/** Each engine thread's name and the roles it runs, for the frame figures. */
		engineThreads = [...threadRoles(mode)];
		// What the thread that draws needs besides its canvas, whichever thread that is.
		const rendererSetup: Omit<RendererSetup, 'canvas'> = {
			tier,
			forceCompat,
			powerPreference,
			fps: switches.fps,
			queue: switches.queue,
			displayChecks: switches.displayChecks,
			hold: hold !== undefined,
			glTiming: switches.glTiming,
			preload: options.preload,
		};

		const device = coreDevice(tier, report, {
			...switches,
			antialias: quality.settings.antialias,
			transparent: options.transparent === true,
			depthPrepass: quality.settings.depthPrepass,
			largeWorld: options.largeWorld === true,
			gpuOcclusion: quality.settings.gpuOcclusion,
		});
		// The GPU path and the device's fixed bits choose the shader file that the renderer loads
		// first, so the thread that draws starts its download now, while the core downloads.
		const shaderPreload: ShaderPreload = { type: 'load-shaders', tier, bits: device.shaderBits };
		if (renderThread === 'render-worker') threads?.render?.worker.postMessage(shaderPreload);
		else if (renderThread === 'sketch-worker') threads?.sketch?.worker.postMessage(shaderPreload);
		else if (drawModule) preloadShaders(drawModule, tier, device.shaderBits);

		const core = await abortable(coreLoad, signal);
		coreMemory = core.memory;
		onProgress('core');
		let wasmMemory = core.memory;
		const capabilities: EngineCapabilities = {
			tier,
			threaded,
			features:
				tier === 'webgl2'
					? Object.keys(report.webgl2.extensions).filter((n) => report.webgl2.extensions[n])
					: report.webgpu.features,
			limits: tier === 'webgl2' ? {} : report.webgpu.limits,
			hdr: device.sceneColor !== FORMAT_CANVAS,
			halfPrecision: (device.shaderBits & PERMUTATION_HALF) !== 0,
			maxInstances: maxInstances(device),
			maxCanvasSize: maxCanvasSize(tier, report),
			depth: device.depth,
		};
		// Where the browser lacks Atomics.waitAsync, the threads wake each other with messages.
		const wakeByMessage = switches.wakeByMessage || !report.atomicsWaitAsync;
		setWakeByMessage(wakeByMessage);
		const handoff: CoreHandoff = {
			build,
			module: core.module,
			memory: core.memory,
			control,
			metrics,
			device,
			errorFixes: ERROR_FIXES,
			wakeByMessage,
		};
		// Only a canvas that no engine used before may need its CSS size fixed: the fix resizes the
		// canvas, which a canvas in a worker refuses.
		const watch = watchCanvas(
			options.canvas,
			control,
			quality.settings.maxPixelRatio,
			capabilities.maxCanvasSize,
			!canvasHold.sized,
		);
		canvasHold.sized = true;
		canvasWatch = watch;
		watch.listen(true);
		// Hold mode keeps input out, so a held frame never depends on it.
		const takesInput = hold === undefined;
		const pageInput = captureInput(options.canvas, control);
		input = pageInput;
		pageInput.listen(takesInput);
		stopPreferences = watchPreferences(slots);
		// A worker that draws holds its frames to the display's rate, which only the page can measure.
		stopDisplay = renderThread !== 'main' && hold === undefined ? watchDisplay(slots) : undefined;

		let userPaused = false;
		let detached = false;
		const applyPause = () => {
			const paused = userPaused || detached;
			pageInput.listen(takesInput && !paused);
			// Counted before the flag clears, so the sketch's first step after the pause sees it.
			if (!paused && Atomics.load(slots, Slot.Paused) !== 0) Atomics.add(slots, Slot.Resumes, 1);
			Atomics.store(slots, Slot.Paused, paused ? 1 : 0);
			notifySlot(slots, Slot.Paused, threads?.sketch?.worker);
		};
		const pageLoss = (reason: string) =>
			onFailure(new EngineError('E1302', `the page lost its GPU: ${reason}.`));
		let draw: DrawModule | undefined;
		/**
		 * Draws on the page's thread from the draw lists in `memory`, with the renderer that the page
		 * loads for it. With a sketch, the page steps it before each draw. Texture images come into the
		 * page's table from that sketch, or through a port from the sketch worker.
		 */
		const drawOnPage = async (
			memory: WebAssembly.Memory | undefined,
			images: Pick<DrawingSetup, 'imageTable' | 'imagePort'>,
			sketch?: SketchRunner,
		) => {
			draw = await (drawModule ?? loadDrawModule());
			// The page's context stays with the canvas: an engine after this one draws on the page too.
			canvasHold.pageContext = true;
			return draw.startDrawing({
				canvas: options.canvas,
				...rendererSetup,
				metrics,
				device,
				scene: memory && { memory, control },
				control,
				sketch,
				...images,
				presented: () => labels.update(),
				fail: pageLoss,
				fault: (error) =>
					onFailure(
						new EngineError('E1404', `the drawing on the page failed: ${messageOf(error)}.`),
					),
				gpuError: (outOfMemory, message) =>
					onFailure(gpuFailure('the page', outOfMemory, message), false),
			});
		};

		if (threads?.jobs.length) globalThis.addEventListener?.('pagehide', stopJobsAsPageLeaves);

		/**
		 * Hands the core to the job workers, each with a port for the on-demand loader's tasks. A stop
		 * waits until each job worker reports that it left the job system, which one without the core
		 * never does. Returns the other end of each port, for the thread that runs the sketch.
		 */
		const startJobs = (jobs: readonly EngineWorker[]): MessagePort[] => {
			jobsWithCore = jobs;
			return jobs.map((job, index) => {
				const tasks = new MessageChannel();
				job.worker.postMessage({ type: 'init', ...handoff, index, taskPort: tasks.port1 }, [
					tasks.port1,
				]);
				return tasks.port2;
			});
		};
		/**
		 * Moves the canvas to the worker that draws, unless that worker kept it from an engine before.
		 * Returns the canvas to hand over, if any.
		 */
		const moveCanvas = (worker: EngineWorker, role: DrawingRole): OffscreenCanvas | undefined => {
			canvasWorker = worker;
			if (canvasHold.movedTo) return undefined;
			const canvas = options.canvas.transferControlToOffscreen();
			canvasHold.movedTo = role;
			return canvas;
		};
		/** Hands the canvas and the core to the render worker, with the port that images come through. */
		const startRenderWorker = (render: EngineWorker, imagePort: MessagePort) => {
			const canvas = moveCanvas(render, 'render');
			render.worker.postMessage(
				{ type: 'init', ...handoff, canvas, ...rendererSetup, imagePort },
				canvas ? [canvas, imagePort] : [imagePort],
			);
			rendererHost = render;
			withCore.add(render);
		};

		marker?.begin(history, tier);
		markerSet = true;
		if (sketchOnPage) {
			// The page starts its core before the workers get theirs. The first core in a new shared
			// memory fills it with the core's data, and a core that starts while another fills it
			// waits, which the page's thread must never do.
			const coreStart = startCore(build, core.module, core.memory);
			const started = await abortable(coreStart, start.signal).catch((error: unknown) => {
				// A start that ends while the page's core starts lets go of that core once it has
				// started, or the core would keep the engine's memory.
				void coreStart.then(
					({ glue }) => glue.releaseInstance?.(),
					() => undefined,
				);
				throw error;
			});
			localCore = started.glue;
			const memory = started.memory as WebAssembly.Memory;
			wasmMemory = memory;
			const imageTable = new ImageTable();
			const render = threads?.render;
			// The page's on-demand loader sends its tasks to this engine's job workers; without them, it
			// starts a task worker.
			const glue = started.glue;
			jobTaskHost = {
				ports: threads ? startJobs(threads.jobs) : [],
				call: (index) => glue.callJobWorker(index),
			};
			setJobTasks(jobTaskHost);
			let imagePort: MessagePort | undefined;
			if (render) {
				// The setup can wait for frames of the render worker: in hold mode, for a warm-up, and
				// for the preset check. So a render worker that does not start ends the start at once.
				render.ready().catch((error: unknown) => start.abort(error));
				// Texture images and custom materials' shaders go from the page straight to the render
				// worker.
				const images = new MessageChannel();
				imagePort = images.port1;
				startRenderWorker(render, images.port2);
			}
			const senders = drawingSenders(imageTable, slots, imagePort);
			const { SketchRunner, runPipelined } = await (runnerModule ?? loadRunnerModule());
			localRunner = new SketchRunner(
				(name, data) => onSketchMessage(name, data),
				metrics,
				{
					glue: started.glue,
					memory,
					control: views,
					keyCodes: KEY_CODES,
					jobWorkers,
					device,
					quality,
					applyQuality: events.quality,
					capabilities,
					...senders,
					pageUrl: pageUrl ?? sketchUrl,
					fps: switches.fps,
					threads: engineThreads,
					showStats: events.stats,
					sendLabelSlot: events.labelSlot,
				},
				hold,
			);
			// In hold mode the sketch module loads only now, after the runner seeded the random
			// numbers. The renderer starts before the setup, so a warm-up in the setup has a renderer
			// to build its pipelines.
			const sketchLoad = sketchModule ?? awaitLater(loadSketch(sketchUrl));
			if (!render)
				localDrawing = await abortable(
					drawOnPage(memory, { imageTable }, localRunner),
					start.signal,
				);
			// A setup that fails without an engine code fails the start with E1405, as a sketch worker's
			// does: a setup function that throws, or a trap in the core during a warm-up.
			const setup = sketchLoad
				.then((sketch) => localRunner?.setup(sketch))
				.catch((error: unknown) => {
					throw error instanceof EngineError
						? error
						: new EngineError(
								'E1405',
								`the sketch on the page did not start: ${messageOf(error)}.`,
							);
				});
			await abortable(setup, start.signal);
			if (render) {
				await abortable(render.ready(), start.signal);
				if (hold === undefined)
					void runPipelined(localRunner, control, (error) =>
						onFailure(
							new EngineError('E1404', `the sketch on the page failed: ${messageOf(error)}.`),
						),
					);
			}
		} else if (threads?.sketch) {
			const { sketch, render, jobs } = threads;
			const taskPorts = startJobs(jobs);
			const init: SketchWorkerInit = {
				taskPorts,
				type: 'init',
				...handoff,
				sketchUrl,
				pageUrl: pageUrl ?? sketchUrl,
				keyCodes: KEY_CODES,
				jobWorkers,
				capabilities,
				hold,
				quality,
				fps: switches.fps,
				threads: engineThreads,
			};
			withCore.add(sketch);
			if (renderThread === 'sketch-worker') {
				const canvas = moveCanvas(sketch, 'sketch');
				sketch.worker.postMessage({ ...init, renderer: { canvas, ...rendererSetup } }, [
					...(canvas ? [canvas] : []),
					...taskPorts,
				]);
				rendererHost = sketch;
			} else {
				// Texture images go from the sketch worker straight to the thread that draws.
				const images = new MessageChannel();
				sketch.worker.postMessage({ ...init, imagePort: images.port1 }, [
					images.port1,
					...taskPorts,
				]);
				if (render) startRenderWorker(render, images.port2);
				else
					localDrawing = await abortable(
						drawOnPage(core.memory, { imagePort: images.port2 }),
						start.signal,
					);
			}
			// The engine is ready once the sketch worker and the render worker are.
			const essential = render ? [sketch, render] : [sketch];
			await abortable(Promise.all(essential.map((w) => w.ready())), start.signal);
		}
		start.signal.throwIfAborted();
		starting = false;
		signal?.removeEventListener('abort', cancelStart);

		const engineStartMs = performance.now() - startedAt;
		onProgress('sketch');
		// The thread that draws writes the time the GPU finished the first frame; the page checks for
		// it once per animation frame until it appears.
		const header = new MetricsReader(metrics);
		const firstFrame = new Promise<void>((resolve) => {
			const check = () => {
				if (Atomics.load(slots, Slot.Running) === 0) return;
				if (header.firstFrameDoneTime > 0) {
					onProgress('first-frame');
					resolve();
					return;
				}
				requestAnimationFrame(check);
			};
			requestAnimationFrame(check);
		});
		marker?.endAfter(firstFrame);
		/** Hold mode's frame, read back once. */
		let held: CapturedFrame | undefined;
		/** The error of a thread that draws when it could not capture a frame. */
		const captureFailure = (reply: WorkerReply | undefined) =>
			new Error(
				`the frame could not be captured${reply?.type === 'capture-failed' ? `: ${reply.message}` : ''}`,
			);
		/** Draws a frame offscreen on the thread that draws, and reads it back. */
		const capture = async (): Promise<CapturedFrame> => {
			if (localDrawing && draw) return draw.captureFrame(localDrawing, slots);
			const reply = await rendererHost?.request({ type: 'capture' });
			if (reply?.type === 'captured')
				return { width: reply.width, height: reply.height, pixels: reply.pixels };
			throw captureFailure(reply);
		};
		/**
		 * Draws a frame offscreen on the thread that draws, which encodes it as a PNG file. Hold
		 * mode's frame is read back already, so the page encodes that and the GPU draws nothing more.
		 */
		const captureImage = async (): Promise<Blob> => {
			if (held) return encodeFrame({ ...held, pixels: held.pixels.slice() }, device.transparent);
			if (localDrawing && draw) return draw.captureImage(localDrawing, slots);
			const reply = await rendererHost?.request({ type: 'capture', image: true });
			if (reply?.type === 'captured-image') return reply.image;
			throw captureFailure(reply);
		};
		const stopped = () => Atomics.load(slots, Slot.Running) === 0;

		const engine: Engine = {
			capabilities,
			report,
			mode,
			firstFrame,
			labels,
			postToSketch(name, data, transfer = []) {
				if (localRunner) localRunner.receive(name, data);
				else threads?.sketch?.worker.postMessage({ type: 'post', name, data }, transfer);
			},
			onSketchMessage(handler) {
				messageHandlers.add(handler);
				const early = earlyMessages;
				earlyMessages = undefined;
				if (early) for (const [name, data] of early) handler(name, data);
				return () => messageHandlers.delete(handler);
			},
			onFailure(handler) {
				failureHandlers.add(handler);
				return () => failureHandlers.delete(handler);
			},
			setPaused(paused) {
				userPaused = paused;
				applyPause();
			},
			detach() {
				if (detached) return;
				detached = true;
				watch.listen(false);
				applyPause();
				options.canvas.remove();
			},
			attach(container) {
				container.append(options.canvas);
				if (!detached) return;
				detached = false;
				watch.listen(true);
				applyPause();
			},
			async measure(seconds) {
				const reader = new MetricsReader(metrics);
				const heap = new HeapSampler();
				const mainThread = new MainThreadWatch();
				reader.begin();
				heap.start();
				const started = performance.now();
				const drain = setInterval(() => reader.drain(), DRAIN_INTERVAL_MS);
				await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
				clearInterval(drain);
				reader.end();
				const firstFrame = reader.firstFrameTime;
				return {
					seconds: (performance.now() - started) / 1000,
					...summarizeFrames(reader.records, threadRoles(mode)),
					memory: { wasmBytes: wasmMemory?.buffer.byteLength ?? null, ...heap.stop() },
					load: {
						engineStartMs,
						probeMs,
						coreMs,
						firstFrameMs: firstFrame > 0 ? firstFrame - performance.timeOrigin : null,
						firstFrameDoneMs:
							reader.firstFrameDoneTime > 0
								? reader.firstFrameDoneTime - performance.timeOrigin
								: null,
						warmUpMs: reader.warmUpMs,
						firstDrawMs: reader.firstDrawMs,
						firstFramePipelines: reader.firstFramePipelines,
					},
					gpuLosses: Atomics.load(slots, Slot.GpuEpoch),
					downloadBytes: { wasm: wasmDownloadBytes() },
					lostRecords: reader.lost,
					completionSignal: tier === 'webgl2' ? 'fence' : 'queue',
					refreshHz: reader.refreshHz > 0 ? reader.refreshHz : null,
					mainThread: mainThread.stop(),
					perSecond: secondRates(reader.records),
				};
			},
			async capture() {
				try {
					if (stopped()) throw new Error('the engine has stopped');
					return await captureImage();
				} catch (error) {
					throw new EngineError('E1414', `engine.capture() failed: ${messageOf(error)}.`);
				}
			},
			async captureFrame() {
				return held ? { ...held, pixels: held.pixels.slice() } : capture();
			},
			simulateGpuLoss() {
				if (localDrawing) localDrawing.simulateLoss();
				else rendererHost?.worker.postMessage({ type: 'lose-gpu' });
			},
			destroy() {
				return stop();
			},
		};
		if (hold === undefined) {
			if (switches.bench) (globalThis as Record<string, unknown>)[BENCH_GLOBAL] = engine;
			return engine;
		}
		try {
			held = await abortable(holdFrame(capture, failureHandlers), signal);
		} catch (error) {
			await stop();
			throw error;
		}
		publishHold({
			ok: true,
			time: hold,
			frame: Atomics.load(slots, Slot.FramesTaken),
			tier,
			...held,
			stats: summarizeFrames(new MetricsReader(metrics).readWritten(), threadRoles(mode)),
		});
		return engine;
	} catch (e) {
		starting = false;
		signal?.removeEventListener('abort', cancelStart);
		await stop();
		throw e;
	}
}

/**
 * Draws the held frame and reads it back through `capture`. The first failure that the engine
 * reports meanwhile, such as a lost GPU, ends the hold instead. A failure without a code becomes
 * E1408.
 */
async function holdFrame<T>(
	capture: () => Promise<T>,
	failureHandlers: Set<(error: EngineError) => void>,
): Promise<T> {
	let fail: (error: EngineError) => void = () => {};
	const failed = new Promise<never>((_, reject) => {
		fail = reject;
	});
	failureHandlers.add(fail);
	try {
		return await Promise.race([capture(), failed]);
	} catch (error) {
		if (error instanceof EngineError) throw error;
		throw new EngineError(
			'E1408',
			`hold mode stopped before it read the held frame back: ${messageOf(error)}.`,
		);
	} finally {
		failureHandlers.delete(fail);
	}
}
