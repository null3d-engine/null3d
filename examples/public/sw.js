// A service worker that removes itself. The examples page registers no service worker, and the demos
// keep no offline cache. A browser keeps a registered worker until a new script replaces it at the
// same address, and it fetches that script again when a visit starts. So a browser that holds a
// registration of this address gets this script, which deletes the demos' caches, the caches whose
// names start with `null3d-demos-`, and unregisters itself. It has no fetch handler, so every
// request goes to the network as it is. The engine's own caches have other names and stay.
const PREFIX = 'null3d-demos-';

self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const name of await caches.keys())
				if (name.startsWith(PREFIX)) await caches.delete(name);
			await self.registration.unregister();
		})(),
	);
});
