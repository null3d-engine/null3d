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
	/**
	 * How smoothly a branch narrows from its base to its tip, from 0 to 1. The pipe model holds a
	 * branch's radius constant between the limbs that leave it, so a trunk reads as a stack of
	 * cylinders. A value of 1 tapers each span between two attachments, and another value blends
	 * toward that taper. The default is 0, which keeps the pipe model's radii.
	 */
	readonly taperCurve?: number;
	/**
	 * How far a branch widens where it leaves its parent, as a share of its own base radius. A limb
	 * that swells into a trunk reads as massive at the joint; a branch of a fixed share of its
	 * parent's radius cannot. Leave it out and the branch keeps the pipe model's radius.
	 */
	readonly baseFlare?: number;
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
	/**
	 * Rings that the level's children grow in, along the parent. Each ring puts its children at one
	 * height, so a conifer's whorls carry their boughs as one shelf. Zero spreads the children evenly
	 * instead, as a broadleaf's limbs grow.
	 */
	readonly whorls?: number;
	/**
	 * Whether the level's last whorl sits at the parent's tip rather than half a ring below it. A
	 * conifer that sets this ends its trunk in boughs, so the crown closes over the top instead of
	 * leaving a bare stick. The default is false, which keeps the rings evenly spaced.
	 */
	readonly whorlTip?: boolean;
	/**
	 * How much more upright a child grows toward the top of the crown, in degrees. The generator
	 * takes this from the child's own angle: a limb that leaves the trunk at a spread angle near
	 * the ground turns toward its parent's direction near the crown's top, as a tree's upper limbs
	 * do. The default is 0, which keeps the angle the record states.
	 */
	readonly upright?: number;
	/**
	 * The share of the level's children that the crown's top drops, from 0 to 1. The generator keeps
	 * each child by a hash, so the crown thins as it rises and its upper limbs fork less than its
	 * lower ones. The default is 0, which keeps every child.
	 */
	readonly thin?: number;
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
	/**
	 * The share of a branch's length that the crown keeps at its narrowest, from 0 to 1. The default
	 * is 0.2, which holds a rounded crown's top open; a conifer that tapers to a point asks for less.
	 */
	readonly floor?: number;
	/**
	 * How far up the branches a filled crown reaches, as a share of the branch heights, from 0 to 1.
	 * The default is 1 for a conical crown and 0.92 for another outline: a rounded crown stops at the
	 * height most branches reach, so a lone upper limb carries no cards above the dome, while a crown
	 * that ends in a leader keeps its top filled.
	 */
	readonly fillTop?: number;
	/**
	 * Height where the plant's foliage begins, as a share of its height, from 0 to 1. The default is
	 * the crown's own start, so a branch that leaves the trunk below the crown carries no leaves
	 * there. A species whose foliage hangs to the ground states 0, because its lowest limbs and
	 * their drooping tips are the truth of the plant rather than foliage below its crown.
	 */
	readonly leafFloor?: number;
}

/**
 * The bark figures that a species may draw: one painter for each family of bark.
 * @category api/vegetation
 */
export type BarkCellName =
	| 'birch'
	| 'pine'
	| 'oak'
	| 'beech'
	| 'spruce'
	| 'willow'
	| 'holm'
	| 'aspen';

/**
 * The cells of the leaf atlas that a species may name: seven cluster outlines, a conifer's needle
 * shoot and fascicle spray, a fern frond, a grass blade and a broad leaf.
 * @category api/vegetation
 */
export type LeafCellName =
	| 'cluster-a'
	| 'cluster-b'
	| 'cluster-c'
	| 'cluster-d'
	| 'cluster-e'
	| 'cluster-f'
	| 'cluster-g'
	| 'fascicle'
	| 'needle'
	| 'frond'
	| 'blade'
	| 'broad';

/**
 * The cards or blades that carry a plant's leaves.
 * @category api/vegetation
 */
