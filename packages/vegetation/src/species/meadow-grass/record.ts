// Meadow grass (smooth meadow grass), an uncut tuft: a loose fountain of flat, even-width blades
// that stay almost as wide to a short blunt hooded tip, under slender flowering stems at about
// twice the leaf height, each stem carrying an open panicle of whorled branches with small
// purple-green spikelets. Many tillers rise from one small crown, the outer ones leaning out.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference
// turntable by the fitting tool (fit.ts); the growth numbers follow the same video and the stills;
// the blade from the texture source's contour and the single-blade stills; the sheath and collar
// are part of the blade's own stalk, so the species carries no bark. The record is plain data: no
// code runs in it.
import type { Species } from '../../core/record';
import { aspect, roundBand } from './fit';

/** The meadow grass's record. */
export const record: Species = {
	id: 'meadow-grass',
	name: 'Meadow grass',
	latin: 'Poa pratensis',
	form: 'loose tuft of flat blades under slender stems with open panicles',
	// Stills 01, 02, 17 and 18: the leaf mass stands about two thirds of the tuft's height, and the
	// flowering stems carry the panicles to about twice the leaf height. The fit measures the
	// crown's width against the whole height at 0.76.
	size: { height: { mean: 0.5, spread: 0.08 }, aspect },
	growth: {
		model: 'tuft',
		// Stills 01, 04 and 21: many tillers rise from one crown and their blades make a leaf mass
		// about as wide as it is tall. The clump stays compact and packs its tillers, so the mass
		// gains density without spreading past the pictures' outline.
		shoots: { mean: 50, spread: 6 },
		base: 0.05,
		lean: [
			[0, 1],
			[1, 4],
		],
		// Still 22 and the fact sheet: two to four blades on each tiller, set in two ranks. The
		// whole-plant pictures carry four or five, so the crown takes the fuller end.
		blades: { mean: 4, spread: 0.4 },
		ranks: 2,
		sheath: { mean: 0.035, spread: 0.01 },
		sheathRadius: 0.0018,
		// Stills 15 and 16: the basal sheath is pale cream, not the blade's green, and it stays that
		// pale from the soil to the collar, so both ends of the column take the same measured colour.
		sheathColour: { foot: [0.366, 0.38, 0.309], collar: [0.366, 0.38, 0.309], reach: 0.85 },
		// Still 21: the youngest inner blades stand tall and almost straight, arching only near
		// their tips, while the oldest outer ones leave their collars wide and arch toward the
		// ground. The young blades hold the leaf mass's height; the old ones its width.
		spread: [
			[0, 2],
			[1, 12],
		],
		size: [
			[0, 0.8],
			[0.5, 1],
			[1, 0.9],
		],
		heads: {
			// Still 01: a dozen slender stems spread over the crown, the panicles held near the
			// tuft's top. The stems rise almost straight and the panicle branches make the spray.
			count: { mean: 12, spread: 3 },
			kind: 'panicle',
			height: { mean: 0.46, spread: 0.07 },
			radius: 0.0022,
			sides: 5,
			bow: { mean: 6, spread: 4 },
			seasons: ['blossom', 'summer'],
			// Stills 19 and 21: an open pyramid panicle of a few whorls, its branches leaving at a
			// falling angle up the stem and drooping, with the spikelets along their outer parts.
			panicle: {
				length: { mean: 0.18, spread: 0.03 },
				whorls: 5,
				branches: { mean: 3, spread: 1 },
				angle: [
					[0, 46],
					[1, 28],
				],
				droop: 12,
				flowers: { mean: 5, spread: 1 },
				// Still 18: the spray's branches read on the silhouette, so a branch at 0.30 of the
				// stem's radius joins it into one piece where 0.18 split the height profile.
				branchShare: 0.3,
			},
		},
	},
	foliage: {
		kind: 'grass-blade',
		blade: {
			// Stills 01, 02 and 12: blades of even width that close in a short blunt hood. The
			// leaf picture draws its blade about 7.4 per cent as wide as it is long, and a 30 cm
			// blade fills that proportion at 20 mm, the same broad blade the sedge's photographs
			// show. The record follows the picture rather than the fact sheet's narrower figure.
			length: { mean: 0.3, spread: 0.02 },
			width: 0.02,
			profile: [
				[0, 0.85],
				[0.1, 1],
				[1, 1],
			],
			tip: 'hooded',
			tipLength: 0.04,
			fold: 18,
			twist: 30,
			arch: { mean: 18, spread: 8 },
			// Stills 02 and 06: the old outer blades carry dry brown tips.
			dryTip: 0.03,
			// Stills 15 and 16: the ribbed pale sheath ends in a pale collar with a small papery
			// ligule in the V where the blade leaves it. Both are the sheath's own pale cream, and
			// the collar takes the lowest fiftieth of the blade.
			collar: { colour: [0.366, 0.38, 0.309], share: 0.02 },
			ligule: { length: { mean: 0.006, spread: 0.002 }, width: 0.004, share: 0.5 },
			// The texture source's two faces under flat light: the shader scales each face's picture
			// by that face's mean, so these figures are the pictures' own means.
			optics: {
				reflectance: [0.1284, 0.272, 0.0218],
				reflectanceBack: [0.0654, 0.158, 0.0104],
				transmittance: [0.16, 0.33, 0.03],
				roughness: [0.55, 0.6],
			},
		},
	},
	extras: [
		{
			// Still 19: small ovate spikelets, green tinged purple, along each panicle branch.
			kind: 'spike',
			at: 'flower',
			share: 1,
			seasons: ['blossom', 'summer'],
			shape: {
				lathe: [
					[0.0005, 0],
					[0.0018, 0.002],
					[0, 0.005],
				],
				// A spikelet is a grain a few millimetres across: five faces read round at the
				// seed head's scale and keep the kernel's cost small.
				sides: 5,
			},
			colour: [0.18, 0.19, 0.13],
			hang: 0,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: false,
		winter: 'evergreen',
		// Still 06: the older blades dry toward a yellow-brown through autumn.
		autumn: { reflectance: [0.2, 0.17, 0.06], transmittance: [0.22, 0.18, 0.05] },
	},
	wind: {
		// The wind clip: the sheathed base stays put while the blades and panicles sway, the stems
		// most freely. Each order's share of the deepest order's stiffness keeps the base rigid.
		stiffness: [
			[0, 1],
			[0.35, 0.98],
			[0.7, 0.88],
			[1, 0.25],
		],
		sway: { frequency: 0.5, amplitude: 0.015 },
		flutter: { kind: 'grass', amplitude: 0.015, frequency: 1.2 },
	},
	lod: {
		// The tuft draws as one merged foliage mesh: blades, sheaths, stems and panicle branches,
		// each on its own axis and wind record.
		nearFoliage: 'merged',
		switchPixels: [24, 12, 120],
		woodOrders: [0, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 600_000, medium: 600_000, high: 600_000, ultra: 600_000 },
			// Each tier holds the largest measured variant with about fifteen per cent above it.
			variantBytes: { low: 1_550_000, medium: 1_600_000, high: 1_700_000, ultra: 3_800_000 },
			lod0Triangles: 200_000,
			lod1Triangles: 30_000,
			lod2Triangles: 8_000,
			downloadBytes: 350_000,
			downloadHalfBytes: 120_000,
			growMilliseconds: 150,
		},
	},
	textures: 'own',
	variants: 4,
	seedSalt: 0x9ea55,
	roundBand,
	// Still 20: a newly germinated plant is a few short blades from one point, before any tuft
	// forms. The reference's index gives it as the species' young form.
	forms: {
		seedling: {
			form: 'a few short blades from one point, before the tuft forms',
			size: { height: { mean: 0.07, spread: 0.01 }, aspect: 0.9 },
			growth: {
				shoots: { mean: 3, spread: 1 },
				base: 0.006,
				lean: [
					[0, 2],
					[1, 6],
				],
				blades: { mean: 3, spread: 0.5 },
				sheath: { mean: 0.01, spread: 0.003 },
				sheathRadius: 0.0008,
				spread: [
					[0, 4],
					[1, 20],
				],
				size: [
					[0, 0.7],
					[1, 1],
				],
				heads: null,
			},
			foliage: {
				kind: 'grass-blade',
				blade: {
					length: { mean: 0.09, spread: 0.01 },
					width: 0.0028,
					profile: [
						[0, 0.85],
						[0.1, 1],
						[1, 1],
					],
					tip: 'hooded',
					tipLength: 0.05,
					fold: 18,
					twist: 30,
					arch: { mean: 30, spread: 10 },
					dryTip: 0,
					optics: {
						reflectance: [0.1284, 0.272, 0.0218],
						reflectanceBack: [0.0654, 0.158, 0.0104],
						transmittance: [0.16, 0.33, 0.03],
						roughness: [0.55, 0.6],
					},
				},
			},
		},
	},
	cuttings: {
		// Stills 21, 22 and 23: a piece of a tiller keeps its sheaths and blades, and a blade lies
		// on its own against the copy stand.
		branch: { order: 1, length: 0.5 },
		subbranch: { order: 1, length: 0.35 },
		// Stills 12, 13 and the two texture sources: a picked blade lies pressed on the copy stand,
		// so its fold, twist and arch straighten and the pictures show the blade's own width.
		leaf: { pressed: true },
	},
};
