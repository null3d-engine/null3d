// defineSketch: the entry point of a sketch module, which the engine runs in the sketch worker.

import type { Geometry, Materials } from '../scene/resources';
import type { Scene } from '../scene/scene';

/**
 * Callbacks a sketch returns from its setup function.
 *
 * @category api/sketch
 */
export interface SketchCallbacks {
	/**
	 * Runs once per frame, before transforms, with the frame's step in seconds. The first frame, and
	 * the first after a pause or a hidden page, gets 0. No step is longer than a quarter second, so a
	 * very slow frame slows the sketch instead of jumping it.
	 */
	onUpdate?(dt: number): void;
}

/**
 * The user's display preferences, which the page reads from the system and passes on.
 *
 * @category api/sketch
 */
export interface SketchPreferences {
	/**
	 * True when the user asks for less motion: the `prefers-reduced-motion` setting. Bring motion
	 * that only decorates to rest, such as an idle spin, camera sway or drifting particles. Keep
	 * motion the user controls, and motion that carries meaning, and prefer cuts to long camera
	 * flights.
	 */
	readonly reducedMotion: boolean;
	/**
	 * Calls `handler` at the start of the first frame after a preference changes. Returns a
	 * function that removes the handler.
	 */
	onChange(handler: () => void): () => void;
}

/**
 * What the engine passes to a sketch's setup function.
 *
 * @category api/sketch
 */
export interface SketchContext {
	/** Objects, cameras, lights and instance batches. */
	scene: Scene;
	/** Material factories. */
	materials: Materials;
	/** Mesh generators. */
	geometry: Geometry;
	/**
	 * Sketch time in seconds, which is the sum of every step that `onUpdate` received, so paused and
	 * hidden time do not count. Also the current frame number.
	 */
	time: { now: number; frame: number };
	/** What the user's system asks of every page, and a notice when that changes. */
	preferences: SketchPreferences;
	/**
	 * Messages between the sketch and the page. `onMessage` returns a function that removes the
	 * handler.
	 */
	page: {
		post(type: string, data?: unknown, transfer?: Transferable[]): void;
		onMessage(handler: (type: string, data: unknown) => void): () => void;
	};
}

/**
 * A sketch's setup function. The engine calls it once, in the sketch worker, and it returns the sketch's
 * callbacks, directly or through a promise.
 *
 * @category api/sketch
 */
export type SketchSetup = (
	context: SketchContext,
) => SketchCallbacks | undefined | Promise<SketchCallbacks | undefined>;

const SKETCH_MARKER = Symbol.for('null3d.sketch');

/**
 * A sketch, as `defineSketch` returns it.
 *
 * @category api/sketch
 */
export interface SketchDefinition {
	readonly [SKETCH_MARKER]: true;
	/** The setup function passed to `defineSketch`. */
	readonly setup: SketchSetup;
}

/**
 * Declares a sketch. In null3d, a 3D scene is called a sketch: a module that builds the scene and
 * updates it every frame, in the sketch worker. The module must export the result as its default
 * export.
 *
 * @category api/sketch
 */
export function defineSketch(setup: SketchSetup): SketchDefinition {
	return { [SKETCH_MARKER]: true, setup };
}

export function isSketchDefinition(value: unknown): value is SketchDefinition {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as Record<symbol, unknown>)[SKETCH_MARKER] === true
	);
}
