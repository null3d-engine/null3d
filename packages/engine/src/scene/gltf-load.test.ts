// The glTF loader's texture step, with a fake engine: a load whose textures fail part way frees
// what it made.

import { expect, test } from 'bun:test';
import { type GltfContext, makeTextures } from './gltf';
import type { GltfData, TextureUse } from './gltf-parse';

const use = (image: number): TextureUse => ({
	image,
	colorSpace: 'srgb',
	uvSet: 0,
	wrap: ['repeat', 'repeat'],
	filter: 'linear',
	mipmaps: true,
});

test('a texture that fails destroys the textures made before it and closes the unused bitmaps', async () => {
	const destroyed: number[] = [];
	const closed: number[] = [];
	let made = 0;
	const context = {
		textures: {
			fromImage: (bitmap: { id: number }) => {
				if (bitmap.id === 2) throw new Error('E1208: the image is too large');
				const id = ++made;
				return { id, destroy: () => destroyed.push(id) };
			},
		},
	} as unknown as GltfContext;
	const bitmaps = [1, 2, 3].map((id) => ({ id, close: () => closed.push(id) }));
	const data = { textures: [use(0), use(1), use(2)], images: [{}, {}, {}] } as unknown as GltfData;
	const loading = makeTextures(
		context,
		data,
		bitmaps as unknown as ImageBitmap[],
		new URL('https://example.com/model.glb'),
		'assets.loadGltf',
	);
	await expect(loading).rejects.toThrow('E1208');
	expect(destroyed.sort()).toEqual([1, 2]);
	expect(closed).toEqual([2]);
});
