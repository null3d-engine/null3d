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
// the last frame alone. Hold mode reads no input, so the held frame never depends on it. In
// development builds, the frame's debug drawing reaches the core just before the frame records;
// release builds give the sketch calls that do nothing.

import { type Debug, RELEASE_DEBUG } from '../debug/debug';
import { DebugDraw } from '../debug/draw';
import { DEV } from '../errors/checks';
import { coreFailure, QUEUED_CHANGE } from '../errors/core-failure';
import { EngineError } from '../errors/engine-error';
import { messageOf } from '../errors/message';
import { TEXTURE_OPTION_UPLOAD_ALL, TEXTURE_STAT_IMAGES_SENT } from '../generated/core';
import type { EngineCapabilities } from '../page/engine';
import type { CoreDevice } from '../page/limits';
import { type QualitySettings, SKETCH_SETTINGS } from '../quality/presets';
import { Assets } from '../scene/assets';
import { CoreMemory } from '../scene/memory';
import { Geometry, Materials } from '../scene/resources';
import { Scene } from '../scene/scene';
import { Textures } from '../scene/textures';
import { type ControlViews, Slot } from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { type ImageSender, imagesArrived } from '../shared/images';
import { Counter, FrameRecorder, Phase, Role } from '../shared/metrics';
import { FixedClock, FrameClock, holdSteps } from './clock';
import type { SketchCallbacks, SketchContext, SketchDefinition } from './define-sketch';
import { InputReader } from './input';
import { type QualityStart, SketchQuality } from './quality';
import { HOLD_SEED, seedMathRandom } from './random';

export type PagePoster = (type: string, data: unknown, transfer?: Transferable[]) => void;

/** Fixed sizes of the engine core. */
export const SCENE_CAPACITY = 16_383;
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
	/** Gives the page the quality settings after the sketch changes them. */
	applyQuality(settings: QualitySettings): void;
	/** The GPU path the engine chose, and what it offers, as the page reports it. */
	capabilities: EngineCapabilities;
	/** Sends texture images to the thread that draws. */
	sendImage: ImageSender;
	/** The page's address, which the sketch's relative asset addresses resolve against. */
	pageUrl: string;
}

/** How often a wait for a control slot checks it, where the control block is not shared memory. */
const SLOT_POLL_MS = 4;

/**
 * Resolves once a control slot holds `target` or more, or once the engine stops. It waits without
 * blocking the thread, and checks the slot on a timer where the control block is not shared memory.
 */
async function reached(slots: Int32Array, slot: number, target: number): Promise<void> {
	const shared =
		typeof SharedArrayBuffer !== 'undefined' && slots.buffer instanceof SharedArrayBuffer;
	for (;;) {
		const value = Atomics.load(slots, slot);
		if (value >= target || Atomics.load(slots, Slot.Running) === 0) return;
		if (shared) {
			const wait = Atomics.waitAsync(slots, slot, value);
			if (wait.async) await wait.value;
		} else await new Promise((resolve) => setTimeout(resolve, SLOT_POLL_MS));
	}
}

/**
 * Waits without blocking for the engine to stop, then ends the job workers' loops. The page stops
 * the job workers only after they leave their loops, where each blocks its thread while it has no
 * work.
 */
