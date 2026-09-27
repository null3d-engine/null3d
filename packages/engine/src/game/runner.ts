// Runs a game module's callbacks: loads the module, calls its setup function once, and steps it
// once per frame, recording each frame's CPU time.

import { EngineError } from '../errors/engine-error';
import { FrameRecorder, Phase, Role } from '../shared/metrics';
import type { GameCallbacks, GameContext } from './define-game';
import { isGameDefinition } from './define-game';

export type PagePoster = (type: string, data: unknown, transfer?: Transferable[]) => void;

export class GameRunner {
	private readonly messageHandlers: ((type: string, data: unknown) => void)[] = [];
	private callbacks: GameCallbacks = {};
	private startTime = -1;
	private lastTime = -1;
	private readonly record: FrameRecorder;
	readonly context: GameContext;

	constructor(post: PagePoster, metrics: ArrayBufferLike) {
		this.record = new FrameRecorder(metrics, Role.Game);
		this.context = {
			time: { now: 0, frame: 0 },
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

	/**
	 * Advances the game by one frame and returns the new frame number, counting from 1. `now` is a
	 * timestamp in milliseconds; in hold mode the caller passes a fixed time instead.
	 */
	step(now: number): number {
		const start = performance.now();
		const { time } = this.context;
		if (this.startTime < 0) this.startTime = now;
		const dt = this.lastTime < 0 ? 0 : (now - this.lastTime) / 1000;
		this.lastTime = now;
		time.now = (now - this.startTime) / 1000;
		time.frame++;
		this.record.begin(time.frame);
		this.callbacks.onUpdate?.(dt);
		const busy = performance.now() - start;
		this.record.addPhase(Phase.Update, busy);
		this.record.commit(busy);
		return time.frame;
	}
}
