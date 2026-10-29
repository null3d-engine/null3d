// Turns a species record and a seed into a plant: skeleton, cards, every detail level, the wind data
// and the crown. The work is pure, so it runs in the main thread or in a job worker and gives the
// same asset either way.
import type { PlantAsset, PlantLevel, PlantPart, WindData } from './asset';
import { type PartArrays, partBytes } from './builder';
import { boundsOf, type CrownData, type CrownField } from './crown';
import { buildLeaves, leafCards } from './leaves';
import { type CardLevel, cardLevel, cardOrder, woodDetail } from './levels';
import { buildFlowers, buildRosette, rosetteLeaves, rosetteLevel } from './rosette';
import { growSkeleton, type Skeleton } from './skeleton';
import { checkSpecies, type Species } from './species';
import { buildWood } from './wood';

/**
 * How much of a plant to grow.
 * @category api/vegetation
 */
export interface GenerateOptions {
	/** The scene's seed. The same seed and species grow the same plant on every device. */
	readonly seed: number;
	/** The variant's index, from 0. */
	readonly variant?: number;
	/** The detail levels to build, from 1 to the record's. */
	readonly levels?: number;
}

/**
 * The floats that one branch record in the wind table holds.
 * @category api/vegetation
 */
export const WIND_STRIDE = 16;

/** The kinds that grow a rosette rather than a branch system. */
const ROSETTE_KINDS: ReadonlySet<string> = new Set(['fern', 'rosette', 'grass']);

/** The widest horizontal reach of a plant's skeleton, which sets the crown's radius. */
function crownRadius(skeleton: Skeleton, species: Species): number {
	let radius = species.height * 0.1;
	for (const branch of skeleton.branches) {
		const points = branch.points;
		for (let i = 0; i + 2 < points.length; i += 3)
			radius = Math.max(radius, Math.hypot(points[i] as number, points[i + 2] as number));
	}
	const leaf = species.leaf;
	const reach = leaf ? Math.max(leaf.width, leaf.height) : (species.rosette?.length ?? 0);
	return radius + reach;
}

/** The wind table: one record for each branch, or one record for a rosette's single stem. */
function windData(species: Species, skeleton: Skeleton, height: number): WindData {
	const branches = skeleton.branches;
	const records = Math.max(1, branches.length);
	const pivots = new Float32Array(records * WIND_STRIDE);
	for (let i = 0; i < records; i++) {
		const branch = branches[i];
		const at = i * WIND_STRIDE;
		if (branch) {
			const x = branch.points[0] as number;
			const y = branch.points[1] as number;
			const z = branch.points[2] as number;
			const ex = (branch.points[3] as number) - x;
			const ey = (branch.points[4] as number) - y;
			const ez = (branch.points[5] as number) - z;
			const length = Math.hypot(ex, ey, ez) || 1;
			pivots[at] = x;
			pivots[at + 1] = y;
			pivots[at + 2] = z;
			pivots[at + 3] = ex / length;
			pivots[at + 4] = ey / length;
			pivots[at + 5] = ez / length;
			pivots[at + 6] = branch.parent;
			pivots[at + 7] =
				species.wind.stiffness[Math.min(branch.level, species.wind.stiffness.length - 1)] ?? 0;
			pivots[at + 8] = species.wind.flutter;
			pivots[at + 9] = species.wind.frequency;
			pivots[at + 10] = branch.level;
			pivots[at + 11] = branch.length;
		} else {
			pivots[at + 4] = 1;
			pivots[at + 6] = -1;
			pivots[at + 7] = species.wind.stiffness[0] ?? 0;
			pivots[at + 8] = species.wind.flutter;
			pivots[at + 9] = species.wind.frequency;
			pivots[at + 11] = height;
		}
	}
	return { pivots, stride: WIND_STRIDE, branches: records };
}