async function shutDownJobsOnStop(glue: CoreGlue, slots: Int32Array): Promise<void> {
	while (Atomics.load(slots, Slot.Running) !== 0) {
		const wait = Atomics.waitAsync(slots, Slot.Running, 1);
		if (wait.async) await wait.value;
	}
	glue.shutdownJobs();
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
	/** The sketch's `time`, which each frame updates in place. */
	private readonly time = { now: 0, dt: 0, frame: 0 };
	/** The sketch's `engine.viewport`, which each frame updates in place when the canvas changed. */
	private readonly viewport = { width: 0, height: 0, pixelRatio: 1 };
	/** The page's count of canvas size changes when the viewport last read them. */
	private viewportSerial = -1;
	private gpuEpoch = 0;
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
	/** The sketch's debug drawing, in development builds only. */
	private readonly debugDraw: DebugDraw | undefined;
	readonly context: SketchContext;

	/**
	 * Starts the engine on the core's thread. `holdSeconds` starts hold mode at that sketch time: it
	 * seeds this thread's math.random, and routes Math.random to it, at once. So the runner must
	 * exist before the sketch module loads, and `setup` then steps the sketch to that time.
	 */
	constructor(
		post: PagePoster,
		metrics: ArrayBufferLike,
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
			SCENE_CAPACITY,
			MAX_BATCHES,
			COMMAND_CAPACITY,
			device.storageBindingBytes,
			device.webgl2,
			device.capabilities,
			device.maxTextureSize,
			device.cellCulling,
		);
		if (status !== 0) throw coreFailure(glue, 'createEngine');
		if (sketch.jobWorkers > 0) {
			Atomics.store(slots, Slot.JobsReady, 1);
			Atomics.notify(slots, Slot.JobsReady);
			void shutDownJobsOnStop(glue, slots);
		}
		this.core = new CoreMemory(glue, sketch.memory);
		Atomics.store(slots, Slot.DrawListAddress0, glue.drawListAddress(0));
		Atomics.store(slots, Slot.DrawListAddress1, glue.drawListAddress(1));
		this.reducedMotion = Atomics.load(slots, Slot.ReducedMotion);
		this.input = new InputReader(sketch.control, sketch.keyCodes);
		const textures = new Textures(this.core, sketch.sendImage, this.time, device.capabilities);
		// The core takes every texture setting of the preset before the setup runs, so a sketch's own
		// budget wins until the setting changes. The page applies the settings it owns.
		textures.applyQuality(sketch.quality.settings, SKETCH_SETTINGS);
		this.quality = new SketchQuality(sketch.quality, (settings, changed) => {
			textures.applyQuality(settings, changed);
			sketch.applyQuality(settings);
		});
		this.readViewport();
		this.debugDraw = DEV ? new DebugDraw(this.core) : undefined;
		const debug: Debug = this.debugDraw ?? RELEASE_DEBUG;
		this.context = {
			time: this.time,
			engine: { viewport: this.viewport, capabilities: sketch.capabilities },
			scene: new Scene(this.core, this.time, device.webgl2, () => this.warmUp()),
			materials: new Materials(this.core),
			geometry: new Geometry(this.core),
			textures,
			assets: new Assets(textures, sketch.pageUrl),
			input: this.input,
			quality: this.quality,
			preferences: {
				get reducedMotion() {
					return Atomics.load(slots, Slot.ReducedMotion) !== 0;
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
	 * Runs the sketch's setup function, which returns the sketch's callbacks. In hold mode, it then
	 * steps the sketch to the held time (see `hold`). Options out of range fail with E1214 before
	 * the setup function runs.
	 */
	async setup(sketch: SketchDefinition): Promise<void> {
		this.fixed = new FixedClock(sketch.options.fixedRate, sketch.options.maxFixedSteps);
		this.callbacks = (await sketch.setup(this.context)) ?? {};
		this.setUp = true;
		if (this.holdSeconds !== undefined) await this.hold(this.holdSeconds);
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
	async warmUp(): Promise<void> {
		if (this.holdSeconds !== undefined) return;
		const { slots } = this.sketch.control;
		let target = this.context.time.frame + 1;
		if (!this.setUp) {
			this.setupFrames = this.setupFrames.then(() => this.publishSetupFrame());
			target = await this.setupFrames;
		}
		await reached(slots, Slot.PipelinesBuilt, target);
		// The sketch's code carries on between frames, after frames that may have grown engine
		// memory, so its views of that memory are made again first.
		this.core.refresh();
	}

	/**
	 * Records a frame of the scene as the setup has built it so far, with no update, and publishes
	 * it for the thread that draws. The frame before the last shares its list, so it waits for that
	 * frame to be taken first.
	 */
	private async publishSetupFrame(): Promise<number> {
		const { slots } = this.sketch.control;
		await reached(slots, Slot.FramesTaken, this.context.time.frame - 1);
		const frame = this.frame(false);
		Atomics.store(slots, Slot.FramesPublished, frame);
		Atomics.notify(slots, Slot.FramesPublished);
		return frame;
	}

	/** Gives the thread its own Math.random back, where hold mode seeded it. */
	dispose(): void {
		this.restoreRandom?.();
		this.restoreRandom = undefined;
	}

	/**
	 * Delivers a message the page sent with engine.postToSketch. It arrives between frames, after
	 * any frame that grew engine memory, so the sketch's views of that memory are made again first.
	 */
	receive(type: string, data: unknown): void {
		this.core.refresh();
		for (const handler of this.messageHandlers) handler(type, data);
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
		this.endPhase(Phase.Transforms);
	}

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
		time.frame++;
		const frame = time.frame;
		this.record.begin(frame);
		this.core.refresh();
		this.phaseStart = start;
		this.readViewport();
		// The sketch's part of the frame: the input the page wrote, preference changes, the fixed
		// steps and the update. It stays in this function: a call that passed the step on would
		// allocate a number for it in every frame.
		if (play) {
			if (this.holdSeconds === undefined) this.input.beginFrame(frame);
			const reducedMotion = Atomics.load(slots, Slot.ReducedMotion);
			if (reducedMotion !== this.reducedMotion) {
				this.reducedMotion = reducedMotion;
				this.notify(this.preferenceHandlers, undefined);
			}
			if (this.quality.takeChange()) this.notify(this.quality.handlers, this.quality);
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
		if (glue.beginFrame(frame) !== 0) this.report(coreFailure(glue, QUEUED_CHANGE));
		this.endPhase(Phase.Commands);
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
		glue.updateBatches(frame);
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
		if (glue.cullFrame(frame, width, height) !== 0) this.report(coreFailure(glue, 'the frame'));
		this.endPhase(Phase.Cull);
		if (DEV && this.debugDraw) {
			try {
				this.debugDraw.flush(width, height);
			} catch (error) {
				this.report(error);
			}
		}
		if (glue.recordFrame(frame, width, height) !== 0) this.report(coreFailure(glue, 'the frame'));
		this.record.count(Counter.Rebuilds, glue.drawTablesRebuilt() ? 1 : 0);
		this.record.count(Counter.VisibleEntries, glue.visibleEntries(frame));
		Atomics.store(slots, Slot.DrawListWords0 + (frame & 1), glue.drawListWords(frame));
		Atomics.store(slots, Slot.FrameEpoch0 + (frame & 1), epoch);
		this.endPhase(Phase.Record);
		this.record.commit(performance.now() - start);
		for (let k = 0; k < this.jobRecords.length; k++) {
			const jobRecord = this.jobRecords[k] as FrameRecorder;
			jobRecord.begin(frame);
			jobRecord.commit(glue.takeJobBusyMs(k));
		}
		return frame;
	}
}
