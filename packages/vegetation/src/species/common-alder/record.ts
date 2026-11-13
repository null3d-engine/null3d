// The common alder, open-grown by water: a tall straight trunk on one leader that carries the crown
// to its very top, its short branches leaving it almost level at every height, so the crown is an
// open cone of rounded leaf clumps with sky between them. The wood is dark: a young branch is smooth
// and purplish with pale orange lenticels, and the bole breaks into small square plates. The leaves
// are nearly circular, notched at the tip and wavy-toothed, and every cluster ends in a big purple
// bud. The tree bears its seeds in small woody cones and its pollen in long catkins, both hanging
// from short stalks at the twigs' ends.
//
// The envelope, the crown's aspect and the all-round band are measured from the reference turntable
// by the fitting tool (fit.ts); the growth numbers are fitted to the same turntable; the shoot
// classes from the studio stills of a branch, a sub-branch and a leaf cluster; the leaf from the
// single-leaf stills and the texture sources; the bark from the bark stills; the cones and catkins
// from the winter still. The record is plain data: no code runs in it.
import type { RadialEnvelope, Species } from '../../core/record';
import { roundBand } from './fit';

/**
 * The outline the crown fills: the visual hull of stills 18 and 02, which stand square to one
 * another, so each gives the reach along one horizontal axis at every height, at 16 azimuths.
 *
 * The fitting tool's hull of the turning video is wider than the whole views: it reaches 1.015 of
 * the height at its widest against the photographs' 0.590 to 0.626, because the generated tree
 * drifts between the video's frames and each frame's reach is kept. The whole views are the frames
 * that rows 1, 6, 9 and 11 are judged on, so the crown follows them; `fit.ts` keeps the tool's own
 * measurement beside it.
 *
 * The hull's shape round the stem is far more lopsided than this table: at mid-height it reads 1.71
 * broad to narrow against the record's 1.07, which is why the crown reads round. The record keeps
 * the narrow stills' mean width; the review records that stills 18 (0.750), 01 (1.227) and 30
 * (1.192) all draw at turn 0 and do not agree, with the turntable's turn-0 frame at 1.191.
 *
 * Laying the hull's shape on the record's mean width should widen the turn-0 side (stills 01 and 30)
 * toward 1.227 and 1.192 and narrow the turn-90 side (still 02) toward 0.658, while still 18, also
 * at turn 0, rises away from its 0.750, the outlier. The measured attempt at this commit,
 * `alder-env-shape-2`, moved 01 from 0.736 to 0.860, 30 from 0.767 to 0.883, 18 from 0.768 to 0.887
 * and 02 from 0.833 to 0.829, and widened the plant from 14.89 m to 17.26 m, so the shape is not
 * kept.
 */
