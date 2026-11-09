// Measures what the browser offers a cache of derived data across visits: the storage allowance
// that it reports for the origin, whether it keeps the origin's storage as persistent, and how fast
// each of its stores writes and reads blocks of 1, 10 and 100 MiB from a worker. The page asks for
// persistent storage, which Firefox answers with a prompt, so it waits only a few seconds for the
// answer. ?stores= names the stores to time, such as cache,idb; all of them by default.
import { progress, run } from './lib/result';

const ALL_STORES = ['cache', 'idb', 'idb-blob', 'opfs-sync', 'opfs'];
/** How long the page waits for the answer to its request for persistent storage. */
const PERSIST_WAIT_MS = 3000;

const params = new URLSearchParams(location.search);
const stores = params.get('stores')?.split(',') ?? ALL_STORES;

/** The answer to a request for persistent storage, or `no answer` when a prompt holds it. */
async function askPersist(): Promise<boolean | 'no answer' | string> {
	if (!navigator.storage?.persist) return 'no call';
	try {
		return await Promise.race([
			navigator.storage.persist(),
			new Promise<'no answer'>((resolve) =>
				setTimeout(() => resolve('no answer'), PERSIST_WAIT_MS),
			),
		]);
	} catch (thrown) {
		return String(thrown);
	}
}

run('storage-speed', async () => {
	const persistedBefore = await navigator.storage?.persisted?.().catch(String);
	progress('asking for persistent storage');
	const persist = await askPersist();
	const persistedAfter = await navigator.storage?.persisted?.().catch(String);
	const worker = new Worker(new URL('./storage-speed-worker.ts', import.meta.url), {
		type: 'module',
	});
	const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
		worker.onmessage = ({ data }) => {
			if (data.step) progress(data.step);
			else if (data.error) reject(new Error(data.error));
			else resolve(data.result);
		};
		worker.onerror = (event) => reject(new Error(event.message || 'the worker did not start'));
		worker.postMessage({ stores });
	});
	worker.terminate();
	const status = document.getElementById('status');
	if (status) status.textContent = JSON.stringify(result, null, 1);
	return {
		userAgent: navigator.userAgent,
		deviceMemory: (navigator as { deviceMemory?: number }).deviceMemory,
		persistedBefore,
		persist,
		persistedAfter,
		...result,
	};
});
