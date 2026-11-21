import { describe, expect, test } from 'bun:test';
import { levelMismatches } from './build';

/** A binary glTF file of one JSON chunk, as the level check reads it. */
function glb(json: object): Uint8Array {
	const text = new TextEncoder().encode(JSON.stringify(json));
	const padded = new Uint8Array(text.length + ((4 - (text.length % 4)) % 4)).fill(0x20);
	padded.set(text);
	const out = new Uint8Array(20 + padded.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, out.length, true);
	view.setUint32(12, padded.length, true);
	view.setUint32(16, 0x4e4f534a, true);
	out.set(padded, 20);
	return out;
}

/** A tree with one lower level, whose texture coordinates are stored as `levelUv`. */
function tree(levelUv: { componentType: number; normalized?: boolean }) {
	return glb({
		nodes: [
			{ name: 'wood', mesh: 0, extensions: { MSFT_lod: { ids: [1] } } },
			{ name: 'wood-1', mesh: 1 },
		],
		meshes: [
			{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }] },
			{ primitives: [{ attributes: { POSITION: 2, TEXCOORD_0: 3 } }] },
		],
		accessors: [
			{ count: 3, componentType: 5123, type: 'VEC3' },
			{ count: 3, componentType: 5126, type: 'VEC2' },
			{ count: 3, componentType: 5123, type: 'VEC3' },
			{ count: 3, type: 'VEC2', ...levelUv },
		],
	});
}

describe('levelMismatches', () => {
	test('names a level that stores an attribute in another form than its full level', () => {
		const found = levelMismatches(tree({ componentType: 5123, normalized: true }));
		expect(found).toHaveLength(1);
		expect(found[0]).toContain('wood-1 against wood');
		expect(found[0]).toContain('TEXCOORD_0: 5123 normalized VEC2');
		expect(found[0]).toContain('TEXCOORD_0: 5126 VEC2');
	});

	test('passes levels stored like their full level', () => {
		expect(levelMismatches(tree({ componentType: 5126 }))).toEqual([]);
	});
});
