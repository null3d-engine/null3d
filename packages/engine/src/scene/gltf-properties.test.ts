// The property bindings that a model's clips make: a material keeps a texture transform for each of
// its maps, so a clip that moves a base color and an emissive transform apart plays both.
import { expect, test } from 'bun:test';
import { MAP_SLOT_BASE_COLOR, MAP_SLOT_EMISSIVE } from '../generated/core';
import { propertyAnimation } from './gltf';
import type { GltfData } from './gltf-parse';

/** A file whose one clip moves the transform tracks that `properties` give. */
function file(properties: object[]): GltfData {
	return {
		materials: [
			{
				uvTransforms: {
					map: { offset: [0.25, 0.5], repeat: [1, 1], rotation: 0 },
					emissiveMap: { offset: [0, 0], repeat: [2, 2], rotation: 0 },
				},
			},
		],
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

/** A track of one map's transform of the file's material, by the pair that it moves. */
function track(key: string, map: 'map' | 'emissiveMap', values: number[]) {
	return {
		target: { kind: 'material', index: 0, value: 'uvOffset', key, map },
		components: 2,
		times: new Float32Array([0, 1]),
		values: new Float32Array(values),
	};
}

test('a clip that moves two maps of one material plays both', () => {
	const { made, notes } = bound(
		file([
			track('baseColorOffset', 'map', [0, 0, 0.5, 0.5]),
			track('emissiveOffset', 'emissiveMap', [2, 2, 3, 3]),
		]),
	);
	expect(made?.keys).toEqual(['materials/0/baseColorOffset', 'materials/0/emissiveOffset']);
	expect(made?.clips[0]).toHaveLength(2);
	// Each map's base is its own transform, which a partial weight mixes with.
	expect(Array.from(made?.bindings[0]?.base ?? [])).toEqual([0.25, 0.5]);
	expect(Array.from(made?.bindings[1]?.base ?? [])).toEqual([0, 0]);
	// Each binding names the slot of its own map, so a track moves that map alone.
	expect(made?.bindings[0]?.slot).toBe(MAP_SLOT_BASE_COLOR);
	expect(made?.bindings[1]?.slot).toBe(MAP_SLOT_EMISSIVE);
	expect(notes).toEqual([]);
});

test('a clip that moves one map keeps it', () => {
	const { made, notes } = bound(file([track('emissiveOffset', 'emissiveMap', [2, 2, 3, 3])]));
	expect(made?.keys).toEqual(['materials/0/emissiveOffset']);
	expect(made?.clips[0]).toHaveLength(1);
	expect(made?.bindings[0]?.slot).toBe(MAP_SLOT_EMISSIVE);
	expect(notes).toEqual([]);
});

test('a clip that moves one property twice plays the first track, with a note', () => {
	const { made, notes } = bound(
		file([
			track('baseColorOffset', 'map', [0, 0, 0.5, 0.5]),
			track('baseColorOffset', 'map', [2, 2, 3, 3]),
		]),
	);
	expect(made?.keys).toEqual(['materials/0/baseColorOffset']);
	expect(made?.clips[0]).toHaveLength(1);
	expect(notes).toEqual([
		'the clip "Move" moves material 0\'s uvOffset twice, so it plays the first track',
	]);
});
