// URL switches that let one device exercise every engine path: ?gpu=, ?threads=off, ?render=main,
// ?latency=, ?preset=, ?fps= and ?hold.

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
	preset: PresetSwitch | undefined;
	/** A fixed frame rate from ?fps=, or undefined for the display rate. */
	fps: number | undefined;
	/** Hold mode: one frame at a fixed time, for image tests. */
	hold: boolean;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
	return value !== null && (allowed as readonly string[]).includes(value)
		? (value as T)
		: undefined;
}

export function parseSwitches(search: string): Switches {
	const params = new URLSearchParams(search);
	const fps = Number(params.get('fps'));
	return {
		gpu: oneOf(params.get('gpu'), ['webgpu', 'compat', 'webgl2'] as const) ?? 'auto',
		threads: params.get('threads') !== 'off',
		renderOnMain: params.get('render') === 'main',
		latency: oneOf(params.get('latency'), ['pipelined', 'low'] as const),
		preset: oneOf(params.get('preset'), ['low', 'medium', 'high', 'ultra'] as const),
		fps: Number.isFinite(fps) && fps > 0 ? fps : undefined,
		hold: params.has('hold'),
	};
}
