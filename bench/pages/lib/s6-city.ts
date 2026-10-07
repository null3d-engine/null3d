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
