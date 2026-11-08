// The bracken: a colony of separate fronds, each rising alone from a buried rhizome on a bare
// stipe that is black at the soil and green above. Every frond carries one broad triangular
// bipinnate blade, held near level on the stipe's turned-over top, the lowest pinna pair longest.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference
// turntable by the fitting tool (fit.ts); the colony, the stipe and the frond from the reference
// set's whole-colony, profile and single-frond pictures and its studio stills; the leaf faces from
// the texture sources. The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/** The bracken. */
export const record: Species = {
	id: 'bracken',
	name: 'Bracken',
	latin: 'Pteridium aquilinum',
	form: 'colony of separate fronds on bare stipes from buried rhizomes',
	// Stills 01 and 18: the fronds reach about a person's chest, the patch about two and a half
	// times as wide as it is tall.
	size: { height: { mean: 1.2, spread: 0.3 }, aspect },
	envelope,
	roundBand,
	growth: {
		model: 'frond-colony',
		// Still 01 and the turntable: about fifteen fronds stand in one loose patch.
		fronds: { mean: 15, spread: 4 },
		// Still 01: the patch spreads about a metre and a quarter each way from its middle, the
		// fronds a stipe apart along lines that wander out from it, so the plan reads round.
		rhizome: {
			length: 0.95,
			branches: { mean: 5, spread: 1 },
			spacing: { mean: 0.32, spread: 0.06 },
		},
		// Still 02: the bare stipe is about as long as the blade it carries, and leans a little.
		stipe: { length: { mean: 0.8, spread: 0.22 }, lean: { mean: 6, spread: 5 } },
		frond: {
			// Stills 12 and 21: the blade is bipinnate and broadly triangular, about as long as
			// its stipe, and the blades of a stand overlap into a continuous roof.
			kind: 'bipinnate',
			length: { mean: 0.85, spread: 0.15 },
			// Stills 06 and 16: a stipe stout enough to carry the blade.
			petiole: { length: 0, width: 0.013, teeth: 0 },
			// Still 02: the rachis leaves the stipe's top rising, turns over through the blade's
			// first third to near level, and lets the tip fall a little below it.
			droop: [
				[0, 0],
				[0.1, 45],
				[0.35, 78],
				[0.7, 94],
				[1, 100],
			],
			// Still 12: the blade turns a little about its rachis, so one side stands higher.
			twist: 8,
			pinnae: {
				// Stills 12 and 21: about ten pinna pairs a side, the lowest pair the longest and
				// the pairs shortening to the tip.
				count: 10,
				length: [
					[0, 0.55],
					[0.15, 0.5],
					[0.6, 0.27],
					[1, 0.04],
				],
				// Still 08: the lowest pinnae leave almost at right angles to the rachis and the
				// upper ones stand closer to it.
				angle: [
					[0, 80],
					[0.5, 64],
					[1, 50],
				],
				planes: 1,
				// Still 09: each pinna folds a little about its costa, so the blade is not flat.
				fold: 14,
				droop: 24,
				spines: 0,
				// Stills 09 and 10: every pinna carries about eighteen pinnules cut into blunt
				// joined lobes.
				sub: {
					count: 18,
					length: [
						[0, 0.12],
						[1, 0.03],
					],
					angle: 72,
					planes: 1,
					fold: 8,
					droop: 10,
					spines: 0,
				},
			},
		},
		// Stills 07 and 01: one or two young fronds still unroll among the open ones.
		croziers: { mean: 1.5, spread: 1 },
	},
	foliage: {
		kind: 'frond',
		// Texture sources 24 and 25: the measured linear means of the two faces, so a face lit
		// square on shows the colour its own picture has: a matt mid green above, a pale underside.
		optics: {
			reflectance: [0.105, 0.182, 0.033],
			reflectanceBack: [0.253, 0.306, 0.073],
			transmittance: [0.12, 0.24, 0.05],
			roughness: [0.75, 0.8],
		},
	},
	bark: {
		// Stills 15 and 16: the stipe is black in its lowest tenth and green above it.
		zones: [
			{ layer: 0, by: 'height', from: -1, to: 0.12, blend: 0.06, tint: [0.022, 0.02, 0.017] },
			{ layer: 1, by: 'height', from: 0.12, to: 4, blend: 0.06, tint: [0.1, 0.22, 0.035] },
		],
		young: 0,
		youngRadius: 0,
		girthScale: 1,
		displacement: 0,
		collar: { swell: 0, length: 1, ridge: 0 },
	},
	seasons: {
		// Still 19: the colony turns rust brown and bronze in autumn, the stipes orange.
		// Still 20: in winter the dead fronds collapse into a flat straw mat.
		default: 'summer',
		deciduous: true,
		winter: 'marcescent',
		autumn: { reflectance: [0.3, 0.14, 0.04], transmittance: [0.35, 0.15, 0.03] },
	},
	wind: {
		// The wind clip is a light breeze: the level blades rock a little on their stipes while
		// the wood stays stiff.
		stiffness: [
			[0, 0.85],
			[1, 0.5],
		],
		sway: { frequency: 0.35, amplitude: 0.02 },
		flutter: { kind: 'leaflet', amplitude: 0.04, frequency: 1.2 },
	},
	lod: {
		nearFoliage: 'merged',
		// A frond's blade fills many pixels before its card does, so it switches later than a
		// broadleaf shoot's.
		switchPixels: [40, 16, 120],
		woodOrders: [1, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 1_000_000, medium: 1_000_000, high: 1_000_000, ultra: 1_000_000 },
			variantBytes: { low: 1_500_000, medium: 1_500_000, high: 1_500_000, ultra: 1_500_000 },
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
	seedSalt: 0x6272616b,
	// Still 12: one whole frond is the single leaf that the close views lay out, pressed flat as a
	// scanned frond lies.
	cuttings: { leaf: { pressed: true } },
};
