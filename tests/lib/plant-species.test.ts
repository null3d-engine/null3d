import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plantSpeciesTests } from '../image/plant-species.ts';

describe('the picture tests of the plant species', () => {
	it('draw one test for each species folder, named plant-<id>', () => {
		const root = mkdtempSync(join(tmpdir(), 'plant-species-'));
		try {
			for (const folder of ['pedunculate-oak', '_stub', 'silver-birch']) {
				const dir = join(root, 'packages/vegetation/src/species', folder);
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, 'index.ts'), '');
			}
			const tests = plantSpeciesTests(root);
			expect(tests.map((test) => test.name)).toEqual([
				'plant-pedunculate-oak',
				'plant-silver-birch',
			]);
			expect(tests[0]).toMatchObject({
				sketch: 'tests/pages/sketches/plant-review-sketch.ts?species=pedunculate-oak&view=panels',
				size: [1024, 1024],
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
