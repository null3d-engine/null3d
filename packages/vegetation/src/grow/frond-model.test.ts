// The family adapter read on its second species: the date palm's model holds the sockets and pieces
// its grown plant holds, and its crown is the pieces' own. The tree fern's case sits in the
// rosette's test, where the planned record lives.
import { beforeAll, describe, expect, it } from 'bun:test';
import type { SpeciesKitData } from '../asset';
import { BUD_FLOWER } from '../core/graph';
import type { FrondCrown, SpeciesModule } from '../core/record';
import { loadSpecies } from '../core/registry';
import { spreadMean } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { crownOf } from './model';
import { emitFrondCrown } from './planned-rosette';

let palm: SpeciesModule;
let kit: SpeciesKitData;

beforeAll(async () => {
	palm = await loadSpecies('date-palm');
	await loadPlantCode(palm.record);
	kit = buildKitNow(palm, { placeholders: 'missing', detail: 'high' });
});

describe('the frond crown adapter', () => {
	it('emits the date palm’s sockets and pieces, with the crown from the pieces', () => {
		const model = emitFrondCrown({ record: palm.record, seed: 11, variant: 0 });
		const asset = growPlantNow(kit, { seed: 11, variant: 0, near: false, detail: 'high' });
		const { buds } = asset.skeleton;
		let grown = 0;
		for (let b = 0; b < buds.count; b++) if ((buds.kind[b] as number) !== BUD_FLOWER) grown++;
		// The record's means are 56 living and 20 dead. Each grower samples each count within its
		// spread: the model lays the means, 56 + 20, at seed 11, and the directed grower happens to
		// lay 59 + 20. The three sockets are the seed's sampling, which the planned model drops, not a
		// loss. The means, the sums and the sampled counts are all pinned, so a record edit fails on
		// the figure it changed.
		const growth = palm.record.growth as FrondCrown;
		const living = spreadMean(growth.fronds.count);
		const dead = growth.dead ? spreadMean(growth.dead.count) : 0;
		expect(living).toBe(56);
		expect(dead).toBe(20);
		expect(model.sockets.length).toBe(living + dead);
		expect(model.sockets.length).toBe(76);
		expect(grown).toBe(79);
		expect(model.pieces.map((piece) => piece.name)).toEqual(
			(palm.record.pieces ?? []).map((piece) => piece.name),
		);
		expect(model.least).toBeGreaterThan(0);
		expect(model.keepShare).toBe(1);
		const crown = crownOf(model.sockets, model.pieces);
		// A frond crown's skeleton ends at the trunk; its fronds stand above it and hang under it.
		expect(crown.top).toBeGreaterThan(asset.skeleton.height);
		expect(crown.base).toBeGreaterThan(0);
		expect(crown.reach).toBeGreaterThan(0);
	});
});
