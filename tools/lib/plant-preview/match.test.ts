// The sky through the pedunculate oak's crown, read from its CPU matte at the three whole-plant
// stills' own framings, over every variant: how much sky the crown's outline encloses, against the
// review's band for each still, and where that sky sits. The matte is the preview's, drawn from the
// first card level as a whole view of a tree shows it, and read by the review tool's own outline
// and measures.
import { describe, expect, it } from 'bun:test';
import { loadSpecies } from '../../../packages/vegetation/src/core/registry.ts';
import {
	buildKitNow,
	growPlantNow,
	loadPlantCode,
} from '../../../packages/vegetation/src/generate.ts';
import { scaledBudget } from '../../../tests/lib/run-budget.ts';
import { GAP_ABOVE, GAP_BELOW, renderView } from './match.ts';
import { OAK_WHOLE } from './oak-targets.ts';
import type { GapSpread } from './spread.ts';

const SEED = 11;
const VARIANTS = [0, 1, 2, 3, 4, 5] as const;
/**
 * How much more open the CPU matte reads than the GPU's matte of the same plant from the same
 * camera: 0.009 to 0.010 over three whole views of one oak, so a CPU figure less this stands for
 * the figure a review would read.
 */
const CPU_OPEN = 0.01;
/** The least share of a crown's zones that hold their share of its sky. The references read 0.7 to 1. */
const ZONES_OPEN_LEAST = 0.7;
/** The most of a crown's enclosed sky that one opening holds. The references read 0.09 to 0.34. */
const LARGEST_OPENING_MOST = 0.4;
/**
 * The sky of the outline's middle over the sky of its rim. The references read 0.43 to 1.08: below
 * the band the rim is open round a solid middle, and above it the crown is hollow.
 */
const MIDDLE_OVER_RIM: readonly [number, number] = [0.35, 1.8];

describe("the sky through the scaffold oak's crown", () => {
	it(
		"sits in each whole view's band on the mean of the variants, and is spread through the crown",
		async () => {
			const module = await loadSpecies('pedunculate-oak');
			await loadPlantCode(module.record);
			const kit = buildKitNow(module, { placeholders: 'missing', detail: 'high' });
			const lowest = Math.min(...OAK_WHOLE.map((still) => still.gap)) - GAP_BELOW;
			const highest = Math.max(...OAK_WHOLE.map((still) => still.gap)) + GAP_ABOVE;
			const gaps = OAK_WHOLE.map(() => [] as number[]);
			for (const variant of VARIANTS) {
				const asset = growPlantNow(kit, { seed: SEED, variant });
				OAK_WHOLE.forEach((still, view) => {
					const render = renderView(kit, asset, still.framing, still.turn, 1, still.widthShare);
					const gap = render.measures.gapFraction - CPU_OPEN;
					(gaps[view] as number[]).push(gap);
					// No one plant stands outside what the species' own three references span: they
					// are three trees, and their gaps differ by more than a variant's from the mean.
					expect([still.file, variant, gap > lowest && gap < highest]).toEqual([
						still.file,
						variant,
						true,
					]);
					// The sky stands through the crown: in most of its zones, in no one opening, and
					// neither gathered at its rim nor at its middle.
					const spread = render.spread as GapSpread;
					expect([still.file, variant, spread.open >= ZONES_OPEN_LEAST]).toEqual([
						still.file,
						variant,
						true,
					]);
					expect([still.file, variant, spread.largest <= LARGEST_OPENING_MOST]).toEqual([
						still.file,
						variant,
						true,
					]);
					expect([
						still.file,
						variant,
						spread.inner >= MIDDLE_OVER_RIM[0] && spread.inner <= MIDDLE_OVER_RIM[1],
					]).toEqual([still.file, variant, true]);
				});
			}
			// The variants' mean at each still stands inside that still's own band.
			OAK_WHOLE.forEach((still, view) => {
				const values = gaps[view] as number[];
				const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
				expect([
					still.file,
					mean >= still.gap - GAP_BELOW && mean <= still.gap + GAP_ABOVE,
				]).toEqual([still.file, true]);
			});
		},
		scaledBudget(300_000),
	);
});
