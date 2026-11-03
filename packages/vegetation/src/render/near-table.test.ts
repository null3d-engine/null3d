// A kit's near table, which fixed placements and the near pool share: fixed placements take slots
// from the bottom, the pool's own start above them, and both write the one CPU copy.
import { describe, expect, it } from 'bun:test';
import type { SketchContext, Texture } from '@null3d/engine';
import { standInSpecies } from '../core/stand-in';
import { buildKitNow, loadPlantCode } from '../generate';
import {
	kitTextures,
	NEAR_SLOT_TEXELS,
	NEAR_SLOTS,
	nearSlotsHeld,
	nearTableData,
	reserveNearSlots,
} from './textures';

/** A context whose textures are plain objects: enough for the tables that kitTextures makes. */
const ctx = {
	textures: { fromData: () => ({ bytes: 4, update() {} }) as unknown as Texture },
} as unknown as SketchContext;

describe("a kit's near table", async () => {
	const stub = standInSpecies('stub');
	await loadPlantCode(stub.record);
	const kit = buildKitNow(stub, { placeholders: true });
	const white = { bytes: 4 } as unknown as Texture;
	const loaded = {
		leafColor: white,
		leafNormal: white,
		barkColor: white,
		barkNormal: white,
		youngColor: white,
		youngNormal: white,
	};

	it('gives fixed placements slots from the bottom, and refuses more than are free', () => {
		const { near } = kitTextures(ctx, kit, 'full', loaded);
		expect(nearSlotsHeld(near)).toBe(0);
		expect(reserveNearSlots(near, 3)).toBe(0);
		expect(reserveNearSlots(near, 2)).toBe(3);
		expect(nearSlotsHeld(near)).toBe(5);
		expect(() => reserveNearSlots(near, NEAR_SLOTS - 4)).toThrow(RangeError);
		expect(reserveNearSlots(near, NEAR_SLOTS - 5)).toBe(5);
		expect(nearSlotsHeld(near)).toBe(NEAR_SLOTS);
	});

	it('keeps one CPU copy of the table, two texels a slot', () => {
		const { near } = kitTextures(ctx, kit, 'full', loaded);
		const data = nearTableData(near);
		expect(data.length).toBe(NEAR_SLOTS * NEAR_SLOT_TEXELS * 4);
		expect(nearTableData(near)).toBe(data);
		expect(nearSlotsHeld({} as Texture)).toBe(0);
	});
});
