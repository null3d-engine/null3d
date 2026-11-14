// The page of the null3D side of the desert; the scene runs in its sketch module. The engine starts
// at the Medium preset with MSAA and GPU occlusion culling, whose check during play keeps its passes
// only while they pay. The engine's own switches, such as `?preset=high`, `?occlusion=off` or
// `?direct=off`, change those. After the timed run the page reads back a frame, whose size is the
// size that the engine drew at, and reports it with the desert's figures.
import { timedRun } from '../../../packages/cli/src/protocol.js';
import { DESERT_CANVAS, DESERT_COUNT, readDesertView } from '../../scenes/desert';
import type { DesertFigures } from '../lib/desert';
import { readRunOptions } from '../lib/options';
import { runNull3dPage } from './harness';

const params = new URLSearchParams(location.search);

runNull3dPage(
	'desert',
	new URL('./desert-sketch.ts', import.meta.url),
	DESERT_COUNT,
	// The scene draws its whole layout, whatever count the page asks for.
	() => DESERT_COUNT,
	{
		canvas: DESERT_CANVAS,
		// The scene's large files need more than the default memory.
		engine: {
			preset: 'medium',
			antialias: 'msaa',
			gpuOcclusion: true,
			memory: { maximumMiB: 4096 },
		},
		measure: async (engine) => {
			const firstFrameMs = performance.now();
			const options = readRunOptions(params);
			const timed = await timedRun({ engine, ...options });
			const frame = await engine.captureFrame();
			// The protocol's run keeps the engine's whole measurement, which its own type names in part.
			const stats = timed.stats as unknown as Awaited<ReturnType<typeof engine.measure>>;
			const desert: DesertFigures = {
				engine: 'null3d',
				view: readDesertView(params),
				shadows: options.shadows,
				drawn: { width: frame.width, height: frame.height },
				intervalMs: stats.intervalMs.median,
				gpuMs: stats.gpuMs?.median ?? null,
				triangles: stats.triangles.median,
				drawCalls: stats.drawCalls.median,
				firstFrameMs,
				settings: {
					preset: engine.mode.preset,
					directDraws: engine.capabilities.directDraws,
					occludedEntries: stats.occludedEntries?.median ?? null,
				},
			};
			return { ...timed, desert };
		},
	},
);
