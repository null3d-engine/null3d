// Loads the engine's WebAssembly core into the current thread. The core is built twice: the
// threaded build imports shared memory, and the single-threaded build defines its own memory.
// The generated wasm-bindgen module is loaded by URL, and `CoreGlue` describes the functions the
// TypeScript side calls, so type checking does not depend on a Rust build.

import { DEV } from '../errors/checks';
import type { CoreErrors } from '../errors/core-failure';
import { EngineError } from '../errors/engine-error';

export type Build = 'threaded' | 'single';

export interface InitOptions {
	module: WebAssembly.Module;
	memory?: WebAssembly.Memory;
	/** Stack size for this thread in bytes, a multiple of 64 KB. */
	thread_stack_size?: number;
}

/**
 * The functions of the generated module that the engine calls. Functions that can fail return an
 * error code (0 for success), or 0 in place of a handle, id or address; `lastErrorCode` and
 * `lastErrorDetail` then describe the failure.
 */
export interface CoreGlue extends CoreErrors {
	/** Instantiates the core; returns the instance's exports, which include its memory. */
	initSync(options: InitOptions): { memory?: WebAssembly.Memory };
	engineVersion(): string;
	isThreadedBuild(): boolean;
	initEngine(
		jobWorkers: number,
		sceneCapacity: number,
		maxBatches: number,
		commands: number,
		storageBindingBytes: number,
		webgl2: boolean,
		capabilities: number,
		maxTextureSize: number,
		sceneColor: number,
		antialias: number,
		transparent: boolean,
		cellCulling: boolean,
		depthPrepass: boolean,
	): number;
	jobWorkerLoop(index: number): void;
	/** Milliseconds a job worker spent on work since the last call for it; resets its total. */
	takeJobBusyMs(index: number): number;
	/** The address of the job system's wake word, or 0 before it exists. */
	jobsWakeAddress(): number;
	/** The address of the job system's stop flag, a byte, or 0 before it exists. */
	jobsStopAddress(): number;
	/** Drops the engine, so this instance can create another; the page's own instance needs it. */
	destroyEngine(): void;
	/**
	 * Drops the instance that the threaded build's glue keeps for this thread, so the browser can
	 * free its memory, and the next start makes a new instance. The single-threaded build lacks it:
	 * the page keeps that instance for the next engine.
	 */
	releaseInstance?(): void;
	sceneCapacity(): number;
	sceneArrays(field: number): number;
	reserveObject(): number;
	/** Copies a world matrix: 12 numbers, with the translation from the origin in 64 bits. */
	worldMatrix(handle: number, out: Float64Array): number;
	commandRing(field: number): number;
	/**
	 * Wakes the job workers at the start of a frame when the previous frame gave them work, so they
	 * are ready when this frame's parallel work comes.
	 */
	prepareJobs(): void;
	/**
	 * Starts a frame, with the sketch time in whole milliseconds and the step since the frame
	 * before in whole microseconds, and applies every pending command.
	 */
	beginFrame(frame: number, timeMs: number, stepUs: number): number;
	updateTransforms(): number;
	/**
	 * Updates the objects that the sketch moved after `updateTransforms`, and the objects below
	 * them, so culling and drawing see the moves in the same frame.
	 */
	updateLateTransforms(): number;
	updateBatches(frame: number): number;
	/** Finds the frame's visible objects on the job workers, where the path culls on the CPU. */
	cullFrame(frame: number, width: number, height: number): number;
	/**
	 * Records the frame's draw list. `built` is the newest frame that the thread that draws drew
	 * with every pipeline built.
	 */
	recordFrame(frame: number, width: number, height: number, scale: number, built: number): number;
	/**
	 * The index list entries that a recorded frame draws, where the path culls on the CPU, or
	 * `CORE_NOT_COUNTED` where the GPU culls.
	 */
	visibleEntries(frame: number): number;
	/** True when the last recorded frame rebuilt its draw tables after a structure change. */
	drawTablesRebuilt(): boolean;
	resetGpu(): number;
	drawListAddress(parity: number): number;
	drawListWords(frame: number): number;
	/**
	 * Makes room for `points` points of debug lines, keeping those written since the last recorded
	 * frame. The arrays can move, so their addresses must be read again.
	 */
	reserveDebugLines(points: number): number;
	/** The address of a debug line array: `DEBUG_LINE_FIELD_POSITIONS` or `..._COLORS`. */
	debugLineArrays(field: number): number;
	/** Draws the first `points` points of the debug line arrays in the next recorded frame. */
	drawDebugLines(points: number): number;
	createBatch(
		capacity: number,
		dynamic: boolean,
		colors: boolean,
		mesh: number,
		material: number,
	): number;
	destroyBatch(batch: number, frame: number): number;
	batchArrays(batch: number, field: number): number;
	setBatchActiveCount(batch: number, count: number): number;
	/** Sets the layer mask of every row of a batch, as an unsigned 32-bit number. */
	setBatchLayers(batch: number, mask: number): number;
	markBatchDirty(batch: number, start: number, count: number): number;
	memoryEpoch(): number;
	/**
	 * A mesh from a geometry generator: `shape` is one of the `SHAPE_*` codes, and the numbers after
	 * it are the arguments of the three.js class's constructor, in their order. Returns the mesh id.
	 */
	createShapeMesh(
		shape: number,
		a: number,
		b: number,
		c: number,
		d: number,
		e: number,
		f: number,
		g: number,
		h: number,
	): number;
	/**
	 * Makes room for a mesh's arrays in engine memory, `words` 32-bit words, and returns their
	 * address; `createMeshFromArrays` reads and frees them.
	 */
	meshArrays(words: number): number;
	/**
	 * A mesh from the arrays at `meshArrays`'s address, as `layout` (the `MESH_ARRAYS_*` bits)
	 * describes them. `types` gives each array's type in its attribute's field of a vertex format.
	 * Returns the mesh id.
	 */
	createMeshFromArrays(vertices: number, indices: number, layout: number, types: number): number;
	meshRadius(mesh: number): number;
	/**
	 * A material with a linear color and opacity. `shading` is one of the `SHADING_*` codes, and
	 * `features` holds `MATERIAL_FEATURE_*` bits, fixed from then on, as is the depth bias: three.js's
	 * polygon offset units and factor.
	 */
	createMaterial(
		shading: number,
		features: number,
		r: number,
		g: number,
		b: number,
		a: number,
		biasConstant: number,
		biasSlope: number,
	): number;
	/**
	 * Changes one value of a material, `param` (a `MATERIAL_PARAM_*` code), and keeps the others.
	 * The value takes as many of `x`, `y` and `z` as it has numbers. Colors are linear.
	 */
	setMaterialValue(material: number, param: number, x: number, y: number, z: number): number;
	/**
	 * Changes `count` custom values of a material, from float `at` of its row of custom values:
	 * a custom material's uniform, as the shader compiler placed it.
	 */
	setMaterialValues(
		material: number,
		at: number,
		count: number,
		x: number,
		y: number,
		z: number,
		w: number,
	): number;
	/**
	 * Gives a material a map in `slot` (a `MAP_SLOT_*` code): a texture's handle, or none with 0.
	 * The shader reads it at the second texture coordinates when `secondUv` is 1.
	 */
	setMaterialMap(material: number, slot: number, texture: number, secondUv: number): number;
	/**
	 * A texture with no texels yet, in `depth` layers of a texture array. `format` is a `FORMAT_*` code.
	 * `mipmaps` has the GPU make the mip levels; without it, `levels` is the mip levels that its data
	 * brings. The rest set its sampler with `ADDRESS_*` and `FILTER_*` codes. Returns its handle.
	 */
	createTexture(
		width: number,
		height: number,
		depth: number,
		format: number,
		mipmaps: boolean,
		levels: number,
		wrapU: number,
		wrapV: number,
		magFilter: number,
		minFilter: number,
		mipFilter: number,
		anisotropy: number,
	): number;
	/**
	 * A 3D texture with no texels yet, in a `FORMAT_*` code of linear 8-bit color or half floats,
	 * read with a linear filter and clamped at its edges. Returns its handle.
	 */
	createVolumeTexture(width: number, height: number, depth: number, format: number): number;
	/**
	 * Gives a texture an image, uploaded with the `TEXTURE_PREMULTIPLIED_ALPHA` flag or 0, and
	 * returns the image's id for the thread that draws. An image of another size resizes it.
	 */
	setTextureImage(texture: number, width: number, height: number, flags: number): number;
	/**
	 * Gives a texture texels of `width` x `height` in each layer, and returns the address that
	 * TypeScript writes them at: tightly packed rows, of blocks in a compressed format, layer after
	 * layer, and level after level for a texture whose data brings its mip levels.
	 */
	setTextureData(texture: number, width: number, height: number): number;
	destroyTexture(texture: number, frame: number): number;
	/** Tells the texture store what the thread that draws has: images received, and frames taken. */
	syncTextures(imagesArrived: number, framesTaken: number): void;
	/** One of the texture store's numbers, by `TEXTURE_STAT_*` code; `texture` names one texture. */
	textureStat(field: number, texture: number): number;
	/** Changes one of the texture store's settings, by `TEXTURE_OPTION_*` code. */
	setTextureOption(option: number, value: number): number;
	/**
	 * Sets up the shadow atlas of point and spot lights: its most tiles, the texels on each side of
	 * each, and whether point lights cast shadows.
	 */
	setShadowTiles(tiles: number, size: number, pointShadows: boolean): number;
	/**
	 * Draws from a camera object with a perspective lens, a vertical field of view in degrees, and
	 * the objects on `layers`. With `target` set to `CAMERA_TARGET_SHADOWS`, the camera fits the
	 * main directional light's shadow cascades instead.
	 */
	setPerspectiveCamera(
		camera: number,
		fovDegrees: number,
		near: number,
		far: number,
		layers: number,
		target: number,
	): number;
	/**
	 * Draws from a camera object with an orthographic lens: a view `height` tall and `width` wide,
	 * where a width of 0 follows the canvas's aspect ratio, centered right of and above the
	 * camera's axis by `centerX` and `centerY`, and the objects on `layers`. `target` acts as in
	 * `setPerspectiveCamera`.
	 */
	setOrthographicCamera(
		camera: number,
		height: number,
		width: number,
		centerX: number,
		centerY: number,
		near: number,
		far: number,
		layers: number,
		target: number,
	): number;
	/** Fits the main directional light's shadow cascades to the drawing camera's view again. */
	clearShadowCamera(): number;
	/**
	 * Adds a row to the light table for the object `handle`; `kind` is one of the `LIGHT_KIND_*`
	 * codes. Returns the light's id.
	 */
	createLight(handle: number, kind: number): number;
	destroyLight(light: number): number;
	/** Sets one of a light's linear colors: `which` is one of the `LIGHT_COLOR_*` codes. */
	setLightColor(light: number, which: number, r: number, g: number, b: number): number;
	/** Sets one of a light's numbers: `which` is one of the `LIGHT_VALUE_*` codes. */
	setLightValue(light: number, which: number, value: number): number;
	/**
	 * Sets the number that each light created from now on starts with: `which` is one of the
	 * `LIGHT_VALUE_*` codes.
	 */
	setLightDefault(which: number, value: number): number;
	setBackground(r: number, g: number, b: number): number;
	/**
	 * The address of the block of post-processing values (`POST_VALUE_*`), 32-bit floats that
	 * TypeScript writes before it calls `setOutput`, `setBloom`, `setLut` or `setVignette`.
	 */
	postValues(): number;
	/** The tone mapping, by code, and the exposure from the post-processing values, from the next frame on. */
	setOutput(toneMapping: number): number;
	/** Turns bloom on with the post-processing values' strength, radius and threshold, or off. */
	setBloom(on: boolean): number;
	/** How many times fewer taps than three.js's bloom's blurs read, from the next frame on. */
	setBloomSamples(divisor: number): number;
	/**
	 * Grades the canvas color with the color grading table in a 3D texture, or with none for 0,
	 * from the next frame on, with the post-processing values' intensity and domain.
	 */
	setLut(texture: number): number;
	/** Turns the vignette on with the post-processing values' offset and darkness, or off. */
	setVignette(on: boolean): number;
	/**
	 * Draws the scene into a target of another format, by code, with another anti-aliasing mode, by
	 * code, from the next frame on.
	 */
	setCanvasOutput(sceneColor: number, antialias: number): number;
	/** Whether the render scale can drop below the whole canvas, from the next frame on. */
	setRenderScaling(scaling: boolean): number;
	/**
	 * The shadow filter's texels on each side, 3 or 5, and the frames between two draws of a far
	 * shadow cascade, from 1 to 8, from the next frame on.
	 */
	setShadowQuality(filter: number, farInterval: number): number;
	/**
	 * What casts shadows in the last recorded frame: the main directional light's cascades in the
	 * bits of `SHADOW_CASTERS_CASCADE_MASK`, and `SHADOW_CASTERS_TILES` when point or spot lights
	 * cast shadows.
	 */
	shadowCasters(): number;
	/** Draws the texture `texture` behind every object in the camera's view, or none with 0. */
	setBackgroundTexture(texture: number): number;
	/**
	 * The scene's fog: its kind (`FOG_KIND_*`), its linear color, the near and far distances of
	 * linear fog, and the density of exponential squared fog.
	 */
	setFog(
		kind: number,
		r: number,
		g: number,
		b: number,
		near: number,
		far: number,
		density: number,
	): number;
	/**
	 * Draws the scene with a debug view (`DEBUG_VIEW_*`), or with its materials with
	 * `DEBUG_VIEW_LIT`, from the next frame on.
	 */
	setDebugView(view: number): number;
	// The animation table. Ids that its create calls return, and that its other calls take, are the
	// table's ids plus one; a create call returns 0 on failure.
	/** Creates the animation table for `instances` animated objects with `joints` joints in all. */
	initAnimations(instances: number, joints: number): number;
	/** Makes room for `words` staging words of animation data and returns their address. */
	animationStaging(words: number): number;
	/**
	 * Creates a skeleton from the staging words: each joint's parent, then its rest pose
	 * (`ANIMATION_REST_FLOATS` floats), then its inverse bind matrix (12 floats, row-major 3 × 4).
	 */
	createSkeleton(joints: number): number;
	/**
	 * Creates a clip from the staging words: `tracks` headers of `ANIMATION_TRACK_WORDS` words
	 * (joint, channel, interpolation, key count), then each track's key times and values, resampled
	 * at `rate` keys per second.
	 */
	createClip(skeleton: number, tracks: number, rate: number): number;
	/** Adds an animated instance of a skeleton. */
	createAnimatedInstance(skeleton: number): number;
	/** Removes an animated instance; later instances take its id and joints. */
	removeAnimatedInstance(instance: number): number;
	/** The address of an animation table array (`ANIMATION_FIELD_*`). */
	animationArrays(field: number): number;
	/**
	 * Plays a clip on an instance's layer, fading over `fade` seconds at `speed`, with
	 * `ANIMATION_PLAY_*` flags.
	 */
	animatorPlay(
		instance: number,
		clip: number,
		layer: number,
		fade: number,
		speed: number,
		flags: number,
	): number;
	/** Stops a clip on an instance, or every clip when `clip` is 0, fading over `fade` seconds. */
	animatorStop(instance: number, clip: number, fade: number): number;
	/** Creates a joint mask of a skeleton from the staging words: one weight from 0 to 1 per joint. */
	createJointMask(skeleton: number): number;
	/** Gives an instance's layer a joint mask, or every joint when `mask` is 0. */
	setLayerMask(instance: number, layer: number, mask: number): number;
	/** Sets a clip's events from the staging words: `count` times as floats, then `count` ids. */
	setClipEvents(clip: number, count: number): number;
	/**
	 * Advances every played clip by `stepUs` whole microseconds, then writes every animated
	 * instance's skinning matrices, on the job workers.
	 */
	updateAnimations(stepUs: number): number;
}

