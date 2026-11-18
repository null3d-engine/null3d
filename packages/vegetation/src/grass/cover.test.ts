// The cover that meets a species: the meadow grass's record gives the grass package its blade and
// its color, so the cover and a plant of that species read as one grass.
import { describe, expect, test } from 'bun:test';
import type { Species } from '../core/record';
import { curveAt } from '../core/types';
import { bladeWidth } from '../leaf/grass-blade';
import { record as meadowRecord } from '../species/meadow-grass/record';
import { grassCover } from './cover';

describe('the cover that meets a species', () => {
	if (meadowRecord.foliage.kind !== 'grass-blade') throw new Error('meadow grass lost its blade');
	const blade = meadowRecord.foliage.blade;

	test('the cover takes the meadow grass blade and the colour of its upper face', () => {
		const cover = grassCover(meadowRecord);
		expect(cover.color).toMatch(/^#[0-9a-f]{6}$/);
		expect(cover.color).toBe('#648e29');
		expect(cover.blade.fold).toBe(blade.fold);
	});

	test("the cover's blade is as wide as the plant's along its whole length", () => {
		const { widthAt } = grassCover(meadowRecord).blade;
		// The collar takes the record's profile of its own width, and the tip closes.
		expect(widthAt(0)).toBe(blade.width * curveAt(blade.profile, 0));
		expect(widthAt(1)).toBe(0);
		for (let t = 0; t <= 1; t += 0.125) expect(widthAt(t)).toBe(bladeWidth(blade.width, blade, t));
	});

	test('a species without a grass blade is refused', () => {
		const oak = { ...meadowRecord, id: 'oak', foliage: { kind: 'none' } } as Species;
		expect(() => grassCover(oak)).toThrow('no grass blade');
	});
});
