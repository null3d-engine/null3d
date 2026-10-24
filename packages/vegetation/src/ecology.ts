// The ecological rules: what each species needs from the ground, written as a tolerance curve for
// each input. A point's score for a rule is the lowest of its curves, so a plant grows only where
// every one of its needs holds. The curves are numbers, so a themed pack writes rules as data.

/**
 * The ground and the scene that a rule reads. Each input is a number from the ground maps, except
 * `canopy`, `edge` and `openness`, which the scatter works out from the trees that it has already
 * placed.
 *
 * @category api/vegetation
 */
export type EcoInput =
	| 'heightAboveWater'
	| 'distanceToWater'
	| 'slope'
	| 'northness'
	| 'eastness'
	| 'wetness'
	| 'curvature'
	| 'canopy'
	| 'edge'
	| 'openness';

/**
 * One tolerance curve: the score is 0 outside the curve's reach, rises to 1 at its best range, and
 * falls back to 0 at its end.
 *
 * @category api/vegetation
 */
export interface ToleranceCurve {
	/** The input that this curve reads. */
	readonly input: EcoInput;
	/** The value under which the score is 0. */
	readonly min: number;
	/** The lowest value that scores 1. */
	readonly best: number;
	/** The highest value that scores 1. */
	readonly worst: number;
	/** The value over which the score is 0. */
	readonly max: number;
}

/**
 * The order that the layers are placed in, which decides what each one can see.
 *
 * @category api/vegetation
 */
export type EcoLayer = 'canopy' | 'young' | 'understory' | 'shrub' | 'ground' | 'deadwood';

/**
 * How a young layer gathers around the plants that the layers above it placed.
 *
 * @category api/vegetation
 */
export interface EcoCluster {
	/** The species that it gathers around. An empty list means every canopy plant. */
	readonly species?: readonly string[];
	/** The farthest that a young plant stands from its adult, in meters. */
	readonly radius: number;
	/** The fewest young plants that one adult gathers beneath it. */
	readonly min: number;
	/** The most young plants that one adult gathers beneath it. */
	readonly max: number;
}

/**
 * One rule: a species, the layer that it belongs to, the room that it needs and what it needs from
 * the ground.
 *
 * @category api/vegetation
 */
export interface EcoRule {
	/**
	 * The species' id, which the placed points carry. A deadwood rule names the prop that it
	 * places instead, since dead wood has no species of its own.
	 */
	readonly species: string;
	/** The layer that places this rule. */
	readonly layer: EcoLayer;
	/** The meters between two candidate places, before the rule's score thins them. */
	readonly spacing: number;
	/** The radius that the plant keeps to itself, in meters: its crown's radius for a tree. */
	readonly radius: number;
	/** The score under which no plant grows. The default is 0, which accepts every scored place. */
	readonly threshold?: number;
	/** What the species needs. The score is the lowest of these curves. */
	readonly tolerances: readonly ToleranceCurve[];
	/** For a young layer, how the saplings gather around the adults. */
	readonly cluster?: EcoCluster;
	/**
	 * The share of the clump field that the species grows in, from 0 to 1. A species that grows in
	 * clumps leaves gaps that another species fills.
	 */
	readonly clump?: readonly [number, number];
	/** The variants of this species that a copy may take. The default is 6. */
	readonly variants?: number;
	/** The scale of one copy, from smallest to largest. The default is 1. */
	readonly scale?: readonly [number, number];
	/**
	 * The layers whose plants this rule must not stand inside. Every layer by default, so a rule
	 * that grows under the crowns names only the layers that it shares the ground with.
	 */
	readonly overlaps?: readonly EcoLayer[];
}

/**
 * The layers in the order that a scatter places them.
 *
 * @category api/vegetation
 */
export const LAYER_ORDER: readonly EcoLayer[] = [
	'canopy',
	'young',
	'understory',
	'shrub',
	'ground',
	'deadwood',
];

/**
 * The score that one curve gives a value, from 0 to 1. A curve whose best range lies below its end
 * reads the same way, so a value can face any way round.
 *
 * @param curve The curve.
 * @param value The input's value.
 * @returns The score.
 * @category api/vegetation
 */
