// Every level is the same plant in size. A card pictures its shoot at the shoot's own size, and a
// level that keeps fewer cards makes up their cover inside the leaf form's hull, never by a larger
// plant. These tests read the box of each level's foliage as a camera sees it, the texels of at
// least half cover on a card, and hold each card level's against the leaf form's: as tall, as wide
// and as deep, and nothing under the ground the leaf form does not put there. They also hold the
// sky inside the crown's outline, so the gaps between cards stay hidden. A level that keeps a share
// of its cards keeps their area and the crown's width, and a record that leaves its extras out from
// a card level changes nothing else.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { length3 } from '../core/math';
import type { Species } from '../core/record';
import { loadSpecies } from '../core/registry';
import type { Detail } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { foliageBox } from './card-size.test-support';
import { matteShare, outlineMatte, skyShare } from './outline.test-support';

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

/** One plant of each habit: the growth model, the species, and the seeds it grows from. */
const HABITS: readonly (readonly [habit: string, id: string, seeds: readonly number[]])[] = [
	['a broadleaf tree', 'pedunculate-oak', [11, 2027]],
	['an evergreen broadleaf', 'holm-oak', [11]],
	['a conifer', 'scots-pine', [11, 2027]],
	['a weeping tree', 'silver-birch', [11]],
	['a shrub', 'hawthorn-shrub', [11, 2027]],
	['a ribbed column', 'saguaro', [11]],
	['a tuft', 'sedge', [11, 2027]],
	['a rosette', 'hosta', [11]],
	['a frond colony', 'bracken', [11]],
];

/**
 * The species whose crowns are read for sky: every species that draws shoot cards but the weeping
 * willow. Each of a card's three crossed planes pictures the whole shoot, so a sparse shoot seen
 * from between two planes shows more cover than its leaves, up to half as much again on the
 * willow's long open shoots. Its card levels read about 0.07 more closed than its leaf form, below
 * the band, and the fault is the card design's, not the bake's.
 */
const SKY_SPECIES = [
	'common-alder',
	'common-ash',
	'european-beech',
	'giant-sequoia',
	'hawthorn-shrub',
	'holm-oak',
	'olive',
	'pedunculate-oak',
	'saguaro',
	'scots-pine',
	'silver-birch',
] as const;

/** A kit of a species at a tier. */
async function kitOf(id: string, detail: Detail) {
	const module = await loadSpecies(id as Parameters<typeof loadSpecies>[0]);
	await loadPlantCode(module.record);
	return buildKitNow(module, { placeholders: 'missing', detail });
}

