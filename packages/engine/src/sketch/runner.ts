// Runs a sketch: starts the engine on this thread's core, calls the sketch's setup function once with
// the scene API, and steps it once per frame. A frame runs the sketch's update, then the core's
// steps, and publishes the frame's draw list; each step's CPU time is recorded, and so is the time
// each job worker spent on the frame's work.

import { coreFailure } from '../errors/core-failure';
import type { CoreDevice } from '../page/limits';
import { CoreMemory } from '../scene/memory';
import { Geometry, Materials } from '../scene/resources';
import { Scene } from '../scene/scene';
import { Slot } from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { Counter, FrameRecorder, Phase, Role } from '../shared/metrics';
import { FrameClock } from './clock';
import type { SketchCallbacks, SketchContext, SketchDefinition } from './define-sketch';

export type PagePoster = (type: string, data: unknown, transfer?: Transferable[]) => void;

/** Fixed sizes of the engine core. */
const SCENE_CAPACITY = 16_383;
const MAX_BATCHES = 256;
const COMMAND_CAPACITY = 1 << 16;

export interface SketchCore {
	glue: CoreGlue;
	memory: WebAssembly.Memory;
	/** The control block's slots: the canvas size in, the published draw lists out. */
	slots: Int32Array;
	jobWorkers: number;
	/** The device the engine draws with. */
	device: CoreDevice;
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
	readonly context: SketchContext;

	constructor(
		post: PagePoster,
		metrics: ArrayBufferLike,
		private readonly sketch: SketchCore,
	) {
		this.record = new FrameRecorder(metrics, Role.Sketch);
		this.jobRecords = Array.from(
			{ length: sketch.jobWorkers },
			(_, k) => new FrameRecorder(metrics, Role.Job + k),
		);
		const { glue, slots, device } = sketch;
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
		const time = { now: 0, frame: 0 };
		this.context = {
			time,
			scene: new Scene(this.core, time),
			materials: new Materials(this.core),
			geometry: new Geometry(this.core),
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
	}

	/** Runs the sketch's setup function, which returns the sketch's callbacks. */
	async setup(sketch: SketchDefinition): Promise<void> {
		this.callbacks = (await sketch.setup(this.context)) ?? {};
	}

	/** Delivers a message the page sent with engine.postToSketch. */
	receive(type: string, data: unknown): void {
		for (const handler of this.messageHandlers) handler(type, data);
	}

	/** Records the time since the previous phase ended as a phase of the frame. */
	private endPhase(phase: Phase): void {
		const now = performance.now();
		this.record.addPhase(phase, now - this.phaseStart);
		this.phaseStart = now;
	}

	/** Reports a failure once per distinct message, so a repeating one does not flood the console. */
	private report(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		if (this.reported.has(message)) return;
		this.reported.add(message);
		console.error(error);
	}

	/**
	 * Advances the sketch by one frame and returns the new frame number, counting from 1. `now` is a
	 * timestamp in milliseconds; in hold mode the caller passes a fixed time instead.
	 */
	step(now: number): number {
		const start = performance.now();
		const { time } = this.context;
		const { glue, slots } = this.sketch;
		this.clock.advance(now, Atomics.load(slots, Slot.Resumes));
		const dt = this.clock.dt;
		time.now = this.clock.now;
		time.frame++;
		const frame = time.frame;
		this.record.begin(frame);
		this.core.refresh();
		this.phaseStart = start;
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
		if (glue.beginFrame(frame) !== 0) this.report(coreFailure(glue, 'the frame'));
		this.endPhase(Phase.Commands);
		glue.updateTransforms();
		this.endPhase(Phase.Transforms);
		glue.updateBatches(frame);
		this.endPhase(Phase.Batches);
		const width = Math.max(1, Atomics.load(slots, Slot.CanvasWidth));
		const height = Math.max(1, Atomics.load(slots, Slot.CanvasHeight));
		const epoch = Atomics.load(slots, Slot.GpuEpoch);
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
