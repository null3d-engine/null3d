// URL switches that let one device exercise every engine path: ?gpu=, ?threads=off, ?render=main,
// ?sketch-thread=main, ?latency=, ?uploads=copy, ?depth=, ?compile=wait, ?shaders=fresh,
// ?check=fresh, ?wake=message, ?hdr=off, ?half= and ?compression=. Eight more set what the
// benchmarks vary: ?fps= for a fixed frame rate, ?jobs= for the job worker count, ?memory= for the
// shared memory's maximum, ?queue= for the frames that may wait on the GPU, ?cells=off for culling
// without grid cells, ?prepass=on or off for the depth prepass, ?occlusion=on or off for occlusion
// culling, and ?skinning=vertex for skinning in the vertex shader of each pass on WebGPU. ?hold
// starts hold mode for image tests, ?preset= fixes the quality preset, ?bench publishes the
// running engine for benchmark tools, and ?gl-timing times each WebGL call for benchmark pages.

import { QUALITY_PRESETS, type QualityPreset } from '../quality/presets';

export type GpuSwitch = 'auto' | 'webgpu' | 'compat' | 'webgl2';
/**
 * How the WebGL2 path times its calls for benchmarks: each call alone, or each call followed by a
 * call that waits for the browser's GPU process, so a wait there counts toward the call that
 * caused it.
 */
export type GlTimingMode = 'calls' | 'sync';
/**
 * How the engine trades latency for speed. In `pipelined` mode, the render worker draws each frame
 * while the sketch computes the next one. In `low` mode, the sketch worker draws each frame right after
 * its update.
 *
 * @category api/engine
 */
export type LatencyMode = 'pipelined' | 'low';

/**
 * The thread that runs the sketch's code and the engine core. With `worker`, the default, the
 * sketch runs in a worker of its own. With `main`, it runs on the page's main thread, where it can
 * reach the DOM, while the render worker draws. The single-threaded build always runs it on the
 * page's thread.
 *
 * @category api/engine
 */
export type SketchThread = 'worker' | 'main';

/**
 * How the GPU path stores depth. In `reversed` depth, the near plane stores 1 and the far plane 0,
 * in a 32-bit float depth buffer. That keeps depth precise far from the camera. WebGPU always
 * draws it. WebGL2 draws it where the browser has the `EXT_clip_control` extension, which gives
 * WebGL2 the depth range from 0 to 1 that WebGPU has. The `reversed-gl` mode keeps the same
 * order, but in WebGL2's own depth range from -1 to 1, which loses most of the precision. In
 * `standard` depth, the near plane stores 0, as in three.js's WebGL renderer.
 *
 * @category api/engine
 */
export type DepthMode = 'reversed' | 'reversed-gl' | 'standard';

/** A family of compressed texture formats that KTX2 files can become. */
export type CompressionFamily = 'astc' | 'bc' | 'etc2';

const COMPRESSION_FAMILIES: readonly CompressionFamily[] = ['astc', 'bc', 'etc2'];

