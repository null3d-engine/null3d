// One quad fills the canvas with a single image texture, for the map-after-GPU-loss test. The map
// is magenta and the material's color is white, so a test that reads the frame's middle pixel tells
// the map from the material's color alone by the green channel: the map draws low green, and the
// fallback draws white.
import { defineSketch } from '@null3d/engine';

/** Texels on each side of the map. */
const SIZE = 8;
/** The map's color, one texel after another: magenta. */
const MAP_COLOR = [255, 0, 255, 255];

/** The map's image: one solid color, made in code so the page needs no asset file. */
function image(): Promise<ImageBitmap> {
	const data = new Uint8ClampedArray(SIZE * SIZE * 4);
	for (let texel = 0; texel < SIZE * SIZE; texel++) data.set(MAP_COLOR, texel * 4);
	return createImageBitmap(new ImageData(data, SIZE, SIZE), {
		premultiplyAlpha: 'none',
		colorSpaceConversion: 'none',
	});
}

export default defineSketch(async ({ scene, materials, geometry, textures, quality }) => {
	quality.set({ minRenderScale: 1, maxRenderScale: 1 });
	scene.setBackground('#000000');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 45,
			near: 0.1,
			far: 10,
			position: [0, 0, 2],
			target: [0, 0, 0],
		}),
	);
	const map = textures.fromImageBitmap(await image(), { mipmaps: false });
	scene.createMesh({
		mesh: geometry.plane({ width: 4, height: 4 }),
		material: materials.unlit({ color: '#ffffff', map }),
	});
});
