// The files of the glTF loader, which a page downloads only when it loads a glTF file, and how many
// of a page's requests fetched each.
import type { Page } from '@playwright/test';

/** The files of the glTF loader, by their addresses on the dev server and in a production build. */
const GLTF_FILES: Record<string, RegExp> = {
	loader: /\/scene\/gltf\.ts$|\/gltf-[\w-]{8}\.js$/,
	worker: /\/gltf-worker(\.ts|-[\w-]{8}\.js)$/,
	meshopt: /\/scene\/gltf-meshopt\.ts$|\/gltf-meshopt-[\w-]{8}\.js$/,
	draco: /\/scene\/gltf-draco\.ts$|\/gltf-draco-[\w-]{8}\.js$/,
	dracoWasm: /\/draco_decoder_gltf(-[\w-]{8})?\.wasm$/,
};

/** Records the address of every request that the page and its workers make. */
export function recordRequests(page: Page): string[] {
	const urls: string[] = [];
	page.context().on('request', (request) => urls.push(new URL(request.url()).pathname));
	return urls;
}

/** How many of the requests fetched each file of the glTF loader. */
export function gltfDownloads(urls: readonly string[]): Record<string, number> {
	return Object.fromEntries(
		Object.entries(GLTF_FILES).map(([file, path]) => [
			file,
			urls.filter((url) => path.test(url)).length,
		]),
	);
}
