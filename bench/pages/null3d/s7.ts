// The page of the null3D version of S7; the scene runs in its sketch module. With
// ?memory-figures, it times the run and then reports the scene's own memory from the stats overlay,
// whose figures a timed run does not read: the engine's tables, the GPU's textures and buffers, the
// page's heap and the shared WebAssembly memory.
import { timedRun } from '../../../packages/cli/src/protocol.js';
import { overlayMemory, waitForOverlay } from '../../../tests/pages/lib/overlay-figures';
import { S7_COUNT } from '../../scenes/s7';
import { readRunOptions } from '../lib/options';
import { runNull3dPage } from './harness';

const params = new URLSearchParams(location.search);

runNull3dPage(
	's7',
	new URL('./s7-sketch.ts', import.meta.url),
	S7_COUNT,
	// The scene draws one surface, whatever count the page asks for.
	() => S7_COUNT,
	{
		measure: params.has('memory-figures')
			? async (engine) => {
					const { warmupSeconds, measureSeconds } = readRunOptions(params);
					const timed = await timedRun({ engine, warmupSeconds, measureSeconds });
					// The overlay shows after the timing, so its own sampling costs no measured frame.
					engine.stats(true);
					const ready = await waitForOverlay('triangles');
					const wasmBytes = (await engine.measure(0.5)).memory.wasmBytes;
					const memory = { ready, ...overlayMemory(wasmBytes) };
					engine.stats(false);
					return { ...timed, memory };
				}
			: undefined,
	},
);
