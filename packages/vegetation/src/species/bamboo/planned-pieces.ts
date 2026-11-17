// The bamboo's planned pieces: the fan of blades that a planned twig's socket carries, cut from
// the directed pair's own twig (pieces.ts). A candidate for the class study; the directed clump
// keeps PIECES, and the index still exports the directed record.
import type { PieceRule } from '../../leaf/piece';
import { FAN } from './pieces';

/** The planned crown's piece: one twig's fan, the blades a socket at a twig carries. */
export const PLANNED_PIECES: readonly PieceRule[] = [
	{
		name: 'fan',
		attitude: 'along',
		variants: 2,
		stem: {
			length: { mean: 0.16, spread: 0.04 },
			radius: [0.0025, 0.001],
			droop: 15,
			bud: false,
			leaves: FAN,
		},
	},
];
