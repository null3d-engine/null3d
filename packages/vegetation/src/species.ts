// The species record: every number that decides how a plant grows. A record holds only numbers and
// short strings, so a themed pack adds species as data, and two calls with the same record and seed
// grow the same plant. The generator reads the record once per variant and makes every random
// choice from the seed and the record's salt.

/**
 * The families that the generator grows.
 * @category api/vegetation
 */
export type SpeciesKind = 'tree' | 'conifer' | 'shrub' | 'fern' | 'rosette' | 'grass';

/**
 * The outlines that scale a branch by its height in the crown.
 * @category api/vegetation
 */
export type CrownShape =
	| 'conical'
	| 'spherical'
	| 'hemispherical'
	| 'cylindrical'
	| 'tapered'
	| 'vase'
	| 'inverse-conical'
	| 'flame'
	| 'weeping';

/**
 * The pieces that a plant's leaves are drawn as.
 * @category api/vegetation
 */
export type LeafKind = 'cluster' | 'needle' | 'frond' | 'blade';

/**
 * One level of the branch system: the trunk, the limbs, the twigs and their children.
 * @category api/vegetation
 */
export interface BranchLevel {
	/** Branches that each parent grows at this level. */
	readonly children: number;
	/** How many of those branches a parent may skip growing, from 0. */
	readonly prune: number;
	/** Length of one branch, in meters. */
	readonly length: number;
	/** How much a branch's length varies from the record's, as a share of it. */
	readonly lengthVariance: number;
	/** Angle from the parent's direction where the branch starts, in degrees. */
	readonly angle: number;
	/** How much the angle varies between branches, in degrees. */
	readonly angleVariance: number;
	/** How much the branch curves along its length, in degrees over the whole branch. */
	readonly curve: number;
	/** How much the curve varies between branches, in degrees. */
	readonly curveVariance: number;
	/** Radius at the tip of a terminal branch, in meters. */
	readonly taper: number;
	/** Share of the parent's length where children start. */
	readonly start: number;
	/** Share of the parent's length where children stop. */
	readonly end: number;
	/** Radial sides of the branch at full detail. */
	readonly sides: number;
	/** Curve samples along the branch at full detail. */
	readonly segments: number;
	/** How far the level twists around its parent, in degrees. */
	readonly twist: number;
}

/**
 * The outline of the crown and the pull that shapes it.
 * @category api/vegetation
 */
export interface Crown {
	/** The outline that scales a branch's length by its height in the crown. */
	readonly shape: CrownShape;
	/** Height where the crown starts, as a share of the plant's height. */
	readonly start: number;
	/** How strongly the outline's lower and upper limits hold, from 0. */
	readonly spread: number;
	/** The vertical pull on every branch: positive bends down, as a willow does. */
	readonly pull: number;
}

/**
 * The cards or blades that carry a plant's leaves.
 * @category api/vegetation
 */
export interface Leaf {
	/** The shape of one card. */
	readonly kind: LeafKind;
	/** Cards on one terminal branch. */
	readonly cards: number;
	/** Width of one card, in meters. */
	readonly width: number;
	/** Height of one card, in meters. */
	readonly height: number;
	/** How many leaves one card stands for, for tint and light through the crown. */
	readonly perCard: number;
	/** How strongly a card faces the sky. */
	readonly up: number;
	/** How strongly a card faces away from the plant's axis. */
	readonly out: number;
	/** Share of the branch where cards start. */
	readonly start: number;
	/** Share of the branch where cards stop. */
	readonly end: number;
}

/**
 * The leaves of a plant that has no branch system, grown from one base.
 * @category api/vegetation
 */
export interface Rosette {
	/** Leaves that radiate from the base. */
	readonly blades: number;
	/** Length of one leaf, in meters. */
	readonly length: number;
	/** Width of one leaf, in meters. */
	readonly width: number;
	/** How far a leaf arches over, as a share of its length. */
	readonly arch: number;
	/** Curve samples along one leaf at full detail. */
	readonly segments: number;
	/** The outline of one leaf. */
	readonly shape: 'broad' | 'blade' | 'frond';
	/** Pairs of leaflets along a frond. */
	readonly pinnae: number;
	/** How upright the leaves stand, from 0 flat to 1 vertical. */
	readonly upright: number;
	/** Flower stems in the middle of the rosette. */
	readonly flowers: number;
}

