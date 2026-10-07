// defineSketch: the entry point of a sketch module, which the engine runs in the sketch worker.
// loadSketch imports a sketch module on the thread that runs it. The page imports loadSketch from
// this module in every mode, so a bundler keeps defineSketch in the page's file. A sketch module
// imports defineSketch from that file, and the sketch worker finds the file in the browser's cache.
// In a file of its own, defineSketch would cost the sketch worker one more request before the
// sketch runs.

import type { Debug } from '../debug/debug';
import { EngineError } from '../errors/engine-error';
import { reasonOf } from '../errors/message';
import type { EngineCapabilities } from '../page/engine';
import type { Assets } from '../scene/assets';
import type { Post } from '../scene/post';
import type { Render } from '../scene/render';
import type { Geometry, Materials } from '../scene/resources';
import type { Scene } from '../scene/scene';
import type { Textures } from '../scene/textures';
import { violationFor, watchPolicy } from '../shared/policy';
import type { Input } from './input';
import type { Quality } from './quality';
import type { Ui } from './ui';

/**
 * Callbacks a sketch returns from its setup function. In each frame the engine calls
 * `onFixedUpdate` as many times as fixed steps fall due, then `onUpdate`, then updates transforms,
 * then calls `onLateUpdate`.
 *
 * @category api/sketch
 */
export interface SketchCallbacks {
	/**
	 * Runs at a fixed rate, 60 times per second of sketch time unless `defineSketch`'s options set
	 * another, with the step's length in seconds. A frame runs it once for each step that falls due
	 * since the previous frame, so 0 or more times, before `onUpdate`. After a slow frame, a frame
	 * runs at most 8 steps unless the options set another number, and drops the rest. Use it for
	 * simulation, such as physics, that must step the same at every frame rate.
	 */
	onFixedUpdate?(step: number): void;
	/**
	 * Runs once per frame, before transforms, with the frame's step in seconds. The first frame, and
	 * the first after a pause or a hidden page, gets 0. No step is longer than a quarter second, so a
	 * very slow frame slows the sketch instead of jumping it. In hold mode, each frame after the
	 * first gets a fixed step of 1/60 second.
	 */
	onUpdate?(dt: number): void;
	/**
	 * Runs once per frame after the engine updates transforms, and before it culls and draws, with
	 * the frame's step in seconds. World positions already hold the frame's changes, and the engine
	 * updates the objects that it moves before it draws the frame. A camera that follows an object
	 * here does not lag a frame behind it.
	 */
	onLateUpdate?(dt: number): void;
	/**
	 * Runs once when the engine stops, on the sketch's thread, before its workers stop. Remove the
	 * timers, event listeners and message handlers that the sketch added outside the engine here.
	 * After it, every call to the engine fails with E1420.
	 */
	onDestroy?(): void;
}

/**
 * The sketch's clock. The engine updates it at the start of each frame, before it calls
 * `onFixedUpdate`.
 *
 * @category api/time
 */
export interface SketchTime {
	/**
	 * Sketch time in seconds: the sum of every frame's step, so paused and hidden time do not count.
	 * It is 0 during the setup function. In hold mode, the last frame's time is the held time exactly.
	 */
	readonly now: number;
	/** The frame's step in seconds, which `onUpdate` and `onLateUpdate` also get. 0 during the setup function. */
	readonly dt: number;
	/** The frame number: 0 during the setup function, 1 in the first frame, and one more in each frame after it. */
	readonly frame: number;
}

/**
 * The canvas's size. The engine reads it at the start of each frame, so it stays the same
 * throughout a frame.
 *
 * @category api/sketch
 */
export interface SketchViewport {
	/** The canvas width in CSS pixels. */
	readonly width: number;
	/** The canvas height in CSS pixels. */
	readonly height: number;
	/**
	 * Device pixels per CSS pixel that the engine draws with: the display's ratio, capped by the
	 * `maxPixelRatio` quality setting. It is lower on a canvas too large for the GPU's largest
	 * texture at that ratio.
	 */
	readonly pixelRatio: number;
}

/**
 * The engine as the sketch sees it: the canvas's size, and what the device can do.
 *
 * @category api/sketch
 */
export interface SketchEngine {
	/** The canvas's size in CSS pixels, and the pixel ratio the engine draws with. */
	readonly viewport: SketchViewport;
	/** The GPU path the engine chose, and what it offers: the values of `engine.capabilities` on the page. */
	readonly capabilities: EngineCapabilities;
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
	/** Post-processing: the tone mapping and the exposure of the scene's color. */
	post: Post;
	/** The sketch's own render passes, such as a camera that draws into a texture. */
	render: Render;
	/** HTML labels that follow scene objects, which the page binds with `engine.labels.bind`. */
	ui: Ui;
	/** The quality preset that the engine runs, its settings, and a notice when they change. */
	quality: Quality;
	/** Sketch time, the frame's step and the frame number. */
	time: SketchTime;
	/** The canvas's size, and what the device can do. */
	engine: SketchEngine;
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

/**
 * Options for `defineSketch`.
 *
 * @category api/sketch
 */
export interface SketchOptions {
	/** Fixed steps per second of sketch time, the rate of `onFixedUpdate`. The default is 60. */
	fixedRate?: number;
	/** The most fixed steps that one frame runs, after a slow frame. The default is 8. */
	maxFixedSteps?: number;
}

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
	/** The options passed to `defineSketch`. */
	readonly options: SketchOptions;
}

