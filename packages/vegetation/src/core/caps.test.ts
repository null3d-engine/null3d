// The owner's caps hold the grown oak: its variant's bytes at every tier, without the nearest wood,
// stay under the tree caps, read at the tier the plant is built for.
import { describe, expect, it } from 'bun:test';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { oakRecord } from '../grow/oak.fixture';
import { capsFor, variantBytesOf } from './caps';
import { noTextureFiles } from './textures';
import { DETAILS } from './types';

describe('the owner caps', () => {
	it('hold the grown oak at every tier', async () => {
		await loadPlantCode(oakRecord);
		const caps = capsFor(oakRecord);
		for (const detail of DETAILS) {
			const kit = buildKitNow(
				{ record: oakRecord, textures: noTextureFiles(oakRecord.id) },
				{ placeholders: 'missing', detail },
			);
			const asset = growPlantNow(kit, { seed: 11, variant: 0 });
			expect(variantBytesOf(asset)).toBeLessThanOrEqual(caps.variantBytes[detail]);
		}
	});
});
