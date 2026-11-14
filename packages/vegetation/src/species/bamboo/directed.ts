// The bamboo on the directed design: a clump of jointed culms from one foot, bare to about 0.4 of
// the height and then a plume of branch pairs, each pair a piece at a socket of its own (pieces.ts).
//
// Scale: no fact sheet gives this clump's size. The record's height, 8 m, is kept, and every other
// size is a share of it read on the pictures named beside it. A culm is then 0.15 m across and a
// leaf 0.16 m long; no real bamboo is 8 m tall with culms that wide and leaves that long, which is
// recorded as a limit of the reference.
//
// Parts the pictures show that this record does not draw: the rhizome (picture 14), which shows only
// where the ground is cut; the hollow culm and its wall (picture 20), which shows only on a cut culm;
// and the leaf litter round the foot (pictures 06 and 19), a stand's ground.
//
// Reference conflict, the crown's openness: picture 01 shows a fuller crown than pictures 02 and 18,
// which show airy vases of separated fans. The drawing stands 0.05 open at 01 against the first and
// 0.15 to 0.20 closed at 02 and 18 against the others, and every opening lever moves all three
// together. The CPU preview's own pairs, enclosed sky at the first card level and the leaf form
// (photographs 0.127, 0.376 and 0.206 by the same rule): base 01 0.176 and 0.223, 02 0.171 and
// 0.224, 18 0.199 and 0.246; the full and whip pairs' sub-branch count from four to three 0.212 and
// 0.264, 0.210 and 0.257, 0.246 and 0.288; the whips alone from four to two 0.220 and 0.260, 0.215
// and 0.255, 0.254 and 0.292. The three stills cannot be met by one crown, so the eye decides; the
// sub-branch count of four to three is the candidate, its move the smallest.
//
// Picture 21's leaf colour, a shared light fault: the photograph's greens mean 106 / 130 / 39 sRGB,
// the judged drawing 89 / 122 / 42, darker in red and green and slightly bluer. The piece's albedo is
// the texture's, and three levers of the fan left the means where they were: the cone from 15 to 8
// degrees 90 / 123 / 44, the tilt from 25 to 10 degrees 91 / 124 / 46, and the leaves' spread from 8
// to 20 degrees 89 / 122 / 42. The shift is toward shadow, which the review's daylight and the fan's
// self-shading give together, so it is not fitted from the record.
import type { Species } from '../../core/record';
import { PIECES } from './pieces';
import { record } from './record';

const { forms: _forms, ...own } = record;

/** The record's bark, whose culm zone the directed clump tints. */
const bark = record.bark;
if (!bark) throw new Error("@null3d/vegetation: the bamboo's record lost its bark");

/** The record's leaf, which the directed clump keeps and marks narrow. */
const leaf = record.foliage.kind === 'blade' ? record.foliage.leaf : undefined;
if (!leaf) throw new Error("@null3d/vegetation: the bamboo's record lost its blade leaf");

/** The clump's height. */
const HEIGHT = 8;

