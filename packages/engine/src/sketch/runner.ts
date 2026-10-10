// Runs a sketch: starts the engine on this thread's core, calls the sketch's setup function once with
// the scene API, and steps it once per frame. A frame reads the canvas size and the input the page
// wrote, runs the sketch's fixed steps and its update, then the core's commands and transforms. It
// then runs the sketch's late update and updates what that moved, and ends with the core's other
// steps, which publish the frame's draw list. Each step's CPU time is recorded, and so is the time
// each job worker spent on the frame's work. Development builds report static objects whose
// transform changed without a setter, before each transform update. A warm-up during the setup
// records and publishes a frame of the scene as it stands, with none of the sketch's code, so the
// thread that draws builds its pipelines. In hold mode it seeds this thread's math.random and routes
// Math.random to it, steps the sketch to the held time in fixed steps after the setup, and publishes
// the last frame alone. Hold mode reads no input and no display preference, so the held frame never
// depends on them: the sketch sees no request for reduced motion and hears of no change. In
// development builds, the frame's debug drawing reaches the core just before the frame records;
// release builds give the sketch calls that do nothing. Each core step of the frame can grow the
// engine's memory, so the views of it are made again after each step that sketch code or a
// development check follows, and at the end of the frame, for code that runs between frames. When
// the engine chose the preset itself, the setup ends with the preset check (preset-check.ts), which
// loads after the first frame. The first frame after a change of preset, and the first frame whose
// handlers hear of it, wait for their pipelines on the thread that draws.

import { DebugDraw } from '../debug/draw';
import { type DebugHost, SketchDebug } from '../debug/sketch-debug';
import type { StatsRequest } from '../debug/stats-options';
import { DEV } from '../errors/checks';
import { coreFailure, QUEUED_CHANGE } from '../errors/core-failure';
import { EngineError } from '../errors/engine-error';
import { messageOf } from '../errors/message';
import {
	LIGHT_VALUE_SHADOW_CASCADES,
	LIGHT_VALUE_SHADOW_MAP_SIZE,
	TEXTURE_OPTION_UPLOAD_ALL,
	TEXTURE_STAT_IMAGES_SENT,
	TEXTURE_STAT_WAITING,
} from '../generated/core';
import { FORMAT_CANVAS } from '../generated/gpu';
import type { EngineCapabilities } from '../page/engine';
import { type CoreDevice, cellTableWarning } from '../page/limits';
import { FULL_SCALE, Governor, GovernorLoop, thousandths } from '../quality/governor';
import { type QualitySettings, SKETCH_SETTINGS } from '../quality/presets';
import { Assets } from '../scene/assets';
import { FrameCameras } from '../scene/frame-cameras';
import { CoreMemory } from '../scene/memory';
import { Post } from '../scene/post';
import { Render } from '../scene/render';
import { Geometry, Materials } from '../scene/resources';
import { Scene } from '../scene/scene';
import { ShaderPreloads } from '../scene/shader-preloads';
import { ShaderTemplates } from '../scene/shader-templates';
import { Textures } from '../scene/textures';
import {
	type ControlViews,
	controlLabels,
	controlViews,
	frameAfter,
	frameReached,
	nextFrame,
	Slot,
} from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { stopHelperWorkers } from '../shared/helper-workers';
import {
	type ImageSender,
	imagesArrived,
	type PreloadSender,
	type ShaderSender,
} from '../shared/images';
import { Counter, FrameRecorder, MemoryFigure, Phase, Role } from '../shared/metrics';
import { slotChange, slotChangeOrRecheck } from '../shared/wake';
import type { WgslUpdate } from '../shared/wgsl-updates';
import { FixedClock, FrameClock, holdSteps } from './clock';
import type { SketchCallbacks, SketchContext, SketchDefinition } from './define-sketch';
import { InputReader } from './input';
import { type QualityStart, type QualityUpdate, RESTART_CHANGE, SketchQuality } from './quality';
import { HOLD_SEED, seedMathRandom } from './random';
import { type LabelSlotSender, Ui } from './ui';

export type PagePoster = (type: string, data: unknown, transfer?: Transferable[]) => void;

/** Fixed sizes of the engine core. */
const MAX_BATCHES = 256;
const COMMAND_CAPACITY = 1 << 16;

export interface SketchCore {
	glue: CoreGlue;
	memory: WebAssembly.Memory;
	/** The control block: the canvas size and input in, the published draw lists out. */
	control: ControlViews;
	/** The key names, in the order of the numbers that the page gives keys in the input ring. */
	keyCodes: readonly string[];
	jobWorkers: number;
	/** The device the engine draws with. */
	device: CoreDevice;
	/** The quality preset and settings that the page chose. */
	quality: QualityStart;
	/** Gives the page the quality preset and settings after each change. */
	applyQuality(update: QualityUpdate): void;
	/** The GPU path the engine chose, and what it offers, as the page reports it. */
	capabilities: EngineCapabilities;
	/** Sends texture images to the thread that draws. */
	sendImage: ImageSender;
	/** Sends custom materials' shaders to the thread that draws. */
	sendShader: ShaderSender;
	/** Asks the thread that draws to load the shader files of features that the sketch will use. */
	sendPreload: PreloadSender;
	/** The page's address, which the sketch's relative asset addresses resolve against. */
	pageUrl: string;
	/** The frame rate that ?fps= holds, or undefined to draw at the display's rate. */
	fps?: number;
	/** Each engine thread's name and the roles it runs, as `engine.measure` names them. */
	threads: readonly (readonly [string, readonly number[]])[];
	/** Asks the page to show or hide its stats overlay, or to change its options. */
	showStats(show: StatsRequest): void;
	/** Tells the page the slot in the label table of each label's id. */
	sendLabelSlot: LabelSlotSender;
}

