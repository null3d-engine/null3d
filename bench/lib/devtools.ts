// The client of Chrome's debugging protocol, which the benchmarks and the command-line add-on check
// share: its one implementation lives in the command-line package, and this module adds the phone's
// entry, which forwards the phone's debugging socket to a local port first.
import { DevTools } from '../../packages/cli/src/devtools.js';
import { forwardDevTools, startBrowser } from '../../tests/lib/adb.ts';

export type { Attached, AttachedWorker, TargetInfo } from '../../packages/cli/src/devtools.js';
export {
	attachEveryWorker,
	attachWorkers,
	closePagesAt,
	DevTools,
	evaluate,
	freePort,
	HeapSampler,
	limitWorkerNetworks,
	pageResultOf,
	pagesAt,
	sleep,
	wasmMemoryBytes,
	within,
} from '../../packages/cli/src/devtools.js';
export type { CallFrame } from '../../packages/cli/src/heap-profile.js';
export { placeName } from '../../packages/cli/src/heap-profile.js';

/**
 * Connects to Chrome on the phone connected by USB, through its debugging socket, which adb forwards
 * to `port` on this computer. Chrome has the socket only while it runs, so this starts Chrome first.
 */
export function connectPhoneChrome(port: number): Promise<DevTools> {
	forwardDevTools(port);
	startBrowser('chrome');
	return DevTools.connect(port);
}