const REQUIRED_FUNCTIONS: readonly (keyof CoreGlue)[] = [
	'initSync',
	'engineVersion',
	'isThreadedBuild',
	'lastErrorCode',
	'lastErrorDetail',
	'initEngine',
	'jobWorkerLoop',
	'takeJobBusyMs',
	'jobsWakeAddress',
	'jobsStopAddress',
	'destroyEngine',
	'sceneCapacity',
	'sceneArrays',
	'reserveObject',
	'worldMatrix',
	'commandRing',
	'prepareJobs',
	'beginFrame',
	'updateTransforms',
	'updateLateTransforms',
	'updateBatches',
	'cullFrame',
	'recordFrame',
	'visibleEntries',
	'drawTablesRebuilt',
	'resetGpu',
	'drawListAddress',
	'drawListWords',
	'reserveDebugLines',
	'debugLineArrays',
	'drawDebugLines',
	'createBatch',
	'destroyBatch',
	'batchArrays',
	'setBatchActiveCount',
	'setBatchLayers',
	'markBatchDirty',
	'memoryEpoch',
	'createShapeMesh',
	'meshArrays',
	'createMeshFromArrays',
	'meshRadius',
	'createMaterial',
	'setMaterialValue',
	'setMaterialValues',
	'setMaterialMap',
	'createTexture',
	'createVolumeTexture',
	'setTextureImage',
	'setTextureData',
	'destroyTexture',
	'syncTextures',
	'textureStat',
	'setTextureOption',
	'setShadowTiles',
	'setPerspectiveCamera',
	'setOrthographicCamera',
	'clearShadowCamera',
	'createLight',
	'destroyLight',
	'setLightColor',
	'setLightValue',
	'setLightDefault',
	'setBackground',
	'postValues',
	'setOutput',
	'setBloom',
	'setBloomSamples',
	'setLut',
	'setVignette',
	'setCanvasOutput',
	'setRenderScaling',
	'setShadowQuality',
	'shadowCasters',
	'setBackgroundTexture',
	'setFog',
	'setDebugView',
	'initAnimations',
	'animationStaging',
	'createSkeleton',
	'createClip',
	'createAnimatedInstance',
	'removeAnimatedInstance',
	'animationArrays',
	'animatorPlay',
	'animatorStop',
	'createJointMask',
	'setLayerMask',
	'setClipEvents',
	'updateAnimations',
];