/** How often a wait for a control slot checks it, where the control block is not shared memory. */
const SLOT_POLL_MS = 4;
/**
 * While a reader shows the frame figures, the first frame that samples publishes the memory
 * figures, and then one frame in every this many.
 */
const MEMORY_EVERY = 8;

/**
 * Resolves once a control slot holds frame `target` or a later one, or once the engine stops. It waits without
 * blocking the thread, and checks the slot on a timer where the control block is not shared memory.
 * A start's steps wait this way, so each wait also checks the slot again after a short time, in case
 * the browser missed the wake.
 */
async function reached(slots: Int32Array, slot: number, target: number): Promise<void> {
	const shared =
		typeof SharedArrayBuffer !== 'undefined' && slots.buffer instanceof SharedArrayBuffer;
	for (;;) {
		const value = Atomics.load(slots, slot);
		if (frameReached(value, target) || Atomics.load(slots, Slot.Running) === 0) return;
		if (shared) {
			const change = slotChangeOrRecheck(slots, slot, value);
			if (change) await change;
		} else await new Promise((resolve) => setTimeout(resolve, SLOT_POLL_MS));
	}
}

/**
 * The pipelined frame loop of a thread that runs the sketch while another thread draws: the sketch
 * worker, or the page with sketchThread: 'main'. It steps the sketch once the thread that draws has
 * taken the frame before, and waits for that without blocking, so the thread's event loop stays free
 * for promises, messages and the page's events. It ends when the engine stops, or when a frame
 * step throws, such as a trap in the core: `fault` then hears the error, and the engine draws the
 * last frame until the page destroys it. Each pass reads the newest published frame, because the
 * setup's frames publish from the same thread.
 */
export async function runPipelined(
	sketch: SketchRunner,
	control: ArrayBufferLike,
	fault: (error: unknown) => void,
): Promise<void> {
	const { slots } = controlViews(control);
	try {
		while (Atomics.load(slots, Slot.Running) !== 0) {
			const paused = Atomics.load(slots, Slot.Paused);
			if (paused !== 0) {
				const change = slotChange(slots, Slot.Paused, paused);
				if (change) await change;
				continue;
			}
			const taken = Atomics.load(slots, Slot.FramesTaken);
			if (frameAfter(Atomics.load(slots, Slot.FramesPublished), taken)) {
				const change = slotChange(slots, Slot.FramesTaken, taken);
				if (change) await change;
				continue;
			}
			const published = sketch.step(performance.now());
			Atomics.store(slots, Slot.FramesPublished, published);
			Atomics.notify(slots, Slot.FramesPublished);
		}
	} catch (error) {
		if (Atomics.load(slots, Slot.Running) !== 0) fault(error);
	}
}

export class SketchRunner {
	private readonly messageHandlers = new Set<(type: string, data: unknown) => void>();
	private readonly preferenceHandlers = new Set<() => void>();
	/** The motion preference as the sketch last saw it. */
	private reducedMotion: number;
	private callbacks: SketchCallbacks = {};
	/** True once the setup function has returned. */
	private setUp = false;
	/** The frames that warm-ups during the setup published, one after another, as the last one's number. */
	private setupFrames: Promise<number> = Promise.resolve(0);
	private readonly clock = new FrameClock();
	/** The fixed steps' clock, which the sketch's options set up. */
	private fixed = new FixedClock();
	/** The sketch's `time`, which each frame updates in place. Its frames are those that run the sketch. */
	private readonly time = { now: 0, dt: 0, frame: 0 };
	/**
	 * The engine's number of the frame it recorded last. The setup's frames, for warm-ups and the
	 * preset check, count here but not in `time.frame`. The core, the draw lists and the thread that
	 * draws use these numbers.
	 */
	private readonly recorded = { frame: 0 };
	/** The sketch's `engine.viewport`, which each frame updates in place when the canvas changed. */
	private readonly viewport = { width: 0, height: 0, pixelRatio: 1 };
	/** The page's count of canvas size changes when the viewport last read them. */
	private viewportSerial = -1;
	private gpuEpoch = 0;
	/**
	 * Frames left before the next publish of the memory figures, while a reader samples them. It is
	 * 0 while nobody samples, so the first frame that samples publishes them.
	 */
	private memoryWait = 0;
	private readonly record: FrameRecorder;
	/** One recorder per job worker, for the busy time the core reports for it each frame. */
	private readonly jobRecords: FrameRecorder[];
	private readonly core: CoreMemory;
	private readonly reported = new Set<string>();
	/** When the current phase of the frame started. */
	private phaseStart = 0;
	/** True while hold mode steps the sketch: the first failure then stops it. */
	private holding = false;
	/** Gives the thread its own Math.random back, after hold mode seeded it. */
	private restoreRandom: (() => void) | undefined;
	private readonly input: InputReader;
	private readonly quality: SketchQuality;
	/** The sketch's textures, whose memory budget each frame looks at. */
	private readonly textures: Textures;
	/**
	 * The frame-budget governor, which moves the render scale and the shadow settings during play.
	 * In hold mode it takes no step, and the settings apply as set.
	 */
	private readonly governor = new Governor();
	/** The governor's part of the frame loop; none in hold mode. */
	private readonly governorLoop: GovernorLoop | undefined;
	/** The governor's count of changes when the core last took the settings that its steps move. */
	private stepChanges = 0;
	/** The sketch's post-processing settings, which say whether bloom is on. */
	private readonly post: Post;
	private readonly render: Render;
	/** True while the sketch has bloom on, as the governor knows it. */
	private bloomOn = false;
	/** The base of bloom's chain that the `bloomSize` setting gives. */
	private bloomSetting = 0;
	/** The `followMovingCasters` setting, which the governor's shadow steps keep. */
	private followMovers = true;
	/** The `shadowCascadeBlend` setting, which the governor's shadow steps keep. */
	private cascadeBlend = 0;
	/** True while the sketch has ambient occlusion on, as the governor knows it. */
	private aoOn = false;
	/** The scale of ambient occlusion's targets that the `aoScale` setting gives, in thousandths. */
	private aoSetting = 0;
	/** True while ambient occlusion draws: the sketch has it on, and its scale is above 0. */
	private aoDrawn = false;
	/** True once the core draws HDR color for an effect, on a device that started on the 8-bit path. */
	private hdrForEffects = false;
	/** The render scale in thousandths where the governor does not move it: the highest. */
	private heldScale = FULL_SCALE;
	/** The sketch's debug drawing, in development builds only, which is also its `ctx.debug`. */
	private readonly debugDraw: DebugDraw | undefined;
	/** The sketch's labels, which each frame projects. */
	private readonly ui: Ui;
	/** True once the sketch thread has warned that the grid cells ran out. */
	private cellsWarned = false;
	readonly context: SketchContext;

