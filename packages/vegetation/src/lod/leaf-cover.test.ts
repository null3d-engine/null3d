// The leaf form's cover at each far view, and the far bake's correction of each view to it: a
// record that names the leaf form's own shares opens or closes its far card, and a record without
// them keeps the bake's own share.
import { beforeAll, describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset, SpeciesKitData } from '../asset';
import type { Species } from '../core/record';
import { loadSpecies } from '../core/registry';
import { bakeFarNow, buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import type { FarBake } from '../stages';
import { loadFarBaker } from './impostor';
import { leafCoverPerView } from './leaf-cover';

let kit: SpeciesKitData;
let asset: PlantAsset;

beforeAll(async () => {
	const module = await loadSpecies('pedunculate-oak');
	await loadPlantCode(module.record);
	kit = buildKitNow(module, { placeholders: 'missing', detail: 'low' });
	asset = growPlantNow(kit, { seed: 11, variant: 0, near: true });
	await loadFarBaker();
});

/** The share of a view's texels that the far atlas draws, its cover in the bake's own cell. */
function coverOf(far: FarBake, view: number): number {
	const side = far.views * far.texels;
	const across = view % far.views;
	const down = Math.floor(view / far.views);
	let drawn = 0;
	for (let y = 0; y < far.texels; y++)
		for (let x = 0; x < far.texels; x++) {
			const at = ((down * far.texels + y) * side + across * far.texels + x) * 4 + 3;
			if ((far.color[at] as number) >= 128) drawn++;
		}
	return drawn / (far.texels * far.texels);
}

/** The kit of the same plant with its record naming the given shares at every far view. */
function withCover(shares: readonly number[]): SpeciesKitData {
	const record = kit.record as Species;
	const lod = { ...record.lod, farCover: shares };
	return { ...kit, record: { ...record, lod } as Species };
}

describe('the leaf form cover per far view', () => {
	it(
		'measures a share for every view of the far atlas, each a covered share',
		async () => {
			const covers = await leafCoverPerView(kit, asset);
			expect(covers.length).toBe(asset.impostor.views * asset.impostor.views);
			for (const share of covers) {
				expect(share).toBeGreaterThanOrEqual(0);
				expect(share).toBeLessThanOrEqual(1);
			}
			// A crown covers a fair share of its own cell from some view and never all of it.
			const mean = covers.reduce((sum, share) => sum + share, 0) / covers.length;
			expect(mean).toBeGreaterThan(0.1);
			expect(mean).toBeLessThan(0.9);
		},
		scaledBudget(240_000),
	);
});

describe('the far bake’s per-view correction', () => {
	it(
		'draws each view at the cover its record names, and keeps its own where none is named',
		() => {
			const views = asset.impostor.views;
			const plain = bakeFarNow(kit, asset);
			const lean = bakeFarNow(withCover(new Array<number>(views * views).fill(0.05)), asset);
			const full = bakeFarNow(withCover(new Array<number>(views * views).fill(0.6)), asset);
			// The share the bake's own cut draws, and a view where a target moves it: a view the
			// plain bake draws sparsely opens further, and one it draws fully closes.
			let open = -1;
			let closed = -1;
			let opened = 0;
			let shut = 0;
			for (let view = 0; view < views * views; view++) {
				const share = coverOf(plain, view);
				if (open < 0 || share < coverOf(plain, open)) open = view;
				if (closed < 0 || share > coverOf(plain, closed)) closed = view;
			}
			opened = coverOf(full, open) - coverOf(plain, open);
			shut = coverOf(plain, closed) - coverOf(lean, closed);
			expect(opened).toBeGreaterThan(0);
			expect(shut).toBeGreaterThan(0);
		},
		scaledBudget(240_000),
	);
});
