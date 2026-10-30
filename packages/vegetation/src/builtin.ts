// The built-in species: five general families, and the eight that Creek's valley draws. Each is a
// record of numbers, not a model or a file, so the package ships no plant assets and a page grows
// them at first use. A themed pack writes the same records with numbers of its own.
import { type BranchLevel, branchLevel, type Species } from './species';

/** The level that every record starts from, which each species overrides where it differs. */
const BASE_LEVEL: BranchLevel = {
	children: 5,
	prune: 0.2,
	length: 3,
	lengthVariance: 0.25,
	angle: 50,
	angleVariance: 18,
	curve: 16,
	curveVariance: 10,
	taper: 0.02,
	start: 0.25,
	end: 0.95,
	sides: 6,
	segments: 5,
	twist: 120,
};

/** One branch level, with the base's numbers wherever the record names none. */
function level(fields: Partial<BranchLevel>): BranchLevel {
	return branchLevel(BASE_LEVEL, fields);
}

/** The color of a broadleaf's bark and leaves. */
const BARK_BROWN: readonly [number, number, number] = [0.2, 0.15, 0.1];
/** The color of a broadleaf's leaves. */
const LEAF_GREEN: readonly [number, number, number] = [0.13, 0.28, 0.07];

/**
 * A broadleaf tree's branches: a trunk that leans and bends, two limb levels and the twigs that
 * carry the cards. The bend is gentle, and it carries the whole crown a little off the trunk's foot,
 * as a grown tree's does.
 */
const BROADLEAF_BRANCHES = [
	level({
		children: 6,
		prune: 0.15,
		length: 9,
		angle: 55,
		curve: 18,
		curveVariance: 8,
		taper: 0.1,
		sides: 8,
		segments: 9,
	}),
	level({ children: 5, prune: 0.2, length: 3.6, angle: 52, taper: 0.03, sides: 6, segments: 5 }),
	level({ children: 4, prune: 0.25, length: 1.5, angle: 56, taper: 0.01, sides: 4, segments: 4 }),
	level({ children: 0, length: 0.6, angle: 60, taper: 0.003, sides: 3, segments: 2 }),
];

/**
 * The dense evergreen's branch system: a trunk that bends, fourteen whorls of boughs that spread
 * nearly level, branchlets off them, and short twigs that carry the needles. Four levels give the
 * crown its mass, so the silhouette closes from the middle of the trunk up rather than reading as
 * bare twigs, and the whorls are close enough that the cone holds no gap between them.
 */
function coniferBranches(height: number): BranchLevel[] {
	return [
		level({
			children: 14,
			prune: 0.08,
			length: height,
			lengthVariance: 0.1,
			angle: 2,
			angleVariance: 1,
			// The trunk leans and bends, so no tree stands as a straight pole. Its own share of the
			// trunk is never read, since a trunk has no parent: the boughs' share is their level's.
			curve: 12,
			curveVariance: 6,
			taper: 0.12,
			start: 0,
			end: 1,
			sides: 8,
			segments: 12,
			twist: 0,
		}),
		level({
			children: 5,
			prune: 0.1,
			length: height * 0.17,
			lengthVariance: 0.18,
			angle: 82,
			angleVariance: 8,
			curve: -10,
			curveVariance: 6,
			taper: 0.03,
			// The boughs start above the lower trunk, so it stands bare and the light passes beneath
			// the crown, and they run to the trunk's tip, so the crown carries foliage to its point.
			start: 0.48,
			end: 1,
			sides: 6,
			segments: 5,
			twist: 100,
		}),
		level({
			children: 2,
			prune: 0.05,
			length: height * 0.11,
			lengthVariance: 0.25,
			angle: 52,
			angleVariance: 14,
			curve: -8,
			curveVariance: 5,
			taper: 0.02,
			start: 0.12,
			end: 1,
			sides: 4,
			segments: 3,
			twist: 60,
		}),
		level({
			children: 0,
			length: height * 0.05,
			lengthVariance: 0.3,
			angle: 38,
			angleVariance: 20,
			curve: -6,
			curveVariance: 5,
			taper: 0.012,
			start: 0.25,
			end: 1,
			sides: 3,
			segments: 2,
		}),
	];
}