	/**
	 * Starts the engine on the core's thread. `holdSeconds` starts hold mode at that sketch time: it
	 * seeds this thread's math.random, and routes Math.random to it, at once. So the runner must
	 * exist before the sketch module loads, and `setup` then steps the sketch to that time.
	 */
	constructor(
		post: PagePoster,
		private readonly metrics: ArrayBufferLike,
		private readonly sketch: SketchCore,
		private readonly holdSeconds?: number,
	) {
		this.record = new FrameRecorder(metrics, Role.Sketch);
		this.jobRecords = Array.from(
			{ length: sketch.jobWorkers },
			(_, k) => new FrameRecorder(metrics, Role.Job + k),
		);
		const { glue, device } = sketch;
		const { slots } = sketch.control;
		const status = glue.initEngine(
			sketch.jobWorkers,
			device.expectedObjects,
			MAX_BATCHES,
			COMMAND_CAPACITY,
			device.storageBindingBytes,
			device.webgl2,
			device.capabilities,
			device.maxTextureSize,
			device.sceneColor,
			device.antialias,
			device.transparent,
			device.cellCulling,
			device.depthPrepass,
			device.skinning,
			device.indexInstances,
			device.largeWorld,
			device.gpuOcclusion,
			device.shadowDepthBits,
		);
		if (status !== 0) throw coreFailure(glue, 'createEngine');
		const {
			shadowTiles,
			shadowTileSize,
			pointLightShadows,
			shadowCascades,
			shadowMapSize,
			morphTargets,
		} = sketch.quality.settings;
		glue.setShadowTiles(shadowTiles, shadowTileSize, pointLightShadows);
		glue.setMorphTargets(morphTargets);
		if (device.occlusionBuffer > 0) glue.setOcclusionBuffer(device.occlusionBuffer);
		// Directional lights that name no cascades or map size take the preset's.
		glue.setLightDefault(LIGHT_VALUE_SHADOW_CASCADES, shadowCascades);
		glue.setLightDefault(LIGHT_VALUE_SHADOW_MAP_SIZE, shadowMapSize);
		if (sketch.jobWorkers > 0) {
			// The page ends the job workers' loops through these words when the engine stops.
			Atomics.store(slots, Slot.JobsWakeAddress, glue.jobsWakeAddress());
			Atomics.store(slots, Slot.JobsStopAddress, glue.jobsStopAddress());
			Atomics.store(slots, Slot.JobsReady, 1);
			Atomics.notify(slots, Slot.JobsReady);
		}
		this.core = new CoreMemory(glue, sketch.memory, glue.arraysMovedAddress());
		this.reducedMotion = Atomics.load(slots, Slot.ReducedMotion);
		this.input = new InputReader(sketch.control, sketch.keyCodes);
		const textures = new Textures(
			this.core,
			sketch.sendImage,
			this.recorded,
			device.capabilities,
			() => this.quality.own('uploadBytesPerFrame'),
			(id) => imagesArrived(slots, id),
			device.webgl2,
			device.textureCache,
			() => this.quality.own('textureMemoryMiB'),
		);
		// The core takes every texture setting of the preset before the setup runs, so a sketch's own
		// budget wins until the setting changes. The page applies the settings it owns.
		textures.applyQuality(sketch.quality.settings, SKETCH_SETTINGS);
		this.governorLoop =
			holdSeconds === undefined
				? new GovernorLoop(
						this.governor,
						metrics,
						{
							shadowCasters: () => glue.shadowCasters(),
							loading: () => glue.textureStat(TEXTURE_STAT_WAITING, 0) > 0,
						},
						sketch.fps,
					)
				: undefined;
		const { governor } = this;
		const bloomSize = () => this.bloomSetting / 2 ** governor.bloomHalvings;
		this.quality = new SketchQuality(
			sketch.quality,
			(update, changed) => {
				this.applyFrameSettings(update.settings);
				textures.applyQuality(update.settings, changed);
				sketch.applyQuality(update);
			},
			() => this.settle(true),
			() => this.renderScale() / FULL_SCALE,
			{
				get steps() {
					return governor.steps;
				},
				get farCascadeInterval() {
					return governor.farInterval;
				},
				get shadowFilter() {
					return governor.filter as 3 | 5;
				},
				get bloomSize() {
					return bloomSize();
				},
				get aoScale() {
					return governor.aoScale / FULL_SCALE;
				},
			},
			textures.memory,
		);
		this.textures = textures;
		this.applyFrameSettings(this.quality.settings);
		this.readViewport();
		const host: DebugHost = {
			showStats: sketch.showStats,
			metrics,
			threads: sketch.threads,
			sources: {
				tier: sketch.capabilities.tier,
				preset: () => this.quality.preset,
				renderScaleThousandths: () => this.renderScale(),
				wasmBytes: () => this.core.memory.buffer.byteLength,
			},
		};
		const templates = new ShaderTemplates(sketch.sendShader);
		const materials = new Materials(this.core, templates, new ShaderPreloads(sketch.sendPreload));
		const geometry = new Geometry(this.core);
		const scene = new Scene(
			this.core,
			this.recorded,
			device.webgl2,
			() => this.warmUp(),
			new FrameCameras(this.core, sketch.control, this.input),
			{ geometry, materials },
			this.input,
		);
		geometry.users = scene;
		this.post = new Post(
			this.core,
			device.effectsSceneColor !== FORMAT_CANVAS,
			device.occlusionTargets,
			materials.shaders,
			templates,
			device.joinEffects,
		);
		this.render = new Render(this.core, scene, materials.shaders, textures.maxSize);
		// A pass's target has the scene color's format: 8-bit color only on the 8-bit path.
		textures.passFormat = device.sceneColor === FORMAT_CANVAS ? 'rgba8unorm' : 'rgba16float';
		this.ui = new Ui(
			controlLabels(slots.buffer),
			scene,
			this.core,
			scene.frameCameras,
			sketch.sendLabelSlot,
		);
		this.debugDraw = DEV ? new DebugDraw(this.core, host, scene) : undefined;
		const debug = this.debugDraw ?? new SketchDebug(host);
		this.context = {
			time: this.time,
			engine: { viewport: this.viewport, capabilities: sketch.capabilities },
			scene,
			materials,
			geometry,
			textures,
			assets: new Assets(textures, sketch.pageUrl, { core: this.core, geometry, materials, scene }),
			input: this.input,
			post: this.post,
			render: this.render,
			ui: this.ui,
			quality: this.quality,
			preferences: {
				get reducedMotion() {
					return holdSeconds === undefined && Atomics.load(slots, Slot.ReducedMotion) !== 0;
				},
				onChange: (handler) => {
					this.preferenceHandlers.add(handler);
					return () => this.preferenceHandlers.delete(handler);
				},
			},
			page: {
				post: (type, data, transfer) => post(type, data, transfer),
				onMessage: (handler) => {
					this.messageHandlers.add(handler);
					return () => this.messageHandlers.delete(handler);
				},
			},
			debug,
		};
		// Last, so a constructor that fails leaves the thread's own Math.random in place.
		if (holdSeconds !== undefined) this.restoreRandom = seedMathRandom(HOLD_SEED);
	}