/** Stack size for each engine thread. */
export const THREAD_STACK_BYTES = 1024 * 1024;

export interface MemoryLimits {
	initial: number;
	maximum: number | null;
	shared: boolean;
}

export interface CoreFiles {
	/** The generated JavaScript that binds the core. */
	glue: URL;
	/** The compiled core. */
	wasm: URL;
	/** The shared memory's page limits; only the threaded build has them. */
	memory?: URL;
}

/**
 * Each build's files. Every path is written out in full, so a bundler finds the files, ships them
 * with the app and rewrites the addresses to the shipped copies.
 */
export function coreUrls(build: Build): CoreFiles {
	return build === 'threaded'
		? {
				glue: new URL('../../dist/wasm/threaded/null3d.js', import.meta.url),
				wasm: new URL('../../dist/wasm/threaded/null3d_bg.wasm', import.meta.url),
				memory: new URL('../../dist/wasm/threaded/null3d_memory.json', import.meta.url),
			}
		: {
				glue: new URL('../../dist/wasm/single/null3d.js', import.meta.url),
				wasm: new URL('../../dist/wasm/single/null3d_bg.wasm', import.meta.url),
			};
}

/**
 * Imports the generated module for a build. Development builds also check that it has every
 * function the engine calls. A release build bundles this code and the core from one install, so
 * only a development setup can pair a core with code from another build, and release builds drop
 * the check and its list of names.
 */
