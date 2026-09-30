// Runs a sketch: starts the engine on this thread's core, calls the sketch's setup function once with
// the scene API, and steps it once per frame. A frame reads the input the page wrote, runs the
// sketch's update, then the core's steps, and publishes the frame's draw list; each step's CPU time
// is recorded, and so is the time each job worker spent on the frame's work. Development builds
// report static objects whose transform changed without a setter, before the transform update. In
// hold mode it seeds this thread's math.random and routes Math.random to it, steps the sketch to the
// held time in fixed steps after the setup, and publishes the last frame alone. Hold mode reads no
// input, so the held frame never depends on it.

import { DEV } from '../errors/checks';
import { coreFailure, QUEUED_CHANGE } from '../errors/core-failure';
import { EngineError } from '../errors/engine-error';
import { messageOf } from '../errors/message';
import { TEXTURE_OPTION_UPLOAD_ALL, TEXTURE_STAT_IMAGES_SENT } from '../generated/core';
import type { CoreDevice } from '../page/limits';
import { Assets } from '../scene/assets';
import { CoreMemory } from '../scene/memory';
import { Geometry, Materials } from '../scene/resources';
import { Scene } from '../scene/scene';
import { Textures } from '../scene/textures';
import { type ControlViews, Slot } from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { type ImageSender, imagesArrived } from '../shared/images';
import { Counter, FrameRecorder, Phase, Role } from '../shared/metrics';
import { FrameClock, holdSteps } from './clock';
import type { SketchCallbacks, SketchContext, SketchDefinition } from './define-sketch';
import { InputReader } from './input';
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
	/** Sends texture images to the thread that draws. */
	sendImage: ImageSender;
	/** The page's address, which the sketch's relative asset addresses resolve against. */
	pageUrl: string;
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
	private readonly clock = new FrameClock();
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
		const time = { now: 0, frame: 0 };
		const textures = new Textures(this.core, sketch.sendImage, time);
		this.context = {
			time,
			scene: new Scene(this.core, time, device.webgl2),
			materials: new Materials(this.core),
			geometry: new Geometry(this.core),
			textures,
			assets: new Assets(textures, sketch.pageUrl),
			input: this.input,
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
		};
		// Last, so a constructor that fails leaves the thread's own Math.random in place.
		if (holdSeconds !== undefined) this.restoreRandom = seedMathRandom(HOLD_SEED);
	}

	/**
	 * Runs the sketch's setup function, which returns the sketch's callbacks. In hold mode, it then
	 * steps the sketch to the held time (see `hold`).
	 */
	async setup(sketch: SketchDefinition): Promise<void> {
		this.callbacks = (await sketch.setup(this.context)) ?? {};
		if (this.holdSeconds !== undefined) await this.hold(this.holdSeconds);
	}

	/** Gives the thread its own Math.random back, where hold mode seeded it. */
	dispose(): void {
		this.restoreRandom?.();
		this.restoreRandom = undefined;
	}

	/** Delivers a message the page sent with engine.postToSketch. */
	receive(type: string, data: unknown): void {
		for (const handler of this.messageHandlers) handler(type, data);
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

	/** Runs one frame at the clock's time and step, and returns its number. */
	private frame(): number {
		const start = performance.now();
		const { time } = this.context;
		const { glue } = this.sketch;
		const { slots } = this.sketch.control;
		const dt = this.clock.dt;
		time.now = this.clock.now;
		time.frame++;
		const frame = time.frame;
		this.record.begin(frame);
		this.core.refresh();
		this.phaseStart = start;
		if (this.holdSeconds === undefined) this.input.beginFrame(frame);
		const reducedMotion = Atomics.load(slots, Slot.ReducedMotion);
		if (reducedMotion !== this.reducedMotion) {
			this.reducedMotion = reducedMotion;
			for (const handler of this.preferenceHandlers) {
				try {
					handler();
				} catch (error) {
					this.report(error);
				}
			}
		}
		try {
			this.callbacks.onUpdate?.(dt);
		} catch (error) {
			this.report(error);
		}
		this.endPhase(Phase.Update);
		// Job workers woken now start while the engine applies the frame's commands; woken before
		// the sketch's update, they would spin through it and sleep again.
		glue.prepareJobs();
		if (glue.beginFrame(frame) !== 0) this.report(coreFailure(glue, QUEUED_CHANGE));
		this.endPhase(Phase.Commands);
		if (DEV) {
			// Before the update clears the marks that setters leave on static objects.
			const unmarked = this.context.scene.unmarkedWrites?.check();
			if (unmarked) this.report(unmarked);
		}
		glue.updateTransforms();
		this.endPhase(Phase.Transforms);
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
