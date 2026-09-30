// defineSketch: the entry point of a sketch module, which the engine runs in the sketch worker.
// loadSketch imports a sketch module on the thread that runs it. The page imports loadSketch from
// this module in every mode, so a bundler keeps defineSketch in the page's file. A sketch module
// imports defineSketch from that file, and the sketch worker finds the file in the browser's cache.
// In a file of its own, defineSketch would cost the sketch worker one more request before the
// sketch runs.

import type { Debug } from '../debug/debug';
import { EngineError } from '../errors/engine-error';
import { messageOf } from '../errors/message';
import type { Assets } from '../scene/assets';
import type { Geometry, Materials } from '../scene/resources';
import type { Scene } from '../scene/scene';
import type { Textures } from '../scene/textures';
import type { Input } from './input';
import type { Quality } from './quality';

/**
 * Callbacks a sketch returns from its setup function.
 *
 * @category api/sketch
 */
export interface SketchCallbacks {
	/**
	 * Runs once per frame, before transforms, with the frame's step in seconds. The first frame, and
	 * the first after a pause or a hidden page, gets 0. No step is longer than a quarter second, so a
	 * very slow frame slows the sketch instead of jumping it. In hold mode, each frame after the
	 * first gets a fixed step of 1/60 second.
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
	/** Textures from decoded images and from data. */
	textures: Textures;
	/** Loading of textures and files, with a count of downloads for loading screens. */
	assets: Assets;
	/** Pointer, touch, keyboard and gamepad input, which the page forwards to the sketch. */
	input: Input;
	/** The quality preset that the engine runs, its settings, and a notice when they change. */
	quality: Quality;
	/**
	 * Sketch time in seconds, which is the sum of every step that `onUpdate` received, so paused and
	 * hidden time do not count. Also the current frame number. In hold mode, the last frame's time is
	 * the held time exactly.
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
	/**
	 * Debug drawing: lines, boxes, spheres, arrows, axes, grids, camera frustums and lights, drawn
	 * for one frame. Only development builds draw them.
	 */
	debug: Debug;
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
 * Declares a sketch. In null3D, a 3D scene is called a sketch: a module that builds the scene and
 * updates it every frame, in the sketch worker. The module must export the result as its default
 * export.
 *
 * @category api/sketch
 */
export function defineSketch(setup: SketchSetup): SketchDefinition {
	return { [SKETCH_MARKER]: true, setup };
}

function isSketchDefinition(value: unknown): value is SketchDefinition {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as Record<symbol, unknown>)[SKETCH_MARKER] === true
	);
}

/**
 * Imports a sketch module and returns its sketch. A module that does not load fails with E1410,
 * unless its code threw an engine error, which keeps its code. A module that exports no sketch
 * fails with E1401.
 */
export async function loadSketch(url: string): Promise<SketchDefinition> {
	let module: { default?: unknown };
	try {
		module = await import(/* @vite-ignore */ url);
	} catch (e) {
		if (e instanceof EngineError) throw e;
		const reason = messageOf(e).replace(/\.$/, '');
		throw new EngineError('E1410', `the sketch module ${url} did not load: ${reason}.`);
	}
	if (!isSketchDefinition(module.default))
		throw new EngineError('E1401', `${url} must export default defineSketch(...).`);
	return module.default;
}
