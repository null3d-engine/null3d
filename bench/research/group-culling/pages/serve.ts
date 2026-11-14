// Serves the desert and Bistro pages from this folder, null3D's CDN build under /cdn/, three.js r187
// under /three/ and the model files under /models/, both from target/group-culling. Every response
// carries the isolation headers, so null3D runs its threaded build, and a CORS header, which its
// module imports need.
import { existsSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

const root = join(import.meta.dirname, '../../../..');
// The large files stay out of git: three.js's build and the models live in target/group-culling.
const here = join(root, 'target/group-culling');
// MESHLETS_CDN names another checkout's CDN build, so an engine change can be timed against the
// same scene and pages.
const MOUNTS: [string, string][] = [
	['/cdn/', process.env.MESHLETS_CDN ?? join(root, 'target/cdn')],
	['/three/', join(here, 'three/package')],
	['/models/', join(here, 'models')],
	['/', import.meta.dirname],
];
// The production build of the Island's measuring page (tests/pages/island-view.html) names its
// files from the site's root, so a path that this folder lacks is looked up in that build.
const island = join(here, 'island-page');
const port = Number(process.env.MESHLETS_PORT ?? 6490);

Bun.serve({
	port,
	fetch(request) {
		const path = decodeURIComponent(new URL(request.url).pathname);
		// The test pages post their report to the repository's collector, and the browser asks for an
		// icon; neither has a file here, and a page whose request fails counts as invalid.
		if (path.startsWith('/__null3d/') || path === '/favicon.ico')
			return new Response(null, { status: 204 });
		const [prefix, base] = MOUNTS.find(([p]) => path.startsWith(p)) ?? MOUNTS[MOUNTS.length - 1];
		let folder = base;
		let file = normalize(join(folder, path.slice(prefix.length) || 'index.html'));
		if (prefix === '/' && !existsSync(file)) {
			folder = island;
			file = normalize(join(folder, path));
		}
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
