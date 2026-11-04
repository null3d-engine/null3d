// Serves the desert comparison: the two pages and the scene module from this folder, null3D's CDN
// build under /cdn/, three.js r187 under /three/ and the model files under /models/. Every response
// carries the isolation headers, so null3D runs its threaded build, and a CORS header, which its
// module imports need.
import { existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

const root = join(import.meta.dirname, '../..');
// MESHLETS_CDN names another checkout's CDN build, so an engine change can be timed against the
// same scene and pages.
const MOUNTS: [string, string][] = [
	['/cdn/', process.env.MESHLETS_CDN ?? join(root, 'target/cdn')],
	['/three/', join(root, 'target/meshlets/three/package')],
	['/models/', join(root, 'target/meshlets')],
	['/', import.meta.dirname],
];
const port = Number(process.env.MESHLETS_PORT ?? 6390);

Bun.serve({
	port,
	fetch(request) {
		const path = decodeURIComponent(new URL(request.url).pathname);
		const [prefix, folder] = MOUNTS.find(([p]) => path.startsWith(p)) ?? MOUNTS[MOUNTS.length - 1];
		const file = normalize(join(folder, path.slice(prefix.length) || 'index.html'));
		if (!file.startsWith(folder) || !existsSync(file) || statSync(file).isDirectory()) {
			return new Response('not found', { status: 404 });
		}
		return new Response(Bun.file(file), {
			headers: {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp',
				'Cross-Origin-Resource-Policy': 'cross-origin',
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'no-cache',
			},
		});
	},
});
console.log(`desert comparison on http://localhost:${port}/`);
