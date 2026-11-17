// The plant gate's bake and switch checks: a card's mask follows the leaf kind it stands for, and
// each clump-card species crosses its first card level without coarsening the grain or stepping the
// crown's open sky. A failing case names the species and the figure.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { SpeciesId } from '../core/registry';
import { loadSpecies } from '../core/registry';
import type { Detail } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { clumpsOf } from './clump-card';
import { outlineMatte, skyShare } from './outline.test-support';

/** A species' kit and its first variant, at a tier. */
async function plantOf(id: string, detail: Detail) {
	const module = await loadSpecies(id as SpeciesId);
	await loadPlantCode(module.record);
	const kit = buildKitNow(module, { placeholders: 'missing', detail });
	const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
	return { kit, asset };
}

/** The bytes of a species' card atlas. */
function cardDigest(kit: ReturnType<typeof buildKitNow>): string {
	const parts = [kit.cards.color, kit.cards.surface]
		.filter((array): array is NonNullable<typeof array> => array !== undefined)
		.map((array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength));
	return Bun.hash(Buffer.concat(parts)).toString(16);
}

/** A level's card-plane quads: a stalk's line names itself in its second coordinate. */
function cardQuads(asset: ReturnType<typeof growPlantNow>, level: 1 | 2): number {
	let quads = 0;
	for (const part of asset.levels[level].parts) {
		if (part.name !== 'cards') continue;
		const { indices, uvs1 } = part.arrays;
		for (let t = 0; t < indices.length; t += 3) {
			const v = indices[t] as number;
			if (Math.abs((uvs1[v * 2 + 1] as number) - 0.75) < 1e-6) continue;
			quads++;
		}
	}
	// Each plane quad is two triangles.
	return quads / 2;
}

/** The species whose planned form draws clump cards. */
const CLUMPS = [
	'pedunculate-oak',
	'common-alder',
	'european-beech',
	'holm-oak',
	'weeping-willow',
] as const;

/** The card atlases measured with the mask from the shape the card stands for. */
const DIGESTS: Readonly<Record<string, string>> = {
	'pedunculate-oak': '4ed6e51065f5f32a',
	'common-alder': 'ed450e86a2b536f9',
	'european-beech': '2163dab80e09ae0',
	'holm-oak': '3026ef15ddb7cf30',
	'weeping-willow': 'c8a3600054c1f2b5',
	'silver-birch': '8ad6727e8832a2d1',
	'italian-cypress': 'b3276d7be6e8825',
	'scots-pine': 'a09aeb62808a9d42',
	'giant-sequoia': 'fd8fd1d2e4ab52af',
};

/** The atlases that the crop's outline produced before the mask followed the leaf kind. */
const CROP_CLIPPED: Readonly<Record<string, string>> = {
	'scots-pine': 'b8439d0b6b2e4f62',
	'giant-sequoia': 'f816afb3fb1619d1',
};

const LONG = scaledBudget(180_000);

describe('the gate: the bake', () => {
	it(
		'follows the leaf kind in each card atlas, and the needle species differ from the crop',
		async () => {
			for (const id of Object.keys(DIGESTS)) {
				const { kit } = await plantOf(id, 'high');
				const digest = cardDigest(kit);
				expect([id, digest]).toEqual([id, DIGESTS[id] as string]);
				const clipped = CROP_CLIPPED[id];
				if (clipped !== undefined) expect([id, digest === clipped]).toEqual([id, false]);
			}
		},
		LONG,
	);
});

describe('the gate: the switch', () => {
	it(
		'fits each first-card-level plate to its clump and keeps three pictures at the second level',
		async () => {
			for (const id of CLUMPS) {
				const { asset } = await plantOf(id, 'medium');
				const clumps = clumpsOf({ rows: asset.shoots, skeleton: asset.skeleton });
				expect([id, clumps !== undefined]).toEqual([id, true]);
				const count = clumps?.length ?? 0;
				// The second card level keeps three pictures a side on every clump plate, within the
				// few extra quads a prototype's own plane set adds.
				const fixed = count * 27;
				const slack = count * 3;
				expect([id, Math.abs(cardQuads(asset, 2) - fixed) <= slack]).toEqual([id, true]);
				// The first level fits each plate, so the oak's grown clumps carry far more pictures
				// than the fixed count. A species whose clumps fit about three a side reads the same
				// figure as the fixed count and is not evidence either way.
				if (id === 'pedunculate-oak')
					expect([id, 'first fitted', cardQuads(asset, 1) > fixed * 1.2]).toEqual([
						id,
						'first fitted',
						true,
					]);
			}
		},
		LONG,
	);

	// The alder's first card level reads a crown far more open than its leaf form, an open fault
	// recorded in the card-size suite. Every other clump species steps within the two hundredths.
	for (const id of CLUMPS)
		(id === 'common-alder' ? it.failing : it)(
			`steps the crown's open sky within two hundredths across the first card level of the ${id}`,
			async () => {
				const { kit, asset } = await plantOf(id, 'medium');
				const leaf = outlineMatte(kit, asset, 0, 192, 'leaves');
				const card = outlineMatte(kit, asset, 1, 192);
				const from = Math.max(0, asset.skeleton.crownBase);
				const own = skyShare(leaf, leaf, from);
				const far = skyShare(leaf, card, from);
				const at = `${id}: leaf form ${own.toFixed(4)}, first card level ${far.toFixed(4)}, step ${(far - own).toFixed(4)}`;
				expect([at, Math.abs(far - own) <= 0.02]).toEqual([at, true]);
			},
			LONG,
		);
});
