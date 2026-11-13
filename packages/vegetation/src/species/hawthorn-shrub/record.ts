// The hawthorn, open-grown: a many-stemmed stool carrying a dense low dome of foliage almost to
// the grass, wider than it is tall. Each stem divides low into a tangle of stiff, angular, thorny
// twigs. The leaves are small and deeply lobed, carried in tufts on short spur shoots, and in
// autumn dark red haws hang from the same twigs.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference
// turntable by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable; the
// shoot classes from the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from
// the texture source's contour and the single-leaf stills; the bark from the bark stills; the
// thorns and the haws from the thorn and fruit stills. The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/** Internodes along a spur: one long first internode, then the leaves crowd at its tip. */
const ROSETTE: readonly (readonly [number, number])[] = [
	[0, 20],
	[0.15, 0.6],
	[1, 0.3],
];

/**
 * Internodes along a spray's growth unit: the leaves crowd into the unit's last tenth, so a tuft
 * holds together at its twig's end.
 */
const TIGHT_ROSETTE: readonly (readonly [number, number])[] = [
	[0, 40],
	[0.12, 0.5],
	[1, 0.25],
];

/** A tuft's leaves, a little smaller than the record's own leaf. */
const TUFT_SCALE: readonly (readonly [number, number])[] = [
	[0, 0.85],
	[1, 1],
];

/** Degrees between a tuft's leaves and its twig, older leaves lowest and widest. */
const TUFT_ANGLE: readonly (readonly [number, number])[] = [
	[0, 130],
	[0.5, 95],
	[1, 60],
];