	/**
	 * Runs the sketch's setup function, which returns the sketch's callbacks. When the page asks for
	 * it, the preset check follows. In hold mode, it then steps the sketch to the held time (see
	 * `hold`). Options out of range fail with E1214 before the setup function runs.
	 */
	async setup(sketch: SketchDefinition): Promise<void> {
		this.fixed = new FixedClock(sketch.options.fixedRate, sketch.options.maxFixedSteps);
		this.callbacks = (await sketch.setup(this.context)) ?? {};
		const { check } = this.sketch.quality;
		if (check && this.holdSeconds === undefined) await this.checkPreset();
		// Warm-ups that the setup started without waiting for them publish their frames first, so
		// the frame loop never records while a setup frame does.
		await this.setupFrames;
		this.setUp = true;
		if (this.holdSeconds !== undefined) await this.hold(this.holdSeconds);
	}

	/**
	 * The preset check, after the setup: the first frame draws with every pipeline built, then the
	 * check measures the scene as the setup built it, and lowers the preset where the device cannot
	 * hold its frame rate. Its code loads after the first frame, while the scene keeps drawing. A
	 * check that cannot load leaves the preset as it is.
	 */
	private async checkPreset(): Promise<void> {
		if (!(await this.drawSetupFrame())) return;
		const loading = import('./preset-check');
		let loaded = false;
		const settled = () => {
			loaded = true;
		};
		loading.then(settled, settled);
		const graceStart = performance.now();
		while (!loaded) if (!(await this.drawSetupFrame())) return;
		const { glue } = this.sketch;
		const { quality } = this;
		try {
			const check = await (await loading).checkPreset(
				{
					metrics: this.metrics,
					get preset() {
						return quality.preset;
					},
					lower: () => quality.lower(),
					drawFrame: () => this.drawSetupFrame(),
					uploading: () => glue.textureStat(TEXTURE_STAT_WAITING, 0) > 0,
					maxFps: this.sketch.fps,
					resumes: () => Atomics.load(this.sketch.control.slots, Slot.Resumes),
				},
				graceStart,
			);
			if (check) this.quality.report(check);
		} catch (error) {
			console.warn(`null3D could not check the quality preset: ${messageOf(error)}`);
		}
	}