/** The bamboo's record with the directed clump in place of the grown one. */
export const directed: Species = {
	...own,
	size: { ...record.size, height: { mean: HEIGHT, spread: 1 }, dbh: 0.019 * HEIGHT },
	growth: {
		model: 'culm-clump',
		// Picture 01: 18 to 20 culms at the foot from one side; the turning video shows 15 to 20 in
		// each frame with sky between them, so few are hidden: about 22, 18 to 26.
		culms: { mean: 22, spread: 4 },
		// Picture 01, row 650: the bundle is 0.22 of the height across at the ground; the turning video
		// 0.25 to 0.27.
		foot: 0.12 * HEIGHT,
		// The plume is 0.85 of the height wide at 0.8 of it (picture 01); its narrow side 0.75 of that
		// (owner ruling 1, the crown plan).
		depth: 0.75,
		// Pictures 01 and 02: the thick culms reach 0.85 to 1.0 of the height.
		height: [0.85, 1],
		// Pictures 01 and 17: a thick culm is 0.019 of the height across.
		diameter: { mean: 0.019 * HEIGHT, spread: 0.002 * HEIGHT },
		// Picture 01 and the turning video: a third of the culms, most at the rim, are half as wide
		// and 0.6 to 0.8 of the height tall.
		thin: { share: 0.33, height: [0.6, 0.8], diameter: 0.5, scale: 0.75 },
		// Pictures 17, 04 and 21: joints 2.0 diameters apart at the foot, rising to 3.3, a little
		// shorter again under the tip: about 20 to a culm.
		joints: [
			[0, 2],
			[0.4, 3.1],
			[0.8, 3.3],
			[1, 2.8],
		],
		// Picture 15: the joint is a raised ring about a third of a centimetre high.
		ridge: 0.004,
		// Picture 01: the rim's culms lean 10 degrees out at the foot and bow to 30 near the top.
		lean: { foot: 10, tip: 30 },
		branches: {
			// Picture 01 and the turning video: the canes stand bare to 0.38 to 0.40 of the height; the
			// branches start at 0.35 on the rim's culms and 0.5 on the middle ones.
			from: { rim: 0.35, centre: 0.5 },
			// Pictures 01 and 22: a pair's first branch leaves 30 to 40 degrees from the culm.
			leave: { mean: 55, spread: 5 },
			pieces: [
				{ from: 0, piece: 'pair-low' },
				{ from: 0.25, piece: 'pair-full' },
				{ from: 0.75, piece: 'pair-whip' },
			],
		},
		tip: 'pair-whip',
		// Pictures 07 and 19: papery sheaths stay on the lowest joints.
		sheaths: { upTo: 0.06 },
	},
	pieces: PIECES,
	extras: [
		{
			// Pictures 07, 16 and 19: papery sheaths stay on the lowest joints, flaring wider than the
			// culm they wrap. Their measurements are in the culm's own radius, so a sheath on a thin
			// culm hangs to the same share of its width as one on a thick culm.
			kind: 'sheath',
			at: 'culm-node',
			share: 0.5,
			count: 1,
			seasons: ['summer', 'autumn', 'winter', 'blossom'],
			shape: {
				byWoodRadius: true,
				lathe: [
					[1, 0],
					[1.42, 0.25],
					[1.5, 0.58],
					[1.42, 1.08],
					[1.25, 1.5],
				],
				sides: 10,
			},
			colour: [0.34, 0.27, 0.16],
			roughness: [0.85, 0.85],
			hang: 0,
		},
		{
			// Picture 15: each joint crosses the smooth green skin as a raised ring, a sixteenth of the
			// culm's width proud of the wood. The profile is in the culm's own radius, so every joint
			// of every culm carries the same ring.
			kind: 'ring',
			at: 'culm-joint',
			share: 1,
			count: 1,
			seasons: ['summer', 'autumn', 'winter', 'blossom'],
			shape: {
				byWoodRadius: true,
				lathe: [
					[0.99, 0],
					[1.0, 0.03],
					[1.06, 0.06],
					[1.06, 0.1],
					[1.0, 0.13],
					[0.99, 0.16],
				],
				sides: 10,
			},
			colour: [0.3, 0.25, 0.15],
			roughness: [0.8, 0.8],
			hang: 0,
		},
	],
	bark: {
		...bark,
		// The culm texture keeps picture 26, a close-up far greener than the plant's own culms (green
		// pixels' means, sRGB): 15 97 / 116 / 46, 17 72 / 102 / 47, 07 86 / 113 / 50 and 01 77 / 94 /
		// 36, a mean of 0.088 / 0.146 / 0.026 in linear light against the texture's 0.127 / 0.342 /
		// 0.012. The tint takes the texture to that mean.
		zones: bark.zones.map((zone) => ({ ...zone, tint: [0.69, 0.43, 2.2] as const })),
	},
	// The leaf is narrow, about a sixth as wide as long (picture 12: 216 of 1,328 px): a card at the low and
	// medium tiers and a card folded at its midrib at the high and ultra tiers, so a clump of some
	// three hundred branch pairs stays inside its near budget.
	foliage: { kind: 'blade', leaf: { ...leaf, narrow: true } },
	// A working figure: the sparsest clump keeps 0.4 of its branch pairs.
	sparse: { foliage: 0.4 },
};
