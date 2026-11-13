// The date palm on the directed design: one plumb trunk to a single growing point, and round it a
// spiral of 28 living fronds and a ring of 7 dead ones, each frond a piece at a socket of its own
// (pieces.ts), with the date bunches at flower sites under the lowest fronds.
//
// Scale (owner ruling 8, and the lead's ruling on its precedence): the fact sheet gives a palm 15 to
// 25 m tall, and picture 01 gives fronds 0.40 of the height, a crown 0.71 and a trunk 0.064. At 15 m,
// the fact sheet's least, the frond is 6.0 m (inside its 4 to 6 m) and the trunk 0.96 m; no greater
// height keeps the frond inside. Every other size is the pictures' proportion, even where it passes
// the fact sheet: the crown is 10.65 m against 6 to 10, the leaflet 0.66 m against 20 to 40 cm, and
// the palm 1.4 times as tall as wide against 2.5. Those are conflicts in the reference, recorded for
// the owner.
import type { Species } from '../../core/record';
import { FROND, PIECES } from './pieces';
import { record } from './record';

const { forms: _forms, ...own } = record;

/** The record's leaflet, which the directed palm keeps but for its size and outline. */
const leaflet = record.foliage.kind === 'blade' ? record.foliage.leaf : undefined;
if (!leaflet) throw new Error("@null3d/vegetation: the date palm's record lost its blade leaflet");

/** The palm's height: the fact sheet's least, at which picture 01's proportions fit it best. */
const HEIGHT = 15;

/** The date palm's record with the directed crown in place of the grown one. */
export const directed: Species = {
	...own,
	// Picture 01: the trunk is 0.064 of the height wide; the crown 0.71 of the height wide.
	size: { height: { mean: HEIGHT, spread: 1 }, dbh: 0.064 * HEIGHT, aspect: 0.71 },
	growth: {
		model: 'frond-crown',
		trunk: {
			// Picture 01 (an eye on a crop): the growing point, where the rachises meet, stands at 0.73
			// of the height; the turning video reads 0.70 to 0.73.
			height: 0.73 * HEIGHT,
			// Pictures 01 and 02: the same width from the foot to just under the crown. The foot's
			// flare is the stem base's (below).
			width: [
				[0, 0.064 * HEIGHT],
				[1, 0.064 * HEIGHT],
			],
			// Pictures 01, 02 and 18: plumb and straight.
			lean: { mean: 1, spread: 1 },
		},
		fronds: {
			// Picture 05, the view from below: about 28 living fronds, 24 to 32 (about 10 above the
			// crown's centre, 4 to 5 each side, 4 to 6 hanging); picture 01 shows about 20 from one side.
			count: { mean: 28, spread: 4 },
			divergence: 137.5,
			// Picture 05: the frond bases clasp about the top metre of the trunk.
			clasp: 0.9,
			// Picture 01, from the growing point: the share of fronds in each rank and the angle they
			// leave at. The inner, young fronds are 0.7 of a full frond long.
			ranks: [
				{ share: 0.2, leave: 82, piece: 'frond-straight', length: 0.7 },
				{ share: 0.27, leave: 55, piece: 'frond-arched', length: 1 },
				{ share: 0.27, leave: 30, piece: 'frond-arched', length: 1 },
				{ share: 0.18, leave: 8, piece: 'frond-arched', length: 1 },
				{ share: 0.08, leave: -30, piece: 'frond-straight', length: 1 },
			],
		},
		// Picture 05 shows 5 to 6 dead fronds from one side; the turning video hangs them to 0.35 of
		// the height. Picture 01: they hang 60 to 80 degrees below level within 0.45 of a frond of the
		// trunk's axis, their bases in a ring under the living fronds.
		dead: {
			count: { mean: 7, spread: 1 },
			hang: { mean: 70, spread: 10 },
			from: 0.9,
			to: 1.6,
			piece: 'frond-dead',
			length: 0.85,
		},
		// The turning video: four or five bunches in every frame. Picture 01: they hang within 1.5
		// trunk widths of the axis, between 0.63 and 0.70 of the height, so just under the growing
		// point among the lowest living fronds.
		flowers: {
			count: { mean: 4.5, spread: 0.5 },
			from: 0.03 * HEIGHT,
			to: 0.1 * HEIGHT,
			leave: 40,
		},
	},
	pieces: PIECES,
	// The sparsest palm keeps a quarter of each group of sockets, spread round the trunk: nine
	// living fronds from every rank, two dead fronds and two date bunches on the default plant, so
	// the crown still reads as a ball on a column (the specification asks ten, three and two).
	sparse: { limbs: 0.25, leaves: 1, coarseness: 0 },
	// The pieces read their bud and leaf-turn figures here; no shoot class grows on this plant.
	shoots: {
		prototypes: 4,
		classes: [
			{
				name: 'long',
				vigor: [0, 1],
				share: 1,
				length: { mean: FROND, spread: 0 },
				nodes: { mean: 2, spread: 0 },
				internode: 1,
				leafScale: 1,
				leafAngle: 45,
				droop: 0,
			},
		],
		phyllotaxis: { kind: 'opposite', decussate: false },
		orders: 1,
		years: 1,
		leafYears: 1,
		stem: { radius: [0.036, 0.004], zigzag: 0 },
		bud: { length: 0, width: 0, tipCluster: 0 },
		placement: { perMetre: 0, shadePrune: 0, skyward: 0.5, scale: 1 },
	},
	foliage: {
		kind: 'blade',
		leaf: {
			...leaflet,
			// Picture 04, several whole fronds with their leaflets full from base to tip: the longest
			// leaflets 0.10 to 0.12 of the frond (0.66 m on this one, past the fact sheet's 20 to
			// 40 cm, recorded), and a tenth to a twelfth as wide as long (the fact sheet says a
			// fifteenth to a thirtieth). Still 12: widest at 0.35 from the base, a long straight taper
			// to a sharp point. The longest stand at the frond's middle (pieces.ts). A narrow leaflet
			// is a card at the low and medium tiers and a card folded at its midrib at the high and
			// ultra tiers: stills 09 and 12 and the fact sheet show the fold.
			length: { mean: 0.66, spread: 0.05 },
			narrow: true,
			outline: {
				width: [
					[0, 0.012],
					[0.35, 0.042],
					[1, 0.003],
				],
				tip: 'acuminate',
				base: 'cuneate',
			},
			fold: 30,
		},
	},
	base: {
		// Picture 01: the foot flares to 0.078 of the height over its lowest 0.06; still 14: short
		// roots run out between the lowest stubs.
		flare: { amount: 0.22, height: 0.3 },
		...(record.base?.roots ? { roots: record.base.roots } : {}),
	},
	lod: {
		...record.lod,
		nearFoliage: 'instanced',
		budget: {
			...record.lod.budget,
			// The fronds are pieces in the kit, shared by every plant, where the grown palm drew them in
			// each plant's own mesh. Measured at seed 11 over the three variants, kit and variants
			// together: 1.77, 2.14, 2.61 and 3.15 MB at the low, medium, high and ultra tiers, against
			// the grown palm's 9.45, 9.57, 9.72 and 9.99 MB. The kit's own: 0.73, 1.06, 1.53 and
			// 2.05 MB; a plant's: at most 0.44 MB.
			kitBytes: { low: 2_500_000, medium: 2_500_000, high: 2_500_000, ultra: 2_500_000 },
			variantBytes: { low: 600_000, medium: 600_000, high: 600_000, ultra: 600_000 },
		},
	},
	cuttings: { leaf: { pressed: true } },
};
