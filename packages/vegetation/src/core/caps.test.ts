// The owner's caps hold the grown oak: its variant's bytes at every tier, without the nearest wood,
// stay under the tree caps, read at the tier the plant is built for. Each tier builds its own kit and
// grows its own oak, so each tier is a check of its own with a budget that grows with the load.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { oakRecord } from '../grow/oak.fixture';
import { capsFor, variantBytesOf } from './caps';
import { noTextureFiles } from './textures';
import { DETAILS } from './types';

describe('the owner caps', () => {
	const caps = capsFor(oakRecord);
	for (const detail of DETAILS)
		it(
			`hold the grown oak at the ${detail} tier`,
			async () => {
				await loadPlantCode(oakRecord);
				const kit = buildKitNow(
					{ record: oakRecord, textures: noTextureFiles(oakRecord.id) },
					{ placeholders: 'missing', detail },
				);
				const asset = growPlantNow(kit, { seed: 11, variant: 0 });
				expect(variantBytesOf(asset)).toBeLessThanOrEqual(caps.variantBytes[detail]);
			},
			scaledBudget(30_000),
		);
});