	/** True once the setup function has returned, so the frame loop may step the sketch. */
	get started(): boolean {
		return this.setUp;
	}

	/**
	 * Resolves once the thread that draws has built every pipeline that the scene needs as it
	 * stands. The next frame that the sketch records creates each pipeline the GPU lacks, and the
	 * thread that draws reports each frame whose pipelines are built. The setup has no frame loop,
	 * so there a warm-up records that frame itself. Hold mode draws one frame, which waits for its
	 * pipelines, so there a warm-up resolves at once.
	 */
	warmUp(): Promise<void> {
		return this.settle(false);
	}

	/**
	 * Resolves once the next frame's pipelines are built, as `warmUp` describes, and with `drawn`,
	 * once the thread that draws has taken that frame too, so the targets it makes exist.
	 */
	private async settle(drawn: boolean): Promise<void> {
		if (this.holdSeconds !== undefined) return;
		const { slots } = this.sketch.control;
		const target = this.setUp ? nextFrame(this.recorded.frame) : await this.queueSetupFrame();
		await reached(slots, Slot.PipelinesBuilt, target);
		if (drawn) await reached(slots, Slot.FramesTaken, target);
	}

	/** Publishes a setup frame after those already queued, and resolves with its number. */
	private queueSetupFrame(): Promise<number> {
		this.setupFrames = this.setupFrames.then(() => this.publishSetupFrame());
		return this.setupFrames;
	}

	/**
	 * Publishes a setup frame and waits until the thread that draws has taken it. Resolves with
	 * false when the engine stopped first.
	 */
	private async drawSetupFrame(): Promise<boolean> {
		const { slots } = this.sketch.control;
		if (Atomics.load(slots, Slot.Running) === 0) return false;
		await reached(slots, Slot.FramesTaken, await this.queueSetupFrame());
		return Atomics.load(slots, Slot.Running) !== 0;
	}

	/**
	 * Records a frame of the scene as the setup has built it so far, with no update, and publishes
	 * it for the thread that draws. The frame before the last shares its list. The thread that
	 * draws marks a frame taken before it replays the frame's list, so that list is free only once
	 * the last frame is taken, as in the frame loop.
	 */
	private async publishSetupFrame(): Promise<number> {
		const { slots } = this.sketch.control;
		while (
			frameAfter(this.recorded.frame, Atomics.load(slots, Slot.FramesTaken)) &&
			Atomics.load(slots, Slot.Running) !== 0
		)
			await reached(slots, Slot.FramesTaken, this.recorded.frame);
		const frame = this.frame(false);
		Atomics.store(slots, Slot.FramesPublished, frame);
		Atomics.notify(slots, Slot.FramesPublished);
		return frame;
	}

	/**
	 * Ends the sketch when the engine stops: runs its onDestroy, then makes every later call to the
	 * engine fail with E1420, so code that outlives the engine never reaches the next engine's core.
	 * It also gives the thread its own Math.random back, where hold mode seeded it.
	 */
	dispose(): void {
		if (this.core.stopped) return;
		try {
			this.callbacks.onDestroy?.();
		} catch (error) {
			console.error(error);
		}
		this.core.stop();
		stopHelperWorkers();
		this.restoreRandom?.();
		this.restoreRandom = undefined;
	}

	/** Delivers a message the page sent with engine.postToSketch. It arrives between frames. */
	receive(type: string, data: unknown): void {
		for (const handler of this.messageHandlers) handler(type, data);
	}

	/** Swaps the shaders of the sketch's custom materials that hot updates of WGSL name. */
	updateShaders(updates: readonly WgslUpdate[]): void {
		this.context.materials.updateShaders(updates);
	}

	/** Reads the canvas's size into the viewport, when the page wrote a new one. */
	private readViewport(): void {
		const { slots, slotFloats } = this.sketch.control;
		const serial = Atomics.load(slots, Slot.ResizeSerial);
		if (serial === this.viewportSerial) return;
		this.viewportSerial = serial;
		const viewport = this.viewport;
		viewport.width = slotFloats[Slot.CanvasCssWidth] as number;
		viewport.height = slotFloats[Slot.CanvasCssHeight] as number;
		viewport.pixelRatio = slotFloats[Slot.PixelRatio] as number;
		this.sketch.glue.setPixelRatio(viewport.pixelRatio);
	}

	/** Records the time since the previous phase ended as a phase of the frame. */
	private endPhase(phase: number): void {
		const now = performance.now();
		this.record.addPhase(phase, now - this.phaseStart);
		this.phaseStart = now;
	}

	/**
	 * Reports a failure in the sketch or the core, logging each distinct message once so a repeating
	 * one does not flood the console. A live engine carries on; hold mode stops at the first one.
	 */
	private report(error: unknown): void {
		const message = messageOf(error);
		if (!this.reported.has(message)) {
			this.reported.add(message);
			console.error(error);
		}
		if (this.holding) throw error;
	}

	/** The render scale of the frame being drawn, in thousandths. */
	private renderScale(): number {
		return this.governorLoop ? this.governor.scale : this.heldScale;
	}

	/** Publishes the textures' and meshes' GPU memory for the frame figures on every thread. */
	private publishMemory(): void {
		const { record } = this;
		const textures = this.textures.memory;
		record.publishMemory(MemoryFigure.TextureBytes, textures.bytes);
		record.publishMemory(MemoryFigure.TextureBudgetBytes, textures.budgetBytes);
		record.publishMemory(MemoryFigure.DroppedLevels, textures.droppedLevels);
		record.publishMemory(MemoryFigure.MeshBytes, this.context.geometry.memoryBytes);
	}

