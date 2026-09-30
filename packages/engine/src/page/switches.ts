// URL switches that let one device exercise every engine path: ?gpu=, ?threads=off, ?render=main,
// ?latency=, ?uploads=copy, ?depth= and ?hdr=off. Three more set what the benchmarks vary: ?fps=
// for a fixed frame rate, ?jobs= for the job worker count and ?memory= for the shared memory's
// maximum. ?hold starts hold mode for image tests.

export type GpuSwitch = 'auto' | 'webgpu' | 'compat' | 'webgl2';
/**
 * How the engine trades latency for speed. In `pipelined` mode, the render worker draws each frame
 * while the sketch computes the next one. In `low` mode, the sketch worker draws each frame right after
 * its update.
 *
 * @category api/engine
 */
export type LatencyMode = 'pipelined' | 'low';

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

export interface Switches {
	gpu: GpuSwitch;
	/** False when ?threads=off asks for the single-threaded build. */
	threads: boolean;
	/** True when ?render=main asks for rendering on the page's main thread. */
	renderOnMain: boolean;
	latency: LatencyMode | undefined;
	/** True when ?uploads=copy makes the WebGL2 path copy uploads out of shared memory first. */
	copyUploads: boolean;
	/**
	 * The depth mode that ?depth= asks the WebGL2 path to draw with, or undefined for the device's
	 * own. A device without `EXT_clip_control` cannot draw `reversed`, and draws its own instead.
	 */
	depth: DepthMode | undefined;
	/**
	 * False when ?hdr=off makes the engine take the 8-bit path, where the scene shaders tone map
	 * themselves, on a device that draws HDR color.
	 */
	hdr: boolean;
	/**
	 * The frame rate from ?fps= that the thread that draws holds, up to the display's rate, or
	 * undefined to draw at the display's rate.
	 */
	fps: number | undefined;
	/** The job workers that ?jobs= asks for, or undefined for the count from the device's cores. */
	jobs: number | undefined;
	/**
	 * The shared memory's declared maximum in MiB from ?memory=, which wins over the page's option,
	 * or undefined to use the option or the default.
	 */
	memoryMiB: number | undefined;
	/**
	 * The text of ?hold=, an empty text for a bare ?hold, or undefined without the switch. The
	 * engine checks it when it starts, so a bad time fails at once instead of starting a live engine.
	 */
	hold: string | undefined;
}

/** The most job workers the engine core runs. */
const MAX_JOB_WORKERS = 255;

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
	return value !== null && (allowed as readonly string[]).includes(value)
		? (value as T)
		: undefined;
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
		latency: oneOf(params.get('latency'), ['pipelined', 'low'] as const),
		copyUploads: params.get('uploads') === 'copy',
		depth: oneOf(params.get('depth'), ['reversed', 'reversed-gl', 'standard'] as const),
		hdr: params.get('hdr') !== 'off',
		fps: positive(params.get('fps')),
		jobs: whole(params.get('jobs'), MAX_JOB_WORKERS),
		memoryMiB: whole(params.get('memory')),
		hold: params.get('hold') ?? undefined,
	};
}
