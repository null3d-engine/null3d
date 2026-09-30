// KTX2 textures, for the image test of KTX2 files. The test picture has four quarters, each a
// checkerboard of 4-texel squares: red at the top left, green at the top right, blue at the bottom
// left and white at the bottom right. basisu 2.50 encoded it flipped (-y_flip), so each file
// stands upright on a square as the PNG does, in ETC1S and in UASTC with a half transparent white
// quarter. The transcoder turns each into the compressed format that the device supports.
//
// The top row shows the PNG, then the ETC1S file large, smaller and tiny, where its mip levels
// blend each quarter's squares into one color, and tiny without mip levels, where stray texels
// show. The bottom row shows the UASTC file large and tiny, then read as linear, which brightens
// it, and a linear ramp of 30 x 20 texels, which no compressed format takes, large and tiny.
import { defineSketch, type MeshArrays, type Texture } from '@null3d/engine';
import { unlitMapMaterial } from '@null3d/engine/internal';

/** A square of side 1.6 facing the camera, with texture coordinates from 0 to 1. */
const SQUARE: MeshArrays = {
	positions: [-0.8, -0.8, 0, 0.8, -0.8, 0, 0.8, 0.8, 0, -0.8, 0.8, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	uvs: [0, 0, 1, 0, 1, 1, 0, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

const TEXTURES = 'assets/textures';

/** The scales that show a texture large, smaller and so small that its smallest levels draw. */
const LARGE = 1;
const SMALLER = 0.4;
const TINY = 0.12;

export default defineSketch(async ({ scene, materials, geometry, assets }) => {
	scene.setBackground('#20242a');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.1,
		far: 50,
		position: [0, 0, 8.5],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const square = geometry.fromArrays(SQUARE);
	const show = (map: Texture, column: number, row: number, scale: number) =>
		scene.createMesh({
			mesh: square,
			material: unlitMapMaterial(materials, map),
			position: [-4 + column * 2, row === 0 ? 1 : -1, 0],
			scale: [scale, scale, scale],
		});

	const [png, etc1s, flat, uastc, linear, ramp] = await Promise.all([
		assets.loadTexture(`${TEXTURES}/quarters.png`),
		assets.loadTexture(`${TEXTURES}/quarters-etc1s.ktx2`),
		assets.loadTexture(`${TEXTURES}/quarters-etc1s.ktx2`, { mipmaps: false }),
		assets.loadTexture(`${TEXTURES}/quarters-uastc.ktx2`),
		assets.loadTexture(`${TEXTURES}/quarters-uastc.ktx2`, { colorSpace: 'linear' }),
		assets.loadTexture(`${TEXTURES}/ramp-uastc.ktx2`, { filter: 'nearest' }),
	]);
	show(png, 0, 0, LARGE);
	show(etc1s, 1, 0, LARGE);
	show(etc1s, 2, 0, SMALLER);
	show(etc1s, 3, 0, TINY);
	show(flat, 4, 0, TINY);
	show(uastc, 0, 1, LARGE);
	show(uastc, 1, 1, TINY);
	show(linear, 2, 1, LARGE);
	show(ramp, 3, 1, LARGE);
	show(ramp, 4, 1, TINY);
});
