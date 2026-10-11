// The page of the null3d version of S6; the scene runs in its sketch module. It fills the window at
// the preset's pixel ratio and records a trace of each second, as S4's page does. It turns GPU
// occlusion culling on, so WebGPU skips what the buildings hide, as the job workers do on WebGL2;
// the engine's `?occlusion=off` switch turns both methods off. It asks the engine for room for the
// whole city's objects at its start. It binds the labels that the sketch
// tracks, and waits for the city to stream in before a timed run warms up. The report gives the
// load: milliseconds from the page's start to the first frame and to the whole city, the sketch's
// seconds for each stage, and the bytes that the sketch's thread downloaded. With
// `?occlusion-turns`, it runs the occlusion turns of T-36 in place of the timed run
// (../lib/s6-occlusion.ts).
import type { Engine } from '@null3d/engine';
import { S6_ENGINE_OBJECTS, S6_FULL_COUNT, S6_MESSAGES, S6_PICKED_LABEL } from '../../scenes/s6';
import { labelLayer, labelTag, pickedText } from '../lib/s6-labels';
import { occlusionTurns } from '../lib/s6-occlusion';
import { runNull3dPage } from './harness';

const params = new URLSearchParams(location.search);

runNull3dPage('s6', new URL('./s6-sketch.ts', import.meta.url), S6_FULL_COUNT, undefined, {
	fillWindow: true,
	trace: true,
	engine: { gpuOcclusion: true, expectedObjects: S6_ENGINE_OBJECTS },
	started: watchCity,
	measure: (engine, log) =>
		params.has('occlusion-turns') ? occlusionTurns(engine, params, log) : undefined,
});

/** Binds the sketch's labels, and resolves with the load's figures once the city is whole. */
function watchCity(engine: Engine): Promise<Record<string, unknown>> {
	const canvas = document.querySelector('canvas') as HTMLCanvasElement;
	let firstFrameMs = 0;
	engine.firstFrame.then(() => {
		firstFrameMs = performance.now();
	});
	return new Promise((resolve) => {
		let picked: HTMLElement | undefined;
		engine.onSketchMessage((type, data) => {
			if (type === S6_MESSAGES.labels) {
				const layer = labelLayer(canvas);
				for (const { id, text } of data as { id: string; text: string }[]) {
					const tag = labelTag(layer, text);
					if (id === S6_PICKED_LABEL) picked = tag;
					engine.labels.bind(id, tag);
				}
			} else if (type === S6_MESSAGES.picked) {
				if (picked) picked.textContent = pickedText(data as number);
			} else if (type === S6_MESSAGES.loaded) {
				resolve({ load: { firstFrameMs, wholeMs: performance.now(), sketch: data } });
			}
		});
	});
}
