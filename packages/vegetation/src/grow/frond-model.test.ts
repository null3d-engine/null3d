// The family adapter read on its second species: the date palm's model holds the sockets and pieces
// its grown plant holds, and its crown is the pieces' own. The tree fern's case sits in the
// rosette's test, where the planned record lives.
import { beforeAll, describe, expect, it } from 'bun:test';
import type { SpeciesKitData } from '../asset';
import { BUD_FLOWER } from '../core/graph';
import type { SpeciesModule } from '../core/record';
import { loadSpecies } from '../core/registry';
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
		// The adapter lays the record's own counts: 56 living and 20 dead, each within its spread.
		expect(model.sockets.length).toBeGreaterThanOrEqual(56 - 4 + 20 - 4);
		expect(model.sockets.length).toBeLessThanOrEqual(56 + 4 + 20 + 4);
		expect(grown).toBeGreaterThanOrEqual(56 - 4 + 20 - 4);
		expect(grown).toBeLessThanOrEqual(56 + 4 + 20 + 4);
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
