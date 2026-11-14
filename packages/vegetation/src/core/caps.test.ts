// The owner's caps hold the grown oak: every variant the game may show, at every tier, without the
// nearest wood, stays under the tree caps, read at the tier the plant is built for. Each tier builds
// its own kit and grows every variant, so each tier is a check of its own with a budget that grows
// with the load. The seeds beyond this one are swept by `caps-heavy.test.ts`.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { oakRecord } from '../grow/oak.fixture';
import { capsFor, VARIANTS_BY_PRESET, variantBytesOf } from './caps';
import { noTextureFiles } from './textures';
import { DETAILS } from './types';

describe('the owner caps', () => {
	const caps = capsFor(oakRecord);
	for (const detail of DETAILS)
		it(
			`hold every grown oak variant at the ${detail} tier`,
			async () => {
				await loadPlantCode(oakRecord);
				const kit = buildKitNow(
					{ record: oakRecord, textures: noTextureFiles(oakRecord.id) },
					{ placeholders: 'missing', detail },
				);
				// The preset grows a share of the species' variants, and no more than it shows.
				const count = Math.min(VARIANTS_BY_PRESET[detail], oakRecord.variants);
				for (let variant = 0; variant < count; variant++) {
					const asset = growPlantNow(kit, { seed: 11, variant });
					expect(variantBytesOf(asset)).toBeLessThanOrEqual(caps.variantBytes[detail]);
				}
			},
			scaledBudget(180_000),
		);
});