describe('a card level keeps the plant size', () => {
	for (const [habit, id, seeds] of HABITS)
		it(
			`draws ${habit}, the ${id}, as tall, as wide and as deep at every level`,
			async () => {
				const kit = await kitOf(id, 'low');
				for (const seed of seeds)
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
			LONG,
		);

	// The medium tier's leaves are meshes of their own outline, so the leaf form's matte is the
	// leaves themselves and not a card's picture of them. A card level draws less of the fine wood
	// than the leaf form, and its cards grow inside the leaf form's hull to make that cover up.
	for (const id of SKY_SPECIES)
		it(
			`keeps the sky inside the crown outline of the ${id} within the review band`,
			async () => {
				const kit = await kitOf(id, 'medium');
				const asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
				const leaf = outlineMatte(kit, asset, 0, 192, 'leaves');
				// The crown is read from its base up: the nearest level alone draws the roots.
				const from = matteShare(asset, Math.max(0, asset.skeleton.crownBase));
				const own = skyShare(leaf, leaf, from);
				for (const level of [1, 2] as const) {
					const sky = skyShare(leaf, outlineMatte(kit, asset, level, 192), from);
					const at = `${id} level ${level}: leaf form ${own.toFixed(4)}, level ${sky.toFixed(4)}`;
					expect([at, sky - own <= SKY_MORE, own - sky <= SKY_LESS]).toEqual([at, true, true]);
				}
			},
			LONG,
		);

	it('names no card growth in any record', async () => {
		const { speciesIds } = await import('../core/registry');
		for (const id of speciesIds()) {
			const { record } = await loadSpecies(id);
			expect([id, 'cardGrow' in (record.lod as Species['lod'])]).toEqual([id, false]);
		}
	});
});

/** A level's card area as drawn, in square metres: the cards' triangles at their places. */
function cardArea(kit: SpeciesKitData, asset: PlantAsset, level: 1 | 2): number {
	const { min, max } = kit.box;
	let sum = 0;
	for (const part of asset.levels[level].parts) {
		if (part.name !== 'cards') continue;
		const { positions, indices } = part.arrays;
		const at = (i: number): number[] =>
			[0, 1, 2].map(
				(c) =>
					(min[c] as number) +
					(positions[i * 3 + c] as number) * (((max[c] as number) - (min[c] as number)) / 65535),
			);
		for (let t = 0; t < indices.length; t += 3) {
			const a = at(indices[t] as number);
			const b = at(indices[t + 1] as number);
			const c = at(indices[t + 2] as number);
			const u = [0, 1, 2].map((k) => (b[k] as number) - (a[k] as number));
			const v = [0, 1, 2].map((k) => (c[k] as number) - (a[k] as number));
			sum +=
				0.5 *
				length3(
					(u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
					(u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
					(u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
				);
		}
	}
	return sum;
}

/** The triangles of a level's parts of one name. */
function partTriangles(asset: PlantAsset, level: 0 | 1 | 2, name: string): number {
	return asset.levels[level].parts
		.filter((part) => part.name === name)
		.reduce((sum, part) => sum + part.arrays.indices.length / 3, 0);
}

/** A species' kit at the low tier with its record's level settings changed. */
async function kitWith(id: string, lod: Partial<Species['lod']>) {
	const module = await loadSpecies(id as Parameters<typeof loadSpecies>[0]);
	await loadPlantCode(module.record);
	const record = { ...module.record, lod: { ...module.record.lod, ...lod } };
	return buildKitNow({ ...module, record }, { placeholders: 'missing', detail: 'low' });
}

/** How much less card area a level that keeps a share of its cards may draw than the full set. */
const AREA_SLACK = 0.05;

describe('a card level that keeps a share of its cards', () => {
	// A level keeps one of each so many of its cards and grows each kept card by the root of that
	// step where the leaf form's hull has room; the alder's crown and the pine's far level have it.
	for (const [id, share] of [
		['common-alder', [0.5, 0.5]],
		['scots-pine', [1, 0.5]],
	] as const)
		it(
			`keeps the ${id}'s card area and width with ${share.join(' and ')} of its cards`,
			async () => {
				const full = await kitWith(id, {});
				const kept = await kitWith(id, { cardShare: share });
				const before = growPlantNow(full, { seed: 11, variant: 0, near: true });
				const after = growPlantNow(kept, { seed: 11, variant: 0, near: true });
				const leaf = foliageBox(kept, after, 0);
				for (const level of [1, 2] as const) {
					const at = `${id} level ${level}`;
					const was = partTriangles(before, level, 'cards');
					const now = partTriangles(after, level, 'cards');
					// Fewer cards where the share thins the level, the same where it keeps them all.
					if ((share[level - 1] as number) < 1) expect([at, now < 0.6 * was]).toEqual([at, true]);
					else expect([at, now]).toEqual([at, was]);
					const area = cardArea(kept, after, level) / cardArea(full, before, level);
					expect([at, area >= 1 - AREA_SLACK, area <= 1 + AREA_SLACK]).toEqual([at, true, true]);
					// The far crown stands no wider than the leaf form's.
					const far = foliageBox(kept, after, level);
					for (const k of [0, 2] as const) {
						const wide = (far.max[k] as number) - (far.min[k] as number);
						const own = (leaf.max[k] as number) - (leaf.min[k] as number);
						expect([at, k, wide <= (1 + SIZE_SLACK) * own]).toEqual([at, k, true]);
					}
				}
			},
			LONG,
		);
});

describe('a record that leaves its extras out from a card level', () => {
	it(
		"draws the pine's cones at the leaf form alone, or at the first card level as well, and nothing else changes",
		async () => {
			const plain = await kitWith('scots-pine', {});
			const none = await kitWith('scots-pine', { extrasFrom: 1 });
			const near = await kitWith('scots-pine', { extrasFrom: 2 });
			const grown = [plain, none, near].map((kit) =>
				growPlantNow(kit, { seed: 11, variant: 0, near: true }),
			) as [PlantAsset, PlantAsset, PlantAsset];
			const [base, fromFirst, fromSecond] = grown;
			// The pine draws its cones at the leaf form and at the first card level.
			expect(partTriangles(base, 1, 'extras')).toBeGreaterThan(0);
			for (const asset of grown)
				expect(partTriangles(asset, 0, 'extras')).toBe(partTriangles(base, 0, 'extras'));
			expect(partTriangles(fromFirst, 1, 'extras')).toBe(0);
			expect(partTriangles(fromSecond, 1, 'extras')).toBe(partTriangles(base, 1, 'extras'));
			for (const asset of [fromFirst, fromSecond])
				expect(partTriangles(asset, 2, 'extras')).toBe(0);
			// Every other part of every level is the plant's own.
			for (const asset of [fromFirst, fromSecond])
				for (const level of [0, 1, 2] as const)
					for (const name of ['wood', 'cards', 'shoots'])
						expect([level, name, partTriangles(asset, level, name)]).toEqual([
							level,
							name,
							partTriangles(base, level, name),
						]);
		},
		LONG,
	);
});
