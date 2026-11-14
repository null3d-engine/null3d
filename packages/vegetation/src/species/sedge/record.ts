// The pendulous sedge: a dense wide mound of broad keeled leaves from one stool of brown sheaths,
// under slender three-angled flowering stems that bow over and hang long narrow spikes one below
// another, with one more spike ending each stem. A sedge is a grass-like plant, so its "trunk" is
// the bundle of leaf sheaths and its "bark" is the sheath surface; the leaves stand in three ranks
// from every shoot, and the solid three-angled stem tells it from a grass.
//
// The height is the fact sheet's. Every other length of the plant's build is a share of the leaf
// mound's height, measured on the turning video's first frame (still 02), which the owner ruled the
// primary plant. The blade's shape, the sheaths and the stem's section come from the close stills.
// The envelope's aspect and the all-round band are the fitting tool's (fit.ts). The record is plain
// data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/** The pendulous sedge's record. */
export const record: Species = {
	id: 'sedge',
	name: 'Pendulous sedge',
	latin: 'Carex pendula',
	form: 'wide fountain of broad keeled leaves under tall bowed stems with hanging spikes',
	// The scale inside the fact sheet's ranges at which the most of its sizes stand inside theirs,
	// at still 02's proportions (stems 1.69 mound heights, a blade 1.5, the mound 1.6 as wide as
	// tall): a mound of 0.625 to 0.667 m holds the mound (0.6 to 1 m), the stems (1 to 2 m), the
	// blade's length (0.5 to 1 m) and the mound's width (1 to 1.5 m). The record takes 0.643 m, so
	// the stems stand 1.09 m. The blade's width and the spike's size stay outside theirs, as the
	// conflicts recorded for the owner.
	size: { height: { mean: 1.09, spread: 0.08 }, aspect },
	growth: {
		model: 'tuft',
		// Still 02: the highest blade stands 250 px above the soil and the highest stem 423 px.
		mound: 0.59,
		// The blades cannot be counted on a photograph, so the shoots are counted by how full the
		// mound is. Still 02's mound (left tip to right tip, mound top to soil), read as plant or sky
		// in ten bands of height, is 0.735 full, its upper five bands 0.58 and its lowest two 0.92
		// and 0.95: its foot is hidden. Fifty-six shoots hide the drawing's foot; with blades that
		// reach as far out as the photograph's, its upper five bands then read 0.73 and its lowest
		// two 0.84 and 0.77. Forty-four of them flower.
		shoots: { mean: 56, spread: 8 },
		// Fifty-six shoot bases of one and a half blade widths (still 07) pack a disc 0.76 of the
		// mound's height across; the brown zone at the foot of still 02 spans 0.84 of it.
		stool: 0.76,
		// Stills 21 and 22: the brown sheaths stand a third of the mound's height under the blades;
		// still 07: a shoot's sheath bundle is one and a half blade widths across.
		sheath: { height: 0.35, width: 0.096 },
		// Stills 07, 08 and 14: the sheaths are red-brown at the foot and paler where the blades
		// leave. The ends are still 07's measured bands as linear reflectance.
		sheathColour: { foot: [0.21, 0.123, 0.079], collar: [0.21, 0.107, 0.062], reach: 0.85 },
		// Stills 11 and 22: five or six blades a shoot.
		blades: { mean: 5.5, spread: 0.5 },
		// Stills 08, 22 and 23: a sedge's leaves leave their shoot in three ranks.
		ranks: 3,
		// Still 02, traced on a 3.4 times crop of the mound's left half, in mound heights from each
		// blade's own shoot. The youngest blade stands near plumb with its tip leaning out. The
		// oldest rises, runs out and comes down steeply at the mound's rim, its tip about 75 degrees
		// below level. Still 02's right half on a three times crop: a middle blade stands up and out
		// at about 75 degrees, arches over and comes down at about 65 degrees; few blades fall plumb,
		// and the younger blades between end in the air. Still 02's mound is 1.74 times as wide at
		// its foot as the plant is tall and 1.51 times at 0.45 of its height, so a middle blade
		// lands 0.9 mound heights out and the oldest 1.35.
		// A blade that can be traced is one that stands clear of the rest, the largest of its kind:
		// the young blade traced stands 1.1 high, the middle one arches at 0.98, the mound's own
		// top, and the oldest rises 0.8 and lands 1.35 out. The oldest blades land from 0.9 to 1.5
		// from the middle, a quarter either side of their mean, so each pose is its traced blade at
		// four fifths of its size and a blade's length strays a quarter either side of its pose's.
		poses: [
			{ share: 0.25, leave: 85, apex: 0.88, drop: 0.04, reach: 0.16 },
			{ share: 0.4, leave: 75, apex: 0.78, drop: 0.78, reach: 0.9, tip: 65 },
			{ share: 0.35, leave: 75, apex: 0.62, drop: 0.62, reach: 1.35, tip: 75 },
		],
		bladeSpread: 0.25,
		stalks: {
			// Still 02: fifteen to twenty stems stand clear of the mound, round the whole tuft, and
			// more inside it. With the mound as wide and full as the photograph's, the shorter stems
			// stand inside it, so a stem rises from most shoots: forty-four of the fifty-six.
			count: { mean: 44, spread: 4 },
			// The fact sheet: the spikes stand in flower through summer and stay brown into winter.
			seasons: ['blossom', 'summer', 'autumn', 'winter'],
			// Still 02: the stems' highest points spread evenly from the mound's top to 1.69 of it.
			top: [1, 1.69],
			// Still 02: a stem stands plumb at the middle and leans up to 35 degrees at the rim.
			lean: [0, 35],
			// Stills 02, 17 and 19: a stem runs straight for seven tenths of its length, then bows
			// through 100 to 150 degrees, so its tip points down and out.
			bow: { from: 0.7, turn: [100, 150] },
			// Still 02: a stem is 5 px across at mid height against a mound of 250 px.
			width: 0.025,
			// Still 16: the solid three-angled stem.
			sides: 3,
			// Still 02: two to four spikes hang from a stem, each 0.33 of the mound's height long and
			// 0.028 across, on a thread of 0.04 to 0.1. Still 19: the spike that ends the stem is 0.4
			// of a hanging spike's length. Still 02, read on a three times crop of its upper left: the
			// spikes hang two or three together near the crest of the stem's bow, where it runs from
			// about 20 degrees above level to 40 below. Still 19 draws its spikes about 0.16 as wide
			// as they are long, the fact sheet about 0.04; the primary plant's still 02 reads 0.085,
			// which the record keeps.
			head: {
				kind: 'spike',
				count: 3,
				length: 0.33,
				width: 0.028,
				thread: 0.07,
				tip: 0.13,
				hang: [20, -40],
			},
		},
		// The least plant that still reads as the species: eight shoots spread over the stool, each
		// with three blades, and five stems.
		least: { shoots: 8, blades: 3, stalks: 5 },
		soil: {
			// Still 09: a short stout rhizome runs either side of the stool, about 8 cm in all.
			rhizome: { mean: 0.04, spread: 0.01 },
			// Still 09: the rhizome reads 2 to 2.5 cm thick.
			rhizomeRadius: 0.011,
			// Still 14 and the lifted studio piece: a dense brown root ball, not a sparse fringe.
			roots: { mean: 32, spread: 5 },
			rootLength: { mean: 0.18, spread: 0.05 },
			rootRadius: 0.0045,
			// Still 14: the roots dip below the rhizome as they leave it.
			droop: { mean: 40, spread: 15 },
		},
	},
	envelope,
	foliage: {
		kind: 'grass-blade',
		blade: {
			// A middle blade's length on still 02: 1.5 mound heights.
			length: { mean: 0.96, spread: 0.24 },
			// Still 02: a blade is 16 px across against a mound of 250 px, 0.064 of its height.
			width: 0.041,
			// Stills 07 and 12: the blade narrows at its foot where it leaves the sheath, and holds
			// its width to where its point begins.
			profile: [
				[0, 0.7],
				[0.1, 1],
				[1, 0.95],
			],
			// Still 12: the leaf holds its full width to four and a half widths from its tip, then
			// closes to a fine point; on the record's blade of 0.96 m that is 0.19 of its length.
			tip: 'pointed',
			tipLength: 0.19,
			// Stills 08, 12 and 16: the blade is a shallow open V, about 15 degrees each side of flat.
			fold: 15,
			// Still 12: the upper face twists part way along the blade.
			twist: 60,
			// Still 02: each blade arches from upright to hanging at its tip.
			arch: { mean: 70, spread: 15 },
			// Still 10: a few tips brown at the edge of the tuft.
			dryTip: 0.05,
			// Stills 08 and 15: a pale line marks the collar where the blade leaves its sheath, in
			// the lower fiftieth of the blade. It should move the leaf-base pictures 08 and 15 and
			// the pressed leaves' bases toward the photographs, and leave the whole views nearly
			// where they are.
			collar: { colour: [0.4, 0.4, 0.32], share: 0.02 },
			// Stills 08 and 15: a pale papery ligule stands in the V where the blade leaves its
			// sheath, about a centimetre and a half long, in the collar's colour. It draws at the near
			// detail only; it should move the leaf-base
			// pictures 08 and 15 toward the photographs.
			ligule: {
				length: { mean: 0.015, spread: 0.004 },
				width: 0.008,
				share: 0.4,
			},
			optics: {
				// The upper face's linear colour, read from stills 12 and 24 through the copy stand's
				// measured light: a deep green at the photograph's own luminance.
				reflectance: [0.042, 0.076, 0.006],
				// The underside's linear colour, read the same way from stills 13 and 25: the render's
				// remaining difference is its missing blue, so the value takes the photographs' own
				// measured ratio on that face.
				reflectanceBack: [0.083, 0.114, 0.133],
				transmittance: [0.04, 0.077, 0.01],
				roughness: [0.45, 0.7],
			},
		},
	},
	seasons: {
		// The reference set shows the plant in summer, in flower.
		default: 'summer',
		// The fact sheet: a sedge keeps its green leaves through the winter.
		deciduous: false,
		winter: 'evergreen',
	},
	wind: {
		// The wind clip: the leaves and bowed stems sway while the crown stays still.
		// The clip's upper three bands over-move (0.350, 0.481, 0.496 against 0.164, 0.299, 0.392)
		// while the lower three hold, so the bowed upper stems stiffen toward the top.
		stiffness: [
			[0, 0.9],
			[1, 0.85],
		],
		sway: { frequency: 0.5, amplitude: 0.03 },
		flutter: { kind: 'grass', amplitude: 0.06, frequency: 2 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [24, 12, 120],
		// A piece's card first shows where the piece spans 24 pixels, so a cell of 32 texels holds
		// it at every tier; a tree leaf's 64 would hold four times the texels for no pixel more.
		cardCell: { low: 32, medium: 32, high: 32, ultra: 32 },
		// The plant scales to its leaf form's top, the measure its whole views were judged with, so
		// no card change can shorten it.
		heightAtLeafTop: true,
		// A flowering stem is thinner than a pixel at the card level, so its card loses its cover
		// and the head on it reads as a piece in air; a card's twig line keeps the head on its stem,
		// and the marker draws that line at the stem's own width, floored at the least the wood draws.
		cardStalk: 1,
		cardStalkWidth: true,
		// A card's plane stands ahead of the row that draws it, so the line spans only the stretch
		// behind the row and stops short of the spike card's centre; this runs it on to that centre.
		cardStalkToFoliage: true,
		woodOrders: [0, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The kit holds fourteen prototypes, the sheath column, seven blade shapes and three
			// flowering stems each with its spikes as a part of its own, and their card atlas of
			// 32-texel cells. It reads 655,436, 703,880, 778,100 and 890,836 bytes at the four
			// tiers, and each cap keeps about fifteen per cent above its read.
			kitBytes: { low: 754_000, medium: 810_000, high: 895_000, ultra: 1_025_000 },
			// A plant is rows of the kit's pieces, so a variant's bytes are the same at every tier.
			// Measured over the six variants at seed 11, in summer and in blossom on 14 November
			// 2026, an outside date that names the measure, with the cards' twig lines at the stems'
			// widths and run on to the card centers: the largest reads 271,352 bytes and the two
			// card levels 4,094 and 2,056 triangles. The caps take those measures plus a twentieth,
			// by the lead's ruling. The lines darken the crown's mean, and two spike groups still
			// read apart at the first card level; both are recorded as limits.
			variantBytes: { low: 285_000, medium: 285_000, high: 285_000, ultra: 285_000 },
			lod0Triangles: 89_000,
			lod1Triangles: 4_300,
			lod2Triangles: 2_160,
			downloadBytes: 350_000,
			downloadHalfBytes: 120_000,
			growMilliseconds: 150,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 0x5ed6e,
	roundBand,
	cuttings: {
		// Stills 21 and 22: the whole young plant lifted with its leaves, sheath and roots.
		branch: { order: 0, length: 1 },
		subbranch: { order: 1, length: 0.4 },
		// Stills 12, 13, 24 and 25: a picked blade lies on the copy stand, so its fold and twist
		// straighten and the pictures show the blade's own width rather than its edge-on projection.
		// Still 12 frames the upper part of a long leaf, which runs out of the frame at its foot:
		// its last six and a half widths, the point among them. The piece is the record's whole
		// blade.
		leaf: { pressed: true },
	},
};
