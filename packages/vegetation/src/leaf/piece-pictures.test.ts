// A piece split into parts keeps its own main stem in the first part; a later part holds side stems
// only. Each run of a part draws the picture of its stem's kind, so no run in a later part may draw
// the main stem's picture.
import { beforeAll, describe, expect, it } from 'bun:test';
import { loadSpecies } from '../core/registry';
import { buildPiecesNow, loadPlantCode } from '../generate';
import { PIECES } from '../species/italian-cypress/pieces';
import type { PiecePrototype } from './piece';

let built: PiecePrototype[];
beforeAll(async () => {
	const module = await loadSpecies('italian-cypress');
	await loadPlantCode(module.record);
	built = buildPiecesNow(module, PIECES);
}, 120_000);

describe("the Italian cypress's split pieces", () => {
	it("draws every run of a later part from its side stems' picture", () => {
		const later = built.filter(
			(piece) => piece.part > 0 && (piece.brushes?.pictures.length ?? 0) === 2,
		);
		expect(later.length).toBeGreaterThan(0);
		const fromMain = later.flatMap((piece) =>
			(piece.brushes?.runs ?? []).filter((run) => run.picture === 0),
		);
		// The main-stem picture stands first, so a later part's run at 0 draws the wrong cord's card.
		expect(fromMain.length).toBe(0);
	});
});