/**
 * How the wind moves a plant: one stiffness for each branch level, and a flutter for its leaves.
 * @category api/vegetation
 */
export interface Wind {
	/** How much each branch level follows the wind, from 0 held to 1 free. */
	readonly stiffness: readonly number[];
	/** How far a leaf card flutters around its branch, in meters. */
	readonly flutter: number;
	/** How fast a leaf card flutters, in hertz. */
	readonly frequency: number;
}

/**
 * The color of a plant and the light through its leaves.
 * @category api/vegetation
 */
export interface SpeciesColor {
	/** The bark color, linear 0 to 1. */
	readonly bark: readonly [number, number, number];
	/** The leaf color, linear 0 to 1. */
	readonly leaf: readonly [number, number, number];
	/** How much a copy's leaf color may shift, linear 0 to 1. */
	readonly tint: number;
	/** The light that passes through a leaf, as a share of the diffuse light. */
	readonly transmission: number;
}

/**
 * One species: the numbers that grow it. A record holds no timing, no device and no scene, so the
 * same record and seed grow the same plant everywhere.
 *
 * @category api/vegetation
 */
export interface Species {
	/** The species' name, unique in a scene. */
	readonly id: string;
	/** The family that grows it. */
	readonly kind: SpeciesKind;
	/** The branch levels, from the trunk's children down to the twigs that carry leaves. */
	readonly branchLevels: readonly BranchLevel[];
	/** The crown's outline and pull. */
	readonly crown: Crown;
	/** The cards that carry leaves, for a plant with a branch system. */
	readonly leaf?: Leaf;
	/** The leaves of a plant without a branch system. */
	readonly rosette?: Rosette;
	/** How the wind moves the plant. */
	readonly wind: Wind;
	/** The plant's color. */
	readonly color: SpeciesColor;
	/** Height of the plant in meters at scale 1. */
	readonly height: number;
	/** Trunks that rise from one base: one for a tree, several for a shrub. */
	readonly trunks: number;
	/** How much a variant's height varies from the record's, as a share of it. */
	readonly heightVariance: number;
	/** The scale of one copy, from smallest to largest. */
	readonly size: readonly [number, number];
	/** The root flare, as a share of the trunk's base radius. */
	readonly flare: number;
	/** Detail levels that the generator builds, from 1 to 3. */
	readonly levels: number;
	/** Variants that a scene makes by default. */
	readonly variants: number;
	/** A number that changes this species alone when the scene's seed changes. */
	readonly seedSalt: number;
}

/**
 * The most branch records that one plant's wind data holds, because a vertex stores the index in 8 bits.
 * @category api/vegetation
 */
export const MAX_BRANCHES = 255;

/**
 * The largest number of levels that a plant gets.
 * @category api/vegetation
 */
export const MAX_LEVELS = 3;

/**
 * The variants that a species makes by default.
 * @category api/vegetation
 */
export const DEFAULT_VARIANTS = 6;

/** The branch levels that a record may hold. */
const MAX_BRANCH_LEVELS = 5;

/** The largest number of children at one level, which keeps the branch count within its cap. */
const MAX_CHILDREN = 16;

/**
 * Every problem that a record has, as sentences; an empty list means the record grows. The check
 * names the field and the fix, so a hand-written species set fails with a message that says what
 * to change.
 *
 * @param species The record to check.
 * @returns One sentence for each problem.
 * @category api/vegetation
 */
