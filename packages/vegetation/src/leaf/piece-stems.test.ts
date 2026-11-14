// A brush piece may keep the stems of the orders it names whole, so a card that stands for a subtree
// hangs from its own stem. Stems below the named order still end where their leaves hide them.
import { beforeAll, describe, expect, it } from 'bun:test';
import { loadSpecies } from '../core/registry';
import { DETAILS } from '../core/types';
import { buildPiecesNow, loadPlantCode } from '../generate';
import { type PieceRule, type PieceStem } from './piece';
import { SURFACE_BRUSH } from './writer';

let module: Awaited<ReturnType<typeof loadSpecies>>;
beforeAll(async () => {
	module = await loadSpecies('pedunculate-oak');
	await loadPlantCode(module.record);
}, 120_000);

/** A stem whose leaves run densely from its base to its tip, so the stem is hidden along all of it. */
function hiddenStem(length: number, sides?: PieceStem['sides']): PieceStem {
	return {
		length: { mean: length, spread: 0 },
		radius: [0.006, 0.002],
		leaves: {
			gap: 0.002,
			from: 0,
			to: 1,
			angle: [
				[0, 20],
				[1, 20],
			],
		},
		bud: false,
		...(sides ? { sides } : {}),
	};
}

const RULE: PieceRule = {
	name: 'stems',
	attitude: 'plumb',
	variants: 1,
	brushCards: true,
	brushHidesStems: true,
	stem: hiddenStem(0.2, [
		{
			stem: hiddenStem(0.12, [
				{
					stem: hiddenStem(0.06),
					gap: 0.02,
					from: 0.3,
					to: 1,
					arrangement: 'alternate',
					angle: { mean: 40, spread: 0 },
				},
			]),
			gap: 0.06,
			from: 0.3,
			to: 1,
			arrangement: 'alternate',
			angle: { mean: 45, spread: 0 },
		},
	]),
};

/** The wood vertices of the piece's high tier, the brush quads left out. */
function wood(rule: PieceRule): number {
	const tier = DETAILS.indexOf('high');
	let count = 0;
	for (const piece of buildPiecesNow(module, [rule]))
		for (let v = 0; v < (piece.tiers[tier]?.positions.length ?? 0) / 3; v++)
			if ((piece.tiers[tier]?.colors[v * 4 + 2] as number) !== SURFACE_BRUSH) count++;
	return count;
}

describe('a brush piece that keeps an order of stems', () => {
	it('holds more wood the lower the order it keeps, and ends the stems below it', () => {
		const hidden = wood(RULE);
		const noOrder = wood({ ...RULE, brushStemKeep: 0 });
		const branchlets = wood({ ...RULE, brushStemKeep: 1 });
		const everyOrder = wood({ ...RULE, brushStemKeep: 2 });
		// The hidden cut ends every hidden stem; keeping order 0 keeps the main stem, keeping the
		// branchlets' order adds their stems, which the cards of whole subtrees hang from, and a
		// deeper order adds the rest.
		expect(noOrder).toBeGreaterThan(hidden);
		expect(branchlets).toBeGreaterThan(noOrder);
		expect(everyOrder).toBeGreaterThanOrEqual(branchlets);
	}, 60_000);
});
