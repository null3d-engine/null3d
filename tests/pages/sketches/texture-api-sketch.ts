// The texture calls of a sketch, for the image test of the texture API. The top row shows the test
// picture loaded as three.js's TextureLoader loads it, then loaded without the flip, so it stands
// on its head, then decoded by loadImageBitmap and made by fromImageBitmap, which must match the
// first. Then a checkerboard of 4 x 4 texels from bytes, a ramp of half floats whose last texel is
// brighter than white, and a map destroyed before the frame, which leaves the material's gray. The
// bottom row shows sRGB data of 1 x 1 texel that took the picture's size, linear data of 2 x 2
// texels that took new texels, the first of three layers, and a picture drawn in the sketch with
// see-through quarters, stored with its colors multiplied by alpha, which darkens them, and
// without. Linear data draws brighter than the same bytes in sRGB.
import { defineSketch, type MeshArrays, type Texture } from '@null3d/engine';
import { unlitMapMaterial } from '@null3d/engine/internal';

/** A square of side 1.6 facing the camera, with texture coordinates from 0 to 1. */
const SQUARE: MeshArrays = {
	positions: [-0.8, -0.8, 0, 0.8, -0.8, 0, 0.8, 0.8, 0, -0.8, 0.8, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	uvs: [0, 0, 1, 0, 1, 1, 0, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

const PICTURE = 'assets/textures/quadrants.png';

/** Bytes of RGBA8 texels from one color per texel, as 0 to 255 components. */
const texels = (colors: number[][]) => Uint8Array.from(colors.flat());

/** A PNG file of four quarters: red, green, blue and white, each with its own alpha. */
async function seeThrough(): Promise<string> {
	const canvas = new OffscreenCanvas(2, 2);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('no 2D context');
	const quarters = [
		'rgba(255,0,0,1)',
		'rgba(0,255,0,0.5)',
		'rgba(0,0,255,0.25)',
		'rgba(255,255,255,0.5)',
	];
	for (const [k, color] of quarters.entries()) {
		context.fillStyle = color;
		context.fillRect(k % 2, Math.floor(k / 2), 1, 1);
	}
	return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

export default defineSketch(async ({ scene, materials, geometry, textures, assets }) => {
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
	const show = (map: Texture, column: number, row: number, color = '#ffffff') =>
		scene.createMesh({
			mesh: square,
			material: unlitMapMaterial(materials, map, { color }),
			position: [-5 + column * 2, row === 0 ? 1 : -1, 0],
		});

	show(await assets.loadTexture(PICTURE), 0, 0);
	show(await assets.loadTexture(PICTURE, { flipY: false }), 1, 0);
	show(textures.fromImageBitmap(await assets.loadImageBitmap(PICTURE)), 2, 0);
	const [dark, light] = [
		[30, 60, 120, 255],
		[240, 200, 80, 255],
	];
	const checker = Array.from({ length: 16 }, (_, k) => ((k + (k >> 2)) & 1 ? light : dark));
	show(
		textures.fromData({
			width: 4,
			height: 4,
			data: texels(checker),
			colorSpace: 'srgb',
			filter: 'nearest',
		}),
		3,
		0,
	);
	const ramp = [0.02, 0.2, 0.6, 3].flatMap((value) => [value, value * 0.5, 0.1, 1]);
	show(
		textures.fromData({
			width: 4,
			height: 1,
			format: 'rgba16float',
			data: new Float32Array(ramp),
			filter: 'nearest',
		}),
		4,
		0,
	);
	const gone = textures.fromData({ width: 1, height: 1, data: texels([[255, 0, 0, 255]]) });
	show(gone, 5, 0, '#888888');
	gone.destroy();

	const resized = textures.fromData({
		width: 1,
		height: 1,
		data: texels([[255, 0, 255, 255]]),
		colorSpace: 'srgb',
	});
	resized.update(await assets.loadImageBitmap(PICTURE));
	show(resized, 0, 1);
	const updated = textures.fromData({
		width: 2,
		height: 2,
		data: new Uint8Array(16),
		filter: 'nearest',
	});
	updated.update(
		texels([
			[255, 80, 0, 255],
			[0, 200, 120, 255],
			[60, 60, 255, 255],
			[255, 255, 255, 255],
		]),
	);
	show(updated, 1, 1);
	const layers = [
		[0, 170, 170, 255],
		[255, 0, 0, 255],
		[255, 255, 0, 255],
	];
	show(textures.fromData({ width: 1, height: 1, depth: 3, data: texels(layers) }), 2, 1);
	const drawn = await seeThrough();
	const nearest = { filter: 'nearest', mipmaps: false } as const;
	show(await assets.loadTexture(drawn, { ...nearest, premultipliedAlpha: true }), 3, 1);
	show(await assets.loadTexture(drawn, nearest), 4, 1);
	URL.revokeObjectURL(drawn);
});