/**
 * The five species that a scene may use without writing a record. Each kind of plant has one, so a
 * forest, a garden or a meadow starts from a call, not from a species pack.
 *
 * @category api/vegetation
 */
export const BUILTIN_SPECIES: readonly Species[] = [
	{
		id: 'broadleaf',
		kind: 'tree',
		branchLevels: BROADLEAF_BRANCHES,
		crown: { shape: 'spherical', start: 0.28, spread: 0.3, pull: 0.16 },
		leaf: {
			kind: 'cluster',
			cards: 12,
			width: 0.6,
			height: 0.6,
			perCard: 12,
			up: 0.75,
			out: 1,
			start: 0.15,
			end: 1,
		},
		wind: { stiffness: [0.12, 0.45, 0.7, 0.9], flutter: 0.02, frequency: 1.6 },
		color: { bark: BARK_BROWN, leaf: LEAF_GREEN, tint: 0.09, transmission: 0.35 },
		height: 10,
		trunks: 1,
		heightVariance: 0.15,
		size: [0.8, 1.3],
		flare: 0.6,
		levels: 3,
		variants: 6,
		seedSalt: 101,
	},
	{
		id: 'conifer',
		kind: 'conifer',
		branchLevels: coniferBranches(15),
		// The crown holds its mass up the trunk: the lower part is bare, and the branches crowd the
		// upper tree, as an evergreen's do, so light passes beneath the crown. The outline narrows
		// quickly, so the crown tapers to a point instead of standing as a column of clumps.
		crown: { shape: 'conical', start: 0.48, spread: 0.5, pull: 0.04 },
		leaf: {
			kind: 'needle',
			cards: 20,
			width: 0.45,
			height: 0.9,
			perCard: 40,
			up: 0.3,
			out: 1.1,
			// The cards run the whole twig, so the foliage follows the branch rather than balling at
			// its tip.
			start: 0.05,
			end: 1,
		},
		wind: { stiffness: [0.1, 0.4, 0.7, 0.85], flutter: 0.008, frequency: 2.4 },
		// A pine's bark is pale and breaks into warm plates, so a trunk reads even in the shade of its
		// own crown; its needles are a deep green that the light lifts.
		color: { bark: [0.26, 0.18, 0.13], leaf: [0.08, 0.2, 0.09], tint: 0.05, transmission: 0.25 },
		height: 15,
		trunks: 1,
		heightVariance: 0.18,
		size: [0.7, 1.25],
		flare: 0.5,
		levels: 3,
		variants: 6,
		seedSalt: 102,
	},
	{
		id: 'shrub',
		kind: 'shrub',
		branchLevels: [
			level({ children: 4, length: 1.6, angle: 48, taper: 0.02, sides: 6, segments: 4 }),
			level({ children: 3, length: 0.8, angle: 55, taper: 0.008, sides: 5, segments: 3 }),
			level({ children: 2, length: 0.35, angle: 60, taper: 0.004, sides: 3, segments: 2 }),
		],
		crown: { shape: 'spherical', start: 0.05, spread: 0.2, pull: 0.1 },
		leaf: {
			kind: 'cluster',
			cards: 6,
			width: 0.2,
			height: 0.2,
			perCard: 6,
			up: 0.8,
			out: 0.9,
			start: 0.15,
			end: 1,
		},
		wind: { stiffness: [0.25, 0.55, 0.8, 1], flutter: 0.02, frequency: 2.2 },
		color: { bark: [0.22, 0.18, 0.13], leaf: [0.15, 0.3, 0.1], tint: 0.1, transmission: 0.3 },
		height: 2.4,
		trunks: 3,
		heightVariance: 0.2,
		size: [0.7, 1.4],
		flare: 0.5,
		levels: 3,
		variants: 6,
		seedSalt: 103,
	},
	{
		id: 'fern',
		kind: 'fern',
		branchLevels: [],
		crown: { shape: 'spherical', start: 0, spread: 0.2, pull: 0.3 },
		rosette: {
			blades: 9,
			length: 0.9,
			width: 0.2,
			arch: 0.95,
			segments: 6,
			shape: 'frond',
			pinnae: 9,
			upright: 0.55,
			flowers: 0,
		},
		wind: { stiffness: [0.85], flutter: 0.05, frequency: 2.8 },
		color: { bark: [0.2, 0.16, 0.1], leaf: [0.11, 0.26, 0.06], tint: 0.08, transmission: 0.4 },
		height: 0.9,
		trunks: 0,
		heightVariance: 0.15,
		size: [0.7, 1.4],
		flare: 0,
		levels: 2,
		variants: 6,
		seedSalt: 104,
	},
	{
		id: 'meadow-grass',
		kind: 'grass',
		branchLevels: [],
		crown: { shape: 'cylindrical', start: 0, spread: 0.2, pull: 0.4 },
		rosette: {
			blades: 26,
			length: 0.5,
			width: 0.034,
			arch: 0.7,
			segments: 3,
			shape: 'blade',
			pinnae: 0,
			upright: 0.45,
			flowers: 0,
		},
		wind: { stiffness: [1], flutter: 0.03, frequency: 3.2 },
		color: { bark: [0.2, 0.18, 0.1], leaf: [0.24, 0.4, 0.1], tint: 0.12, transmission: 0.5 },
		height: 0.5,
		trunks: 0,
		heightVariance: 0.2,
		size: [0.8, 1.5],
		flare: 0,
		levels: 2,
		variants: 6,
		seedSalt: 105,
	},
];