export function toleranceScore(curve: ToleranceCurve, value: number): number {
	const { min, best, worst, max } = curve;
	const low = Math.min(best, worst);
	const high = Math.max(best, worst);
	if (value < min || value > max) return 0;
	if (value >= low && value <= high) return 1;
	if (value < low) return low > min ? (value - min) / (low - min) : 1;
	return max > high ? (max - value) / (max - high) : 1;
}

/**
 * The score that a rule gives a place: the lowest of its curves, so every need must hold.
 *
 * @param rule The rule.
 * @param read Reads one input at the place.
 * @returns The score, from 0 to 1.
 * @category api/vegetation
 */
export function ruleScore(rule: EcoRule, read: (input: EcoInput) => number): number {
	let score = 1;
	for (const curve of rule.tolerances) {
		const value = toleranceScore(curve, read(curve.input));
		if (value < score) score = value;
		if (score === 0) return 0;
	}
	return score;
}

/** The problems that a set of rules has, as sentences; an empty list means they place plants. */
function ruleProblems(rules: readonly EcoRule[]): string[] {
	const problems: string[] = [];
	rules.forEach((rule, index) => {
		const at = `rules[${index}] ("${rule.species}")`;
		if (typeof rule.species !== 'string' || !rule.species)
			problems.push(`${at} needs a species id.`);
		if (!LAYER_ORDER.includes(rule.layer)) problems.push(`${at} names no known layer.`);
		if (!(rule.spacing > 0) || !Number.isFinite(rule.spacing))
			problems.push(`${at}.spacing must be a positive number of meters.`);
		if (!(rule.radius >= 0) || !Number.isFinite(rule.radius))
			problems.push(`${at}.radius must be a number of meters from 0.`);
		if (rule.threshold !== undefined && !(rule.threshold >= 0 && rule.threshold <= 1))
			problems.push(`${at}.threshold must be a number from 0 to 1.`);
		if (rule.layer === 'young' && !rule.cluster)
			problems.push(`${at} is a young layer, so it needs a cluster to gather around its adults.`);
		if (rule.cluster) {
			const cluster = rule.cluster;
			if (!(cluster.radius > 0) || !Number.isFinite(cluster.radius))
				problems.push(`${at}.cluster.radius must be a positive number of meters.`);
			if (!Number.isInteger(cluster.min) || cluster.min < 0)
				problems.push(`${at}.cluster.min must be a whole number from 0.`);
			if (!Number.isInteger(cluster.max) || cluster.max < cluster.min)
				problems.push(`${at}.cluster.max must be a whole number of cluster.min or more.`);
		}
		if (rule.clump && !(rule.clump[0] >= 0 && rule.clump[0] <= rule.clump[1] && rule.clump[1] <= 1))
			problems.push(`${at}.clump must hold two numbers from 0 to 1, smallest first.`);
		if (rule.variants !== undefined && (!Number.isInteger(rule.variants) || rule.variants < 1))
			problems.push(`${at}.variants must be a whole number from 1.`);
		if (rule.scale && !(rule.scale[0] > 0 && rule.scale[0] <= rule.scale[1]))
			problems.push(`${at}.scale must hold two positive numbers, smallest first.`);
		for (const layer of rule.overlaps ?? [])
			if (!LAYER_ORDER.includes(layer)) problems.push(`${at}.overlaps names no known layer.`);
		for (const curve of rule.tolerances) {
			if (!(curve.min < curve.max))
				problems.push(`${at}: the ${curve.input} curve must reach further than it starts.`);
			if (
				curve.best < curve.min ||
				curve.best > curve.max ||
				curve.worst < curve.min ||
				curve.worst > curve.max
			)
				problems.push(`${at}: the ${curve.input} curve's best range must lie within it.`);
		}
	});
	return problems;
}

/**
 * Refuses a set of rules that cannot place plants, with every problem in one message.
 *
 * @param rules The rules.
 * @returns The same rules.
 * @throws Error naming each problem.
 * @category api/vegetation
 */
export function checkRules(rules: readonly EcoRule[]): readonly EcoRule[] {
	const problems = ruleProblems(rules);
	if (problems.length > 0)
		throw new Error(
			`@null3d/vegetation: these scatter rules cannot place plants.\n${problems.join('\n')}`,
		);
	return rules;
}
