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

/** The record's bark, which the directed palm keeps and tints where it draws a rachis. */
const bark = record.bark;
if (!bark) throw new Error("@null3d/vegetation: the date palm's record lost its bark");

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
			// Pictures 01 and 02: the same width from the foot to just under the crown. Pictures 05
			// and 16: inside the crown the trunk ends among the frond bases that clasp its top metre,
			// so it closes there to a blunt cone rather than standing up as a flat cap. The foot's
			// flare is the stem base's (below).
			width: [
				[0, 0.064 * HEIGHT],
				[0.92, 0.064 * HEIGHT],
				[0.97, 0.045 * HEIGHT],
				[1, 0.02 * HEIGHT],
			],
			// Pictures 01, 02 and 18: plumb and straight.
			lean: { mean: 1, spread: 1 },
		},
		fronds: {
			// Picture 01 at full size shows 22 to 24 living fronds from one side (some 6 steep, 9
			// spreading, 8 hanging), the turning video 18 to 24 a frame and picture 05 from below 24.
			// The crown takes the pictures' highest one-side reading, doubled: 48 in all. At 40 the
			// crown drew 0.44 of its own sky against the photographs' 0.20 (the preview's match, 01).
			count: { mean: 48, spread: 4 },
			divergence: 137.5,
			// Picture 05: the frond bases clasp about the top metre of the trunk.
			clasp: 0.9,
			// Picture 01, from the growing point: the share of fronds in each rank and the angle they
			// leave at. The inner, young fronds are 0.7 of a full frond long. Pictures 01 and 04 and
			// the turning video: the fronds fill one even dome from near upright to hanging, in layers
			// 10 to 15 degrees apart. The shares follow the picture's 6 steep, 9 spreading and 8
			// hanging from one side, so a quarter of the fronds hang; at an eighth the crown's sky
			// stood 0.01 wider at 01 (the preview's match).
			ranks: [
				{ share: 0.15, leave: 82, spread: 6, piece: 'frond-straight', length: 0.7 },
				{ share: 0.2, leave: 55, spread: 12, piece: 'frond-arched', length: 1 },
				{ share: 0.2, leave: 30, spread: 11, piece: 'frond-arched', length: 1 },
				{ share: 0.2, leave: 8, spread: 11, piece: 'frond-arched', length: 1 },
				{ share: 0.25, leave: -30, spread: 15, piece: 'frond-straight', length: 1 },
			],
		},
		// Picture 20: a dense curtain of about 15 dead fronds from one side, 2.9 times the trunk wide,
		// so about 20 in all (16 to 24); the turning video hangs them to 0.35 of the height. Picture
		// 01: they hang 60 to 80 degrees below level within 0.45 of a frond of the trunk's axis, their
		// bases in a ring under the living fronds.
		dead: {
			count: { mean: 20, spread: 4 },
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
			from: 0.01 * HEIGHT,
			to: 0.03 * HEIGHT,
			// The stalk arches out before it hangs, so the bunch stands clear of the trunk.
			leave: 20,
		},
	},
	pieces: PIECES,
	extras: [
		{
			// Picture 01: four or five bunches, each a ball about 0.06 of the height across (0.9 m) of
			// many thin strands lined with dates, on a stalk 0.08 of the height long (1.2 m) that arches
			// out and hangs; still 19: a date three times as long as its strand is thick, yellow turning
			// orange. The fact sheet: dates 3 to 7 cm, yellow to orange-brown. Each date hangs on its own
			// strand from the stalk's end, out to the ball's 0.45 m radius, so the bunch fills its
			// outline: some 230 dates of five sides and five rings on four-sided strands, inside the
			// plant's budget.
			kind: 'fruit',
			at: 'flower',
			share: 1,
			count: { mean: 230, spread: 30 },
			seasons: ['summer', 'autumn'],
			shape: {
				lathe: [
					[0.002, 0],
					[0.0095, 0.012],
					[0.0095, 0.04],
					[0.005, 0.058],
					[0, 0.066],
				],
				sides: 5,
				stalk: 0.08 * HEIGHT,
				pedicel: 0.45,
				stalkSides: 4,
			},
			colour: [0.6, 0.3, 0.03],
			// The stalk is the orange of the picture's bunch stems.
			stalkColour: [0.5, 0.28, 0.05],
			roughness: [0.45, 0.6],
			// The stalk leaves its site outward and bends down by this much more, so the bunch hangs
			// clear of the trunk, within one and a half trunk widths of its axis as picture 01 shows.
			hang: 30,
		},
	],
	// The specification's sparsest palm keeps 10 living fronds and 3 dead ones of 35, so the crown
	// still reads as a ball on a column: a share of 0.37 of its fronds.
	sparse: { foliage: 0.37 },
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
			// leaflets 0.10 to 0.12 of the frond (0.72 m, the picture's most, past the fact sheet's
			// 20 to 40 cm, recorded), and a tenth to a twelfth as wide as long (the fact sheet says a
			// fifteenth to a thirtieth). At 0.66 m the crown drew 0.39 of its own sky at 01. Still 12: widest at 0.35 from the base, a long straight taper
			// to a sharp point. The longest stand at the frond's middle (pieces.ts). A narrow leaflet
			// is a card at the low and medium tiers and a card folded at its midrib at the high and
			// ultra tiers: stills 09 and 12 and the fact sheet show the fold.
			length: { mean: 0.72, spread: 0.05 },
			// The upper face as the plant's own pictures show its leaflets (green pixels' means, in
			// sRGB): 04 96 / 108 / 90, 09 114 / 126 / 99, 11 114 / 125 / 103, 12 110 / 128 / 107, 21
			// 112 / 122 / 103 and 22 124 / 134 / 116, their mean 112 / 124 / 103. The texture's source,
			// picture 24, is the darkest and yellowest of them (74 / 88 / 67), and the texture keeps it.
			optics: { ...leaflet.optics, reflectance: [0.162, 0.201, 0.136] },
			narrow: true,
			outline: {
				width: [
					[0, 0.013],
					[0.35, 0.046],
					[1, 0.003],
				],
				tip: 'acuminate',
				base: 'cuneate',
			},
			fold: 30,
		},
	},
	bark: {
		...bark,
		// The frond's rachis draws the young layer, the bark photograph smoothed to a rachis. Still
		// 22: the photograph's rachis is 1.51 / 1.29 / 0.65 of its leaflets' colour, where the drawing's
		// stood at 1.30 / 0.99 / 0.98, tan; this tint takes it to the photograph's pale yellow-green.
		youngTint: [1.16, 1.3, 0.66],
	},
	seasons: {
		...record.seasons,
		// The dead fronds' brown, which their browning mixes toward: against each picture's leaflets,
		// in linear light, picture 01 shows 1.43 / 0.76 / 0.65, 02 0.84 / 0.49 / 0.36, 05 1.18 / 0.67 /
		// 0.65 and 20 1.00 / 0.55 / 0.62; their mean, 1.11 / 0.62 / 0.57, on the leaflets' own light.
		autumn: { reflectance: [0.18, 0.125, 0.078], transmittance: [0.1, 0.081, 0.034] },
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
		// A frond's leaflets need the texels across it: at half cells the palm's frond, 1.26 m
		// across, draws 4.5 cm a texel across where whole cells give 2.1 cm.
		cardCuts: { cells: 'full' },
		budget: {
			...record.lod.budget,
			// The fronds are pieces in the kit, shared by every plant, where the grown palm drew them in
			// each plant's own mesh, and each plant draws its own date bunches, about 90 dates on
			// each of four or five. Measured at seed 11 over the three variants, kit and variants
			// together: 4.06, 4.22, 4.44 and 4.83 MB at the low, medium, high and ultra tiers, against
			// the grown palm's 9.45, 9.57, 9.72 and 9.99 MB. The kit's own: 0.73, 0.85, 1.06 and
			// 1.43 MB; a plant's at most 1.38 MB, the dates most of it.
			// The ultra kit's own cap rises once, to its measure plus a twentieth, by the lead's
			// ruling on 14 November 2026: 2,602,980 bytes measured at seed 11 over the three
			// variants (kit 1.80 / 1.94 / 2.19 / 2.60 MB at low / medium / high / ultra), after the
			// leaflets went to 102 a side, the fronds to 48 and the leaflet to 0.72 m, which took the
			// crown's own sky at 01 from 0.45 to 0.33 against the photographs' 0.20. The other tiers
			// stay at 2.5 MB and the palm class's cap at 4 MB.
			kitBytes: { low: 2_500_000, medium: 2_500_000, high: 2_500_000, ultra: 2_733_000 },
			variantBytes: { low: 1_600_000, medium: 1_600_000, high: 1_600_000, ultra: 1_600_000 },
		},
	},
	cuttings: { leaf: { pressed: true } },
};
