// The soft tree fern: one stout fibrous trunk under a crown of arching, twice-divided fronds that
// spring from a single growing point, with coiled croziers at the centre and a skirt of dead fronds
// below the living crown. The trunk is a mat of roots and old frond bases, not wood.
//
// The numbers come from the reference set's whole views (01, 02, 17, 18), its crown views (03 to
// 07) and its studio stills (08 to 13, 21 to 23); the textures from slots 24 to 26. The frond is a
// rachis carrying pinnae, each pinna the species' leaf: the reference's leaf texture is one pinna,
// and the frond's second division is painted in that picture.
import type { Species } from '../../core/record';

/** The tree fern's record. */
export const record: Species = {
	id: 'tree-fern',
	name: 'Soft tree fern',
	latin: 'Dicksonia antarctica',
	form: 'single stout fibrous trunk under a crown of arching fronds from one point',
	// Still 01 and the silhouette 18: the crown is about as wide as the plant is tall, the trunk
	// about a seventh of the height across at breast height.
	size: { height: { mean: 3.6, spread: 0.3 }, dbh: 0.5, aspect: 1.25 },
	growth: {
		model: 'crown-rosette',
		stem: {
			// Stills 17 and 18: the trunk is about two thirds of the plant's height.
			height: { mean: 2.6, spread: 0.2 },
			// Still 17: the column runs nearly parallel-sided, a little narrower at the top.
			radius: [
				[0, 0.29],
				[0.1, 0.27],
				[0.6, 0.26],
				[1, 0.25],
			],
			// Still 01: the trunk stands upright, within a few degrees.
			lean: { mean: 2, spread: 2 },
			curve: { mean: 0, spread: 1.5 },
			surface: 'root-mat',
		},
		crown: {
			// Still 01 and the crown views: a dense living crown of three dozen fronds.
			fronds: { mean: 34, spread: 2 },
			divergence: 137.5,
			// Still 01: the youngest fronds lean out from the centre and the oldest rise, arch over
			// and hang at the tips, so the crown reads as a dome with an open centre.
			tilt: [
				[0, 24],
				[0.35, 38],
				[0.7, 70],
				[1, 95],
			],
			// Stills 06 and 07: the fronds spring from one growing point at the trunk's top, where
			// the old bases cluster, rather than clasping a length of stem as a palm's do.
			depth: 0.2,
			// Still 06: the crown's centre holds the young fronds, still rolled, coiled through a
			// turn and a half above a hairy stalk.
			croziers: {
				count: { mean: 6, spread: 1 },
				length: { mean: 0.55, spread: 0.05 },
				coil: 540,
				// Stills 01 and 06: a fiddlehead is a thick fleshy roll, more than twice the stipe's
				// width, and the crown's centre carries a cluster of them.
				radius: 0.06,
				// Still 01 and 06: the fiddleheads are hairy red-brown, the same mat as the trunk.
				bark: 'grown',
			},
			// Still 16, 17 and 20: the dead fronds hang against the trunk as a brown curtain, and
			// still 20 shows their pinnae, so a dead frond keeps the detail of a living one.
			// A dead frond hangs shorter than a living one, at about seven tenths of its length.
			dead: { count: { mean: 20, spread: 2 }, hang: 160, skirt: 0.1, blades: true, length: 0.72 },
		},
		frond: {
			// Stills 21 and 22: the frond is twice divided, its pinnae in near-opposite pairs; the
			// pinna itself is the species' leaf, drawn from its own picture.
			kind: 'pinnate',
			length: { mean: 2.1, spread: 0.2 },
			// Still 07: a short red-brown stipe, densely hairy, no wider than the rachis.
			petiole: { length: 0.28, width: 0.055, teeth: 0 },
			// Still 21: the blade rises from the stipe and arches over, its tip drooping.
			droop: [
				[0, 2],
				[0.25, 30],
				[0.55, 70],
				[1, 130],
			],
			twist: 4,
			pinnae: {
				// Stills 08 to 11: thirty or more pairs a side. The count gives the places and each
				// place carries a group, so the frond holds twice this many.
				count: { mean: 22, spread: 1 },
				// Pinna length over the frond's length, by position along the rachis.
				length: [
					[0, 0.05],
					[0.15, 0.13],
					[0.4, 0.21],
					[0.8, 0.13],
					[1, 0.05],
				],
				angle: [
					[0, 80],
					[0.5, 72],
					[1, 50],
				],
				// Stills 08 and 21: the pinnae lie in the frond's own plane, so the blade reads flat
				// rather than as a V-section.
				planes: 1,
				fold: 8,
				droop: 12,
				spines: 0,
			},
		},
	},
	foliage: {
		// The leaf is one pinna: the reference's texture source holds a whole pinna, with its
		// pinnules and lobes painted in.
		kind: 'blade',
		leaf: {
			length: { mean: 0.36, spread: 0.03 },
			outline: 'texture',
			petiole: { length: 0.012, radius: 0.0012, flat: 0, droop: 4 },
			fold: 8,
			curl: 6,
			crossCurl: 0,
			twist: 4,
			wave: [0.002, 3],
			optics: {
				// The texture's own mean colour on each face, as the flat-lit pictures show it.
				reflectance: [0.0578, 0.0881, 0.0208],
				reflectanceBack: [0.2539, 0.2494, 0.076],
				transmittance: [0.09, 0.15, 0.04],
				roughness: [0.55, 0.65],
			},
			// Stills 19 and 25: the spore cases are painted in the underside texture itself, at the
			// photograph's own size and spacing (3.9 mm across, 1.7 mm apart along a lobe, 223 to a
			// pinna), so this record draws no discs: the leaf shows the photograph's one set.
		},
	},
	bark: {
		// Stills 15 and 26: the whole trunk is packed roots and cut frond bases, one surface, a warm
		// red-brown mat whose drawn colour loses chroma under the review's light.
		// The photograph's base is less red than the trunk above it: a neutral zone grades the
		// orange in over the bare trunk's first quarter, and the orange zone holds above it.
		zones: [
			{ layer: 0, by: 'height', from: -1, to: 0.25, blend: 0.25, tint: [0.85, 1.0, 1.05] },
			{ layer: 0, by: 'height', from: 0.2, to: 4, blend: 0.3, tint: [1.27, 0.9, 0.72] },
		],
		young: 0,
		// The stipes, rachises and pinna midribs take the fine tile, so they read as hairy brown
		// stalks rather than as the trunk's coarse mat.
		youngRadius: 0.06,
		girthScale: [
			[0, 0.6],
			[1, 1],
		],
		// The stumps of old frond bases stand a little proud of the root mat.
		displacement: 0.02,
		collar: { swell: 0, length: 1, ridge: 0 },
	},
	base: {
		// Stills 14 and 17: the foot flares into a wide low mound of roots that run out over the
		// litter, not a smooth taper.
		flare: { amount: 1, height: 0.45 },
		roots: {
			count: { mean: 40, spread: 5 },
			length: { mean: 0.55, spread: 0.12 },
			radius: 0.015,
			dive: 0.12,
			ridge: 0.7,
		},
	},
	seasons: {
		default: 'summer',
		deciduous: false,
		winter: 'evergreen',
		// The dead fronds' brown, which the foliage's browning mixes toward: still 20 shows a deep
		// red-brown curtain, and its thin pinnae turn pale straw under a bright sun unless the brown
		// takes less light through.
		autumn: { reflectance: [0.12, 0.058, 0.028], transmittance: [0.1, 0.05, 0.025] },
	},
	wind: {
		// The trunk stands rigid; the fronds swing from their stipes.
		stiffness: [
			[0, 0.98],
			[0.5, 0.85],
			[1, 0.6],
		],
		// The clip is a light breeze: its own top band moves four hundredths of its outline. Cutting
		// both amplitudes to zero still measures the top at 0.23, so the measure's page-to-page wind
		// phase sets a floor far above the clip for a crown of this size; these values are the
		// lightest breeze that still reads as moving foliage.
		sway: { frequency: 0.3, amplitude: 0.02 },
		flutter: { kind: 'leaflet', amplitude: 0.02, frequency: 1.2 },
	},
	lod: {
		nearFoliage: 'merged',
		switchPixels: [200, 40, 200],
		woodOrders: [1, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// The kit holds one pinna at each tier; the crown's pinna leaflets are the variant's, and
			// the photographs' three dozen fronds and their skirt set the variant's size.
			kitBytes: { low: 40_000, medium: 50_000, high: 60_000, ultra: 70_000 },
			variantBytes: {
				low: 2_000_000,
				medium: 2_000_000,
				high: 2_000_000,
				ultra: 2_000_000,
			},
			lod0Triangles: 90_000,
			lod1Triangles: 15_000,
			lod2Triangles: 10_000,
			downloadBytes: 900_000,
			downloadHalfBytes: 300_000,
			growMilliseconds: 100,
		},
	},
	textures: 'own',
	variants: 4,
	seedSalt: 0x7466726e,
	roundBand: 0.25,
	cuttings: {
		// Still 21: one whole frond, its stipe and its pinnae.
		branch: { order: 1, length: 2.4 },
		// Still 22: a length of rachis from the middle of the frond, with its pinnae. The length is
		// the mature frond's, so the cut takes one of the crown's long living fronds rather than a
		// short one or a dead one.
		subbranch: { order: 1, length: 2.4, from: 0.3, span: 1 },
		// Still 23: a length of the blade carrying its pinnae. The length takes a mature living
		// frond and the section runs through the blade's middle, where the pinnae are longest.
		cluster: { order: 1, length: 2.4, from: 0.5, span: 0.9, scale: 0.9 },
		// Stills 12, 13 and 24: the pinna laid flat on its own.
		leaf: { pressed: true },
	},
};