export interface Switches {
	gpu: GpuSwitch;
	/** False when ?threads=off asks for the single-threaded build. */
	threads: boolean;
	/** True when ?render=main asks for rendering on the page's main thread. */
	renderOnMain: boolean;
	/** The thread that ?sketch-thread= asks to run the sketch on, which wins over the option. */
	sketchThread: SketchThread | undefined;
	latency: LatencyMode | undefined;
	/** True when ?uploads=copy makes the WebGL2 path copy uploads out of shared memory first. */
	copyUploads: boolean;
	/**
	 * The depth mode that ?depth= asks the WebGL2 path to draw with, or undefined for the device's
	 * own. A device without `EXT_clip_control` cannot draw `reversed`, and draws its own instead.
	 */
	depth: DepthMode | undefined;
	/**
	 * The compressed texture families that ?compression= lets KTX2 files become, of those the
	 * device has: a list such as ?compression=bc,etc2, or none with ?compression=none. Undefined
	 * for every family the device has.
	 */
	compression: readonly CompressionFamily[] | undefined;
	/**
	 * False when ?compile=wait makes the WebGL2 path wait for each program's compile at its first
	 * draw, as it does in a browser without `KHR_parallel_shader_compile`.
	 */
	parallelCompile: boolean;
	/**
	 * True when ?shaders=fresh gives each shader's text a comment that no earlier start used, so the
	 * browser compiles every shader again instead of reusing what it compiled before, as on a first
	 * visit.
	 */
	freshShaders: boolean;
	/**
	 * True when ?check=fresh makes the engine measure its preset again, as on a first visit, instead
	 * of taking the preset check's stored result from an earlier start.
	 */
	freshCheck: boolean;
	/**
	 * True when ?wake=message makes the engine's threads wake each other with messages, as they do
	 * in a browser without `Atomics.waitAsync`.
	 */
	wakeByMessage: boolean;
	/**
	 * False when ?hdr=off makes the engine take the 8-bit path, where the scene shaders tone map
	 * themselves, on a device that draws HDR color.
	 */
	hdr: boolean;
	/**
	 * True when ?half=on makes the scene shaders do their color math at half precision, where the
	 * device can, false when ?half=off makes them use full precision, and undefined for the
	 * engine's own choice.
	 */
	half: boolean | undefined;
	/**
	 * False when ?cells=off makes the core cull every object and instance row, with no whole grid
	 * cells skipped first, for benchmarks that measure what cell culling saves.
	 */
	cells: boolean;
	/**
	 * True when ?prepass=on turns the depth prepass on, false when ?prepass=off turns it off, and
	 * undefined to leave it to the page's option and the quality preset.
	 */
	prepass: boolean | undefined;
	/**
	 * True when ?occlusion=on turns occlusion culling on, false when ?occlusion=off turns it off,
	 * and undefined to leave it to the page's options and the quality preset. It sets GPU occlusion
	 * culling on WebGPU and software occlusion culling on WebGL2.
	 */
	occlusion: boolean | undefined;
	/**
	 * True when ?skinning=vertex makes WebGPU skin skinned meshes in the vertex shader of each pass
	 * that draws them, as WebGL2 does, instead of once per frame in a compute pass, to measure the
	 * two against each other.
	 */
	vertexSkinning: boolean;
	/**
	 * The frame rate from ?fps= that the thread that draws holds, up to the display's rate, or
	 * undefined to draw at the display's rate.
	 */
	fps: number | undefined;
	/** The job workers that ?jobs= asks for, or undefined for the count from the device's cores. */
	jobs: number | undefined;
	/**
	 * The most frames that ?queue= lets wait unfinished on the GPU: a whole number, or infinity
	 * for ?queue=off, which leaves the queue to the browser. Undefined for the engine's own limit.
	 */
	queue: number | undefined;
	/**
	 * The shared memory's declared maximum in MiB from ?memory=, which wins over the page's option,
	 * or undefined to use the option or the default.
	 */
	memoryMiB: number | undefined;
	/**
	 * The quality preset that ?preset= fixes, which wins over the page's option and over the
	 * crash marker, or undefined without the switch or with a name that is no preset.
	 */
	preset: QualityPreset | undefined;
	/**
	 * The text of ?hold=, an empty text for a bare ?hold, or undefined without the switch. The
	 * engine checks it when it starts, so a bad time fails at once instead of starting a live engine.
	 */
	hold: string | undefined;
	/** True when ?bench asks the engine to publish itself on the page for a benchmark tool. */
	bench: boolean;
	/**
	 * How ?gl-timing asks the WebGL2 path to time each WebGL call on the thread that draws, for a
	 * benchmark page to read: `calls` for a bare ?gl-timing, `sync` for ?gl-timing=sync, or
	 * undefined to time none.
	 */
	glTiming: GlTimingMode | undefined;
}

/** The most job workers the engine core runs. */
const MAX_JOB_WORKERS = 255;

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
	return value !== null && (allowed as readonly string[]).includes(value)
		? (value as T)
		: undefined;
}

/** True for `on`, false for `off`, and undefined for anything else. */
function onOff(value: string | null): boolean | undefined {
	return value === 'on' ? true : value === 'off' ? false : undefined;
}

/** A number above 0, or undefined for a missing or unusable value. */
function positive(value: string | null): number | undefined {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A whole number from 1 to `max`, or undefined for a missing or unusable value. */
function whole(value: string | null, max = Number.MAX_SAFE_INTEGER): number | undefined {
	const n = positive(value);
	return n !== undefined && Number.isInteger(n) && n <= max ? n : undefined;
}

export function parseSwitches(search: string): Switches {
	const params = new URLSearchParams(search);
	return {
		gpu: oneOf(params.get('gpu'), ['webgpu', 'compat', 'webgl2'] as const) ?? 'auto',
		threads: params.get('threads') !== 'off',
		renderOnMain: params.get('render') === 'main',
		sketchThread: oneOf(params.get('sketch-thread'), ['worker', 'main'] as const),
		latency: oneOf(params.get('latency'), ['pipelined', 'low'] as const),
		copyUploads: params.get('uploads') === 'copy',
		depth: oneOf(params.get('depth'), ['reversed', 'reversed-gl', 'standard'] as const),
		compression: params
			.get('compression')
			?.split(',')
			.flatMap((name) => oneOf(name, COMPRESSION_FAMILIES) ?? []),
		parallelCompile: params.get('compile') !== 'wait',
		freshShaders: params.get('shaders') === 'fresh',
		freshCheck: params.get('check') === 'fresh',
		wakeByMessage: params.get('wake') === 'message',
		hdr: params.get('hdr') !== 'off',
		half: onOff(params.get('half')),
		cells: params.get('cells') !== 'off',
		prepass: onOff(params.get('prepass')),
		occlusion: onOff(params.get('occlusion')),
		vertexSkinning: params.get('skinning') === 'vertex',
		fps: positive(params.get('fps')),
		jobs: whole(params.get('jobs'), MAX_JOB_WORKERS),
		queue: params.get('queue') === 'off' ? Number.POSITIVE_INFINITY : whole(params.get('queue')),
		memoryMiB: whole(params.get('memory')),
		preset: oneOf(params.get('preset'), QUALITY_PRESETS),
		hold: params.get('hold') ?? undefined,
		bench: params.has('bench'),
		glTiming: !params.has('gl-timing')
			? undefined
			: params.get('gl-timing') === 'sync'
				? 'sync'
				: 'calls',
	};
}
