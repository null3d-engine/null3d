// Mip levels that the GPU makes, for the image test of mip levels. A checkerboard of 8-texel
// squares draws smaller and smaller, with its mip levels in the top row and without them below:
// with them, squares too small to show fade to the gray of black and white averaged in linear
// color; without them, they break into a pattern of stray texels. At the bottom, the checkerboard
// covers two floors that recede from the camera, with a trilinear filter on the left and
// anisotropic filtering on the right, which keeps the squares sharp further along the floor.
import { defineSketch, type MeshArrays, type TextureOptions } from '@null3d/engine';
import { unlitMapMaterial } from '@null3d/engine/internal';

/** Texels on each side of the checkerboard, and of each of its squares. */
const SIZE = 256;
const SQUARE = 8;
/** The checkerboard's side in world units, halving from one to the next. */
const SIDES = [1.6, 0.8, 0.4, 0.2, 0.1];
const GAP = 0.3;

/** A square of side 1 facing the camera, centered on its origin. */
const QUAD: MeshArrays = {
	positions: [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	uvs: [0, 0, 1, 0, 1, 1, 0, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

/** A floor 2 wide and 9 deep that starts at its origin and runs away from the camera. */
const FLOOR: MeshArrays = {
	positions: [-1, 0, 0, 1, 0, 0, 1, 0, -9, -1, 0, -9],
	normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
	uvs: [0, 0, 1, 0, 1, 4.5, 0, 4.5],
	indices: [0, 1, 2, 0, 2, 3],
};

/** The checkerboard, made in code. */
function checkerboard(): Promise<ImageBitmap> {
	const data = new Uint8ClampedArray(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const value = (Math.floor(x / SQUARE) ^ Math.floor(y / SQUARE)) & 1 ? 255 : 0;
			data.set([value, value, value, 255], (y * SIZE + x) * 4);
		}
	return createImageBitmap(new ImageData(data, SIZE, SIZE), {
		premultiplyAlpha: 'none',
		colorSpaceConversion: 'none',
	});
}

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry, textures } = ctx;
	scene.setBackground('#1a2a3a');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.1,
		far: 100,
		position: [0, 0, 7],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const material = async (options: TextureOptions) =>
		unlitMapMaterial(materials, textures.fromImageBitmap(await checkerboard(), options));

	const quad = geometry.fromArrays(QUAD);
	const width = SIDES.reduce((sum, side) => sum + side, 0) + GAP * (SIDES.length - 1);
	const rows: [number, TextureOptions][] = [
		[1.9, {}],
		[0.15, { mipmaps: false }],
	];
	for (const [y, options] of rows) {
		const map = await material(options);
		let x = -width / 2;
		for (const side of SIDES) {
			x += side / 2;
			scene.createMesh({ mesh: quad, material: map, position: [x, y, 0], scale: [side, side, 1] });
			x += side / 2 + GAP;
		}
	}

	const floor = geometry.fromArrays(FLOOR);
	const floors: [number, TextureOptions][] = [
		[-1.3, { wrap: 'repeat' }],
		[1.3, { wrap: 'repeat', anisotropy: 16 }],
	];
	for (const [x, options] of floors)
		scene.createMesh({ mesh: floor, material: await material(options), position: [x, -1.5, 3] });
});
