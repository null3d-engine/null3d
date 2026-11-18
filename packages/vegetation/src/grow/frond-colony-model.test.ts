// The frond-colony family's adapter, read on the bracken: the model holds the sockets and pieces
// its grown plant holds, its pieces are the kit's leaf classes, and its figures are the record's
// own. The grown plant is unchanged by the adapter, which its pinned mesh digest proves.
import { beforeAll, describe, expect, it } from 'bun:test';
import type { SpeciesKitData } from '../asset';
import type { SpeciesModule } from '../core/record';
import { loadSpecies } from '../core/registry';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { emitFrondColony } from './frond-colony';
import { crownOf } from './model';

let bracken: SpeciesModule;
let kit: SpeciesKitData;

beforeAll(async () => {
	bracken = await loadSpecies('bracken');
	await loadPlantCode(bracken.record);
	kit = buildKitNow(bracken, { placeholders: 'missing', detail: 'high' });
});

describe('the frond-colony adapter', () => {
	it('emits the bracken’s sockets and pieces, with the crown from the pieces', () => {
		const model = emitFrondColony({
			record: bracken.record,
			seed: 11,
			variant: 0,
			season: 'summer',
		});
		const asset = growPlantNow(kit, { seed: 11, variant: 0, near: false, detail: 'high' });
		// One socket a standing frond: the model and the grown plant agree at seed 11.
		expect(model.sockets.length).toBe(28);
		expect(asset.skeleton.buds.count).toBe(28);
		// The rhizome's pieces and the stipes: one axis a frond and one under the soil.
		expect(model.axes.length).toBe(56);
		expect(model.pieces.map((piece) => piece.name)).toEqual(
			kit.prototypes.map((prototype) => prototype.piece?.name ?? ''),
		);
		expect(model.pieces.length).toBe(8);
		expect(model.least).toBe(5);
		expect(model.scale).toBe(1);
		expect(model.keepShare).toBe(1);
		// The record's own figures, not a retyped size: the longest frond and the leaf it holds.
		expect(model.pieces[0]?.figures.frondLength).toBeCloseTo(1.04, 6);
		expect(model.pieces[0]?.figures.leafLength).toBeCloseTo(0.96, 6);
		expect(model.pieces[0]?.figures.leafWidth).toBeCloseTo(0.014, 6);
		// A socket's lower side is stated, as a rolled leaf needs it.
		const face = model.sockets[0]?.face;
		expect(face).toBeDefined();
		const length = Math.sqrt((face?.[0] ?? 0) ** 2 + (face?.[1] ?? 0) ** 2 + (face?.[2] ?? 0) ** 2);
		expect(Math.abs(length - 1)).toBeLessThan(1e-6);
		const crown = crownOf(model.sockets, model.pieces);
		expect(crown.top).toBeCloseTo(1.92, 2);
		expect(crown.base).toBeCloseTo(0.221, 3);
		expect(crown.reach).toBeCloseTo(1.049, 3);
	});
});