const envelope: RadialEnvelope = {
	kind: 'radial',
	heights: [
		0.14, 0.2, 0.26, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.86, 0.92, 0.97, 1,
	],
	radii: [
		[
			0.08, 0.087, 0.101, 0.125, 0.168, 0.125, 0.101, 0.087, 0.08, 0.087, 0.101, 0.125, 0.168,
			0.125, 0.101, 0.087,
		],
		[
			0.207, 0.213, 0.229, 0.251, 0.268, 0.251, 0.229, 0.213, 0.207, 0.213, 0.229, 0.251, 0.268,
			0.251, 0.229, 0.213,
		],
		[
			0.266, 0.269, 0.277, 0.285, 0.289, 0.285, 0.277, 0.269, 0.266, 0.269, 0.277, 0.285, 0.289,
			0.285, 0.277, 0.269,
		],
		[
			0.278, 0.279, 0.282, 0.286, 0.288, 0.286, 0.282, 0.279, 0.278, 0.279, 0.282, 0.286, 0.288,
			0.286, 0.282, 0.279,
		],
		[
			0.297, 0.295, 0.291, 0.286, 0.284, 0.286, 0.291, 0.295, 0.297, 0.295, 0.291, 0.286, 0.284,
			0.286, 0.291, 0.295,
		],
		[
			0.307, 0.304, 0.298, 0.29, 0.287, 0.29, 0.298, 0.304, 0.307, 0.304, 0.298, 0.29, 0.287, 0.29,
			0.298, 0.304,
		],
		[
			0.301, 0.293, 0.279, 0.263, 0.255, 0.263, 0.279, 0.293, 0.301, 0.293, 0.279, 0.263, 0.255,
			0.263, 0.279, 0.293,
		],
		[
			0.279, 0.268, 0.25, 0.238, 0.234, 0.238, 0.25, 0.268, 0.279, 0.268, 0.25, 0.238, 0.234, 0.238,
			0.25, 0.268,
		],
		[
			0.255, 0.252, 0.246, 0.24, 0.237, 0.24, 0.246, 0.252, 0.255, 0.252, 0.246, 0.24, 0.237, 0.24,
			0.246, 0.252,
		],
		[
			0.234, 0.232, 0.226, 0.22, 0.218, 0.22, 0.226, 0.232, 0.234, 0.232, 0.226, 0.22, 0.218, 0.22,
			0.226, 0.232,
		],
		[
			0.205, 0.202, 0.196, 0.189, 0.185, 0.189, 0.196, 0.202, 0.205, 0.202, 0.196, 0.189, 0.185,
			0.189, 0.196, 0.202,
		],
		[
			0.178, 0.173, 0.164, 0.156, 0.152, 0.156, 0.164, 0.173, 0.178, 0.173, 0.164, 0.156, 0.152,
			0.156, 0.164, 0.173,
		],
		[
			0.146, 0.142, 0.135, 0.13, 0.128, 0.13, 0.135, 0.142, 0.146, 0.142, 0.135, 0.13, 0.128, 0.13,
			0.135, 0.142,
		],
		[
			0.11, 0.107, 0.101, 0.096, 0.094, 0.096, 0.101, 0.107, 0.11, 0.107, 0.101, 0.096, 0.094,
			0.096, 0.101, 0.107,
		],
		[
			0.065, 0.062, 0.057, 0.052, 0.05, 0.052, 0.057, 0.062, 0.065, 0.062, 0.057, 0.052, 0.05,
			0.052, 0.057, 0.062,
		],
		[
			0.03, 0.026, 0.021, 0.017, 0.015, 0.017, 0.021, 0.026, 0.03, 0.026, 0.021, 0.017, 0.015,
			0.017, 0.021, 0.026,
		],
	],
	source: {
		method: 'profile',
		from: '18-silhouette.png',
		views: 2,
		stills: [
			{ file: '18-silhouette.png', turn: 0 },
			{ file: '02-whole-profile.png', turn: 90 },
		],
	},
};

/** Internodes along a spur: the leaves gather at its tip round the bud that ends it. */
const SPUR: readonly (readonly [number, number])[] = [
	[0, 12],
	[0.15, 0.7],
	[1, 0.35],
];

/** Internodes along a growing shoot: even over the run, the leaves alternating to its end. */
const RUN: readonly (readonly [number, number])[] = [
	[0, 1],
	[0.8, 0.85],
	[1, 0.6],
];

/**
 * How far a leaf leans off the shoot it grows on, along the shoot: wide open at its foot so the
 * blades clear the stem, closing toward the tip as the stills of a branch and a sub-branch show.
 */
const OPEN_LEAF_ANGLE: readonly (readonly [number, number])[] = [
	[0, 110],
	[0.5, 80],
	[1, 60],
];

