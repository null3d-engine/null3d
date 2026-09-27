// Runs a game module: starts the engine core on this thread, loads the module, calls its setup
// function once with the scene API, and steps it once per frame. A frame runs the game's update,
// then the core's steps, and publishes the frame's draw list; each step's CPU time is recorded.

import { coreFailure } from '../errors/core-failure';
import { EngineError } from '../errors/engine-error';
import { CoreMemory } from '../scene/memory';
import { Geometry, Materials } from '../scene/resources';
import { Scene } from '../scene/scene';
import { Slot } from '../shared/control';
import type { CoreGlue } from '../shared/core';
import { FrameRecorder, Phase, Role } from '../shared/metrics';
import type { GameCallbacks, GameContext } from './define-game';
import { isGameDefinition } from './define-game';

export type PagePoster = (type: string, data: unknown, transfer?: Transferable[]) => void;

/** Fixed sizes of the engine core. */
const SCENE_CAPACITY = 16_383;
const MAX_BATCHES = 256;
const COMMAND_CAPACITY = 1 << 16;

export interface GameCore {
	glue: CoreGlue;
	memory: WebAssembly.Memory;
	/** The control block's slots: the canvas size in, the published draw lists out. */
	slots: Int32Array;
	jobWorkers: number;
}

export class GameRunner {
	private readonly messageHandlers: ((type: string, data: unknown) => void)[] = [];
	private callbacks: GameCallbacks = {};
	private startTime = -1;
	private lastTime = -1;
	private readonly record: FrameRecorder;
	private readonly core: CoreMemory;
	private readonly reported = new Set<string>();
	/** When the current phase of the frame started. */
	private phaseStart = 0;
	readonly context: GameContext;

	constructor(
		post: PagePoster,
		metrics: ArrayBufferLike,
		private readonly game: GameCore,
	) {
		this.record = new FrameRecorder(metrics, Role.Game);
		const { glue, slots } = game;
		const status = glue.initEngine(game.jobWorkers, SCENE_CAPACITY, MAX_BATCHES, COMMAND_CAPACITY);
		if (status !== 0) throw coreFailure(glue, 'createEngine');
		this.core = new CoreMemory(glue, game.memory);
		Atomics.store(slots, Slot.DrawListAddress0, glue.drawListAddress(0));
		Atomics.store(slots, Slot.DrawListAddress1, glue.drawListAddress(1));
		const time = { now: 0, frame: 0 };
		this.context = {
			time,
			scene: new Scene(this.core, time),
			materials: new Materials(this.core),
			geometry: new Geometry(this.core),
			page: {
				post: (type, data, transfer) => post(type, data, transfer),
				onMessage: (handler) => {
					this.messageHandlers.push(handler);
				},
			},
		};
	}

	/** Imports the game module and runs its setup function. */
	async load(gameUrl: string): Promise<void> {
		const module = (await import(/* @vite-ignore */ gameUrl)) as { default?: unknown };
		if (!isGameDefinition(module.default)) {
			throw new EngineError('E1401', `${gameUrl} must export default defineGame(...).`);
		}
		this.callbacks = (await module.default.setup(this.context)) ?? {};
	}

	/** Delivers a message the page sent with engine.postToGame. */
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
	 * Advances the game by one frame and returns the new frame number, counting from 1. `now` is a
	 * timestamp in milliseconds; in hold mode the caller passes a fixed time instead.
	 */
	step(now: number): number {
		const start = performance.now();
		const { time } = this.context;
		const { glue, slots } = this.game;
		if (this.startTime < 0) this.startTime = now;
		const dt = this.lastTime < 0 ? 0 : (now - this.lastTime) / 1000;
		this.lastTime = now;
		time.now = (now - this.startTime) / 1000;
		time.frame++;
		const frame = time.frame;
		this.record.begin(frame);
		this.core.refresh();
		this.phaseStart = start;
		try {
			this.callbacks.onUpdate?.(dt);
		} catch (error) {
			this.report(error);
		}
		this.endPhase(Phase.Update);
		if (glue.beginFrame(frame) !== 0) this.report(coreFailure(glue, 'the frame'));
		this.endPhase(Phase.Commands);
		glue.updateTransforms();
		this.endPhase(Phase.Transforms);
		glue.updateBatches(frame);
		this.endPhase(Phase.Batches);
		const width = Math.max(1, Atomics.load(slots, Slot.CanvasWidth));
		const height = Math.max(1, Atomics.load(slots, Slot.CanvasHeight));
		if (glue.recordFrame(frame, width, height) !== 0) this.report(coreFailure(glue, 'the frame'));
		Atomics.store(slots, Slot.DrawListWords0 + (frame & 1), glue.drawListWords(frame));
		this.endPhase(Phase.Record);
		this.record.commit(performance.now() - start);
		return frame;
	}
}