	/**
	 * Applies the settings that the frames read: gives the governor the render scale's range and
	 * the shadow settings, and tells the core whether the scale can drop below the whole canvas, and
	 * how shadows filter and update after the governor's steps. With the governor off, the range
	 * holds the highest scale alone. Hold mode draws at the highest scale of the range, with the
	 * passes that play draws the range with.
	 */
	private applyFrameSettings(settings: QualitySettings): void {
		const low = thousandths(settings.minRenderScale);
		const high = thousandths(settings.maxRenderScale);
		this.heldScale = high;
		const { governor } = this;
		governor.setOn(settings.governor);
		governor.setRange(low, high);
		this.followMovers = settings.followMovingCasters;
		this.cascadeBlend = settings.shadowCascadeBlend;
		governor.setShadows(settings.shadowFilter, settings.farCascadeInterval, this.followMovers);
		this.bloomSetting = settings.bloomSize;
		governor.setBloom(this.bloomOn, this.bloomSetting);
		this.aoSetting = Math.round(settings.aoScale * FULL_SCALE);
		governor.setAo(this.aoOn, this.aoSetting);
		this.stepChanges = governor.stepChanges;
		const { glue } = this.sketch;
		if (
			glue.setRenderScaling((settings.governor ? low : high) < FULL_SCALE) !== 0 ||
			this.setShadowQuality() !== 0 ||
			glue.setBloomChain(this.bloomSetting, governor.bloomHalvings) !== 0 ||
			glue.setAoScale(governor.aoScale) !== 0 ||
			glue.setDofTaps(settings.dofSamples) !== 0 ||
			glue.setReflectionScale(settings.reflectionScale) !== 0 ||
			glue.setSoftwareOcclusion(settings.softwareOcclusion) !== 0
		)
			this.report(coreFailure(glue, 'quality.set'));
	}

	/**
	 * Gives the core the shadow filter and the far cascades' interval after the governor's steps,
	 * whether far cascades follow moving casters, and the blend between cascades. Returns the
	 * core's result: 0 when it took them.
	 */
	private setShadowQuality(): number {
		const { governor } = this;
		return this.sketch.glue.setShadowQuality(
			governor.filter,
			governor.farInterval,
			this.followMovers,
			this.cascadeBlend,
		);
	}

	/**
	 * Gives the core the shadow settings and bloom's base after a step of the governor, and tells
	 * the sketch's change handlers of it.
	 */
	private applyGovernedSteps(): void {
		const { governor } = this;
		const { glue } = this.sketch;
		this.stepChanges = governor.stepChanges;
		if (
			this.setShadowQuality() !== 0 ||
			glue.setBloomChain(this.bloomSetting, governor.bloomHalvings) !== 0 ||
			glue.setAoScale(governor.aoScale) !== 0
		)
			this.report(coreFailure(glue, 'the quality governor'));
		this.quality.governed();
	}

	/**
	 * Follows the sketch's effects. Returns true when the frame has new targets and pipelines, so
	 * the thread that draws holds it until they are built, and the frame before stays on screen
	 * meanwhile.
	 */
	private followEffects(): boolean {
		const ao = this.followAo();
		const bloom = this.followBloom();
		const custom = this.post.takeNewPipelines();
		const passes = this.render.takeNewPipelines();
		return ao || bloom || custom || passes;
	}

	/**
	 * Follows the sketch's ambient occlusion: the governor's step needs it on. Returns true when it
	 * starts or stops drawing: the frame adds or removes the depth prepass and the steps.
	 */
	private followAo(): boolean {
		const on = this.post.aoOn;
		if (on !== this.aoOn) {
			this.aoOn = on;
			this.governor.setAo(on, this.aoSetting);
		}
		const drawn = on && this.aoSetting > 0;
		if (drawn === this.aoDrawn) return false;
		this.aoDrawn = drawn;
		return true;
	}

	/**
	 * Follows the sketch's bloom, which the governor's bloom step needs on, and its other effects.
	 * The first time bloom, a custom effect or a custom tone curve turns on, on a device that started
	 * on the 8-bit path only for MSAA, the core moves to HDR color with FXAA for the engine's life.
	 * Returns true then: the frame has new targets and pipelines, so the thread that draws holds it
	 * until they are built, and the frame before stays on screen meanwhile.
	 */
	private followBloom(): boolean {
		const on = this.post.bloomOn;
		if (on !== this.bloomOn) {
			this.bloomOn = on;
			this.governor.setBloom(on, this.bloomSetting);
		}
		const { device, glue } = this.sketch;
		if (!this.post.needsHdr || this.hdrForEffects || device.sceneColor !== FORMAT_CANVAS)
			return false;
		if (device.effectsSceneColor === FORMAT_CANVAS) return false;
		this.hdrForEffects = true;
		if (glue.setCanvasOutput(device.effectsSceneColor, device.effectsAntialias) !== 0)
			this.report(coreFailure(glue, 'post.set'));
		return true;
	}

	/** Calls each of the sketch's handlers with `value`, and reports each error that one throws. */
	private notify<T>(handlers: Iterable<(value: T) => void>, value: T): void {
		for (const handler of handlers) {
			try {
				handler(value);
			} catch (error) {
				this.report(error);
			}
		}
	}

