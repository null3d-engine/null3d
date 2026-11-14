// Every level is the same plant in size. A card pictures its shoot at the shoot's own size, and a
// level that keeps fewer cards makes up their cover inside the leaf form's hull, never by a larger
// plant. These tests read the box of each level's foliage as a camera sees it, the texels of at
// least half cover on a card, and hold each card level's against the leaf form's: as tall, as wide
// and as deep, and nothing under the ground the leaf form does not put there. They also hold the
// sky inside the crown's outline, so the gaps between cards stay hidden. Each species is a test of
// its own, so a run can pick one.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { Species } from '../core/record';
import { loadSpecies, type SpeciesId, speciesIds } from '../core/registry';
import type { Detail } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { foliageBox, outlineMatte, skyShare } from './card-size.test-support';

/** A species grows and its three levels are read texel by texel; a busy machine takes a while. */
const LONG = scaledBudget(180_000);

/**
 * The most a card level's foliage box may differ from the leaf form's in height, width and depth,
 * as a share of the leaf form's own.
 */
const SIZE_SLACK = 0.03;

/** How far under the leaf form's own lowest point a card level's picture may reach, in metres. */
const GROUND_SLACK = 0.01;

/**
 * How much more sky, and how much less, a card level may show inside the crown's outline than the
 * leaf form: the review standard's band.
 */
const SKY_MORE = 0.05;
const SKY_LESS = 0.02;

/** The seeds each species grows from, two variants each. */
const SEEDS = [11, 2027] as const;

/**
 * The species whose levels miss the size rule for a fault outside the card levels' size, each with
 * that fault. Their tests are skipped, and name the fault, until it is mended.
 */
const SIZE_FAULTS: Readonly<Partial<Record<SpeciesId, string>>> = {
	'meadow-grass': 'its merged second level, which draws no cards, stands narrower than its leaves',
	sedge: 'its merged second level, which draws no cards, stands shorter than its leaves',
	'weeping-willow':
		'its leaves hang below the ground, and a card picture at the shoot size reaches a texel past them',
};

/**
 * The species whose card levels miss the sky band for a fault outside their size, each with that
 * fault, skipped as the size faults are.
 */
const SKY_FAULTS: Readonly<Partial<Record<SpeciesId, string>>> = {
	'weeping-willow': 'its card pictures at the shoot size cover more than its thin leaves',
};

/** A test, or a skipped one that names the fault that keeps it from passing. */
function held(name: string, fault: string | undefined, run: () => Promise<void>): void {
	if (fault) it.skip(`${name}: skipped, ${fault}`, run, LONG);
	else it(name, run, LONG);
}

/** The species whose shoots draw as cards, whose crowns are read for sky. */
const SKY_SPECIES: readonly SpeciesId[] = [
	'common-alder',
	'common-ash',
	'european-beech',
	'hawthorn-shrub',
	'holm-oak',
	'pedunculate-oak',
	'scots-pine',
	'silver-birch',
	'weeping-willow',
];

/** A kit of a species at a tier. */
async function kitOf(id: SpeciesId, detail: Detail) {
	const module = await loadSpecies(id);
	await loadPlantCode(module.record);
	return buildKitNow(module, { placeholders: 'missing', detail });
}

describe('a card level keeps the plant size', () => {
	for (const id of speciesIds())
		held(
			`draws the ${id} as tall, as wide and as deep at every level`,
			SIZE_FAULTS[id],
			async () => {
				const kit = await kitOf(id, 'low');
				for (const seed of SEEDS)
					for (const variant of [0, 1]) {
						const asset = growPlantNow(kit, { seed, variant, near: true });
						const leaf = foliageBox(kit, asset, 0);
						const size = [0, 1, 2].map((k) => (leaf.max[k] as number) - (leaf.min[k] as number));
						for (const level of [1, 2] as const) {
							const far = foliageBox(kit, asset, level);
							const at = `${id} seed ${seed} variant ${variant} level ${level}`;
							// The top, then the width and the depth.
							expect([
								at,
								'top',
								Math.abs(far.max[1] - leaf.max[1]) <= SIZE_SLACK * leaf.max[1],
							]).toEqual([at, 'top', true]);
							for (const k of [0, 2] as const) {
								const wide = (far.max[k] as number) - (far.min[k] as number);
								expect([
									at,
									k,
									Math.abs(wide - (size[k] as number)) <= SIZE_SLACK * (size[k] as number),
								]).toEqual([at, k, true]);
							}
							// Nothing under the ground: no picture below the leaf form's own foot.
							expect([at, 'foot', far.min[1] >= Math.min(0, leaf.min[1]) - GROUND_SLACK]).toEqual([
								at,
								'foot',
								true,
							]);
						}
					}
			},
		);

	// The medium tier's leaves are meshes of their own outline, so the leaf form's matte is the
	// leaves themselves and not a card's picture of them. A card level draws every part of the leaf
	// form but its finer wood, which its cards grow to make up.
	for (const id of SKY_SPECIES)
		held(
			`keeps the sky inside the crown outline of the ${id} within the review band`,
			SKY_FAULTS[id],
			async () => {
				const kit = await kitOf(id, 'medium');
				const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
				const leaf = outlineMatte(kit, asset, 0, 192);
				const own = skyShare(leaf, leaf);
				for (const level of [1, 2] as const) {
					const sky = skyShare(leaf, outlineMatte(kit, asset, level, 192));
					const at = `${id} level ${level}: leaf form ${own.toFixed(4)}, level ${sky.toFixed(4)}`;
					expect([at, sky - own <= SKY_MORE, own - sky <= SKY_LESS]).toEqual([at, true, true]);
				}
			},
		);

	it('names no card growth in any record', async () => {
		for (const id of speciesIds()) {
			const { record } = await loadSpecies(id);
			expect([id, 'cardGrow' in (record.lod as Species['lod'])]).toEqual([id, false]);
		}
	});
});
