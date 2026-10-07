// A KTX2 file of UASTC HDR data, for the image test of HDR textures. The file holds 64 x 64
// texels in four quarters of 4-texel checkerboards, with linear values from 1/16 to 16: red at the
// top left, green at the top right, blue at the bottom left and grey to bright white at the bottom
// right. Basis Universal 2.50's encoder (the asset tool's copy) wrote it from 32-bit floats with
// every mip level, rows from the bottom up. The device takes it as BC6H, or as shared-exponent
// floats without BC formats.
//
// The left square shows the same values as half floats made in code, which the file's square
// beside it must match. Then the file's square smaller, where its mip levels blend each quarter's
// squares, and tiny. AgX tone mapping shows the values above 1.
import { defineSketch, type MeshArrays, type Texture } from '@null3d/engine';

/** A square of side 1.6 facing the camera, with texture coordinates from 0 to 1. */
const SQUARE: MeshArrays = {
	positions: [-0.8, -0.8, 0, 0.8, -0.8, 0, 0.8, 0.8, 0, -0.8, 0.8, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	uvs: [0, 0, 1, 0, 1, 1, 0, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

const SIZE = 64;

/** Each quarter's light squares, then its dark squares, in linear values. */
const QUARTERS = {
	topLeft: [
		[4, 0.25, 0.25],
		[1, 0.0625, 0.0625],
	],
	topRight: [
		[0.25, 4, 0.25],
		[0.0625, 1, 0.0625],
	],
	bottomLeft: [
		[0.25, 0.25, 4],
		[0.0625, 0.0625, 1],
	],
	bottomRight: [
		[16, 16, 16],
		[0.5, 0.5, 0.5],
	],
} as const;

/** The file's texels as 32-bit floats, first row at the bottom, as the encoder took them. */
function texels(): Float32Array {
	const data = new Float32Array(SIZE * SIZE * 4);
	for (let row = 0; row < SIZE; row++)
		for (let x = 0; x < SIZE; x++) {
			const top = row >= SIZE / 2;
			const left = x < SIZE / 2;
			const quarter = top
				? left
					? QUARTERS.topLeft
					: QUARTERS.topRight
				: left
					? QUARTERS.bottomLeft
					: QUARTERS.bottomRight;
			const light = (Math.floor(x / 4) + Math.floor(row / 4)) % 2 === 0;
			data.set([...quarter[light ? 0 : 1], 1], (row * SIZE + x) * 4);
		}
	return data;
}

export default defineSketch(async ({ scene, materials, geometry, assets, textures, post }) => {
	post.set({ toneMapping: 'agx' });
	scene.setBackground('#20242a');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 45, near: 0.1, far: 50, position: [0, 0, 6] }),
	);
	const square = geometry.fromArrays(SQUARE);
	const show = (map: Texture, x: number, scale: number) =>
		scene.createMesh({
			mesh: square,
			material: materials.unlit({ map }),
			position: [x, 0, 0],
			scale: [scale, scale, scale],
		});
	const data = textures.fromData({
		width: SIZE,
		height: SIZE,
		format: 'rgba16float',
		data: texels(),
	});
	const file = await assets.loadTexture(
		new URL('../assets/textures/quarters-hdr.ktx2', import.meta.url),
	);
	show(data, -2.7, 1);
	show(file, -0.9, 1);
	show(file, 0.9, 0.4);
	show(file, 2.1, 0.12);
});