export async function loadGlue(build: Build): Promise<CoreGlue> {
	const glue = (await import(/* @vite-ignore */ coreUrls(build).glue.href)) as Partial<CoreGlue>;
	if (DEV) {
		const missing = REQUIRED_FUNCTIONS.filter((name) => typeof glue[name] !== 'function');
		if (missing.length > 0)
			throw new EngineError('E1402', `the ${build} engine core lacks ${missing.join(', ')}.`);
	}
	return glue as CoreGlue;
}

export interface StartedCore {
	glue: CoreGlue;
	/** The memory the core runs in: the shared memory, or the single-threaded build's own. */
	memory: WebAssembly.Memory | undefined;
}

/**
 * Instantiates the core in this thread with an already compiled module. `step` hears each step as
 * it finishes: the glue loaded, then the core started.
 */
export async function startCore(
	build: Build,
	module: WebAssembly.Module,
	memory?: WebAssembly.Memory,
	step?: (name: string) => void,
): Promise<StartedCore> {
	const glue = await loadGlue(build);
	step?.('glue loaded');
	const exports = glue.initSync(
		build === 'threaded' ? { module, memory, thread_stack_size: THREAD_STACK_BYTES } : { module },
	);
	step?.('core started');
	return { glue, memory: memory ?? exports.memory };
}
