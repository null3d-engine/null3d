// What a test that times GPU work starts its browser with: the Mac's own GPU, or the run's own
// browser for a test that also runs on the software GPU, and the flags that open WebGPU's developer
// features and turn off Dawn's timestamp quantization. A rounded timestamp hides a cost of a few
// hundredths of a millisecond, so one shared launch keeps every cost's figure at the timer's step.
import {
	browserOptions,
	defaultEnvironment,
	GPU_TIMING_ARGS,
} from '../../packages/cli/src/browser.js';

/** The places that draw frames, as the browser launcher names them. */
type Environment = Parameters<typeof browserOptions>[0];

/**
 * The launch options of a test that times GPU work, in `environment`: that browser's own flags, and
 * the flags that make its GPU timestamps exact.
 */
export function timingBrowser(environment: Environment = 'chrome-real-gpu') {
	const options = browserOptions(environment);
	return { launchOptions: { ...options, args: [...(options.args ?? []), ...GPU_TIMING_ARGS] } };
}

/** The launch of a cost test, which needs a computer with a GPU of its own. */
export const TIMING_BROWSER = timingBrowser();

/** The launch of a timing test in the run's own browser, which CI makes the software GPU. */
export const TIMING_BROWSER_IN_RUN = timingBrowser(defaultEnvironment());