export function speciesProblems(species: Species): string[] {
	const problems: string[] = [];
	const name = typeof species.id === 'string' && species.id ? `"${species.id}"` : 'a species';
	const finite = (value: unknown): value is number =>
		typeof value === 'number' && Number.isFinite(value);
	const positive = (value: unknown, field: string) => {
		if (!finite(value) || value <= 0) problems.push(`${field} must be a positive number.`);
	};
	const share = (value: unknown, field: string) => {
		if (!finite(value) || value < 0 || value > 1)
			problems.push(`${field} must be a number from 0 to 1.`);
	};

	if (typeof species.id !== 'string' || !species.id)
		problems.push('A species needs an id, such as "oak".');
	if (!['tree', 'conifer', 'shrub', 'fern', 'rosette', 'grass'].includes(species.kind))
		problems.push(`${name} has an unknown kind; use tree, conifer, shrub, fern, rosette or grass.`);
	positive(species.height, `${name}: height`);
	if (!finite(species.trunks) || species.trunks < 0)
		problems.push(`${name}: trunks must be a number from 0.`);
	if (species.kind === 'tree' || species.kind === 'conifer' || species.kind === 'shrub')
		positive(species.trunks, `${name}: trunks`);
	share(species.heightVariance, `${name}: heightVariance`);
	share(species.flare, `${name}: flare`);
	if (!finite(species.size[0]) || !finite(species.size[1]) || species.size[0] <= 0)
		problems.push(`${name}: size must hold two positive numbers, smallest first.`);
	if (species.size[0] > species.size[1])
		problems.push(`${name}: size must hold the smallest copy first.`);
	if (!Number.isInteger(species.levels) || species.levels < 1 || species.levels > MAX_LEVELS)
		problems.push(`${name}: levels must be a whole number from 1 to ${MAX_LEVELS}.`);
	if (!Number.isInteger(species.variants) || species.variants < 1 || species.variants > 10)
		problems.push(`${name}: variants must be a whole number from 1 to 10.`);
	if (!Number.isInteger(species.seedSalt))
		problems.push(`${name}: seedSalt must be a whole number.`);

	if (!Array.isArray(species.branchLevels) || species.branchLevels.length === 0) {
		if (species.leaf) problems.push(`${name}: a plant with leaf cards needs branchLevels.`);
	} else if (species.branchLevels.length > MAX_BRANCH_LEVELS) {
		problems.push(`${name}: branchLevels holds at most ${MAX_BRANCH_LEVELS} levels.`);
	} else {
		species.branchLevels.forEach((level, i) => {
			const at = `${name}: branchLevels[${i}]`;
			if (!Number.isInteger(level.children) || level.children < 0 || level.children > MAX_CHILDREN)
				problems.push(`${at}.children must be a whole number from 0 to ${MAX_CHILDREN}.`);
			share(level.prune, `${at}.prune`);
			positive(level.length, `${at}.length`);
			share(level.lengthVariance, `${at}.lengthVariance`);
			if (!finite(level.angle)) problems.push(`${at}.angle must be a number of degrees.`);
			if (!finite(level.angleVariance) || level.angleVariance < 0)
				problems.push(`${at}.angleVariance must be a number of degrees from 0.`);
			if (!finite(level.curve)) problems.push(`${at}.curve must be a number of degrees.`);
			if (!finite(level.curveVariance) || level.curveVariance < 0)
				problems.push(`${at}.curveVariance must be a number of degrees from 0.`);
			positive(level.taper, `${at}.taper`);
			share(level.start, `${at}.start`);
			share(level.end, `${at}.end`);
			if (level.start >= level.end) problems.push(`${at}.start must lie before ${at}.end.`);
			if (!Number.isInteger(level.sides) || level.sides < 3 || level.sides > 16)
				problems.push(`${at}.sides must be a whole number from 3 to 16.`);
			if (!Number.isInteger(level.segments) || level.segments < 1 || level.segments > 24)
				problems.push(`${at}.segments must be a whole number from 1 to 24.`);
			if (!finite(level.twist)) problems.push(`${at}.twist must be a number of degrees.`);
		});
	}

	if (
		![
			'conical',
			'spherical',
			'hemispherical',
			'cylindrical',
			'tapered',
			'vase',
			'inverse-conical',
			'flame',
			'weeping',
		].includes(species.crown.shape)
	)
		problems.push(`${name}: crown.shape is not one of the nine crown outlines.`);
	share(species.crown.start, `${name}: crown.start`);
	if (!finite(species.crown.spread) || species.crown.spread < 0)
		problems.push(`${name}: crown.spread must be a number from 0.`);
	if (!finite(species.crown.pull)) problems.push(`${name}: crown.pull must be a number.`);

	if (species.kind === 'fern' || species.kind === 'rosette' || species.kind === 'grass') {
		if (!species.rosette) problems.push(`${name}: a ${species.kind} needs a rosette record.`);
	} else if (!species.leaf) {
		problems.push(`${name}: a ${species.kind} needs a leaf record.`);
	}
	if (species.rosette) {
		const at = `${name}: rosette`;
		if (!Number.isInteger(species.rosette.blades) || species.rosette.blades < 1)
			problems.push(`${at}.blades must be a whole number from 1.`);
		positive(species.rosette.length, `${at}.length`);
		positive(species.rosette.width, `${at}.width`);
		if (!finite(species.rosette.arch) || species.rosette.arch < 0)
			problems.push(`${at}.arch must be a number from 0.`);
		if (!Number.isInteger(species.rosette.segments) || species.rosette.segments < 1)
			problems.push(`${at}.segments must be a whole number from 1.`);
		if (!['broad', 'blade', 'frond'].includes(species.rosette.shape))
			problems.push(`${at}.shape must be broad, blade or frond.`);
		if (!Number.isInteger(species.rosette.pinnae) || species.rosette.pinnae < 0)
			problems.push(`${at}.pinnae must be a whole number from 0.`);
		share(species.rosette.upright, `${at}.upright`);
		if (!Number.isInteger(species.rosette.flowers) || species.rosette.flowers < 0)
			problems.push(`${at}.flowers must be a whole number from 0.`);
	}
	if (species.leaf) {
		const at = `${name}: leaf`;
		if (!['cluster', 'needle', 'frond', 'blade'].includes(species.leaf.kind))
			problems.push(`${at}.kind must be cluster, needle, frond or blade.`);
		if (!Number.isInteger(species.leaf.cards) || species.leaf.cards < 1)
			problems.push(`${at}.cards must be a whole number from 1.`);
		positive(species.leaf.width, `${at}.width`);
		positive(species.leaf.height, `${at}.height`);
		positive(species.leaf.perCard, `${at}.perCard`);
		if (!finite(species.leaf.up) || species.leaf.up < 0)
			problems.push(`${at}.up must be a number from 0.`);
		if (!finite(species.leaf.out) || species.leaf.out < 0)
			problems.push(`${at}.out must be a number from 0.`);
		share(species.leaf.start, `${at}.start`);
		share(species.leaf.end, `${at}.end`);
		if (species.leaf.start >= species.leaf.end)
			problems.push(`${at}.start must lie before ${at}.end.`);
	}

	if (!Array.isArray(species.wind.stiffness) || species.wind.stiffness.length === 0)
		problems.push(`${name}: wind.stiffness needs one number for each branch level.`);
	else
		for (const [i, value] of species.wind.stiffness.entries())
			if (!finite(value) || value < 0 || value > 1)
				problems.push(`${name}: wind.stiffness[${i}] must be a number from 0 to 1.`);
	if (!finite(species.wind.flutter) || species.wind.flutter < 0)
		problems.push(`${name}: wind.flutter must be a number from 0.`);
	positive(species.wind.frequency, `${name}: wind.frequency`);

	for (const [i, channel] of species.color.bark.entries())
		if (!finite(channel) || channel < 0 || channel > 1)
			problems.push(`${name}: color.bark[${i}] must be a number from 0 to 1.`);
	for (const [i, channel] of species.color.leaf.entries())
		if (!finite(channel) || channel < 0 || channel > 1)
			problems.push(`${name}: color.leaf[${i}] must be a number from 0 to 1.`);
	share(species.color.tint, `${name}: color.tint`);
	share(species.color.transmission, `${name}: color.transmission`);

	return problems;
}

