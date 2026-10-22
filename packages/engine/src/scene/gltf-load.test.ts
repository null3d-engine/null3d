// The glTF loader's texture step and its levels, with a fake engine: a load whose textures fail
// part way frees what it made, and a level whose primitive names its base's accessors shares the
// base's vertices.

import { expect, test } from 'bun:test';
import { type GltfContext, makeTextures, sharesVertices } from './gltf';
import type { GltfData, PrimitiveData, TextureUse } from './gltf-parse';

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

/** The accessors that a primitive of four vertices names, as the parser reads them. */
const ACCESSORS: Readonly<Record<string, number>> = {
	POSITION: 4,
	NORMAL: 5,
	TEXCOORD_0: 6,
};

/** A primitive of four vertices that reads `accessors`, by glTF name. */
function primitive(
	accessors: Readonly<Record<string, number>> = ACCESSORS,
	over: Partial<PrimitiveData> = {},
): PrimitiveData {
	return {
		accessors,
		positions: { array: new Float32Array(12), normalized: false },
		normals: { array: new Float32Array(12), normalized: false },
		uvs: { array: new Float32Array(8), normalized: false },
		indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
		material: -1,
		min: [0, 0, 0],
		max: [1, 1, 0],
		...over,
	};
}

test("a level shares its base mesh's vertices when every attribute names the base's accessor", () => {
	expect(sharesVertices(primitive(), primitive())).toBe(true);
});

test('a level copies its vertices when any attribute names another accessor', () => {
	const base = primitive();
	// Its own positions, as a level of cards has.
	expect(sharesVertices(primitive({ ...ACCESSORS, POSITION: 40 }), base)).toBe(false);
	// Its own normals.
	expect(sharesVertices(primitive({ ...ACCESSORS, NORMAL: 41 }), base)).toBe(false);
	// An attribute that the base lacks.
	expect(sharesVertices(primitive({ POSITION: 4, NORMAL: 5 }), base)).toBe(false);
	// An attribute that the level lacks.
	expect(sharesVertices(base, primitive({ POSITION: 4, NORMAL: 5 }))).toBe(false);
	// Draco's own ids: no primitive's accessor, and no sharing.
	const draco = { accessors: undefined };
	expect(sharesVertices(primitive(ACCESSORS, draco), primitive(ACCESSORS, draco))).toBe(false);
});

test('a level copies its vertices when its base morphs, skins or has no indices', () => {
	const base = primitive();
	expect(
		sharesVertices(primitive(), { ...base, morph: { positions: [new Float32Array(12)] } }),
	).toBe(false);
	expect(
		sharesVertices(primitive(), {
			...base,
			joints: { array: new Uint8Array(16), normalized: false },
			weights: { array: new Float32Array(16), normalized: false },
		}),
	).toBe(false);
	// No normals on either: the engine computes normals per mesh, which differ.
	expect(
		sharesVertices(
			primitive(ACCESSORS, { normals: undefined }),
			primitive(ACCESSORS, { normals: undefined }),
		),
	).toBe(false);
	expect(sharesVertices({ ...primitive(), indices: undefined }, base)).toBe(false);
});
