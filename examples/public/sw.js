// The demos' offline cache. The page registers this worker in production builds. On every visit
// with a network it reads the build's file list, `null3d-files.json`, which the null3D Vite plugin
// writes beside the page: the files a page needs to start and the files of each feature. A changed
// build caches in one step and the worker deletes the old cache, so the next visit runs it.
//
// The demos' sample files, under /samples/, /sample-environments/ and /sample-textures/, are
// pinned by their own hashes and never change under an address, so they join the cache as they are
// fetched; a second visit draws them without a network.
const PREFIX = 'null3d-demos-';
const SAMPLES = /^\/(samples|sample-environments|sample-textures)\//;

self.addEventListener('install', (event) => {
	event.waitUntil(update().catch(() => {}));
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	// A visit asks the network first, so a new build is picked up at once, and falls back to the
	// cache when the network is gone.
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request)
				.then((answer) => {
					const copy = answer.clone();
					void caches.open(current()).then((cache) => cache.put('./', copy));
					return answer;
				})
				.catch(async () => (await caches.match('./')) ?? fetch(request)),
		);
		event.waitUntil(update().catch(() => {}));
		return;
	}
	// Build files carry a content hash, and the sample files are pinned, so both are safe to keep
	// forever under their addresses.
	const keep = url.pathname.includes('/assets/') || SAMPLES.test(url.pathname);
	if (!keep) return;
	event.respondWith(
		caches.match(request).then(
			(hit) =>
				hit ??
				fetch(request).then((answer) => {
					if (answer.ok) {
						const copy = answer.clone();
						void caches.open(current()).then((cache) => cache.put(request, copy));
					}
					return answer;
				}),
		),
	);
});

/** The name of the cache that holds the build the page last read. */
let named = '';
function current() {
	return named || PREFIX + 'live';
}

/** Caches the build that the server holds now, once, and deletes the caches of older builds. */
async function update() {
	const answer = await fetch('null3d-files.json', { cache: 'no-store' });
	if (!answer.ok) return;
	const list = await answer.json();
	const name = PREFIX + list.version;
	if (name === named) return;
	const cache = await caches.open(name);
	if (!(await cache.match('./'))) {
		const features = Object.values(list.features).flat();
		// Two features can name one file, such as a shared table of shader paragraphs, and a cache
		// refuses a list that names a file twice.
		await cache.addAll([...new Set(['./', ...list.start, ...features])]).catch(() => {});
	}
	named = name;
	for (const old of await caches.keys())
		if (old.startsWith(PREFIX) && old !== name && !old.endsWith('-samples'))
			await caches.delete(old);
}