/**
 * Refuses a record that cannot grow, with every problem in one message so a pack can fix them
 * together.
 *
 * @param species The record to check.
 * @returns The same record.
 * @throws Error naming each problem, when the record cannot grow.
 * @category api/vegetation
 */
export function checkSpecies(species: Species): Species {
	const problems = speciesProblems(species);
	if (problems.length > 0)
		throw new Error(`@null3d/vegetation: this species cannot grow.\n${problems.join('\n')}`);
	return species;
}

/** A branch level's missing fields, filled from its parent's, so a record states only what differs. */
const LEVEL_FIELDS = [
	'children',
	'prune',
	'length',
	'lengthVariance',
	'angle',
	'angleVariance',
	'curve',
	'curveVariance',
	'taper',
	'start',
	'end',
	'sides',
	'segments',
	'twist',
] as const;

/**
 * Fills a partial branch level from a base level. A species record written by hand names only the
 * numbers that differ from the level above, and this gives it every field.
 *
 * @param base The level to take missing fields from.
 * @param level The fields the record states.
 * @returns A complete branch level.
 * @category api/vegetation
 */
export function branchLevel(base: BranchLevel, level: Partial<BranchLevel>): BranchLevel {
	const out: Record<string, number> = {};
	for (const field of LEVEL_FIELDS) out[field] = level[field] ?? base[field];
	return out as unknown as BranchLevel;
}
