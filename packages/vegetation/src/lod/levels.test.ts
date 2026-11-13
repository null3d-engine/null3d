// Where the first card level starts. A card pictures its shoot in a cell of a few tens of texels, so
// the level starts no nearer than where the shoot spans that many pixels on screen: never where the
// card would be drawn larger than its own picture. The page's hand-over from real shoots and the
// asset's own level distance come from one rule, so they agree.
import { describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import { loadSpecies, speciesIds } from '../core/registry';
import { DETAILS, spreadMax } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { cardTexels } from './card-bake';
import { firstCardPixels, firstCardStart, REFERENCE_VIEW, shootReach } from './levels';

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
		'starts where no species draws a card larger than its picture, at every preset',
		async () => {
			for (const id of speciesIds()) {
				const module = await loadSpecies(id);
				if (module.record.lod.nearFoliage !== 'instanced') continue;
				await loadPlantCode(module.record);
				const kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
				let longest = 0;
				for (const prototype of kit.prototypes) longest = Math.max(longest, prototype.length);
				const shoots = kit.record.shoots;
				const scale = shoots ? spreadMax(shoots.placement.scale) : 1;
				for (const detail of DETAILS) {
					const at = { ...kit, detail };
					for (const view of [REFERENCE_VIEW, CLOSE_VIEW]) {
						const start = firstCardStart(at, view);
						// The longest shoot at its largest scale, at the start, spans no more pixels than
						// its card holds texels, nor more than the record asks.
						const spans = pixelsAt(longest * scale, start, view);
						const most = Math.min(kit.record.lod.switchPixels[0], cardTexels(kit.record, detail));
						expect([id, detail, view.fov, spans <= most + 1e-6]).toEqual([
							id,
							detail,
							view.fov,
							true,
						]);
					}
				}
			}
		},
		LONG,
	);

	it('takes the smaller of the record pixels and the card texels', async () => {
		const oak = (await loadSpecies('pedunculate-oak')).record;
		const pine = (await loadSpecies('scots-pine')).record;
		// The oak asks for 240 pixels; its 64-texel cell gives a shoot about 58.
		expect(firstCardPixels(oak, 'high')).toBeCloseTo(60 / 1.04, 6);
		// The pine's cell grows to 128 texels at the high tier, so its cards start nearer there.
		expect(firstCardPixels(pine, 'high')).toBeGreaterThan(firstCardPixels(pine, 'low'));
		// A plant whose foliage is one mesh draws no shoot cards and keeps the record's pixels.
		const hosta = (await loadSpecies('hosta')).record;
		expect(firstCardPixels(hosta, 'high')).toBe(hosta.lod.switchPixels[0]);
	});

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
