// The owner's caps hold every plant the game may grow: each of the oak's variants, at every tier,
// from several seeds, stays under the tree caps without the nearest wood. A heavy check, because it
// grows every variant of eleven seeds at every tier and builds a kit for each tier to do it; the
// unit run checks one seed, and this one catches a seed whose tree stands larger than the caps allow.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { oakRecord } from '../grow/oak.fixture';
import { capsFor, variantBytesOf } from './caps';
import { noTextureFiles } from './textures';
import { DETAILS } from './types';

/** The seeds the caps are swept over. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

describe('the owner caps over the seeds', () => {
	const caps = capsFor(oakRecord);
	for (const detail of DETAILS)
		it(
			`hold every grown oak of every seed at the ${detail} tier`,
			async () => {
				await loadPlantCode(oakRecord);
				const kit = buildKitNow(
					{ record: oakRecord, textures: noTextureFiles(oakRecord.id) },
					{ placeholders: 'missing', detail },
				);
				for (const seed of SEEDS)
					for (let variant = 0; variant < oakRecord.variants; variant++) {
						const asset = growPlantNow(kit, { seed, variant });
						const bytes = variantBytesOf(asset);
						// The figure and the seed both go in the message, so a run that fails names its tree.
						expect({ seed, variant, over: bytes > caps.variantBytes[detail] }).toEqual({
							seed,
							variant,
							over: false,
						});
					}
			},
			scaledBudget(600_000),
		);
});
