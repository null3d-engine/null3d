// The glTF loader's texture step and its levels, with a fake engine: a load whose textures fail
// part way frees what it made, a level whose primitive names its base's accessors shares the
// base's vertices, and a file's error fades unless the tool's coverage comes beside it.

import { expect, test } from 'bun:test';
import {
	fileLevelMeasure,
	type GltfContext,
	makeTextures,
	readStage,
	readStageBand,
	sharesVertices,
} from './gltf';
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

test('a level of a skinned mesh shares the vertices that the skin moves', () => {
	// Both primitives name the same joints and weights, so the skin moves one set of vertices.
	const skinned = { ...ACCESSORS, JOINTS_0: 7, WEIGHTS_0: 8 };
	const base = primitive(skinned, {
		joints: { array: new Uint8Array(16), normalized: false },
		weights: { array: new Float32Array(16), normalized: false },
	});
	const level = primitive(skinned, {
		joints: { array: new Uint8Array(16), normalized: false },
		weights: { array: new Float32Array(16), normalized: false },
	});
	expect(sharesVertices(level, base)).toBe(true);
});

test('a level copies its vertices when its base morphs or has no indices', () => {
	const base = primitive();
	expect(
		sharesVertices(primitive(), { ...base, morph: { positions: [new Float32Array(12)] } }),
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

test("a file's level fades unless the coverage that its measured error implies comes beside it", () => {
	// A hand-set error, as the Creek trees' levels hold: the switch shows, so the level fades.
	expect(fileLevelMeasure([28.297, 56.594], undefined, 0)).toEqual({ error: 28.297 });
	// A measured error, which the asset tool writes with the coverage that the error implies.
	expect(fileLevelMeasure([919.294], [0.0165], 0)).toEqual({ error: 919.294, fade: false });
	// A file that gives the coverage of its levels alone.
	expect(fileLevelMeasure(undefined, [0.0165], 0)).toEqual({ coverage: 0.0165 });
});

/** A stage file of `lists`, each at the width that its largest index takes, as the asset tool writes it. */
function stageFile(lists: readonly number[][]): ArrayBuffer {
	const placed = lists.map((list) => {
		const size = list.some((index) => index > 0xffff) ? 4 : 2;
		return { list, size, bytes: Math.ceil((list.length * size) / 4) * 4 };
	});
	const length = 16 + placed.reduce((sum, list) => sum + 8 + list.bytes, 0);
	const bytes = new ArrayBuffer(length);
	const view = new DataView(bytes);
	view.setUint32(0, 0x5344334e, true);
	view.setUint32(4, 1, true);
	view.setUint32(8, 0, true);
	view.setUint32(12, lists.length, true);
	let at = 16;
	for (const { list, size, bytes: count } of placed) {
		view.setUint32(at, list.length, true);
		view.setUint32(at + 4, size, true);
		const array =
			size === 2
				? new Uint16Array(bytes, at + 8, count / 2)
				: new Uint32Array(bytes, at + 8, count / 4);
		array.set(list);
		at += 8 + count;
	}
	return bytes;
}

test('a stage file gives the triangle lists of the node its primitives, at either width', () => {
	const lists = [
		[0, 1, 2, 2, 3, 0],
		[0, 70_000, 2, 2, 70_000, 0],
	];
	const read = readStage(stageFile(lists), 2);
	expect(read?.map((list) => Array.from(list))).toEqual(lists);
	// A file of another version, kind or list count, or one cut short, is left out.
	const wrong = stageFile(lists);
	new DataView(wrong).setUint32(4, 2, true);
	expect(readStage(wrong, 2)).toBeUndefined();
	expect(readStage(stageFile(lists), 1)).toBeUndefined();
	expect(readStage(stageFile(lists).slice(0, 20), 2)).toBeUndefined();
});

/** A band stage file: the header with kind 1, the patch count, the patches, then one index list. */
function bandStage(bounds: number[], records: number[], list: number[], width = 2): ArrayBuffer {
	const patches = records.length / 4;
	const count = Math.ceil((list.length * width) / 4) * 4;
	const bytes = new Uint8Array(20 + patches * 32 + 8 + count);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0x5344334e, true);
	view.setUint32(4, 1, true);
	view.setUint32(8, 1, true);
	view.setUint32(12, 1, true);
	view.setUint32(16, patches, true);
	// Eight words a patch: its sphere's four floats, then its record's four integers.
	for (let k = 0; k < patches; k++) {
		for (let c = 0; c < 4; c++)
			view.setFloat32(20 + k * 32 + c * 4, bounds[k * 4 + c] as number, true);
		for (let c = 0; c < 4; c++)
			view.setUint32(20 + k * 32 + 16 + c * 4, records[k * 4 + c] as number, true);
	}
	const listAt = 20 + patches * 32;
	view.setUint32(listAt, list.length, true);
	view.setUint32(listAt + 4, width, true);
	const array = width === 2 ? new Uint16Array(bytes.buffer, listAt + 8, list.length) : null;
	if (array) array.set(list);
	else new Uint32Array(bytes.buffer, listAt + 8, list.length).set(list);
	return bytes.buffer;
}

test('a band stage gives the patches and indices of one band of a tree', () => {
	const bounds = [1, 2, 3, 4, 5, 6, 7, 8];
	const records = [0, 3, 0, 0, 3, 6, 1, 0];
	const list = [0, 1, 2, 3, 4, 5, 6, 7, 8];
	const band = readStageBand(bandStage(bounds, records, list));
	expect(band && Array.from(band.bounds)).toEqual(bounds);
	expect(band && Array.from(band.records)).toEqual(records);
	expect(band && Array.from(band.indices)).toEqual(list);
	// Four-byte indices reach a mesh of more than 65,535 vertices.
	const wide = readStageBand(bandStage(bounds, records, [0, 70_000, 2], 4));
	expect(wide && Array.from(wide.indices)).toEqual([0, 70_000, 2]);
	// A file of another kind or version, one cut short, and one with no patch is left out.
	const wrongKind = bandStage(bounds, records, list);
	new DataView(wrongKind).setUint32(8, 0, true);
	expect(readStageBand(wrongKind)).toBeUndefined();
	const wrongVersion = bandStage(bounds, records, list);
	new DataView(wrongVersion).setUint32(4, 2, true);
	expect(readStageBand(wrongVersion)).toBeUndefined();
	expect(readStageBand(bandStage(bounds, records, list).slice(0, 40))).toBeUndefined();
	expect(readStageBand(bandStage([], [], list))).toBeUndefined();
});
