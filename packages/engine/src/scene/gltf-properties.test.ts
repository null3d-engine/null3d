// The property bindings that a model's clips make: a material keeps one texture transform for all
// its maps, so a clip that moves a base color and an emissive transform apart plays the first.
import { expect, test } from 'bun:test';
import { propertyAnimation } from './gltf';
import type { GltfData } from './gltf-parse';

/** A file whose one clip moves the transform tracks that `properties` give. */
function file(properties: object[]): GltfData {
	return {
		materials: [{ uvTransform: { offset: [0.25, 0.5], repeat: [1, 1], rotation: 0 } }],
		nodes: [],
		lights: [],
		animation: { clips: [{ name: 'Move', tracks: [], properties }] },
	} as unknown as GltfData;
}

/** The tracks of `file`, bound for one object of a copy that draws its material. */
function bound(data: GltfData) {
	const notes: string[] = [];
	const target = {};
	const made = propertyAnimation(
		data,
		{ variants: () => [target] } as unknown as Parameters<typeof propertyAnimation>[1],
		[],
		[],
		{ clips: new Map([['Move', 1]]) } as unknown as Parameters<typeof propertyAnimation>[4],
		notes,
	);
	return { made, notes, target };
}

/** A track of one transform of the file's material, by the pair that it moves. */
function track(key: string, values: number[]) {
	return {
		target: { kind: 'material', index: 0, value: 'uvOffset', key },
		components: 2,
		times: new Float32Array([0, 1]),
		values: new Float32Array(values),
	};
}

test('a clip that moves two transforms of one material plays the first, with a note', () => {
	const { made, notes } = bound(
		file([track('baseColorOffset', [0, 0, 0.5, 0.5]), track('emissiveOffset', [2, 2, 3, 3])]),
	);
	expect(made?.keys).toEqual(['materials/0/baseColorOffset']);
	expect(made?.clips[0]).toHaveLength(1);
	// The base is the transform that the file gave the material.
	expect(Array.from(made?.bindings[0]?.base ?? [])).toEqual([0.25, 0.5]);
	expect(notes).toEqual([
		'the clip "Move" moves two transforms of material 0, and the engine keeps one for every map, so it plays the first',
	]);
});

test('a clip that moves one transform keeps it', () => {
	const { made, notes } = bound(file([track('emissiveOffset', [2, 2, 3, 3])]));
	expect(made?.keys).toEqual(['materials/0/emissiveOffset']);
	expect(made?.clips[0]).toHaveLength(1);
	expect(notes).toEqual([]);
});
