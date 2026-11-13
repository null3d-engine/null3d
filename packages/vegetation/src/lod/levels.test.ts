// Where the first card level starts: where the longest shoot, at its largest placement scale, spans
// the record's first switch pixels. The page's hand-over from real shoots and the asset's own level
// distance come from one rule, so they agree.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { loadSpecies, speciesIds } from '../core/registry';
import { spreadMax } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { firstCardStart, REFERENCE_VIEW, shootReach } from './levels';

/** Every species' kit is built once at the low tier; a busy machine takes a while. */
const LONG = scaledBudget(120_000);

/** The review page's close camera: a still 720 pixels tall at 70 degrees. */
const CLOSE_VIEW = { height: 720, fov: 70 } as const;

/** The pixels a length spans at a distance and a view. */
function pixelsAt(length: number, distance: number, view: { height: number; fov: number }) {
	return (length * view.height) / (2 * Math.tan((view.fov * Math.PI) / 360) * distance);
}

describe('the first card level', () => {
	it(
		"starts where the longest shoot spans the record's first switch pixels",
		async () => {
			for (const id of speciesIds()) {
				const module = await loadSpecies(id);
				if (module.record.lod.nearFoliage !== 'instanced') continue;
				await loadPlantCode(module.record);
				const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
				let longest = 0;
				for (const prototype of kit.prototypes) longest = Math.max(longest, prototype.length);
				const shoots = kit.record.shoots;
				const reach = Math.max(0.4, longest * (shoots ? spreadMax(shoots.placement.scale) : 1));
				for (const view of [REFERENCE_VIEW, CLOSE_VIEW]) {
					const spans = pixelsAt(reach, firstCardStart(kit, view), view);
					const pixels = kit.record.lod.switchPixels[0];
					expect([id, view.fov, Math.abs(spans - pixels) < 1e-6 * pixels]).toEqual([
						id,
						view.fov,
						true,
					]);
				}
			}
		},
		LONG,
	);

	it(
		'measures a plant of small tufts from the least shoot',
		async () => {
			const module = await loadSpecies('saguaro');
			await loadPlantCode(module.record);
			const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
			expect(shootReach(kit)).toBe(0.4);
		},
		LONG,
	);

	it(
		"sets the asset's first card level where the page's shoots hand over",
		async () => {
			const module = await loadSpecies('pedunculate-oak');
			await loadPlantCode(module.record);
			const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
			const asset = growPlantNow(kit, { seed: 11, variant: 0 });
			expect(asset.levels[1].from).toBe(firstCardStart(kit, REFERENCE_VIEW));
		},
		LONG,
	);
});
