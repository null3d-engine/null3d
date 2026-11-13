// The soft tree fern on the directed design: one plumb trunk of root mat on a low mound, a single
// growing point with a tuft of croziers, and round it a spiral of 18 living fronds and a skirt of 14
// dead ones hanging against the trunk, each frond a piece at a socket of its own (pieces.ts).
//
// Scale (owner ruling 8): the fact sheet gives a trunk 2 to 5 m and a crown 4 to 6 m wide; the
// height is 4.4 m, where picture 01's proportions put the crown (1.0 of the height, 4.4 m), the frond
// (0.6, 2.64 m against 1.5 to 3) and the trunk to the growing point (0.72, 3.2 m) inside the fact
// sheet. Every other number is a share of that height read on the pictures named beside it.
import type { Species } from '../../core/record';
import { PIECES } from './pieces';
import { record } from './record';

const { forms: _forms, ...own } = record;

/** The record's pinna, which the directed fern keeps and marks narrow. */
const pinna = record.foliage.kind === 'blade' ? record.foliage.leaf : undefined;
if (!pinna) throw new Error("@null3d/vegetation: the tree fern's record lost its blade pinna");

/** The fern's height. */
const HEIGHT = 4.4;

/** The tree fern's record with the directed crown in place of the grown one. */
export const directed: Species = {
	...own,
	// Pictures 01, 02 and 18: the crown is 1.0, 0.98 and 1.01 of the height wide (row scan); the
	// turning video 0.92 to 1.03. Picture 01: the trunk is 0.15 of the height across.
	size: { height: { mean: HEIGHT, spread: 0.4 }, dbh: 0.15 * HEIGHT, aspect: 1 },
	growth: {
		model: 'frond-crown',
		trunk: {
			// Picture 01: the growing point, where the stalks meet, at 0.72 of the height; the turning
			// video reads 0.72 to 0.76.
			height: 0.72 * HEIGHT,
			// Pictures 01 and 17 and the turning video: one width from the mound to the crown, 0.15 of
			// the height, with no taper and no swelling under the crown. The mound is the stem base's.
			width: [
				[0, 0.15 * HEIGHT],
				[1, 0.15 * HEIGHT],
			],
			// Pictures 01, 02, 17 and 18: plumb and straight.
			lean: { mean: 1, spread: 1 },
		},
		fronds: {
			// Picture 01 at full size: about 17 fronds from one side (seven on the left, three facing
			// the lens, seven on the right), and the dome hides those behind it; picture 05, a close
			// view from below, shows 16 stalks of the inner crown. About 22 in all, 20 to 24.
			count: { mean: 22, spread: 2 },
			divergence: 137.5,
			// Pictures 06 and 07: the stalks leave one growing point, packed side by side.
			clasp: 0.15,
			// Picture 01, from the growing point: the inner fronds leave at 60 to 70 degrees, the middle
			// ones at 30 to 40 and the outer ones at 0 to 15; the middle and outer share one arch.
			ranks: [
				{ share: 0.25, leave: 60, piece: 'frond-inner', length: 1 },
				{ share: 0.4, leave: 35, piece: 'frond-arched', length: 1 },
				{ share: 0.35, leave: 5, piece: 'frond-arched', length: 1 },
			],
		},
		// Pictures 01, 16 and 20: 14 dead fronds (12 to 16) hang flat against the trunk under the living
		// crown, shrivelled to 0.25 of the height (0.42 of a living frond), their tips at 0.42 of the
		// height; the turning video hangs the skirt to 0.45.
		dead: {
			count: { mean: 14, spread: 2 },
			hang: { mean: 84, spread: 4 },
			from: 0.12,
			to: 0.3,
			piece: 'frond-dead',
			length: 0.42,
		},
		// Pictures 05 and 06 and the turning video: 4 to 6 croziers at the centre, each a hairy stalk
		// 0.12 of the height tall ending in a coil about 0.03 of the height across, leaning out by up
		// to 15 degrees.
		croziers: {
			count: { mean: 5, spread: 1 },
			length: { mean: 0.12 * HEIGHT, spread: 0.02 * HEIGHT },
			coil: 540,
			radius: 0.035,
			lean: 15,
		},
	},
	pieces: PIECES,
	// The specification's sparsest fern keeps 8 living fronds and a skirt of 6 of 36, so the dome and
	// the skirt still read: a share of 0.39 of its fronds.
	sparse: { foliage: 0.39 },
	// The pieces read their bud and leaf-turn figures here; no shoot class grows on this plant.
	shoots: {
		prototypes: 4,
		classes: [
			{
				name: 'long',
				vigor: [0, 1],
				share: 1,
				length: { mean: 0.6 * HEIGHT, spread: 0 },
				nodes: { mean: 2, spread: 0 },
				internode: 1,
				leafScale: 1,
				leafAngle: 75,
				droop: 0,
			},
		],
		phyllotaxis: { kind: 'opposite', decussate: false },
		orders: 1,
		years: 1,
		leafYears: 1,
		stem: { radius: [0.016, 0.002], zigzag: 0 },
		bud: { length: 0, width: 0, tipCluster: 0 },
		placement: { perMetre: 0, shadePrune: 0, skyward: 0.5, scale: 1 },
	},
	// The leaf is one pinna (pieces.ts): drawn far as one card a pinna, and near as small folded
	// cards, one a pinnule, on each pinna's midrib.
	foliage: { kind: 'blade', leaf: { ...pinna, narrow: true } },
	base: {
		// Picture 01: the foot widens to 0.175 of the height just above a low root mound 0.53 of the
		// height wide at the ground and 0.08 tall, with concave sides (the turning video: 0.45 and
		// 0.09). A flare of 2.5 times the trunk's radius fading over 0.13 m draws that mound.
		flare: { amount: 2.5, height: 0.13 },
		...(record.base?.roots ? { roots: record.base.roots } : {}),
	},
	lod: {
		...record.lod,
		nearFoliage: 'instanced',
		// A frond's pinnae need the texels across it, so each stretch of its cut card takes a whole
		// cell.
		cardCuts: { cells: 'full' },
		budget: {
			...record.lod.budget,
			// The fronds are pieces in the kit, shared by every plant, where the grown fern drew them in
			// each plant's own mesh, and each frond's cut card takes whole cells. Measured at seed 11
			// over the four variants, kit and variants together: 2.00, 2.07, 2.19 and 2.31 MB at the
			// low, medium, high and ultra tiers, against the grown fern's 5.01, 5.06, 5.21 and 5.43 MB.
			// The kit's own: 1.71, 1.76, 1.84 and 1.93 MB (0.66 to 0.88 at half cells); a plant's at
			// most 102 KB. One card a pinna: the near form is 17,298 triangles at the high tier against
			// the grown fern's 50,393, so the record's near budget stands.
			kitBytes: { low: 2_000_000, medium: 2_000_000, high: 2_000_000, ultra: 2_000_000 },
			variantBytes: { low: 150_000, medium: 150_000, high: 150_000, ultra: 150_000 },
		},
	},
	cuttings: { leaf: { pressed: true } },
};
