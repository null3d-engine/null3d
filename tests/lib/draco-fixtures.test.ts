// The Draco test file that the repository keeps must be what Draco's encoder builds from the pinned
// sample, so a change of the sample or the encoder shows here.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDracoFixture, DRACO_FIXTURE } from './draco-fixtures.ts';
import { MODELS_DIR } from './meshopt-fixtures.ts';

describe('the Draco test file', () => {
	test('matches what the encoder builds', async () => {
		const built = await buildDracoFixture();
		expect(Buffer.from(built).equals(readFileSync(join(MODELS_DIR, DRACO_FIXTURE)))).toBe(true);
	});
});
