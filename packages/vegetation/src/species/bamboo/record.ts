// The bamboo, a running timber bamboo: a giant grass whose clump rises as a bundle of near-straight
// jointed culms, clean for its lower half, then opening into an airy plume of thin branches and fans
// of narrow leaves. Each branch leaves a ringed node in a complement of two or three, one branch
// taking the lead, and divides into leafy branchlets. The culm barely tapers and its node rings
// cross a hollow, smooth green surface that no tree has.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference turntable
// by the fitting tool (fit.ts); the shoot classes from the studio stills of a branch, a sub-branch
// and a leaf cluster; the leaf from the texture source's contour and the single-leaf stills; the
// bark from the culm surface's texture. The record is plain data: no code runs in it.
import type { Species } from '../../core/record';
import { aspect, envelope, roundBand } from './fit';

/**
 * Internodes along a leafy branchlet: a long bare base out of the sheath, then the leaves' short
 * joints, crowded into the branchlet's last third where the fan stands.
 */
const BRANCHLET: readonly (readonly [number, number])[] = [
	[0, 7],
	[0.55, 0.9],
	[1, 0.3],
];

/** The bamboo's record. */
export const record: Species = {
	id: 'bamboo',
	name: 'Bamboo',
	latin: 'Phyllostachys edulis',
	form: 'a clump of tall jointed culms under an airy plume',
	size: { height: { mean: 8, spread: 1 }, dbh: 0.19, aspect },
	growth: {
		model: 'culm',
		// Stills 01, 02 and 18: a tight foot of some fifteen to twenty culms, the outer ones leaning
		// out, the whole clump about as wide as a third of its height at the foot.
		culms: { mean: 16, spread: 3 },
		layout: 'clump',
		// The culms rise from one foot with sky between their swollen bases, the outer ones leaning
		// out, as stills 01 and 02 show: the clump holds together by its crown, not by a fused base.
		spacing: 0.95,
		height: { mean: 8, spread: 1 },
		// Still 17: a culm's width over its height is about a fortieth, far thicker in proportion than
		// a tree's bole.
		diameter: { mean: 0.19, spread: 0.02 },
		// Stills 07 and 17: short joints at the foot, the longest about the middle, shorter again under
		// the tip, so the rings stand regularly up the culm.
		internode: [
			[0, 0.2],
			[0.12, 0.32],
			[0.45, 0.46],
			[0.8, 0.4],
			[1, 0.24],
		],
		// Still 15: the node is a raised ring of about a third of a centimetre over the culm's surface,
		// with a wax band above it and the sheath's scar below.
		node: { ridge: 0.007, waxBand: 0.02, sheathScar: 0.005 },
		// Stills 08 and 09: the branch complement leaves above the lower half of each culm, so the
		// clump stands bare to about its middle. The two or three branches leave on opposite
		// sides, steeply upward, and one takes the node's lead. Stills 01 and 02 show lower branches
		// shorter and the longest near the top of the branching zone.
		branches: {
			from: 0.55,
			perNode: { mean: 2, spread: 0.4 },
			dominant: true,
			length: [
				[0, 0.9],
				[0.45, 1.85],
				[0.8, 2.45],
				[1, 1.55],
			],
			angle: 52,
			orders: 1,
		},
		// Still 09: the flattened groove up the internode above a branch.
		sulcus: 0.12,
		// Stills 07 and 19: young culms carry papery sheaths low down, which shed as the culm hardens.
		sheaths: { upTo: 0.06, length: 0.28 },
		// Still 17: the culm stands nearly plumb, leaning out only slightly toward its tip.
		arch: { mean: 8, spread: 2 },
	},
	envelope,
	shoots: {
		prototypes: 6,
		classes: [
			{
				// Still 23: a branchlet of one season, its leaves gathered into a fan of five or six at
				// the tip, with the branchlet's own joints bare below it.
				name: 'short',
				vigor: [0, 0.5],
				share: 0.45,
				years: 1,
				length: { mean: 0.18, spread: 0.03 },
				nodes: { mean: 6, spread: 1 },
				internode: BRANCHLET,
				stem: { radius: [0.004, 0.002] },
				// The cluster still's fan alone takes this length: the shorter leaves bring its 235-
				// pixel height toward the photograph's 164, while the cluster turn's piece is moved
				// to the long class's shoot and keeps that class's length.
				leafScale: [
					[0, 0.63],
					[0.7, 0.7],
					[1, 0.665],
				],
				leafAngle: [
					[0, 95],
					[0.6, 82],
					[1, 68],
				],
				leafAngleSpread: 18,
				leafAzimuthSpread: 65,
				droop: 6,
				phyllotaxis: { kind: 'distichous', flatten: 0.45 },
			},
			{
				// Still 22: the longer branchlet of an older branch, its leaves after a longer bare
				// run, the fan spreading wider and hanging a little more.
				name: 'long',
				vigor: [0.5, 1],
				share: 0.55,
				years: 1,
				length: { mean: 0.46, spread: 0.08 },
				nodes: { mean: 9, spread: 1.5 },
				internode: BRANCHLET,
				stem: { radius: [0.006, 0.0025] },
				leafScale: [
					[0, 0.88],
					[0.45, 1.05],
					[1, 0.9],
				],
				leafAngle: [
					[0, 95],
					[0.5, 82],
					[1, 66],
				],
				leafAngleSpread: 20,
				leafAzimuthSpread: 65,
				droop: 9,
				phyllotaxis: { kind: 'distichous', flatten: 0.45 },
			},
		],
		cuttingClasses: [
			{
				// Still 22: a cut branchlet of about half a metre, its leaves after a bare run and side
				// branchlets each ending in a fan. The crown cannot carry shoots this bare, so the
				// sub-branch draws this class and the crown never does. The photograph shows three or
				// four fans; a third costs the kit more bytes than its owner cap leaves.
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 2,
				length: { mean: 0.42, spread: 0.05 },
				nodes: { mean: 6, spread: 1 },
				internode: BRANCHLET,
				stem: { radius: [0.005, 0.002] },
				lateral: 58,
				laterals: 2,
				lateralGap: 0.45,
				leafScale: [
					[0, 1.05],
					[1, 1.1],
				],
				leafAngle: [
					[0, 95],
					[0.6, 80],
					[1, 64],
				],
				leafAngleSpread: 20,
				leafAzimuthSpread: 65,
				droop: 9,
				phyllotaxis: { kind: 'distichous', flatten: 0.45 },
			},
		],
		phyllotaxis: { kind: 'distichous', flatten: 0.45 },
		orders: 2,
		years: 1,
		leafYears: 1,
		stem: { radius: [0.004, 0.002], zigzag: 4 },
		// Still 10: the buds at a branchlet's joints are small and close against the wood.
		bud: { length: 0.004, width: 0.003, tipCluster: 1, colour: [0.16, 0.12, 0.05] },
		placement: {
			perMetre: [
				[0, 3],
				[1, 5.5],
			],
			// The reference's plume is open between its fans: the shoots spread along the branches
			// without closing the crown, and the silhouette still hangs together as one piece.
			density: 1.0,
			shadePrune: 0,
			// Stills 01, 05 and 18: the plume is open, with sky between the fans and the branches
			// showing through it, so only the innermost shoots go.
			skyPrune: 0.05,
			// The reference spreads its sprays along the upper culms, so the shoots stand along each
			// branch rather than gathering into a tuft at its tip.
			tipBias: 0.1,
			lift: 8,
			skyward: 0.5,
			rosette: 'fan',
			scale: { mean: 1, spread: 0.12 },
			gather: 1,
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Stills 12, 13 and 24: a lance-shaped blade about 15 to 20 cm long, widest near its middle,
			// long-tipped and narrowing to a short stalk.
			length: { mean: 0.17, spread: 0.025 },
			outline: 'texture',
			petiole: { length: 0.006, radius: 0.0009, flat: 0, droop: 8 },
			fold: 8,
			curl: 9,
			crossCurl: -4,
			twist: 5,
			wave: [0.0015, 3],
			optics: {
				// The texture manifest's measured means of both faces: still 12's upper face is a bright
				// mid green, and still 13's lower face a pale blue-green.
				reflectance: [0.0808, 0.2188, 0.0047],
				reflectanceBack: [0.1699, 0.257, 0.1894],
				// The through-light carries more red than the reflected face, so a back-lit crown
				// reads as the photographs' yellow-green rather than the sky's blue-green.
				transmittance: [0.12, 0.18, 0.02],
				roughness: [0.42, 0.58],
			},
		},
	},
	bark: {
		zones: [
			// Still 26's flat-lit culm surface and stills 07 and 17 in daylight: one smooth green skin
			// with a waxy bloom, so one tint answers the texture.
			{ layer: 0, by: 'height', from: 0, to: 40, blend: 0.5, tint: [1, 1, 1] },
		],
		young: 0,
		youngRadius: 0.012,
		girthScale: [
			[0, 0.8],
			[1, 1.15],
		],
		// Still 15: the surface is smooth between the rings, so the texture's figure barely moves it.
		displacement: 0.005,
		// Stills 08 and 09: a branch meets the culm in a short, smooth swelling, not a deep crotch.
		collar: { swell: 0.18, length: 1.2, ridge: 0.25 },
	},
	extras: [
		{
			// Stills 07, 16 and 19: a young culm's lowest nodes carry papery sheaths, which shed as the
			// culm hardens. A sheath flares wider than the culm it wraps and hangs from its node as a
			// skirt, so it stands proud of the smooth green surface rather than hugging it.
			kind: 'sheath',
			at: 'culm-node',
			share: 0.5,
			count: 1,
			seasons: ['summer', 'autumn', 'winter', 'blossom'],
			shape: {
				lathe: [
					[0.12, 0],
					[0.17, 0.03],
					[0.18, 0.07],
					[0.17, 0.13],
					[0.15, 0.18],
				],
				sides: 10,
			},
			colour: [0.34, 0.27, 0.16],
			roughness: [0.85, 0.85],
			hang: 0,
		},
	],
	seasons: { default: 'summer', deciduous: false, winter: 'evergreen' },
	wind: {
		// The reference's breeze bends the culms together and sets the fans swinging.
		stiffness: [
			[0, 0.9],
			[0.5, 0.8],
			[1, 0.55],
		],
		sway: { frequency: 0.24, amplitude: 0.045 },
		flutter: { kind: 'blade', amplitude: 0.16, frequency: 3 },
	},
	lod: {
		nearFoliage: 'instanced',
		switchPixels: [240, 12, 160],
		// A card no wider than the shoot it stands for keeps the sky between the plume's sprays,
		// as the turning reference shows.
		cardGrow: 1.0,
		// A card draws a short stalk so a leaf mass ties to its shoot, not floats free.
		cardStalk: 2,
		// The farthest card level keeps the culms alone: a branch a few centimetres thick is under a
		// pixel there, while the cards carry the plume's shape.
		woodOrders: [1, 0],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			kitBytes: { low: 2_500_000, medium: 2_500_000, high: 3_500_000, ultra: 3_800_000 },
			variantBytes: { low: 2_200_000, medium: 2_200_000, high: 2_700_000, ultra: 2_900_000 },
			lod0Triangles: 580_000,
			lod1Triangles: 75_000,
			lod2Triangles: 19_000,
			downloadBytes: 900_000,
			downloadHalfBytes: 320_000,
			growMilliseconds: 280,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 1447370378,
	roundBand,
	forms: {
		// Still 19: the spring spear, one thick sheathed culm pushing up through the soil, its sheaths
		// overlapping up the body and only the newest leaf tips showing at its point. It is the same
		// culm model grown short and broad, with no branch complement.
		shoot: {
			form: 'a spring spear: one thick sheathed culm rising from the soil',
			size: { height: { mean: 0.5, spread: 0.02 }, dbh: 0.2, aspect: 0.6 },
			growth: {
				culms: 1,
				layout: 'clump',
				spacing: 0.02,
				height: { mean: 0.5, spread: 0.02 },
				diameter: { mean: 0.2, spread: 0.01 },
				internode: [
					[0, 0.07],
					[0.6, 0.05],
					[1, 0.03],
				],
				node: { ridge: 0.002, waxBand: 0.01, sheathScar: 0.003 },
				branches: { from: 1, perNode: 1, dominant: false, length: 0.05, angle: 45, orders: 1 },
				sulcus: 0,
				sheaths: { upTo: 1, length: 0.02 },
				arch: 0,
			},
			envelope: null,
			shoots: {
				prototypes: 4,
				classes: [
					{
						name: 'short',
						vigor: [0, 1],
						share: 1,
						years: 1,
						length: { mean: 0.03, spread: 0.005 },
						nodes: { mean: 2, spread: 0 },
						internode: 1,
						stem: { radius: [0.002, 0.001] },
						leafScale: 0.4,
						leafAngle: 40,
						droop: 0,
					},
				],
				placement: {
					perMetre: 0,
					density: 0,
					shadePrune: 0,
					skyPrune: 0,
					tipBias: 0,
					lift: 0,
					skyward: 0.5,
					scale: { mean: 0.5, spread: 0 },
					gather: 1,
				},
			},
			bark: {
				// Still 19: the spear's flesh shows dark brown between its pale sheaths.
				zones: [{ layer: 0, by: 'height', from: 0, to: 2, blend: 0, tint: [0.85, 0.21, 0.95] }],
				young: 0,
				youngRadius: 0.01,
				girthScale: 1,
				displacement: 0.002,
				collar: { swell: 0.1, length: 1, ridge: 0 },
			},
			extras: [
				{
					kind: 'sheath',
					at: 'culm-node',
					share: 1,
					count: 1,
					seasons: ['summer', 'autumn', 'winter', 'blossom'],
					shape: {
						lathe: [
							[0.05, 0],
							[0.075, 0.02],
							[0.09, 0.05],
							[0.075, 0.09],
							[0.05, 0.13],
						],
						sides: 10,
					},
					colour: [0.3, 0.23, 0.13],
					roughness: [0.9, 0.9],
					hang: 0,
				},
			],
			wind: {
				stiffness: [
					[0, 0.98],
					[1, 0.9],
				],
				sway: { frequency: 0.2, amplitude: 0.005 },
				flutter: { kind: 'blade', amplitude: 0.05, frequency: 2 },
			},
		},
	},
	cuttings: {
		// Still 21: a metre of a branch, from its node to its leafy branchlets.
		branch: { order: 1, length: 0.95 },
		// Still 22: a cut branchlet with side fans, drawn by the class of its own.
		subbranch: { shoot: 'cut' },
		// Still 23: the shorter branchlet's fan.
		cluster: { shoot: 'short' },
		// Stills 12, 13, 24 and 25 lay the leaf flat on a copy stand.
		leaf: { pressed: true },
	},
};
