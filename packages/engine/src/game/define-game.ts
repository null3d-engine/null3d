// defineGame: the entry point of a game module, which the engine runs in the game worker.

import type { Geometry, Materials } from '../scene/resources';
import type { Scene } from '../scene/scene';

/** Callbacks a game returns from its setup function. */
export interface GameCallbacks {
	/** Runs once per frame, before transforms, with the frame time in seconds. */
	onUpdate?(dt: number): void;
}

/** What the engine passes to a game's setup function. */
export interface GameContext {
	/** Objects, cameras, lights and instance batches. */
	scene: Scene;
	/** Material factories. */
	materials: Materials;
	/** Mesh generators. */
	geometry: Geometry;
	/** Time since the game started, in seconds, and the current frame number. */
	time: { now: number; frame: number };
	/** Messages between the game and the page. */
	page: {
		post(type: string, data?: unknown, transfer?: Transferable[]): void;
		onMessage(handler: (type: string, data: unknown) => void): void;
	};
}

export type GameSetup = (
	context: GameContext,
) => GameCallbacks | undefined | Promise<GameCallbacks | undefined>;

const GAME_MARKER = Symbol.for('sokko3d.game');

export interface GameDefinition {
	readonly [GAME_MARKER]: true;
	readonly setup: GameSetup;
}

/** Declares a game. The module that calls it must export the result as its default export. */
export function defineGame(setup: GameSetup): GameDefinition {
	return { [GAME_MARKER]: true, setup };
}

export function isGameDefinition(value: unknown): value is GameDefinition {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as Record<symbol, unknown>)[GAME_MARKER] === true
	);
}
