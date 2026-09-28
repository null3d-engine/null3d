// Loads the engine's WebAssembly core into the current thread. The core is built twice: the
// threaded build imports shared memory, and the single-threaded build defines its own memory.
// The generated wasm-bindgen module is loaded by URL, and `CoreGlue` describes the functions the
// TypeScript side calls, so type checking does not depend on a Rust build.

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
	): number;
	jobWorkerLoop(index: number): void;
	/** Milliseconds a job worker spent on work since the last call for it; resets its total. */
	takeJobBusyMs(index: number): number;
	shutdownJobs(): void;
	sceneCapacity(): number;
	sceneArrays(field: number): number;
	reserveObject(): number;
	worldMatrix(handle: number, out: Float32Array): number;
	commandRing(field: number): number;
	beginFrame(frame: number): number;
	updateTransforms(): number;
	updateBatches(frame: number): number;
	recordFrame(frame: number, width: number, height: number): number;
	resetGpu(): number;
	drawListAddress(parity: number): number;
	drawListWords(frame: number): number;
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
	markBatchDirty(batch: number, start: number, count: number): number;
	memoryEpoch(): number;
	createBoxMesh(
		width: number,
		height: number,
		depth: number,
		widthSegments: number,
		heightSegments: number,
		depthSegments: number,
	): number;
	createSphereMesh(radius: number, widthSegments: number, heightSegments: number): number;
	meshRadius(mesh: number): number;
	createMaterial(unlit: boolean, r: number, g: number, b: number, a: number): number;
	setMaterialColor(material: number, r: number, g: number, b: number, a: number): number;
	setCamera(camera: number, fovDegrees: number, near: number, far: number): number;
	setSun(dx: number, dy: number, dz: number, r: number, g: number, b: number): number;
	setAmbient(r: number, g: number, b: number): number;
	setBackground(r: number, g: number, b: number): number;
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
	'shutdownJobs',
	'sceneCapacity',
	'sceneArrays',
	'reserveObject',
	'worldMatrix',
	'commandRing',
	'beginFrame',
	'updateTransforms',
	'updateBatches',
	'recordFrame',
	'resetGpu',
	'drawListAddress',
	'drawListWords',
	'createBatch',
	'destroyBatch',
	'batchArrays',
	'setBatchActiveCount',
	'markBatchDirty',
	'memoryEpoch',
	'createBoxMesh',
	'createSphereMesh',
	'meshRadius',
	'createMaterial',
	'setMaterialColor',
	'setCamera',
	'setSun',
	'setAmbient',
	'setBackground',
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

/** Imports the generated module for a build and checks that it has every function the engine calls. */
export async function loadGlue(build: Build): Promise<CoreGlue> {
	const glue = (await import(/* @vite-ignore */ coreUrls(build).glue.href)) as Partial<CoreGlue>;
	const missing = REQUIRED_FUNCTIONS.filter((name) => typeof glue[name] !== 'function');
	if (missing.length > 0) {
		throw new EngineError('E1402', `the ${build} engine core lacks ${missing.join(', ')}.`);
	}
	return glue as CoreGlue;
}

export interface StartedCore {
	glue: CoreGlue;
	/** The memory the core runs in: the shared memory, or the single-threaded build's own. */
	memory: WebAssembly.Memory | undefined;
}

/** Instantiates the core in this thread with an already compiled module. */
export async function startCore(
	build: Build,
	module: WebAssembly.Module,
	memory?: WebAssembly.Memory,
): Promise<StartedCore> {
	const glue = await loadGlue(build);
	const exports = glue.initSync(
		build === 'threaded' ? { module, memory, thread_stack_size: THREAD_STACK_BYTES } : { module },
	);
	return { glue, memory: memory ?? exports.memory };
}
