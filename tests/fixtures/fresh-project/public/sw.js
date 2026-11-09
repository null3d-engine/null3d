// The fresh project's service worker, as the hosting guide shows it: it caches the page and the
// build's files that the game uses, so the game plays with no network after its first visit.
//
// The page preloads the sprite shaders, and the preset draws screen-space bounce light from its
// first frame. The light reads the depth and the normals of ambient occlusion's steps, and the
// copy of the scene color, so the cache holds those features' files too, and the preset's GPU
// occlusion culling's. A feature that this list leaves out costs the game nothing, because its files
// stay out of the cache.
const FEATURES = ['sprites', 'ao', 'color_copy', 'occlusion'];
const PREFIX = 'game-';

self.addEventListener('install', (event) => event.waitUntil(update()));

self.addEventListener('fetch', (event) => {
	if (event.request.mode === 'navigate') event.waitUntil(update().catch(() => {}));
	event.respondWith(
		caches.match(event.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(event.request)),
	);
});

/** Caches the build that the server holds now, once, and deletes the caches of older builds. */
async function update() {
	const list = await (await fetch('null3d-files.json', { cache: 'no-store' })).json();
	const name = PREFIX + list.version;
	const cache = await caches.open(name);
	if (await cache.match('./')) return;
	const features = FEATURES.flatMap((feature) => list.features[feature]);
	// Two features can name one file, such as a shared table of shader paragraphs, and a cache
	// refuses a list that names a file twice.
	await cache.addAll([...new Set(['./', ...list.start, ...features])]);
	for (const old of await caches.keys())
		if (old.startsWith(PREFIX) && old !== name) await caches.delete(old);
}
