// The addresses of S6's two model files: the city's kit models and its towers, which
// bench/lib/city-files.ts builds from the sample content's layout, optimized by the asset tool as a
// developer ships a model. The null3D plugin optimizes each on its first import and keeps the
// result in its cache; a build writes them with the pages. The scene module stays free of imports
// that only Vite resolves, so the unit tests can load it; pages take the addresses here.
import kit from '/s6-city/kit.gltf?optimized';
import towers from '/s6-city/towers.gltf?optimized';

/** The optimized kit file's address, for null3D's `assets.loadGltf` and three.js's `GLTFLoader`. */
export const S6_KIT_URL: string = kit;

/** The optimized tower file's address. */
export const S6_TOWERS_URL: string = towers;

/** A downloaded file of code, which the load's figures leave out: the engines' own files. */
const CODE = /\.(m?js|wasm|css|html)(\?|#|$)/;

/**
 * The bytes of content that this thread downloaded, from its resource timings: the scene's files
 * and none of the engine's code. Each engine fetches the scene's files on one thread: null3D on
 * the sketch's, and three.js on the page's.
 */
export function loadedBytes(): number {
	let bytes = 0;
	for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[])
		if (!CODE.test(entry.name)) bytes += entry.encodedBodySize;
	return bytes;
}