/** The bounds over a level's parts. */
function levelBounds(parts: readonly PlantPart[]): ReturnType<typeof boundsOf> {
	const min: [number, number, number] = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const max: [number, number, number] = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	for (const part of parts) {
		const bounds = boundsOf(part.arrays.positions);
		for (let axis = 0; axis < 3; axis++) {
			min[axis] = Math.min(min[axis] as number, bounds.min[axis] as number);
			max[axis] = Math.max(max[axis] as number, bounds.max[axis] as number);
		}
	}
	if (!Number.isFinite(min[0])) return boundsOf(new Float32Array(3));
	const center: [number, number, number] = [
		(min[0] + max[0]) / 2,
		(min[1] + max[1]) / 2,
		(min[2] + max[2]) / 2,
	];
	let radius = 0;
	for (const part of parts) {
		const bounds = boundsOf(part.arrays.positions);
		radius = Math.max(
			radius,
			bounds.radius +
				Math.hypot(
					bounds.center[0] - center[0],
					bounds.center[1] - center[1],
					bounds.center[2] - center[2],
				),
		);
	}
	return { min, max, center, radius };
}

/** One level's record, from its parts. */
function levelOf(parts: readonly PlantPart[], error: number): PlantLevel {
	let vertices = 0;
	let triangles = 0;
	let bytes = 0;
	for (const part of parts) {
		vertices += part.arrays.positions.length / 3;
		triangles += part.arrays.indices.length / 3;
		bytes += partBytes(part.arrays);
	}
	return { parts, error, vertices, triangles, bytes };
}

/** The time that the generator has spent, which the stats report. */
function clock(): number {
	return typeof performance !== 'undefined' && typeof performance.now === 'function'
		? performance.now()
		: 0;
}

/**
 * Grows one plant from a species record and a seed. It makes the skeleton once, then every level
 * from that skeleton, so the crown keeps its shape and the wind data serves every level.
 *
 * @param species The species record.
 * @param options The seed, the variant and the levels to build.
 * @returns The plant's asset.
 * @throws Error when the record cannot grow.
 * @category api/vegetation
 */
