// Reads the occlusion pages' figures (./occlusion.ts) from one `engine.measure`. It lives apart from
// the shared figures, which the device runner reads in Node without the engine's types.
import type { FrameSummary } from '@null3d/engine';
import type { OcclusionFigures } from './occlusion';

/** The figures of one measurement, as medians per frame, in the occlusion pages' form. */
export function occlusionFigures(stats: FrameSummary): OcclusionFigures {
	const { threads } = stats;
	let jobsMs = 0;
	for (const [name, thread] of Object.entries(threads))
		if (name.startsWith('job-')) jobsMs += thread.busyMs.median;
	const sketch = threads['sketch-worker'] ?? threads.main;
	return {
		cpuMs: stats.cpuMs.median,
		cpuMsAllThreads: stats.cpuMsAllThreads.median,
		sketchMs: sketch?.busyMs.median ?? null,
		cullMs: sketch?.phases.cull?.median ?? null,
		renderMs: threads['render-worker']?.busyMs.median ?? null,
		jobsMs,
		gpuMs: stats.gpuMs?.median ?? null,
		intervalMs: stats.intervalMs.median,
		drawCalls: stats.drawCalls.median,
		visibleEntries: stats.visibleEntries?.median ?? null,
		occludedEntries: stats.occludedEntries?.median ?? null,
	};
}
