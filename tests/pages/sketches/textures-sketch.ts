// Textures on the GPU, for the image test of textures. The top row shows one picture decoded from
// PNG, JPEG, WebP and AVIF files, then a gray ramp stored as sRGB, which draws as it is, and as
// linear data, which draws brighter. The bottom row shows the picture past its edges with each
// wrap mode, then a texture of 4 x 4 texels magnified with a nearest and a linear filter. Images
// decode with their first row at the bottom, as three.js flips them, so the picture stands upright.
// Every image reaches the thread that draws before the held frame, which uploads them all.
import { defineSketch, type MeshArrays } from '@null3d/engine';
import { type TextureOptions, texturesOf, unlitMapMaterial } from '@null3d/engine/internal';

const DECODE: ImageBitmapOptions = {
	imageOrientation: 'flipY',
	premultiplyAlpha: 'none',
	colorSpaceConversion: 'none',
};
const FORMATS = ['png', 'jpg', 'webp', 'avif'];

/**
 * A square of side 1.6 facing the camera, centered on its origin, with texture coordinates from
 * `low` at its lower left corner to `high` at its upper right corner.
 */
function square(low: number, high: number): MeshArrays {
	const s = 0.8;
	return {
		positions: [-s, -s, 0, s, -s, 0, s, s, 0, -s, s, 0],
		normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
		uvs: [low, low, high, low, high, high, low, high],
		indices: [0, 1, 2, 0, 2, 3],
	};
}

/** An image made in code, from each pixel's color. */
function made(
	width: number,
	height: number,
	color: (x: number, y: number) => readonly number[],
): Promise<ImageBitmap> {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) data.set([...color(x, y), 255], (y * width + x) * 4);
	return createImageBitmap(new ImageData(data, width, height), DECODE);
}

/** The test picture in the format of `extension`, decoded. */
async function picture(extension: string): Promise<ImageBitmap> {
	const response = await fetch(
		new URL(`../assets/textures/quadrants.${extension}`, import.meta.url),
	);
	return createImageBitmap(await response.blob(), DECODE);
}

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry } = ctx;
	const textures = texturesOf(ctx);
	scene.setBackground('#20242a');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.1,
		far: 50,
		position: [0, 0, 8.5],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	const plain = geometry.fromArrays(square(0, 1));
	const wide = geometry.fromArrays(square(-0.5, 1.5));
	const show = (
		image: ImageBitmap,
		x: number,
		y: number,
		options?: TextureOptions,
		mesh = plain,
	) => {
		const map = textures.fromImageBitmap(image, options);
		scene.createMesh({ mesh, material: unlitMapMaterial(materials, map), position: [x, y, 0] });
	};

	const decoded = await Promise.all(FORMATS.map(picture));
	for (const [k, image] of decoded.entries()) show(image, -5 + k * 2, 1);
	const ramp = (x: number) => {
		const value = Math.round((x * 255) / 63);
		return [value, value, value];
	};
	show(await made(64, 8, ramp), 3, 1);
	show(await made(64, 8, ramp), 5, 1, { colorSpace: 'linear' });

	for (const [k, wrap] of (['repeat', 'clamp', 'mirror'] as const).entries())
		show(await picture('png'), -5 + k * 2, -1, { wrap }, wide);
	const tiny = (x: number, y: number) => [40 + x * 70, 40 + y * 70, 220 - x * 50];
	const flat = { mipmaps: false } as const;
	show(await made(4, 4, tiny), 1, -1, { ...flat, magFilter: 'nearest', minFilter: 'nearest' });
	show(await made(4, 4, tiny), 3, -1, flat);
	// A white map times the material's color: the square draws in the material's gray.
	const tinted = textures.fromImageBitmap(await made(2, 2, () => [255, 255, 255]), flat);
	const material = unlitMapMaterial(materials, tinted, { color: '#aaaaaa' });
	scene.createMesh({ mesh: plain, material, position: [5, -1, 0] });
});
