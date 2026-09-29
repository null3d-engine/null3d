// URL switches that let one device exercise every engine path: ?gpu=, ?threads=off, ?render=main,
// ?latency=, ?uploads=copy, ?preset=, ?fps= and ?hold. Two more set what the benchmarks vary:
// ?jobs= for the job worker count and ?memory= for the shared memory's maximum.

export type GpuSwitch = 'auto' | 'webgpu' | 'compat' | 'webgl2';
/**
 * How the engine trades latency for speed. In `pipelined` mode, the render worker draws each frame
 * while the sketch computes the next one. In `low` mode, the sketch worker draws each frame right after
 * its update.
 *
 * @category api/engine
 */
export type LatencyMode = 'pipelined' | 'low';
export type PresetSwitch = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

export interface Switches {
	gpu: GpuSwitch;
	/** False when ?threads=off asks for the single-threaded build. */
	threads: boolean;
	/** True when ?render=main asks for rendering on the page's main thread. */
	renderOnMain: boolean;
	latency: LatencyMode | undefined;
	/** True when ?uploads=copy makes the WebGL2 path copy uploads out of shared memory first. */
	copyUploads: boolean;
	preset: PresetSwitch | undefined;
	/** A fixed frame rate from ?fps=, or undefined for the display rate. */
	fps: number | undefined;
	/** Hold mode: one frame at a fixed time, for image tests. */
	hold: boolean;
	/** The job workers that ?jobs= asks for, or undefined for the count from the device's cores. */
	jobs: number | undefined;
	/** The shared memory's declared maximum in MiB from ?memory=, or undefined for the default. */
	memoryMiB: number | undefined;
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
		preset: oneOf(params.get('preset'), ['low', 'medium', 'high', 'ultra'] as const),
		fps: positive(params.get('fps')),
		hold: params.has('hold'),
		jobs: whole(params.get('jobs'), MAX_JOB_WORKERS),
		memoryMiB: whole(params.get('memory')),
	};
}