/**
 * Creek's species: the valley's trees, and the hostas, sedges and rushes that line its water. Their
 * numbers give the shapes that the demo's plant models had.
 *
 * @category api/vegetation
 */
export const CREEK_SPECIES: readonly Species[] = [
	{
		id: 'oak',
		kind: 'tree',
		branchLevels: [
			level({
				children: 7,
				prune: 0.15,
				length: 11,
				angle: 52,
				taper: 0.12,
				sides: 8,
				segments: 10,
			}),
			level({
				children: 6,
				prune: 0.2,
				length: 3.8,
				angle: 50,
				taper: 0.032,
				sides: 6,
				segments: 5,
			}),
			level({
				children: 4,
				prune: 0.25,
				length: 1.6,
				angle: 56,
				taper: 0.012,
				sides: 4,
				segments: 4,
			}),
			level({ children: 0, length: 0.7, angle: 60, taper: 0.004, sides: 3, segments: 2 }),
		],
		crown: { shape: 'spherical', start: 0.3, spread: 0.35, pull: 0.2 },
		leaf: {
			kind: 'cluster',
			cards: 10,
			width: 0.5,
			height: 0.42,
			perCard: 9,
			up: 0.7,
			out: 1,
			start: 0.12,
			end: 1,
		},
		wind: { stiffness: [0.1, 0.4, 0.7, 0.85], flutter: 0.02, frequency: 1.5 },
		color: { bark: [0.16, 0.13, 0.1], leaf: [0.12, 0.25, 0.06], tint: 0.08, transmission: 0.34 },
		height: 13,
		trunks: 1,
		heightVariance: 0.16,
		size: [0.8, 1.35],
		flare: 0.7,
		levels: 3,
		variants: 6,
		seedSalt: 201,
	},
	{
		id: 'beech',
		kind: 'tree',
		branchLevels: [
			level({
				children: 6,
				prune: 0.15,
				length: 11.5,
				angle: 48,
				taper: 0.11,
				sides: 8,
				segments: 10,
			}),
			level({
				children: 6,
				prune: 0.2,
				length: 3.6,
				angle: 46,
				taper: 0.03,
				sides: 6,
				segments: 5,
			}),
			level({
				children: 4,
				prune: 0.25,
				length: 1.4,
				angle: 55,
				taper: 0.011,
				sides: 4,
				segments: 4,
			}),
			level({ children: 0, length: 0.65, angle: 58, taper: 0.004, sides: 3, segments: 2 }),
		],
		crown: { shape: 'hemispherical', start: 0.35, spread: 0.3, pull: 0.12 },
		leaf: {
			kind: 'cluster',
			cards: 10,
			width: 0.3,
			height: 0.4,
			perCard: 8,
			up: 0.8,
			out: 1,
			start: 0.12,
			end: 1,
		},
		wind: { stiffness: [0.1, 0.4, 0.65, 0.8], flutter: 0.025, frequency: 1.7 },
		color: { bark: [0.32, 0.3, 0.27], leaf: [0.14, 0.28, 0.07], tint: 0.07, transmission: 0.33 },
		height: 14,
		trunks: 1,
		heightVariance: 0.14,
		size: [0.8, 1.3],
		flare: 0.45,
		levels: 3,
		variants: 6,
		seedSalt: 202,
	},
	{
		id: 'birch',
		kind: 'tree',
		branchLevels: [
			level({
				children: 5,
				prune: 0.15,
				length: 10.5,
				angle: 44,
				taper: 0.07,
				sides: 7,
				segments: 10,
			}),
			level({ children: 5, prune: 0.2, length: 3, angle: 46, taper: 0.02, sides: 5, segments: 4 }),
			level({
				children: 3,
				prune: 0.2,
				length: 1.2,
				angle: 52,
				taper: 0.008,
				sides: 3,
				segments: 3,
			}),
			level({ children: 0, length: 0.55, angle: 55, taper: 0.003, sides: 3, segments: 2 }),
		],
		crown: { shape: 'vase', start: 0.22, spread: 0.25, pull: 0.28 },
		leaf: {
			kind: 'cluster',
			cards: 10,
			width: 0.24,
			height: 0.24,
			perCard: 6,
			up: 0.7,
			out: 1,
			start: 0.15,
			end: 1,
		},
		wind: { stiffness: [0.15, 0.5, 0.8, 0.95], flutter: 0.03, frequency: 1.9 },
		color: { bark: [0.62, 0.6, 0.55], leaf: [0.2, 0.34, 0.1], tint: 0.1, transmission: 0.36 },
		height: 12,
		trunks: 1,
		heightVariance: 0.18,
		size: [0.75, 1.25],
		flare: 0.35,
		levels: 3,
		variants: 6,
		seedSalt: 203,
	},
	{
		id: 'willow',
		kind: 'tree',
		branchLevels: [
			level({
				children: 6,
				prune: 0.15,
				length: 8,
				angle: 58,
				curve: -12,
				taper: 0.1,
				sides: 8,
				segments: 9,
			}),
			level({
				children: 5,
				prune: 0.2,
				length: 3,
				angle: 62,
				curve: -30,
				taper: 0.025,
				sides: 5,
				segments: 4,
			}),
			level({
				children: 4,
				prune: 0.2,
				length: 1.4,
				angle: 55,
				curve: -45,
				taper: 0.009,
				sides: 3,
				segments: 3,
			}),
			level({
				children: 0,
				length: 0.7,
				angle: 50,
				curve: -50,
				taper: 0.003,
				sides: 3,
				segments: 2,
			}),
		],
		crown: { shape: 'weeping', start: 0.2, spread: 0.2, pull: 0.6 },
		leaf: {
			kind: 'cluster',
			cards: 11,
			width: 0.12,
			height: 0.42,
			perCard: 7,
			up: 0.5,
			out: 1,
			start: 0.1,
			end: 1,
		},
		wind: { stiffness: [0.2, 0.55, 0.8, 1], flutter: 0.05, frequency: 1.4 },
		color: { bark: [0.25, 0.21, 0.15], leaf: [0.18, 0.3, 0.1], tint: 0.09, transmission: 0.38 },
		height: 10,
		trunks: 1,
		heightVariance: 0.2,
		size: [0.8, 1.4],
		flare: 0.5,
		levels: 3,
		variants: 6,
		seedSalt: 204,
	},
	{
		id: 'alder',
		kind: 'tree',
		branchLevels: [
			level({
				children: 6,
				prune: 0.15,
				length: 8.5,
				angle: 50,
				taper: 0.09,
				sides: 7,
				segments: 9,
			}),
			level({ children: 5, prune: 0.2, length: 3, angle: 50, taper: 0.024, sides: 5, segments: 4 }),
			level({
				children: 4,
				prune: 0.2,
				length: 1.2,
				angle: 56,
				taper: 0.008,
				sides: 3,
				segments: 3,
			}),
			level({ children: 0, length: 0.55, angle: 58, taper: 0.003, sides: 3, segments: 2 }),
		],
		crown: { shape: 'flame', start: 0.2, spread: 0.35, pull: 0.2 },
		leaf: {
			kind: 'cluster',
			cards: 10,
			width: 0.28,
			height: 0.3,
			perCard: 7,
			up: 0.75,
			out: 1,
			start: 0.12,
			end: 1,
		},
		wind: { stiffness: [0.15, 0.45, 0.75, 0.9], flutter: 0.03, frequency: 1.8 },
		color: { bark: [0.22, 0.2, 0.17], leaf: [0.16, 0.3, 0.09], tint: 0.1, transmission: 0.35 },
		height: 9.5,
		trunks: 1,
		heightVariance: 0.2,
		size: [0.8, 1.3],
		flare: 0.55,
		levels: 3,
		variants: 6,
		seedSalt: 205,
	},
	{
		id: 'hosta',
		kind: 'rosette',
		branchLevels: [],
		crown: { shape: 'hemispherical', start: 0, spread: 0.2, pull: 0.2 },
		rosette: {
			blades: 14,
			length: 0.55,
			width: 0.23,
			arch: 0.55,
			segments: 6,
			shape: 'broad',
			pinnae: 0,
			upright: 0.35,
			flowers: 7,
		},
		wind: { stiffness: [0.55], flutter: 0.03, frequency: 2.4 },
		color: { bark: [0.2, 0.18, 0.12], leaf: [0.12, 0.3, 0.09], tint: 0.12, transmission: 0.42 },
		height: 0.6,
		trunks: 0,
		heightVariance: 0.12,
		size: [0.75, 1.35],
		flare: 0,
		levels: 2,
		variants: 6,
		seedSalt: 206,
	},
	{
		id: 'sedge',
		kind: 'grass',
		branchLevels: [],
		crown: { shape: 'conical', start: 0, spread: 0.3, pull: 0.5 },
		rosette: {
			blades: 18,
			length: 0.8,
			width: 0.014,
			arch: 0.85,
			segments: 3,
			shape: 'blade',
			pinnae: 0,
			upright: 0.6,
			flowers: 0,
		},
		wind: { stiffness: [1], flutter: 0.04, frequency: 3 },
		color: { bark: [0.22, 0.2, 0.12], leaf: [0.2, 0.32, 0.1], tint: 0.12, transmission: 0.45 },
		height: 0.85,
		trunks: 0,
		heightVariance: 0.2,
		size: [0.8, 1.4],
		flare: 0,
		levels: 2,
		variants: 6,
		seedSalt: 207,
	},
	{
		id: 'rush',
		kind: 'grass',
		branchLevels: [],
		crown: { shape: 'cylindrical', start: 0, spread: 0.2, pull: 0.3 },
		rosette: {
			blades: 12,
			length: 1.1,
			width: 0.009,
			arch: 0.35,
			segments: 4,
			shape: 'blade',
			pinnae: 0,
			upright: 0.85,
			flowers: 0,
		},
		wind: { stiffness: [1], flutter: 0.05, frequency: 2.6 },
		color: { bark: [0.2, 0.19, 0.13], leaf: [0.16, 0.3, 0.09], tint: 0.1, transmission: 0.4 },
		height: 1.15,
		trunks: 0,
		heightVariance: 0.2,
		size: [0.8, 1.3],
		flare: 0,
		levels: 2,
		variants: 6,
		seedSalt: 208,
	},
];

/**
 * Every species that the package ships: the five families and Creek's eight.
 *
 * @category api/vegetation
 */
export const ALL_SPECIES: readonly Species[] = [...BUILTIN_SPECIES, ...CREEK_SPECIES];

/**
 * The species with an id, or undefined when the package ships none.
 *
 * @param id The species' id, such as "oak".
 * @returns The record, or undefined.
 * @category api/vegetation
 */
export function builtInSpecies(id: string): Species | undefined {
	return ALL_SPECIES.find((species) => species.id === id);
}