	/**
	 * Advances the sketch by one frame and returns the new frame number, counting from 1.
	 * `timestamp` is the frame's time in milliseconds.
	 */
	step(timestamp: number): number {
		this.clock.advance(timestamp, Atomics.load(this.sketch.control.slots, Slot.Resumes));
		return this.frame();
	}

	/**
	 * Hold mode: steps the sketch from time 0 to `seconds` in fixed steps, with no frame loop, and
	 * publishes the last frame for the thread that draws. That thread draws none of the earlier
	 * frames, so the last one creates every GPU object and uploads the whole scene, as after a GPU
	 * loss, textures included. It waits for every texture image to reach that thread first. The
	 * first failure in the sketch or the core stops the hold with E1408.
	 */
	private async hold(seconds: number): Promise<void> {
		const steps = holdSteps(seconds);
		const { slots } = this.sketch.control;
		const { glue } = this.sketch;
		let frame = 0;
		this.holding = true;
		try {
			for (let step = 0; step <= steps; step++) {
				this.clock.holdStep(step, steps, seconds);
				if (step === steps) {
					await imagesArrived(slots, glue.textureStat(TEXTURE_STAT_IMAGES_SENT, 0));
					glue.setTextureOption(TEXTURE_OPTION_UPLOAD_ALL, 1);
					// Like a new GPU device, the thread that draws has none of the objects that the
					// earlier frames' lists created, so the last frame records as it does after a GPU
					// loss.
					this.gpuEpoch = -1;
				}
				frame = this.frame();
			}
		} catch (error) {
			throw new EngineError(
				'E1408',
				`hold mode stopped at ${Number(this.clock.now.toFixed(3))} seconds, in frame ${this.context.time.frame}: ${messageOf(error)}`,
			);
		} finally {
			this.holding = false;
		}
		Atomics.store(slots, Slot.FramesPublished, frame);
		Atomics.notify(slots, Slot.FramesPublished);
	}

	/**
	 * Updates the world transforms of the objects that moved: every one, or with `late`, only those
	 * that moved since the last update, and the objects below them. Development builds first report
	 * static objects whose transform changed without a setter, because the update clears the marks
	 * that setters leave.
	 */
	private updateTransforms(late: boolean): void {
		if (DEV) {
			const unmarked = this.context.scene.unmarkedWrites?.check();
			if (unmarked) this.report(unmarked);
		}
		const { glue } = this.sketch;
		if (late) glue.updateLateTransforms();
		else glue.updateTransforms();
		this.core.refresh();
		this.endPhase(Phase.Transforms);
	}

	/**
	 * The animation step, once the scene has animated or morphed objects: advances their clips by
	 * `stepUs` whole microseconds, poses them on the job workers, and moves the bounds of skinned
	 * and morphed objects, which marks them. It runs before the transform update and its check of
	 * static objects. It counts as transform time, with the transform update that follows it. The
	 * events it collects reach the sketch's handlers at the start of the next frame's update.
	 */
	private animate(stepUs: number): void {
		const { scene } = this.context;
		if (scene.animations === undefined && !scene.morphed) return;
		try {
			const step = this.sketch.glue.updateAnimations(stepUs);
			this.core.check(step, 'the animation step', undefined, true);
		} catch (error) {
			this.report(error);
		}
	}

	/** Reports an error from a sketch's handler, as `report` does. */
	private readonly reportError = (error: unknown): void => this.report(error);