/** The hawthorn's record. */
export const record: Species = {
	id: 'hawthorn-shrub',
	name: 'Hawthorn',
	latin: 'Crataegus monogyna',
	form: 'many-stemmed thorny shrub in a dense low dome',
	// Stills 07 and 18: several stems leave one stool and fan out, so no single bole can carry the
	// plant. Still 18 stands the thickest stem about two hundredths of the height across at breast
	// height. Its height is read from the stems' own size in still 07; its spread and crown base are
	// the fit's.
	// Stills 07 and 18 stand the thickest stem at about two hundredths of the height across at
	// breast height; the first setting drew it at 0.0156. The bend keeps its own girth below, so
	// the thicker drawn wood does not stiffen the crown's sag.
	size: { height: { mean: 4, spread: 0.6 }, dbh: 0.103, aspect },
	growth: {
		model: 'self-organizing',
		years: 30,
		macroOrders: 4,
		// Stills 01, 02 and 18: the foliage reaches almost to the grass, so the envelope keeps its room
		// almost from its own base, cut flat only at the stool's height where the bare stems stand.
		floor: 0.04,
		// Stills 01, 02 and 09: the stool is a dense thicket, so more lateral buds flush than the
		// light alone gives and the crown reads as one mass rather than a few limbs.
		branching: 2,
		// Stills 03, 06 and 09: the stool's limbs crowd and cross, so the thick wood keeps a little
		// clear air and the fine twigs keep their own tangle.
		clearance: 0.1,
		clearanceThickness: 0.35,
		turning: 30,
		internode: { length: 0.22, ageFactor: 0.99 },
		// Still 07: several stems stand from one stool, each leaning out as it leaves the soil.
		stems: {
			count: { mean: 7, spread: 1 },
			lean: { mean: 20, spread: 6 },
			stool: 0.3,
			fused: 0.5,
		},
		buds: {
			arrangement: { kind: 'spiral', divergence: 137.5 },
			// Still 09: the side twigs leave their branch at wide, irregular angles.
			angle: [
				[0.25, 52],
				[1, 60],
			],
			angleSpread: 10,
			extinction: [0.01, 0.02],
		},
		// Stills 01 and 02: the dome is broader than it is tall, and its top stays broad rather than
		// running to a point, so the leader carries the crown high while its laterals fill the top
		// round it.
		apical: {
			control: [
				[0, 0.5],
				[1, 0.54],
			],
			dominance: [0.7, 0.6, 0.98],
			wander: 16,
		},
		// Still 07 and 17: the stems run up bare for about two fifths of the height and then divide
		// into a few limbs that fan out round them; the stool's stems take the stair above.
		divide: { at: 0.4, count: 4, angle: 62, lean: 28, plumb: 4 },
		// Stills 01 and 02: the crown's lit surface carries its fullest shoots.
		light: { apical: 1, lateral: 1.2, shadow: [5, 0.15, 2], cells: 96, surface: true },
		// Stills 01 and 02: the limbs run out level to build the dome's skirt, and only the outermost
		// tips turn up.
		tropism: {
			photo: 0.05,
			gravi: [
				[0, 0.1],
				[0.2, 0],
				[0.55, 0],
				[0.85, 0.02],
				[1, 0.06],
			],
		},
		// Stills 01, 02 and 18: foliage stands almost to the grass, with only the stool itself bare,
		// and no low shoot is lost to the shade of the crown above it. The drawn dome sits taller
		// than the photographs' and keeps its mass too high, so the tender shoots in the crown's
		// shade are shed a little more readily than the first setting allowed.
		shedding: { threshold: 0.06, cleanBole: 0, stubs: 0.1, underCrown: 0 },
		// The bend weighs the wood at the stem's own girth, so a thin stool sags a little and its
		// tips right themselves.
		bending: { strength: 0.2, upturn: 0.3, girth: 0.1 },
		forkRule: true,
		kinks: true,
		// Stills 04 and 10: the foliage meets the wood at every twig. A twig under the far view's
		// pixel draws nothing, so the tip keeps enough radius for its leaf group to stand on.
		pipe: { exponent: 2.3, tipRadius: 0.004 },
	},
	envelope,
	shoots: {
		prototypes: 6,
		classes: [
			{
				// Stills 11 and 23: a spur shoot of this year carries five or six lobed leaves in one
				// rosette round its bud cluster, the oldest leaf lowest and widest.
				name: 'short',
				vigor: [0, 0.05],
				share: 0.35,
				years: 1,
				length: { mean: 0.03, spread: 0.006 },
				// Five or six leaves in the rosette as stills 11 and 23 show, standing round the shoot's
				// axis on the golden angle rather than in a fan along one plane.
				phyllotaxis: { kind: 'rosette-spur', leaves: { mean: 6, spread: 0.6 } },
				nodes: { mean: 6.5, spread: 0.5 },
				internode: ROSETTE,
				leafScale: TUFT_SCALE,
				leafAngle: [
					[0, 150],
					[0.5, 100],
					[1, 55],
				],
				leafAngleSpread: 30,
				droop: 3,
			},
			{
				// Stills 09 and 10: last year's shoot, whose end tuft put out this year's spurs; the
				// twig runs stiff and thin between them.
				name: 'long',
				vigor: [0.05, 0.5],
				share: 0.35,
				years: 2,
				length: { mean: 0.14, spread: 0.03 },
				nodes: { mean: 7, spread: 0.5 },
				leafYears: 1,
				internode: ROSETTE,
				stem: { radius: [0.005, 0.003] },
				// Still 09: the side twigs leave the stem one at a time, a few centimetres apart,
				// rather than as a fan from one point.
				laterals: 2,
				lateralGap: 0.4,
				// Stills 08 and 19: the twigs run stiff and angular between their nodes.
				bend: { length: 0.05, angle: 32 },
				leafScale: [
					[0, 1],
					[1, 1],
				],
				leafAngle: TUFT_ANGLE,
				droop: 4,
			},
			{
				// Still 21: a branch's last years of short stiff twigs, bare between the tufts of spurs,
				// each tuft at the end of a zigzag run.
				name: 'spray',
				vigor: [0.5, 1],
				share: 0.3,
				years: 3,
				length: { mean: 0.28, spread: 0.05 },
				nodes: { mean: 7, spread: 0.5 },
				internode: TIGHT_ROSETTE,
				stem: { radius: [0.012, 0.005] },
				lateral: 55,
				laterals: { mean: 1.5, spread: 0.4 },
				lateralGap: 0.3,
				bend: { length: 0.05, angle: 32 },
				leafScale: TUFT_SCALE,
				leafAngle: TUFT_ANGLE,
				droop: 5,
			},
		],
		// Stills 21 and 22: a cut twig forks at last year's joint into two shoots, each ending in a
		// tuft of leaves, with the wood bare between the joints. The crown cannot carry shoots this
		// open, so the cuttings draw this class and the crown never does.
		cuttingClasses: [
			{
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 2,
				length: { mean: 0.3, spread: 0.08 },
				nodes: { mean: 6, spread: 0.5 },
				internode: ROSETTE,
				stem: { radius: [0.007, 0.003] },
				lateral: 55,
				laterals: 2,
				lateralGap: 0.4,
				bend: { length: 0.05, angle: 32 },
				leafScale: [
					[0, 0.9],
					[1, 1.1],
				],
				leafAngle: TUFT_ANGLE,
				droop: 4,
			},
		],
		phyllotaxis: { kind: 'spiral', divergence: 144 },
		orders: 3,
		years: 3,
		leafYears: 2,
		stem: { radius: [0.003, 0.002], zigzag: 20 },
		// Stills 10, 11 and 23: a small chestnut bud, two or three millimetres long, stands in the
		// tuft's centre, with a few below it at the spur's end.
		bud: {
			length: 0.004,
			width: 0.003,
			tipCluster: 5,
			cluster: { step: 0.3, lean: 45 },
			colour: [0.22, 0.1, 0.05],
		},
		placement: {
			// Stills 01, 02 and 09: the shrub's finest axes are crowded with foliage, so every stretch
			// of them carries shoots.
			// Stills 09 and 10: a limb carries a spray of short twigs along its length, not one stem
			// with a tuft at its end, so the finest axes bear shoots closely.
			perMetre: [
				[0, 7.5],
				[0.55, 9.5],
				[1, 16],
			],
			// The reference's dome is denser than the curve alone gives: this is the dial, not a
			// change of reach or part size. The first card level's shared cap sets the most the crown
			// may carry, so the dial stands where every variant and season fits under it.
			density: 1.63,
			shadePrune: 0,
			// Stills 01, 03 and 05: sky shows through the crown's middle and under it, where its own
			// leaves leave a shoot under this share of the sky, while the lit outer masses stay.
			skyPrune: 0.18,
			skyPruneLayer: 1,
			// Stills 01 and 18: no bare twigs hang outside the foliage.
			bareTrim: 0.03,
			// Stills 04 and 05: the shoots stand up off their wood, so the foliage rides on the twigs,
			// and the lowest ones stay low enough to keep the skirt at the grass.
			lift: 6,
			skyward: 0.55,
			scale: { mean: 1.2, spread: 0.1 },
			// Stills 01, 02 and 18: the dome is broad at its middle and flat across its top, so the
			// mid-crown shoots reach a little further than the record's one scale and the top ones
			// stand half as far past their twigs, which lowers the dome without raising its foot.
			scaleByHeight: [
				[0, 1],
				[0.55, 1.1],
				[0.8, 0.8],
				[1, 0.32],
			],
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Stills 12 and 24: a small broad blade cut into three to five forward-pointing lobes on a
			// wedge base, three to four centimetres from base to tip, on a stalk about a quarter of that.
			length: { mean: 0.035, spread: 0.006 },
			outline: 'texture',
			petiole: { length: 0.009, radius: 0.0005, flat: 0, droop: 10 },
			fold: 8,
			curl: 10,
			crossCurl: -4,
			twist: 5,
			wave: [0.002, 4],
			optics: {
				reflectance: [0.0404, 0.0849, 0.0116],
				reflectanceBack: [0.1935, 0.2701, 0.1787],
				transmittance: [0.12, 0.084, 0.013],
				roughness: [0.45, 0.6],
			},
		},
	},
	bark: {
		// Stills 15 and 26: the sampled plates read lighter and bluer than the photographs, so the
		// zone scales red and green a little and cuts blue hard to keep the grey-brown.
		zones: [{ layer: 0, by: 'height', from: 0, to: 40, blend: 0, tint: [0.82, 0.8, 0.64] }],
		young: 0,
		// Still 16 and 28: the plates fade to smooth red-brown bark on wood thinner than about four
		// centimetres across.
		youngRadius: 0.02,
		girthScale: [
			[0, 0.5],
			[1, 1],
		],
		// Still 26: the plates stand shallow.
		displacement: 0.035,
		// Still 08: a twig meets its parent in a short, knotted collar.
		collar: { swell: 0.35, length: 1.4, ridge: 0.4 },
		// Still 08: the fork closes in a small knot, its arms parting irregularly.
		fork: { bend: 2.5, knot: 0.25 },
		// Still 07 and 14: a thin green film of moss on the stool's lowest wood, on every side.
		moss: { amount: 0.4, up: 0.5, north: 0, colour: [0.14, 0.2, 0.05] },
		// Still 15: grey-green lichen flecks the older plates low on the stems.
		lichen: { amount: 0.4, from: 0.1, to: 0.6, colour: [0.4, 0.42, 0.36] },
	},
	base: {
		// Still 07: each stem flares only slightly where it leaves the soil; the stool's stems stand
		// close enough that their feet meet.
		flare: { amount: 0.1, height: 0.25 },
		// Still 14: a few thin roots run out over the litter, only just proud of it, and sink as they go.
		roots: {
			count: { mean: 3, spread: 1 },
			length: { mean: 0.4, spread: 0.1 },
			radius: 0.02,
			dive: 0.1,
			ridge: 0.4,
		},
	},
	extras: [
		{
			// Stills 09, 10 and 19: a long straight woody spine stands out from almost every node of
			// the twigs, red-brown when young and grey with age.
			kind: 'thorn',
			at: 'node',
			share: 0.5,
			seasons: ['blossom', 'summer', 'autumn', 'winter'],
			shape: { spines: 1, length: 0.022, spread: 0 },
			colour: [0.18, 0.06, 0.04],
			hang: 90,
		},
		{
			// Stills 01, 02 and 19: dark red haws in twos and threes at the twigs' ends, each a small
			// round berry on a short stalk below the last leaves.
			kind: 'fruit',
			at: 'shoot-tip',
			share: 0.3,
			count: { mean: 2, spread: 0.5 },
			tipShare: 0.85,
			seasons: ['summer', 'autumn'],
			shape: {
				lathe: [
					[0.0012, 0],
					[0.0046, 0.005],
					[0.003, 0.0085],
					[0, 0.0096],
				],
				sides: 8,
				stalk: 0.012,
				pedicel: 0.004,
				stalkSides: 5,
			},
			colour: [0.26, 0.02, 0.03],
			stalkColour: [0.2, 0.14, 0.06],
			roughness: [0.4, 0.7],
			hang: 160,
		},
		{
			// Still 20: flat corymbs of five-petalled cream flowers at a spring spur's end, with the
			// leaves out among them. The shoot-tip site stands each corymb at the shoot's wood tip,
			// inside the terminal leaf rosette, so the leaves hide it; a petal cup takes no stalk or
			// pedicel to stand clear of them.
			kind: 'flower',
			at: 'shoot-tip',
			share: 0.4,
			count: { mean: 6, spread: 1.5 },
			tipShare: 1,
			seasons: ['blossom'],
			shape: { petals: 5, radius: 0.007, cup: 0.45, stalk: 0.03 },
			colour: [0.85, 0.83, 0.76],
			stalkColour: [0.1, 0.14, 0.04],
			hang: 0,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		// Stills 01 and 02 carry green leaves with ripe haws, so the fruit shows in summer too; the
		// autumn variant turns the leaves a warm yellow-brown.
		autumn: { reflectance: [0.16, 0.09, 0.02], transmittance: [0.25, 0.14, 0.02] },
		blossom: { extra: 2, leaves: 1 },
	},
	wind: {
		// The wind clip: the twig tips flick while the mass holds. The wood is stiff through, so the
		// outer order carries most of the motion; the plant sways a little at its foot and its leaves
		// shift by a leaf's width, as a low dome stirs in a light breeze rather than rocking.
		stiffness: [
			[0, 0.97],
			[0.5, 0.94],
			[1, 0.9],
		],
		sway: { frequency: 0.35, amplitude: 0.02 },
		flutter: { kind: 'blade', amplitude: 0.02, frequency: 3 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		// A card's twig is thinner than a pixel at a whole view, so each draws its supporting twig as
		// a line wide enough to hold the leaf group in the picture, running on to the card's foliage.
		cardStalk: 3,
		cardStalkToFoliage: true,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The kit's leaves and six shoot prototypes measure 2.46, 3.36, 5.29 and 9.05 MB; each
			// cap sits above its figure, under the class's own ceiling.
			kitBytes: { low: 2_600_000, medium: 3_500_000, high: 5_600_000, ultra: 9_500_000 },
			// The six variants measure 5.1 to 9.1 MB in leaf, and the blossom season reaches 13.93 MB
			// with the flowers' own mesh; each cap sits above the largest, under the class's own ceiling.
			variantBytes: { low: 14_000_000, medium: 14_000_000, high: 14_000_000, ultra: 14_000_000 },
			// The near band measures 483,068 triangles once the height calibration's scale is applied
			// before the light grid, so the cap keeps its 17,728-triangle spare above that read, 3.67
			// per cent of it; the earlier 481,806 stood the same spare, 3.82 per cent, above the
			// pre-calibration 464,078. The first card level measures at most 152,498 and the second at
			// most 22,761 over the variants and seasons, under the class's shared card caps.
			lod0Triangles: 500_796,
			lod1Triangles: 155_000,
			lod2Triangles: 25_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 350_000,
			// The first growth of a process includes compiling the code, so the cap covers that.
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 1870652341,
	// The sparsest form keeps this share of the crown's shoots, each whole: about the leaf area
	// below which the crown stops reading as its species.
	sparse: { foliage: 0.11 },
	roundBand,
	cuttings: {
		// Still 21: the branch keeps the spray's years of stiff twigs, bare between the leaf tufts.
		// The sub-branch takes the short cut class, which draws the photographs' tighter twigs. Both
		// are drawn from the shoot kit by this record's choice, so neither carries the thorns the
		// grown plant wears; a branch or sub-branch cut from the grown plant would keep them.
		branch: { shoot: 'spray' },
		subbranch: { shoot: 'cut' },
		// Stills 11 and 23 hold one rosette of five or six leaves round its buds at the end of a spur.
		// A cluster is one shoot row drawn from the kit, so the old-wood extras cannot stand on it:
		// the thorns grow from buds of the grown plant, and this piece shows none.
		cluster: { shoot: 'short' },
		// Stills 12, 13, 24 and 25 lay the leaf flat on a copy stand.
		leaf: { pressed: true },
	},
};
