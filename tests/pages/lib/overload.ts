// The GPU-bound page's scene and how its results read. The page raises the scene's GPU work step by
// step until the GPU needs more than twice the display's frame interval. Then it measures the rate
// at which the renderer presented frames and the rate at which the GPU finished them. Where the
// presented rate stays above the completed rate, frames queue on the GPU.

/** The scene: layers of detailed spheres in a square grid that fills the view. */
export const OVERLOAD_SCENE = {
	/** Faces around each sphere and from pole to pole: about 16,000 triangles a sphere. */
	widthSegments: 128,
	heightSegments: 64,
	/** Spheres along each edge of a layer. */
	side: 128,
	/** Layers, one behind another. */
	layers: 4,
} as const;

/** Every sphere of the scene; the page shows a first part of them. */
export const OVERLOAD_SPHERES = OVERLOAD_SCENE.side * OVERLOAD_SCENE.side * OVERLOAD_SCENE.layers;

/** How the page raises the load. */
export const OVERLOAD_STEPS = {
	/** The spheres of the first step; each step doubles them. */
	firstCount: 16,
	/** Seconds measured at each step. */
	stepSeconds: 1,
	/** The steps stop when the lower of the two rates falls below this share of the display's rate. */
	overloadedShare: 0.5,
	/** Seconds measured at the step that overloads the GPU, unless `?seconds=` gives others. */
	seconds: 5,
} as const;

/** How much faster the presented rate must be than the completed rate for the two to part. */
export const PARTED_SHARE = 0.1;

/** The figures of one step. */
export interface OverloadStep {
	/** Spheres drawn. */
	count: number;
	presentedFps: number;
	/** Null when no completion arrived. */
	completedFps: number | null;
	/** Medians, and the 95th percentile of the time from submit to completion, where measured. */
	gpuLatencyMs: { median: number; p95: number } | null;
	gpuMs: number | null;
	cpuMs: number;
	/**
	 * The refresh rate that the thread that draws measured from its frame callbacks. Where the
	 * browser slows those callbacks to the GPU's pace, it falls under load.
	 */
	refreshHz: number | null;
}

/** What the page reports. */
export type OverloadResult = {
	tier: string;
	/** The display's refresh rate: the rate measured at the lightest step, which judges the others. */
	displayHz: number | null;
	completionSignal: string;
	/** Each step, from the lightest. */
	steps: OverloadStep[];
	/**
	 * The longer measurement at the first step that overloaded the GPU, or at the count that
	 * ?spheres= fixes. Null when no step overloaded the GPU.
	 */
	overloaded: OverloadStep | null;
};

/**
 * Frames between a frame's submit and the GPU finishing it: the time from submit to completion in
 * completed frame intervals. Null without both figures.
 */
export function framesInFlight(step: OverloadStep): number | null {
	if (!step.gpuLatencyMs || !step.completedFps) return null;
	return (step.gpuLatencyMs.median * step.completedFps) / 1000;
}

/** True when the renderer presented frames faster than the GPU finished them. */
export function ratesParted(step: OverloadStep): boolean {
	return step.completedFps !== null && step.presentedFps > step.completedFps * (1 + PARTED_SHARE);
}
