// A tinted copy of a part's material overrides its colour and roughness alone: the file's colour,
// normal, packed occlusion/metalness/roughness and occlusion maps and the normal scale that a mesh
// without tangents gets must all reach the material, or the part loses its relief and its contact
// shading.
import { describe, expect, test } from 'bun:test';
import { type Part, tintedPart } from './blender-models';

describe('a tinted part', () => {
	test('keeps the file maps and normal scale and overrides only the colour and roughness', () => {
		const colour = { name: 'colour' };
		const normal = { name: 'normal' };
		const orm = { name: 'orm' };
		const ao = { name: 'ao' };
		let seen: Record<string, unknown> | undefined;
		const materials = {
			standard: (values: Record<string, unknown>) => {
				seen = values;
				return {};
			},
		};
		const part = {
			maps: { map: colour, normalMap: normal, metalnessRoughnessMap: orm, aoMap: ao },
		} as unknown as Part;

		tintedPart(materials as unknown as Parameters<typeof tintedPart>[0], part, '#ff0000', 0.9);

		expect(seen?.map).toBe(colour);
		expect(seen?.normalMap).toBe(normal);
		expect(seen?.metalnessRoughnessMap).toBe(orm);
		expect(seen?.aoMap).toBe(ao);
		expect(seen?.normalScale).toEqual([1, -1]);
		expect(seen?.color).toBe('#ff0000');
		expect(seen?.roughness).toBe(0.9);
	});
});