export interface Leaf {
	/** The shape of one card. */
	readonly kind: LeafKind;
	/**
	 * The leaf atlas's cell that the cards sample. Leave it out and the generator chooses a cluster
	 * cell from the species' name, or the cell that the kind names. A species names its own cell
	 * when its leaves differ from its kind's, such as a small round leaf on a broadleaf tree.
	 */
	readonly cell?: LeafCellName;
	/** Cards on one terminal branch. */
	readonly cards: number;
	/** Half the width of one card, in meters: a card draws two of these across. */
	readonly width: number;
	/** Half the height of one card, in meters: a card draws two of these up. */
	readonly height: number;
	/** How many leaves one card stands for, for tint and light through the crown. */
	readonly perCard: number;
	/** How strongly a card faces the sky. */
	readonly up: number;
	/** How strongly a card faces away from the plant's axis. */
	readonly out: number;
	/** Share of the branch where cards start. */
	readonly start: number;
	/**
	 * The share of a branch left bare at its base at the crown's top, where `start` gives it at the
	 * crown's bottom. A conifer shows wood where its whorls stand apart and wraps its leader where
	 * they crowd, and one bare reach cannot serve both ends of the same tree. Leave it out and every
	 * branch keeps `start`.
	 */
	readonly startTop?: number;
	/** Share of the branch where cards stop. */
	readonly end: number;
	/**
	 * How many branch levels above the twigs carry cards. One puts cards on the twigs alone. Two adds
	 * half as many to the level above, and each further level adds half of the level below it, so
	 * the crown fills from its inside rather than only at its tips. The default is 2, which covers
	 * the twigs and the level above them.
	 */
	readonly depth?: number;
	/**
	 * Whether each flat card is drawn as two panels crossed along its middle. A crossed card keeps
	 * its coverage when the camera looks along the card's plane, as a spray of needles is seen from
	 * below. The default is false, which draws one panel.
	 */
	readonly cross?: boolean;
	/**
	 * Extra cards through the crown's volume, as a share of the cards on the branches. A filled crown
	 * closes its outline where its twigs leave a gap, and each filled card reads the nearest branch
	 * for its wind and its shade. The default is 0, which draws only the branch cards.
	 */
	readonly fill?: number;
	/**
	 * The share of a filled crown's cards that stand in the crown's volume wherever its outline puts
	 * them, rather than on the line between two nearby twigs. A crown with few long limbs needs it:
	 * without it its foliage follows each limb, and the crown reads as separate lobes instead of one
	 * mass. From 0 to 1; the default 0 bridges neighbouring twigs only.
	 */
	readonly volume?: number;
	/**
	 * How much larger a card grows in the crown's outer third, where a rim of overlapping cards reads
	 * as a mass and an even spread of thin ones reads as a spray. The cards out there are also thinned
	 * to every other one, so the rim gains size rather than count. From 0 to 3; the default 1 draws
	 * every card the same size.
	 */
	readonly rim?: number;
	/**
	 * Whether the filled cards hang almost straight down, as a willow's shoots fall, rather than
	 * following the crown's outward direction. The default is false.
	 */
	readonly hang?: boolean;
	/**
	 * Whether the plant draws its branches without leaves, as a deciduous tree in winter. The leaf
	 * record still names the cards that it would draw, so a bare tree and a green tree share one
	 * record. The default is false.
	 */
	readonly bare?: boolean;
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
	/**
	 * The bark cell that the trunk and the limbs draw. Each cell is a painter for a family of bark:
	 * a birch's peeling white, a pine's flaking plates, an oak's fissures, a beech's smooth grey, a
	 * spruce's scales or a willow's ridges. The default is the beech's smooth grey.
	 */
	readonly bark?: BarkCellName;
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
	/**
	 * The share of the height that the trunk rises before its limbs carry the crown, from 0 to 1.
	 * The default is 1, which runs the trunk to the top as a leader. A smaller value makes a tree
	 * that divides low into heavy limbs, as an open-grown oak does.
	 */
	readonly leader?: number;
	/** Trunks that rise from one base: one for a tree, several for a shrub. */
	readonly trunks: number;
	/**
	 * How far each stem of a multi-stem plant leans outward, as the tangent of its angle from the
	 * vertical. The default is 0.18; a wider value spreads several stems from one base.
	 */
	readonly stemLean?: number;
	/**
	 * The detail level whose meshes cast the plant's shadow. Leave it out and the coarsest level casts
	 * it, unless the plant is small enough that a coarse level would turn its shadow into a blob: a
	 * plant under `SHADOW_CASTER_MIN_TRIANGLES` keeps its finest level whatever this says.
	 */
	readonly shadowLevel?: number;
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

/**
 * The largest number of children at one level. A dense conifer carries more boughs in a whorl than
 * a broadleaf carries limbs, and the plant's branch cap still bounds every level together.
 */
const MAX_CHILDREN = 32;

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
	share(species.leader ?? 1, `${name}: leader`);
	if (!finite(species.trunks) || species.trunks < 0)
		problems.push(`${name}: trunks must be a number from 0.`);
	if (
		species.shadowLevel !== undefined &&
		(!finite(species.shadowLevel) ||
			species.shadowLevel < 0 ||
			!Number.isInteger(species.shadowLevel))
	)
		problems.push(`${name}: shadowLevel must be a whole level from 0.`);
	if (species.stemLean !== undefined && (!finite(species.stemLean) || species.stemLean < 0))
		problems.push(`${name}: stemLean must be a number from 0.`);
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
			if (level.taperCurve !== undefined) share(level.taperCurve, `${at}.taperCurve`);
			if (
				level.baseFlare !== undefined &&
				(!finite(level.baseFlare) || level.baseFlare < 0 || level.baseFlare > 8)
			)
				problems.push(`${at}.baseFlare must be a number from 0 to 8.`);
			if (level.whorls !== undefined && (!Number.isInteger(level.whorls) || level.whorls < 0))
				problems.push(`${at}.whorls must be a whole number from 0.`);
			if (level.whorlTip !== undefined && typeof level.whorlTip !== 'boolean')
				problems.push(`${at}.whorlTip must be true or false.`);
			if (level.upright !== undefined && (!finite(level.upright) || level.upright < 0))
				problems.push(`${at}.upright must be a number of degrees from 0.`);
			share(level.thin ?? 0, `${at}.thin`);
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
	if (species.crown.floor !== undefined) share(species.crown.floor, `${name}: crown.floor`);
	if (species.crown.fillTop !== undefined) share(species.crown.fillTop, `${name}: crown.fillTop`);
	if (species.crown.leafFloor !== undefined)
		share(species.crown.leafFloor, `${name}: crown.leafFloor`);

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
		if (
			species.leaf.startTop !== undefined &&
			(!finite(species.leaf.startTop) || species.leaf.startTop < 0 || species.leaf.startTop > 1)
		)
			problems.push(`${at}.startTop must be a number from 0 to 1.`);
		if (
			species.leaf.rim !== undefined &&
			(!finite(species.leaf.rim) || species.leaf.rim < 0 || species.leaf.rim > 3)
		)
			problems.push(`${at}.rim must be a number from 0 to 3.`);
		if (
			species.leaf.volume !== undefined &&
			(!finite(species.leaf.volume) || species.leaf.volume < 0 || species.leaf.volume > 1)
		)
			problems.push(`${at}.volume must be a number from 0 to 1.`);
		if (!['cluster', 'needle', 'frond', 'blade'].includes(species.leaf.kind))
			problems.push(`${at}.kind must be cluster, needle, frond or blade.`);
		if (
			species.leaf.cell !== undefined &&
			![
				'cluster-a',
				'cluster-b',
				'cluster-c',
				'cluster-d',
				'cluster-e',
				'cluster-f',
				'cluster-g',
				'fascicle',
				'needle',
				'frond',
				'blade',
				'broad',
			].includes(species.leaf.cell)
		)
			problems.push(`${at}.cell is not one of the leaf cells.`);
		if (
			species.bark !== undefined &&
			!['birch', 'pine', 'oak', 'beech', 'spruce', 'willow', 'holm', 'aspen'].includes(species.bark)
		)
			problems.push(`${name}: bark is not one of the bark cells.`);
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
		if (
			species.leaf.depth !== undefined &&
			(!Number.isInteger(species.leaf.depth) || species.leaf.depth < 1)
		)
			problems.push(`${at}.depth must be a whole number from 1.`);
		if (species.leaf.cross !== undefined && typeof species.leaf.cross !== 'boolean')
			problems.push(`${at}.cross must be true or false.`);
		if (species.leaf.bare !== undefined && typeof species.leaf.bare !== 'boolean')
			problems.push(`${at}.bare must be true or false.`);
		if (species.leaf.fill !== undefined && (!finite(species.leaf.fill) || species.leaf.fill < 0))
			problems.push(`${at}.fill must be a number from 0.`);
		if (species.leaf.hang !== undefined && typeof species.leaf.hang !== 'boolean')
			problems.push(`${at}.hang must be true or false.`);
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
	'taperCurve',
	'baseFlare',
	'start',
	'end',
	'sides',
	'segments',
	'twist',
	'whorls',
	'whorlTip',
	'upright',
	'thin',
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
	// A level's optional fields, such as its whorls, keep the base's value when the record names none.
	for (const field of LEVEL_FIELDS) out[field] = (level[field] ?? base[field]) as number;
	return out as unknown as BranchLevel;
}
