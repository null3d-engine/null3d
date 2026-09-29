// Runs a benchmark scene's shared per-frame code alone, with no engine: the motion and the camera
// path that every engine's version of the scene runs each frame, writing into plain arrays. It warms
// up and measures like the engines' pages and publishes the time per frame, which the benchmark
// report takes away from each engine's busiest thread to show the engine's own work.
import { run } from '../../../tests/pages/lib/result';
import { MEASURE_SECONDS, WARMUP_SECONDS } from '../../scenes/spec';
import { showPageName } from '../lib/fit';
import { measureFrames } from '../lib/measure';
import { pageReport, type RunOptions, readRunOptions } from '../lib/options';

export interface SceneCode {
	/** The object count that the report gives. */
	n: number;
	/** Runs the scene's shared code for time t, in seconds. It allocates nothing. */
	frame(t: number): void;
}

/** Times the shared code that `build` makes for the scene `sceneName`, and publishes the result. */
export function runSceneCodePage(
	sceneName: string,
	build: (options: RunOptions) => SceneCode,
): void {
	const params = new URLSearchParams(location.search);
	showPageName();
	run(pageReport(params), async () => {
		const options = readRunOptions(params);
		if (options.hold !== null || options.demo) {
			throw new Error('A scene-code page draws nothing: remove ?hold and ?demo from the address.');
		}
		const code = build(options);
		const timings = await measureFrames(
			(t) => {
				code.frame(t);
				return undefined;
			},
			options.seconds ?? WARMUP_SECONDS,
			options.seconds ?? MEASURE_SECONDS,
		);
		return { scene: sceneName, renderer: 'scene-code', n: code.n, ...timings };
	});
}