/** The common alder's record. */
export const record: Species = {
	id: 'common-alder',
	name: 'Common alder',
	latin: 'Alnus glutinosa',
	form: 'open cone on a straight central trunk, its short branches almost level',
	// Stills 01, 02 and 18 stand the bole about 0.036 of the tree's height across at breast height.
	// The whole views' crowns are 0.590 and 0.626 of the height wide, so the tree is taller than it is
	// broad and the crown is a narrow cone rather than the fitting tool's wider hull.
	size: { height: { mean: 20, spread: 2 }, dbh: 0.72, aspect: 0.61 },
	growth: {
		model: 'self-organizing',
		years: 36,
		macroOrders: 4,
		// Stills 02, 18 and 30: the crown's lowest foliage stands from a tenth to a fifth of the
		// height, so its underside stands there and the bole is bare below it.
		floor: 0.14,
		// Still 07: a branch meets the bole in a swollen collar and passes round the wood above it
		// rather than through. Only wood above a third of the trunk's girth keeps the clearance, so the
		// crown's fine twigs keep their own layout.
		clearance: 0.3,
		clearanceThickness: 0.35,
		turning: 30,
		internode: { length: 0.5, ageFactor: 0.99 },
		stems: { count: 1, lean: { mean: 1.5, spread: 1.5 }, stool: 0, fused: 0 },
		buds: {
			// Stills 10, 11 and 23: the leaves and buds stand one at a time along the twig, in the
			// two-fifths spiral an alder carries.
			arrangement: { kind: 'spiral', divergence: 144 },
			// Stills 07 and 17: the lower branches leave the bole almost level, and they steepen as
			// each order is finer, so the crown's top rounds into a cone rather than a plate.
			angle: [
				[0.25, 74],
				[1, 56],
			],
			angleSpread: 6,
			// Stills 01 and 18: the crown is open, and a bud that chance kills leaves the space the
			// photograph shows rather than a bare stub.
			extinction: [0.02, 0.03],
		},
		// Stills 01, 02 and 17: one leader runs straight from the bole to the crown's top and is never
		// outgrown by a limb, so the tree is excurrent and the bole runs through the crown.
		apical: {
			control: [
				[0, 0.7],
				[1, 0.62],
			],
			dominance: [0.75, 0.6, 0.98],
			wander: 8,
		},
		// Stills 01 and 02: the crown's lit top and rim carry its fullest shoots.
		// No earlier record value put more buds on one side: the arrangement is a constant spiral
		// and the light is an isotropic shadow grid, so the room bias is the species' first
		// per-azimuth control. The fitting tool's hull reads 1.71 broad to narrow at mid-height
		// against the record's 1.07. A room bias of 1 was drawn at f4cd557ac: it narrowed still 02
		// from 0.833 to 0.687 toward its 0.658 and still 18 from 0.768 to 0.744, but it narrowed
		// stills 01 and 30 (0.736 to 0.720 and 0.767 to 0.743) instead of widening them, and moved
		// row 9's aspect from 0.677 to 0.705, so the alder does not set it.
		light: { apical: 1, lateral: 1, shadow: [5, 0.15, 2], cells: 96, surface: true },
		// Stills 03 and 05: a branch runs out almost level and turns up a little at its end, where its
		// last year's wood reaches for the light.
		tropism: {
			photo: 0.04,
			gravi: [
				[0, 0.28],
				[0.35, 0.04],
				[0.75, 0.05],
				[1, 0.2],
			],
		},
		// Stills 01, 02 and 18: a bud the righting carried under the crown stands in its shade, and the
		// bole is bare from its flare to the crown's base.
		shedding: { threshold: 0.1, cleanBole: 0.14, stubs: 0.2, underCrown: 1 },
		// The crown's sag was fitted with the wood weighed at a 3.5 m bole; the bend keeps weighing it
		// so, whatever width the trunk is drawn at.
		bending: { strength: 0.45, upturn: 0.25, girth: 3.5 },
		forkRule: true,
		// Stills 10 and 22: the fine twigs run stiff and angular between their nodes, kinking at each
		// leaf's foot rather than curving as one rod.
		kinks: true,
		// Still 17: the bole runs on as one stem through the crown and stays the tree's thickest axis,
		// so no limb outgrows it and the crown stands on a continuous trunk.
		pipe: { exponent: 2.3, tipRadius: 0.012, leader: 0.85 },
	},
	envelope,
	shoots: {
		prototypes: 5,
		classes: [
			{
				// Still 23: this year's spur, a short shoot whose four to six leaves gather at its end
				// round one large purple bud. The oldest leaf opens widest and hangs lowest, so the
				// cluster reads round from every side.
				name: 'short',
				vigor: [0, 0.05],
				share: 0.3,
				years: 1,
				length: { mean: 0.11, spread: 0.02 },
				nodes: { mean: 6, spread: 0.4 },
				internode: SPUR,
				leafScale: [
					[0, 0.85],
					[1, 1],
				],
				leafAngle: [
					[0, 130],
					[0.5, 85],
					[1, 55],
				],
				leafAngleSpread: 25,
				droop: 3,
			},
			{
				// Stills 10 and 22: last year's shoot, its leaves alternating along it and its side
				// shoots leaving one at a time from the leaf axils.
				name: 'long',
				vigor: [0.05, 0.5],
				share: 0.35,
				years: 2,
				length: { mean: 0.3, spread: 0.05 },
				nodes: { mean: 9, spread: 0.5 },
				internode: RUN,
				leafYears: 1,
				stem: { radius: [0.005, 0.003] },
				// Still 21: the side shoots leave the stem singly, a few centimetres apart, not as a fan
				// from one point.
				laterals: 2,
				lateralGap: 0.35,
				// Stills 10 and 22: the twig kinks at each node and runs straight between the kinks.
				bend: { length: 0.05, angle: 30 },
				leafScale: [
					[0, 0.9],
					[1, 1],
				],
				leafAngle: OPEN_LEAF_ANGLE,
				droop: 4,
			},
			{
				// The crown's outer growth: two years of a limb's end, its leafy side shoots alternating
				// along a stem that shows between them.
				name: 'spray',
				vigor: [0.5, 1],
				share: 0.35,
				years: 2,
				length: { mean: 0.6, spread: 0.1 },
				nodes: { mean: 10, spread: 0.5 },
				internode: RUN,
				stem: { radius: [0.014, 0.006] },
				lateral: 70,
				laterals: { mean: 2.5, spread: 0.4 },
				lateralGap: 0.3,
				bend: { length: 0.06, angle: 30 },
				leafScale: [
					[0, 0.85],
					[1, 1],
				],
				leafAngle: OPEN_LEAF_ANGLE,
				droop: 4,
			},
		],
		// Stills 10 and 22: a bare twig that forks once into two leafy shoots with the stem showing
		// between the joints, sparser than the crown's own twigs. The crown cannot carry a shoot this
		// open, so the cuttings draw this class and the crown never does.
		cuttingClasses: [
			{
				name: 'cut',
				vigor: [0, 1],
				share: 0,
				years: 3,
				length: { mean: 0.55, spread: 0.2 },
				nodes: { mean: 4.5, spread: 0.5 },
				internode: RUN,
				stem: { radius: [0.009, 0.002] },
				lateral: 70,
				laterals: 1.4,
				lateralGap: 0.4,
				leafYears: 2,
				bend: { length: 0.05, angle: 30 },
				leafScale: [
					[0, 0.9],
					[1, 1.05],
				],
				leafAngle: OPEN_LEAF_ANGLE,
				droop: 4,
			},
			{
				// Stills 11 and 23: this year's shoot of alternate leaves gathered at its end round one
				// purple bud. The field photograph carries eight and the studio seven, so the count's
				// spread is wide enough for the class's two shoots to draw those two numbers, and the
				// leaves stand between the two sizes each wants. A cutting class never offers itself to
				// the crown, so the tree keeps its own spurs.
				name: 'spur',
				vigor: [0, 1],
				share: 0,
				years: 1,
				length: { mean: 0.24, spread: 0.02 },
				nodes: { mean: 7, spread: 1.4 },
				// Still 23: the leaves stand along a stem with its internodes showing, so the piece is
				// taller than it is wide, as the photograph lays it out.
				internode: RUN,
				leafScale: [
					[0, 0.74],
					[1, 0.875],
				],
				leafAngle: [
					[0, 95],
					[0.5, 70],
					[1, 45],
				],
				leafAngleSpread: 15,
				droop: 3,
			},
			{
				// Still 21: three years of a limb, its side shoots leaving at a wide angle and
				// carrying their leaves along their whole length, with the leaf size the photograph
				// gives beside a piece this long. It stands last so the other two pieces draw the
				// shoots they drew before it. Its kind is the free long kind, since a class kind
				// names a shoot the four-panel plant also grows.
				name: 'whip',
				vigor: [0, 1],
				share: 0,
				years: 3,
				length: { mean: 0.68, spread: 0.08 },
				nodes: { mean: 3.5, spread: 0.5 },
				internode: RUN,
				stem: { radius: [0.012, 0.004] },
				lateral: 70,
				laterals: { mean: 2.6, spread: 0.2 },
				lateralGap: 0.3,
				leafYears: 2,
				bend: { length: 0.06, angle: 30 },
				leafScale: [
					[0, 0.85],
					[1, 1],
				],
				leafAngle: OPEN_LEAF_ANGLE,
				droop: 4,
			},
		],
		// Stills 11 and 23: each leaf stands a fifth of a turn past the one below it.
		phyllotaxis: { kind: 'spiral', divergence: 144 },
		orders: 3,
		years: 3,
		leafYears: 2,
		// Still 10: the twigs are slender and kink at every node, the buds sitting on short stalks.
		stem: { radius: [0.0035, 0.0022], zigzag: 18 },
		// Stills 10 and 23: a stubby purple bud, about eight millimetres long, stands above the last
		// leaf at every shoot's end, on a short stalk, with smaller buds in the axils below it.
		bud: {
			length: 0.008,
			width: 0.006,
			tipCluster: 1,
			colour: [0.055, 0.03, 0.045],
		},
		placement: {
			// Stills 01, 02 and 05: every branch carries leafy shoots along its run, so the crown reads
			// as clumps on visible branches rather than tufts on bare axes.
			perMetre: [
				[0, 1.4],
				[0.55, 3],
				[1, 10],
			],
			// Stills 01 and 18: the crown holds about a tenth of its own box as sky, and the curve above
			// carries the shoots that fill what the photographs show.
			density: 3.6,
			shadePrune: 0,
			// Stills 01, 03 and 05: sky shows between the branch tiers and through the crown's middle,
			// while the crown's own interior keeps the shade leaves that make its mass.
			skyPrune: 0.02,
			skyPruneLayer: 1,
			// Stills 01 and 18: no bare twigs stand outside the foliage, so a twig left with nothing goes.
			bareTrim: 0.03,
			// Stills 02 and 05: the shoots stand up off their wood, so the foliage rides on the limbs.
			lift: 10,
			skyward: 0.55,
			scale: { mean: 1.25, spread: 0.15 },
		},
	},
	foliage: {
		kind: 'blade',
		leaf: {
			// Stills 12 and 24: a nearly circular blade, its width about nine tenths of its length, on a
			// short stalk, which the texture contour carries with its notched tip and wavy double teeth.
			length: { mean: 0.07, spread: 0.008 },
			outline: 'texture',
			// Stills 21 and 22: the stalk stands a little over a millimetre across. A stout stalk draws
			// its leaves joined at a cut piece's scale, but it is not this species' own, so the record
			// keeps the thin one and the piece's loose groups are stated instead.
			petiole: { length: 0.012, radius: 0.0016, flat: 0, droop: 20 },
			fold: 12,
			curl: 10,
			crossCurl: 4,
			twist: 4,
			// Stills 12 and 13: the margin runs in small waves between its teeth.
			wave: [0.0015, 4],
			// The front face stands as the single-leaf stills measure it. The light through and the
			// underside carry a fifth more red and two thirds more blue than the texture's means gave,
			// because a crown draws a mixture of the three and the three whole views that read its own
			// light stood four to nine steps too green and yellow against their photographs.
			optics: {
				reflectance: [0.0303, 0.0651, 0.0093],
				reflectanceBack: [0.194, 0.2558, 0.0965],
				transmittance: [0.0895, 0.1401, 0.0343],
				roughness: [0.42, 0.62],
			},
		},
	},
	bark: {
		// Stills 26 and 15 under the copy-stand lamps: a dark grey-brown on the thick bole. The
		// texture set carries the tone; this zone pulls its red and blue down, because the drawn
		// bole stands warm of its photographs. Thin wood draws the young bark instead and keeps
		// none of this tint.
		zones: [{ layer: 0, by: 'height', from: 0, to: 40, blend: 0, tint: [0.89, 1, 0.97] }],
		young: 0,
		// Stills 16 and 28: the plates give way to smooth purplish bark with pale orange lenticels on
		// wood thinner than about seven centimetres across, which is how the limb of still 16 reads.
		youngRadius: 0.075,
		// Still 15: the plates stand wider on the thick bole than on the limbs below it.
		girthScale: [
			[0, 0.55],
			[1, 1],
		],
		// Still 15: shallow square plates split by narrow furrows.
		displacement: 0.03,
		// Still 07: a branch meets the bole in a long, swollen collar.
		collar: { swell: 0.42, length: 1.6, ridge: 0.5 },
		// Still 08: the fork closes on a smooth curve, its arms parting in a wide Y.
		fork: { bend: 2.6 },
		// Still 14's foot: a thin green film in the furrows, not a coat over the plates. Measured on the
		// bark alone, the foot's red-green is within half a step of its photograph's, so the green the
		// base view reads is the meadow behind the flare rather than this film.
		moss: { amount: 0.3, up: 1, north: 0, colour: [0.16, 0.2, 0.06] },
		// Still 15: pale grey-green lichen flecks the crests of the plates on the lower bole.
		lichen: { amount: 0.15, from: 0.4, to: 0.7, colour: [0.36, 0.38, 0.34] },
	},
	base: {
		// Stills 14 and 20: the foot flares to about a third again the bole's own width at the water,
		// on a few broad buttresses.
		flare: { amount: 0.4, height: 0.6 },
		buttress: {
			lobes: { mean: 5, spread: 1 },
			amount: 0.45,
			sharpness: 2.5,
			height: 0.55,
			round: 0.55,
		},
		// Stills 14 and 20: roots run out over the bank and into the water, their tops standing clear
		// of the ground and sinking as they go.
		roots: {
			count: { mean: 6, spread: 1 },
			length: { mean: 1.6, spread: 0.3 },
			radius: 0.45,
			dive: 0.35,
			ridge: 0.95,
		},
	},
	extras: [
		{
			// Still 19: small woody cones, each about twice as long as wide, hanging in twos to fours
			// from one short stalk at the twig's end. Their scales stand in rows that open as the seed
			// leaves.
			// Still 19 wants more cones on more tips, but they are the costliest part the species carries:
			// at three tenths of the tips the densest variant measures 28.2 MB against the owner's twenty.
			// A sixth stands, as the budget allows no more.
			kind: 'cone',
			at: 'shoot-tip',
			share: 0.16,
			count: { mean: 3, spread: 1 },
			tipShare: 0.8,
			seasons: ['summer', 'autumn', 'winter'],
			shape: {
				lathe: [
					[0.0012, 0],
					[0.0038, 0.001],
					[0.0056, 0.0022],
					[0.0064, 0.004],
					[0.0062, 0.006],
					[0.0054, 0.0082],
					[0.0042, 0.0104],
					[0.0026, 0.0124],
					[0.0012, 0.0138],
					[0, 0.0148],
				],
				sides: 6,
				scales: 4,
				scaled: [0.0012, 0.0138],
				stalk: 0.008,
				pedicel: 0.006,
				stalkSides: 5,
				scaleShade: 0.35,
				scaleJitter: 0.2,
			},
			// Still 19: the cones are a very dark brown, almost black in their crevices.
			colour: [0.035, 0.022, 0.013],
			bandColour: [0.06, 0.038, 0.022],
			stalkColour: [0.09, 0.07, 0.05],
			roughness: [0.9, 0.85],
			hang: 150,
		},
		{
			// Still 19 and still 04: the male catkins, long slender strings that hang in threes and
			// fours from the same twig ends, and sway clear of the leaves above them.
			kind: 'catkin',
			at: 'shoot-tip',
			share: 0.18,
			count: { mean: 3, spread: 0 },
			tipShare: 0.9,
			seasons: ['summer', 'autumn', 'winter'],
			shape: { catkin: { length: 0.055, radius: 0.0028 } },
			// Still 19: a yellow-green string of pollen sacs, lighter than the cones beside it.
			colour: [0.14, 0.13, 0.045],
			roughness: [0.75, 0.8],
			hang: 175,
		},
	],
	seasons: {
		default: 'summer',
		deciduous: true,
		winter: 'bare',
		// The species turns yellow-green late and drops its leaves without colour.
		autumn: { reflectance: [0.09, 0.11, 0.025], transmittance: [0.12, 0.16, 0.03] },
	},
	wind: {
		// The wind clip: the trunk barely moves and the crown's shoots swing a little, the leaves
		// fluttering on their short stalks.
		stiffness: [
			[0, 0.62],
			[0.5, 0.93],
			[1, 0.98],
		],
		sway: { frequency: 0.28, amplitude: 0.09 },
		flutter: { kind: 'blade', amplitude: 0.12, frequency: 2.2 },
	},
	lod: {
		nearFoliage: 'instanced',
		// Still 02: the crown's rim broke into three leaf groups where the photograph has one, and the
		// first switch coming nearer joins it to one. Rejected for still 17: it leaves that view's
		// thirteen pieces unchanged, so they are not cards standing apart.
		switchPixels: [160, 12, 160],
		// The cards stand two fifths larger than the shoots they picture, so a gap between one shoot's
		// leaves falls on a neighbour's leaves rather than on sky, and the crown's rim reads solid.
		cardGrow: 1.7,
		// Still 18: a card's twig is thinner than a pixel at a whole view, so its leaves would read as a
		// piece in air. Each card draws its supporting twig as a line from the parent node, so the join
		// shows. A wider least width draws the line as more specks, which count as more pieces.
		cardStalk: 1.5,
		cardStalkToFoliage: true,
		woodOrders: [2, 1],
		impostor: { views: 8, texels: 64 },
		shadowLevel: 1,
		budget: {
			// Each cap sits above the figure its tier measures, with room for the cut pieces. The
			// crown's densest variant measures 18.2 to 19.4 MB, the rim's cards and the cutting
			// classes among them, under the owner's twenty. The kit's three cutting classes measure
			// 3.35, 4.72, 7.22 and 12.27 MB, inside the owner's 3.5, 6.3, 11.8 and 22.6.
			kitBytes: { low: 3_450_000, medium: 4_900_000, high: 7_600_000, ultra: 12_900_000 },
			variantBytes: { low: 19_500_000, medium: 19_600_000, high: 19_700_000, ultra: 19_800_000 },
			lod0Triangles: 2_800_000,
			// The denser crown's first card level measures 151,295 triangles; the cap above it is the
			// owner's raised 155,000.
			lod1Triangles: 155_000,
			lod2Triangles: 42_000,
			downloadBytes: 1_000_000,
			downloadHalfBytes: 350_000,
			growMilliseconds: 600,
		},
	},
	textures: 'own',
	variants: 6,
	seedSalt: 20261108,
	// The sparsest form keeps this share of the crown's shoots, each whole: about the leaf area
	// below which the crown stops reading as its species.
	sparse: { foliage: 0.14 },
	// The reference's own crown-box spread at the eight angles is wider than the broad dome's band,
	// so the reference sets it.
	roundBand,
	cuttings: {
		// Still 21: a branch of alternate leafy side shoots, which its own class draws rather than the
		// crown's spray, so the leaves keep the size the photograph gives them beside the piece.
		branch: { shoot: 'whip' },
		// Still 22: a shorter twig whose shoots leave sparse and bare between, as the cut class draws it.
		subbranch: { shoot: 'cut' },
		// Still 23: one shoot's five or six alternate leaves round their purple bud.
		cluster: { shoot: 'spur' },
		// Stills 12, 13, 24 and 25 lay the leaf flat on a copy stand.
		leaf: { pressed: true },
	},
};
