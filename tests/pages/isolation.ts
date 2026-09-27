// Checks that the page is cross-origin isolated and that the threaded WebAssembly build loads with
// shared memory. Open it in any browser; the result also goes to the dev server's collector.
import initThreaded, { isThreadedBuild } from '@sokko3d/engine/wasm/threaded/sokko3d.js';
import { run } from './lib/result';

/** Initial and maximum sizes, in 64 KB pages, of the shared memory this check creates. */
const INITIAL_PAGES = 18;
const MAXIMUM_PAGES = 16384;

run('isolation', async () => {
	const isolated = globalThis.crossOriginIsolated === true;
	let threaded = false;
	if (isolated) {
		const memory = new WebAssembly.Memory({
			initial: INITIAL_PAGES,
			maximum: MAXIMUM_PAGES,
			shared: true,
		});
		await initThreaded({ memory });
		threaded = isThreadedBuild();
	}
	return {
		crossOriginIsolated: isolated,
		sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
		threaded,
	};
});
