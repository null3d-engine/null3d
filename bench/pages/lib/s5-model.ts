// The address of S5's character model: the KayKit Knight of the sample content, optimized by the
// asset tool, as a developer ships a model. The null3D plugin optimizes it on its first import and
// keeps the result in its cache; a build writes it with the pages. The scene module stays free of
// imports that only Vite resolves, so the unit tests can load it; pages take the address here.
import knight from '/samples/sources/characters/kaykit-knight/Knight.glb?optimized';

/** The optimized Knight's address, for null3D's `assets.loadGltf` and three.js's `GLTFLoader`. */
export const S5_MODEL_URL: string = knight;