export function generatePlant(species: Species, options: GenerateOptions): PlantAsset {
	const started = clock();
	checkSpecies(species);
	const variant = options.variant ?? 0;
	const seed = options.seed;
	const rosettePlant = ROSETTE_KINDS.has(species.kind);
	const skeleton = growSkeleton(species, seed, variant);
	const levels = Math.max(1, Math.min(species.levels, options.levels ?? species.levels));
	const field: CrownField = {
		radius: rosettePlant
			? (species.rosette?.length ?? species.height)
			: crownRadius(skeleton, species),
		start: species.height * species.crown.start,
		height: species.height,
		shape: species.crown.shape,
	};

	const rosetteLeavesList = rosettePlant ? rosetteLeaves(species, seed, variant, field) : undefined;
	const cards = rosettePlant ? undefined : leafCards(species, skeleton, seed, variant, field);
	const order = cards ? cardOrder(cards) : [];
	// A card level names the cards that the level keeps and their growth, and the next level reads
	// them for its morph targets.
	const cardLevels: CardLevel[] = cards
		? Array.from({ length: levels }, (_, level) => cardLevel(cards, level, order))
		: [];
	// Build what no other level's error moves, and find each level's own error first: a level's
	// targets mix toward the level after it, so its error must be known before the leaves are built.
	const localErrors: number[] = new Array(levels).fill(0);
	const rosetteParts: (PlantPart[] | undefined)[] = new Array(levels);
	const woodParts: (PartArrays | undefined)[] = new Array(levels);
	for (let level = 0; level < levels; level++) {
		if (rosetteLeavesList && species.rosette) {
			const thinned = rosetteLevel(rosetteLeavesList, level);
			const segments = Math.max(2, Math.round(species.rosette.segments * (1 - 0.2 * level)));
			const parts: PlantPart[] = [
				{
					name: species.rosette.shape === 'frond' ? 'frond' : 'blade',
					arrays: buildRosette(species, thinned.leaves, thinned.grow, segments),
				},
			];
			// Each level holds arrays of its own, so a worker's transfer list names none twice.
			const flowers = buildFlowers(species, seed, variant);
			if (flowers) parts.push({ name: 'flower', arrays: flowers });
			rosetteParts[level] = parts;
			localErrors[level] = thinned.error;
		} else if (cards) {
			const wood = buildWood(
				species,
				skeleton,
				woodDetail(level),
				field,
				Math.max(1, skeleton.branches.length),
			);
			woodParts[level] = wood.part;
			localErrors[level] = Math.max(wood.error, (cardLevels[level] as CardLevel).error);
		}
	}
	const errors: number[] = new Array(levels);
	for (let level = 0; level < levels; level++)
		errors[level] =
			level === 0
				? 0
				: Math.max(localErrors[level] as number, (errors[level - 1] as number) * 1.5 + 0.02);
	const built: PlantLevel[] = [];
	for (let level = 0; level < levels; level++) {
		const parts: PlantPart[] = [];
		const rosette = rosetteParts[level];
		if (rosette) parts.push(...rosette);
		else if (cards) {
			const thinned = cardLevels[level] as CardLevel;
			parts.push({ name: 'wood', arrays: woodParts[level] as PartArrays });
			if (thinned.cards.length > 0) {
				// The next level's kept cards and error, or none for the coarsest level that draws.
				const following = cardLevels[level + 1];
				parts.push({
					name: 'leaves',
					arrays: buildLeaves(
						thinned.cards,
						thinned.grow,
						following && {
							keep: new Set(following.cards),
							grow: following.grow,
							error: errors[level + 1] as number,
						},
					),
				});
			}
		}
		built.push(levelOf(parts, errors[level] as number));
	}

	// The crown's bounds hold every level, so a switch never moves the bounds that culling reads.
	const bounds = levelBounds(built.flatMap((level) => level.parts));
	const crown: CrownData = {
		shape: species.crown.shape,
		min: bounds.min,
		max: bounds.max,
		center: bounds.center,
		radius: bounds.radius,
		start: species.height * species.crown.start,
	};
	let vertices = 0;
	let triangles = 0;
	let bytes = 0;
	for (const level of built) {
		vertices += level.vertices;
		triangles += level.triangles;
		bytes += level.bytes;
	}
	return {
		species,
		variant,
		levels: built,
		wind: windData(species, skeleton, species.height),
		crown,
		impostorSource: { level: 0, bounds: crown, pivot: 0, tint: species.color.leaf },
		stats: { vertices, triangles, bytes, milliseconds: clock() - started },
	};
}

/**
 * Grows a species' variants: the record's count by default, each with its own seed choice and its
 * own shape.
 *
 * @param species The species record.
 * @param options The seed and how many variants to grow.
 * @returns One asset for each variant.
 * @category api/vegetation
 */
export function generateVariantSet(
	species: Species,
	options: { seed: number; variants?: number; levels?: number },
): PlantAsset[] {
	const count = Math.max(1, Math.min(10, options.variants ?? species.variants));
	const assets: PlantAsset[] = [];
	for (let variant = 0; variant < count; variant++)
		assets.push(generatePlant(species, { seed: options.seed, variant, levels: options.levels }));
	return assets;
}

/** The typed arrays in a part, for a worker's transfer list. */
export function partBuffers(arrays: PartArrays): ArrayBuffer[] {
	return [
		arrays.positions.buffer as ArrayBuffer,
		arrays.normals.buffer as ArrayBuffer,
		arrays.uvs.buffer as ArrayBuffer,
		arrays.colors.buffer as ArrayBuffer,
		...(arrays.targets ? [arrays.targets.buffer as ArrayBuffer] : []),
		arrays.indices.buffer as ArrayBuffer,
	];
}