	/**
	 * Runs one frame at the clock's time and step, and returns its number. Without `play`, the
	 * frame reads no input and runs none of the sketch's code: only the core's steps.
	 */
	private frame(play = true): number {
		const start = performance.now();
		const { time, callbacks } = this;
		const { glue } = this.sketch;
		const { slots } = this.sketch.control;
		const dt = this.clock.dt;
		time.now = this.clock.now;
		time.dt = dt;
		const frame = nextFrame(this.recorded.frame);
		this.recorded.frame = frame;
		if (play) time.frame++;
		this.record.begin(frame);
		this.phaseStart = start;
		this.readViewport();
		// The governor judges the frames so far before the sketch's update, which then sees the
		// render scale of this frame, and whose change handlers hear of a shadow step.
		if (play && this.governorLoop) {
			this.governorLoop.now[0] = start;
			this.governorLoop.frame();
			if (this.governor.stepChanges !== this.stepChanges) this.applyGovernedSteps();
		}
		// Handlers that hear of a restart may create objects with new pipelines, so their frame
		// waits for them.
		let restart = false;
		// The sketch's part of the frame: the input the page wrote and its pointer events on
		// objects, preference changes, the fixed steps and the update. It stays in this function: a
		// call that passed the step on would allocate a number for it in every frame.
		if (play) {
			if (this.holdSeconds === undefined) {
				this.input.beginFrame(frame, (frame - time.frame) | 0);
				this.context.scene.dispatchPointerEvents(this.reportError);
				const reducedMotion = Atomics.load(slots, Slot.ReducedMotion);
				if (reducedMotion !== this.reducedMotion) {
					this.reducedMotion = reducedMotion;
					this.notify(this.preferenceHandlers, undefined);
				}
			}
			const change = this.quality.takeChange();
			if (change !== 0) {
				if (change === RESTART_CHANGE) restart = true;
				this.notify(this.quality.handlers, this.quality);
			}
			// The clips' events of the frame before, so the sketch's update sees them.
			this.context.scene.animations?.dispatch(this.reportError);
			// Steps that fall due count even when the sketch has no fixed update, so none pile up.
			const steps = this.fixed.stepsAt(time.now);
			if (callbacks.onFixedUpdate) {
				for (let k = 0; k < steps; k++) {
					try {
						callbacks.onFixedUpdate(this.fixed.step);
					} catch (error) {
						this.report(error);
					}
				}
			}
			try {
				callbacks.onUpdate?.(dt);
			} catch (error) {
				this.report(error);
			}
		}
		this.endPhase(Phase.Update);
		// Job workers woken now start while the engine applies the frame's commands; woken before
		// the sketch's update, they would spin through it and sleep again.
		glue.prepareJobs();
		// Whole milliseconds and microseconds cross into the core without a number object each.
		const timeMs = Math.round(time.now * 1000);
		const stepUs = Math.round(dt * 1_000_000);
		if (glue.beginFrame(frame, timeMs, stepUs) !== 0) this.report(coreFailure(glue, QUEUED_CHANGE));
		this.core.refresh();
		this.endPhase(Phase.Commands);
		this.animate(play ? stepUs : 0);
		this.updateTransforms(false);
		if (play && callbacks.onLateUpdate) {
			try {
				callbacks.onLateUpdate(dt);
			} catch (error) {
				this.report(error);
			}
			this.endPhase(Phase.Update);
			this.updateTransforms(true);
		}
		if (this.followEffects()) restart = true;
		if (this.governor.stepChanges !== this.stepChanges) this.applyGovernedSteps();
		glue.updateBatches(frame);
		if (!this.cellsWarned && glue.cellsRefused() !== 0) {
			this.cellsWarned = true;
			console.warn(cellTableWarning());
		}
		this.endPhase(Phase.Batches);
		const width = Math.max(1, Atomics.load(slots, Slot.CanvasWidth));
		const height = Math.max(1, Atomics.load(slots, Slot.CanvasHeight));
		const epoch = Atomics.load(slots, Slot.GpuEpoch);
		// Read after the epoch and before a GPU reset, which needs it. The count then covers every
		// frame that an old device replayed, as the thread that draws skips the old device's frames
		// that it takes later, with their releases of images.
		glue.syncTextures(
			Atomics.load(slots, Slot.ImagesArrived),
			Atomics.load(slots, Slot.FramesTaken),
		);
		if (epoch !== this.gpuEpoch) {
			// A new GPU device has none of the old one's objects: this frame creates them all again.
			if (glue.resetGpu() !== 0) this.report(coreFailure(glue, 'the GPU reset'));
			this.gpuEpoch = epoch;
		}
		// The texture memory budget dropped levels or asks for some again: the loads again start
		// now, and the quality change handlers hear of it in the next frame.
		if (this.textures.pollBudget()) this.quality.governed();
		const built = Atomics.load(slots, Slot.PipelinesBuilt);
		const joinFailed = Atomics.exchange(slots, Slot.JoinFailed, 0);
		if (joinFailed !== 0) this.post.dropJoin(joinFailed);
		if (glue.cullFrame(frame, width, height, built) !== 0)
			this.report(coreFailure(glue, 'the frame'));
		this.endPhase(Phase.Cull);
		if (DEV && this.debugDraw) {
			this.core.refresh();
			try {
				this.debugDraw.flush(width, height);
			} catch (error) {
				this.report(error);
			}
		}
		const scale = this.renderScale();
		if (glue.recordFrame(frame, width, height, scale, built) !== 0)
			this.report(coreFailure(glue, 'the frame'));
		Atomics.store(slots, Slot.RenderScale, scale);
		// Input names frames in the engine's count, so each frame of the setup and of the preset
		// check keeps its own camera: a click can come while any of them is on screen.
		this.context.scene.keepFrameCamera(frame, width, height);
		// Every frame places the labels, as the thread that draws presents each one.
		try {
			this.ui.project(frame, width, height);
		} catch (error) {
			this.report(error);
		}
		this.record.count(Counter.Rebuilds, glue.drawTablesRebuilt() ? 1 : 0);
		this.record.count(Counter.VisibleEntries, glue.visibleEntries(frame));
		this.record.count(Counter.OccludedEntries, glue.occludedEntries(frame));
		// The memory figures change slowly, so a few times a window is enough. They start with the
		// first frame that samples, so the figures never show 0 for memory the engine holds, nor the
		// memory of the last time a reader sampled.
		if (this.record.figures) {
			if (this.memoryWait === 0) {
				this.publishMemory();
				this.memoryWait = MEMORY_EVERY;
			}
			this.memoryWait--;
		} else this.memoryWait = 0;
		// A frame whose list needs more room than any before moves the list, so each frame gives
		// the thread that draws its list's address.
		const parity = frame & 1;
		Atomics.store(slots, Slot.DrawListAddress0 + parity, glue.drawListAddress(parity));
		Atomics.store(slots, Slot.DrawListWords0 + parity, glue.drawListWords(frame));
		Atomics.store(slots, Slot.FrameEpoch0 + (frame & 1), epoch);
		// The first frame that records after a restart, whether the sketch asked for it between
		// frames or in this frame's own code, has the new settings, so the thread that draws holds it
		// until its pipelines are built.
		if (this.quality.takeRestart() || restart) Atomics.store(slots, Slot.PipelineHold, frame);
		this.core.refresh();
		this.endPhase(Phase.Record);
		this.record.commit(performance.now() - start);
		for (let k = 0; k < this.jobRecords.length; k++) {
			const jobRecord = this.jobRecords[k] as FrameRecorder;
			jobRecord.begin(frame);
			jobRecord.commitMicros(glue.takeJobBusyUs(k));
		}
		return frame;
	}
}
