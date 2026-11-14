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
	// The fact sheet: flowering stems 30 to 60 cm, the tuft 15 to 30 cm in leaf. Still 01 stands the
	// tallest head at about twice the leaf mound's height, still 02 at 1.8 times.
	size: { height: { mean: 0.5, spread: 0.08 }, aspect },
	growth: {
		model: 'tuft',
		// Still 01: the leaf mound is 262 px tall under heads that reach 525 px; still 02's vase of
		// blades stands taller, about 0.55 of the plant's height.
		mound: 0.55,
		// Still 01: twelve flowering stems. Still 04 shows about forty-five blades at its fullest
		// ring, but from above only the outer ring shows: still 01 shows forty to fifty blades in
		// the tuft's front alone, and sixteen shoots of three or four blades drew 0.85 of sky inside
		// its outline against the photograph's 0.49. Still 01's cover asks for three times that.
		shoots: { mean: 48, spread: 9 },
		// Still 01: the sheath bases span 96 px at the soil against a mound of 262 px.
		stool: 0.36,
		// Stills 01 and 03: pale green sheath columns stand 0.12 to 0.15 of the mound's height, each
		// one blade width across.
		sheath: { height: 0.14, width: 0.035 },
		// Stills 07 and 15: the sheaths are pale straw-green from foot to collar.
		sheathColour: { foot: [0.366, 0.38, 0.309], collar: [0.366, 0.38, 0.309], reach: 0.85 },
		// The fact sheet: two to four blades a tiller; still 22 shows three or four, and still 02's
		// vase of many blades asks for the upper part of that.
		blades: { mean: 3.6, spread: 0.6 },
		// The fact sheet and stills 22 and 23: blades in two ranks.
		ranks: 2,
		// Still 01, read on a 2.6 times crop, in mound heights. The inner blades stand within 10
		// degrees of plumb; the middle ones leave at 20 to 30 degrees from plumb and end 0.6 to 0.8
		// high; the outer ones leave at 45 to 60 degrees, arch at 0.4 to 0.5 and end 0.1 to 0.35 above
		// the soil, 0.7 to 0.8 out. Still 02's vase is taller: most of its blades reach the vase's
		// top at about half the plant's height, so the inner blades end at the mound's top and the
		// middle ones at 0.85 of it, where 0.72 drew a vase a third of the height. The outer pose
		// takes the upper part of still 01's range: it arches out low and ends 0.3 above the soil,
		// 0.75 out, where the low end drew the blades lying on the soil.
		poses: [
			{ share: 0.4, leave: 85, apex: 1, drop: 0, reach: 0.08 },
			{ share: 0.35, leave: 65, apex: 0.85, drop: 0.02, reach: 0.4 },
			{ share: 0.25, leave: 38, apex: 0.45, drop: 0.15, reach: 0.75 },
		],
		bladeSpread: 0.12,
		stalks: {
			// Stills 01 and 02: some twenty flowering stems, whose heads overlap into one crown;
			// stills 04 and 17 show about twelve from the sides they look from.
			count: { mean: 20, spread: 2 },
			// The fact sheet: in flower in late spring and early summer.
			seasons: ['blossom', 'summer'],
			// Still 01: the heads' tips spread evenly from 0.725 to 1.0 of the plant's height, 1.32 to
			// 1.82 of the mound's.
			top: [1.32, 1.82],
			// Still 01: the middle stem is plumb and the rim's lean up to 35 degrees.
			lean: [0, 35],
			// Still 01: a stem is straight, with a slight outward curve over its upper part.
			bow: { from: 0.5, turn: [4, 12] },
			// Still 01: a stem is 2 to 3 px across against a mound of 262 px.
			width: 0.012,
			sides: 5,
			// Still 02: a head is an open panicle 0.4 of the mound's height long and 0.22 wide at its
			// lowest whorl, six or seven whorls of short branches leaving the stem at about 45 degrees
			// with sky inside the head, each carrying a few plump spikelets. The fact sheet: three to
			// five branches a whorl and a spikelet of 4 to 6 mm.
			head: {
				kind: 'panicle',
				length: 0.4,
				width: 0.22,
				whorls: 7,
				branches: 3,
				angle: 45,
				spikelets: 4,
				spikelet: 0.03,
			},
		},
		// The least plant that still reads as the species: seven shoots of two blades and four stems.
		least: { shoots: 7, blades: 2, stalks: 4 },
		soil: {
			// Still 14: dense fine pale roots leave the crown straight down and out, with no rhizome.
			// Still 21: lifted, they hold a ball of soil about 0.11 m across and 0.1 m deep.
			roots: { mean: 32, spread: 5 },
			rootLength: { mean: 0.1, spread: 0.02 },
			rootRadius: 0.002,
			droop: { mean: 60, spread: 15 },
		},
	},
	foliage: {
		kind: 'grass-blade',
		blade: {
			// Stills 12 and 24: blades of even width that close in a short blunt hood. Still 01: a
			// blade is 9 px across against a mound of 262 px, 0.034 of the mound's height, and still
			// 02's blades arch up and out to the vase's top, so along its curve a blade is longer
			// than the mound is tall. Still 23, the full-size studio shoot, shows four full blades read
			// base to tip at 0.04 to 0.05 of their length wide, so the pictures' broad blade holds
			// over the fact sheet's 2 to 4 mm; both figures stand for the owner.
			length: { mean: 0.32, spread: 0.03 },
			width: 0.0085,
			profile: [
				[0, 0.85],
				[0.1, 1],
				[1, 1],
			],
			tip: 'hooded',
			tipLength: 0.04,
			fold: 18,
			// Still 01: blades that arch out to either side show their faces along most of their
			// length, where a blade held face up in the plane it arches in shows only its edge to a
			// side view. Each turns a quarter turn from collar to tip.
			twist: 90,
			arch: { mean: 34, spread: 8 },
			// Stills 02 and 06: the old outer blades carry dry brown tips.
			dryTip: 0.03,
			// Stills 15 and 16: the ribbed pale sheath ends in a pale collar with a small papery
			// ligule in the V where the blade leaves it. Both are the sheath's own pale cream, and
			// the collar takes the lowest fiftieth of the blade.
			collar: { colour: [0.366, 0.38, 0.309], share: 0.02 },
			ligule: { length: { mean: 0.006, spread: 0.002 }, width: 0.004, share: 0.5 },
			// The leaf pictures' two faces under flat light: the shader scales each face's picture
			// by that face's mean, so these figures are the pictures' own means.
			optics: {
				reflectance: [0.1284, 0.272, 0.0218],
				reflectanceBack: [0.318, 0.349, 0.24],
				transmittance: [0.16, 0.33, 0.03],
				roughness: [0.55, 0.6],
			},
		},
	},
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
		nearFoliage: 'instanced',
		switchPixels: [24, 12, 120],
		// A piece's card first shows where the piece spans 24 pixels, so a cell of 32 texels holds
		// it at every tier; a tree leaf's 64 would hold four times the texels for no pixel more.
		cardCell: { low: 32, medium: 32, high: 32, ultra: 32 },
		// A flowering stem is thinner than a pixel at the card level, so its card loses its cover
		// and the panicle on it reads as a piece in air; a card's twig line keeps the panicle on its
		// stem, and the marker draws that line at the stem's own width, floored at the least the
		// wood draws.
		cardStalk: 1,
		cardStalkWidth: true,
		woodOrders: [0, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The kit holds fourteen prototypes, the sheath column, seven blade shapes and three
			// flowering stems each with its panicle as a part of its own, and their card atlas of
			// 32-texel cells. It reads 713,148, 896,436, 1,124,308 and 1,413,280 bytes at the four
			// tiers; the three flowering stems with their panicles are most of what the tiers add.
			// Each cap keeps about fifteen per cent above its read.
			kitBytes: { low: 821_000, medium: 1_031_000, high: 1_293_000, ultra: 1_626_000 },
			// A plant is rows of the kit's pieces, so a variant's bytes are the same at every tier.
			// Measured over the four variants at seed 11, in summer and in blossom: the largest reads
			// 154,839 bytes with the root ball of stills 14 and 21, the forty-eight shoots still 01's
			// cover asks for and the twenty flowering stems of stills 01 and 02; the two card levels
			// read 1,822 and 930 triangles. Drawn at once at the tallest view, the first variant reads
			// 45,158 triangles at the high tier and 68,292 at the ultra. Each of those caps keeps a
			// twentieth above its read, the nearest level's above the ultra's, as the lead ruled.
			variantBytes: { low: 162_600, medium: 162_600, high: 162_600, ultra: 162_600 },
			lod0Triangles: 71_710,
			lod1Triangles: 1_914,
			lod2Triangles: 977,
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
				// Still 20: one shoot, with no flowering stem, so the leaves are the whole height.
				mound: 1,
				shoots: { mean: 1, spread: 0 },
				stool: 0.1,
				sheath: { height: 0.15, width: 0.06 },
				blades: { mean: 3.5, spread: 0.5 },
				// Still 20: one blade near plumb and the others leaning out to about 45 degrees, all
				// straight.
				poses: [
					{ share: 0.4, leave: 82, apex: 0.97, drop: 0, reach: 0.14 },
					{ share: 0.6, leave: 55, apex: 0.72, drop: 0, reach: 0.5 },
				],
				stalks: null,
				least: { shoots: 1, blades: 2, stalks: 0 },
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