/**
 * Declares a sketch. In null3D, a 3D scene is called a sketch: a module that builds the scene and
 * updates it every frame, in the sketch worker. The module must export the result as its default
 * export. `options` sets the rate of the fixed steps.
 *
 * @category api/sketch
 */
export function defineSketch(setup: SketchSetup, options: SketchOptions = {}): SketchDefinition {
	return { [SKETCH_MARKER]: true, setup, options };
}

function isSketchDefinition(value: unknown): value is SketchDefinition {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as Record<symbol, unknown>)[SKETCH_MARKER] === true
	);
}

/** The directives that can block a module's download. */
const SCRIPT_DIRECTIVES = /^(script-src|worker-src|default-src)/;

/** How long the loader waits before it imports a sketch module that did not load once more, in ms. */
const RETRY_WAIT_MS = 500;

/** The query parameter that gives a sketch module a fresh address for its second import. */
const RETRY_PARAM = 'null3d-retry';

/** Imports the module at an address. */
type ModuleImport = (url: string) => Promise<{ default?: unknown }>;

const importModule: ModuleImport = (url) => import(/* @vite-ignore */ url);

/** How `loadSketch` reports and makes its imports. */
export interface SketchLoadOptions {
	/** Notes a step of the load in the thread's start trail, such as a second import. */
	step?: (text: string) => void;
	/** Imports a module. Tests give a stub. */
	importModule?: ModuleImport;
	/** How long the loader waits before the second import, in ms. */
	retryWaitMs?: number;
}

/**
 * Imports a sketch module and returns its sketch. A module that the page's policy blocks, or one
 * of its imports from the same origin, fails with E1422. A module that does not load is imported
 * once more after a short wait, and the console and `step` note the second import. When both
 * imports fail, the load fails with E1410 and the first failure's reason, unless the module's code
 * threw an engine error, which keeps its code. A module that exports no sketch fails with E1401.
 */
export async function loadSketch(
	url: string,
	options: SketchLoadOptions = {},
): Promise<SketchDefinition> {
	const load = options.importModule ?? importModule;
	let module: { default?: unknown };
	watchPolicy();
	try {
		module = await load(url);
	} catch (e) {
		if (e instanceof EngineError) throw e;
		const violation = await violationFor(new URL(url, globalThis.location?.href));
		if (violation && SCRIPT_DIRECTIVES.test(violation.directive))
			throw new EngineError(
				'E1422',
				`the page's Content-Security-Policy blocks the sketch module ${url}: its ${violation.directive} does not allow ${violation.blocked}.`,
			);
		module = await importAgain(url, e, load, options);
	}
	if (!isSketchDefinition(module.default))
		throw new EngineError('E1401', `${url} must export default defineSketch(...).`);
	return module.default;
}

/**
 * Imports a sketch module whose first import failed with `first`, once more after a short wait.
 * Every browser keeps a module whose code threw or did not parse, and rethrows the same error at
 * once, so such a module fails with E1410 without a second download. Firefox and Safari download a
 * module that did not download again at the same address. Chrome keeps the failed download and
 * fails again at once with a new error, so the loader then imports the module at an address with
 * a query of its own. Only http and https addresses take a query. So in Firefox and Safari, a
 * module that fails both downloads is asked for a third time.
 */
async function importAgain(
	url: string,
	first: unknown,
	load: ModuleImport,
	{ step, retryWaitMs = RETRY_WAIT_MS }: SketchLoadOptions,
): Promise<{ default?: unknown }> {
	const reason = reasonOf(first);
	const failed = (e: unknown) =>
		e instanceof EngineError
			? e
			: new EngineError('E1410', `the sketch module ${url} did not load: ${reason}.`);
	const note = (text: string) => {
		console.warn(`null3D: ${text}`);
		step?.(text);
	};
	note(`the sketch module ${url} did not load (${reason}), so the engine imports it once more`);
	await new Promise((resolve) => setTimeout(resolve, retryWaitMs));
	try {
		return await load(url);
	} catch (second) {
		const address = new URL(url, globalThis.location?.href);
		if (second === first || second instanceof EngineError || !/^https?:$/.test(address.protocol))
			throw failed(second);
		address.searchParams.set(RETRY_PARAM, '1');
		note(`the second import failed too, so the engine imports ${address.href}`);
		try {
			return await load(address.href);
		} catch (third) {
			throw failed(third);
		}
	}
}
