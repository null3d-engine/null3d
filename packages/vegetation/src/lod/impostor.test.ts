import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset, SpeciesKitData } from '../asset.ts';
import { farCardLift, farGrid } from './impostor.ts';

/** A kit whose record's second level is the full level a capped one is measured against. */
const KIT = {
	record: { lod: { budget: { lod1Triangles: 100_000 } } },
} as unknown as SpeciesKitData;

/** A grown variant whose own second level draws a quarter of the record's full level. */
function assetOf(fields: { maxTriangles?: number; capTriangles?: number }): PlantAsset {
	return {
		...fields,
		sparse: 0,
		impostor: { texels: 128 },
		stats: { triangles: [0, 25_000, 0] },
	} as unknown as PlantAsset;
}

describe('the far bake', () => {
	it('draws the far picture of a maximum the plant already fits as it draws one with no maximum', () => {
		const uncapped = farGrid(KIT, assetOf({}));
		const loose = farGrid(KIT, assetOf({ maxTriangles: 250_000 }));
		expect(loose).toEqual(uncapped);
	});

	it('draws a smaller far picture where the maximum changed the levels', () => {
		const uncapped = farGrid(KIT, assetOf({}));
		const biting = farGrid(KIT, assetOf({ maxTriangles: 250_000, capTriangles: 250_000 }));
		expect(biting.texels).toBeLessThan(uncapped.texels);
	});

	it('enlarges the far cards only where the maximum changed the levels', () => {
		expect(farCardLift(assetOf({}))).toBe(1);
		expect(farCardLift(assetOf({ maxTriangles: 250_000 }))).toBe(1);
		expect(farCardLift(assetOf({ maxTriangles: 250_000, capTriangles: 250_000 }))).toBeGreaterThan(
			1,
		);
	});
});

describe('the plant core', () => {
	it(
		'loads on a thread that reads no other package, the far baker being a lazy chunk',
		() => {
			// A runtime with no source condition resolves another package to its built files, which
			// a checkout does not hold. The generator's own modules must load there all the same.
			const generator = fileURLToPath(new URL('../generate.ts', import.meta.url));
			const run = Bun.spawnSync([
				process.execPath,
				'-e',
				`await import(${JSON.stringify(generator)});`,
			]);
			expect(run.exitCode, run.stderr.toString()).toBe(0);
		},
		scaledBudget(60_000),
	);
});
