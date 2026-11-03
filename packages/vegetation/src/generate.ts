// The generator's orchestrator: the stages from a species record to a grown, meshed variant, in
// order. Stage C builds the kit once per species: leaf meshes at every tier, shoot prototypes, the
// card atlas and the records header. Stage D grows the macro skeleton; stage E dresses it with shoot
// rows, the crown's light and the wind records; stage F meshes the three levels and quantises them;
// stage G bakes the far cards. Each stage is a function of its own module, and this file only calls
// them in order, so a module fills its stage without touching this one.
//
// The orchestrator holds no engine import, so a job worker and Bun run it alike. The growers and
// the leaf builders are lazy chunks: `loadPlantCode` loads a species' code on this thread, and the
// stage calls after it are synchronous. A kit built with `placeholders` grows the stand-in of every
// stage (core/placeholder.ts); with `placeholders: 'missing'` it grows a stand-in only for each stage
// that is not built yet; without either, a stage that is not built yet throws.
import type { MeshArrays, PlantAsset, PlantPart, ShootPrototype, SpeciesKitData } from './asset';
import { type CoarsenessOptions, coarsenessFor, coarsenessKey } from './coarseness';
import { speciesBox } from './core/box';
import { type MacroSkeleton, SkeletonBuilder } from './core/graph';
import { hashText } from './core/hash';
import { NotBuiltError } from './core/not-built';
import {
	emptyLevel,
	emptyRows,
	levelOf,
	placeholderCardBake,
	placeholderCardMesh,
	placeholderCrown,
	placeholderFar,
	placeholderFoliage,
	placeholderHeader,
	placeholderLeaves,
	placeholderPrototypes,
	placeholderQuantise,
	placeholderRows,
	placeholderSkeleton,
	placeholderStarts,
	placeholderWind,
	placeholderWood,
} from './core/placeholder';
import type { Species, SpeciesModule } from './core/record';
import { loadSpeciesHooks, speciesHooks } from './core/registry';
import type { TextureManifest } from './core/textures';
import { DETAILS, type Detail, type Season, type Vec3 } from './core/types';
import { lightCrown } from './crown/visibility';
import { type CuttingOptions, cutBranch, cutFoliage, mergeShoots } from './cutting';
import { coarsenSkeleton } from './grow/coarsen';
import { grower, loadGrower } from './grow/models';
import { extrasMesh } from './leaf/extras';
import { placeShoots } from './leaf/instancer';
import { foliage, loadFoliage } from './leaf/kinds';
import { shootPrototypes } from './leaf/shoot';
import { bakeCards } from './lod/card-bake';
import { cardMesh } from './lod/cards';
import { bakeFar } from './lod/impostor';
import { levelStarts } from './lod/levels';
import { quantiseParts, TEXTURE_UV_STEPS, WOOD_UV_STEPS } from './lod/quantise';
import { speciesHeader } from './render/records';
import type { DressInput, FarBake, GrowInput, MeshInput, MeshLevel } from './stages';
import { VARIANT_RECORDS, windRecords } from './wind/records';
import { meshWood } from './wood/wood-mesh';

/**
 * The generator's version, which every kit key and variant key holds, so a cached kit or variant of
 * an older generator is never read.
 *
 * @category api/vegetation
 */
export const GENERATOR_VERSION = '1';

/**
 * What a species' kit is built from: its record and its texture manifest. A species module is one.
 *
 * @category api/vegetation
 */
export interface KitSource {
	/** The species record. */
	readonly record: Species;
	/** The texture files, of which the kit reads the manifest. */
	readonly textures: Pick<SpeciesModule['textures'], 'manifest'>;
}

/**
 * How a kit is built.
 *
 * @category api/vegetation
 */
export interface KitOptions {
	/** The mesh tier; high by default. */
	readonly detail?: Detail;
	/**
	 * Grow the stand-in of every stage, as the stand-in species that scenes place do; or with
	 * `'missing'`, grow each built stage and a stand-in only for a stage that is not built yet.
	 */
	readonly placeholders?: boolean | 'missing';
}

/**
 * How one variant grows. Its coarseness options come from the kit, as `prepareSpecies` took them,
 * when it gives none of its own.
 *
 * @category api/vegetation
 */
export interface GrowOptions extends CoarsenessOptions {
	/** The scene's seed. */
	readonly seed: number;
	/** The variant's index, from 0 to the record's variants less one. */
	readonly variant: number;
	/** The season; the record's default when not given. */
	readonly season?: Season;
	/** The mesh tier; the kit's by default. */
	readonly detail?: Detail;
	/** Mesh the nearest level's wood at once rather than in the background. */
	readonly near?: boolean;
	/** Grow or cut one piece for close review instead of the whole plant. */
	readonly cutting?: CuttingOptions;
}

/**
 * Loads a species' code on this thread: its growth model's grower, its foliage kind's leaf builder
 * and its own shape code, each once. Every synchronous stage call needs it first.
 *
 * @param record The species record.
 * @category api/vegetation
 */
export async function loadPlantCode(record: Species): Promise<void> {
	await Promise.all([
		loadGrower(record.growth.model),
		loadFoliage(record.foliage.kind),
		loadSpeciesHooks(record.id),
	]);
}

/**
 * Runs a stage, or its stand-in when the kit asks for stand-ins. A stand-in kit always grows the
 * stand-ins, so the stand-in species that scenes place draw the same as the real stages land. A kit
 * that asks for the missing stages' stand-ins runs each stage and grows the stand-in only where the
 * stage throws that it is not built.
 */
function stage<T>(
	placeholders: boolean | 'missing' | undefined,
	run: () => T,
	standIn: () => T,
): T {
	if (placeholders === 'missing') {
		try {
			return run();
		} catch (error) {
			if (error instanceof NotBuiltError) return standIn();
			throw error;
		}
	}
	return placeholders ? standIn() : run();
}

/**
 * The key of a kit: a hash of the generator's version, the record, the manifest and the tier. Two
 * kits with one key hold the same bytes.
 *
 * @param record The species record.
 * @param manifest The texture manifest.
 * @param detail The mesh tier.
 * @returns The key.
 * @category api/vegetation
 */
export function kitKey(record: Species, manifest: TextureManifest, detail: Detail): string {
	return hashText(
		`${GENERATOR_VERSION}|${JSON.stringify(record)}|${JSON.stringify(manifest)}|${detail}`,
	);
}

/**
 * The key of a grown variant: its kit's key, the seed, the variant, the season, the tier, the
 * cutting and the coarseness options.
 *
 * @param kit The species' kit.
 * @param options The growth's options.
 * @returns The key.
 * @category api/vegetation
 */
export function variantKey(kit: SpeciesKitData, options: GrowOptions): string {
	const season = options.season ?? kit.record.seasons.default;
	const cutting = options.cutting ? JSON.stringify(options.cutting) : '';
	return `${kit.key}:${options.seed >>> 0}:${options.variant}:${season}:${options.detail ?? kit.detail}:${cutting}${coarsenessKey(kit, options)}`;
}

/**
 * Builds a species' kit on this thread: its leaf meshes at every tier, its shoot prototypes, its
 * card atlas and its records header. Call `loadPlantCode` first.
 *
 * @param source The species' record and texture manifest, such as its module.
 * @param options The tier, and whether every stage grows its stand-in.
 * @returns The kit.
 * @category api/vegetation
 */
export function buildKitNow(source: KitSource, options: KitOptions = {}): SpeciesKitData {
	const { record } = source;
	const manifest = source.textures.manifest;
	const detail = options.detail ?? 'high';
	const placeholders = options.placeholders ?? false;
	const box = speciesBox(record);
	const builder = foliage(record.foliage.kind);
	const leavesByTier = DETAILS.map((tier) =>
		stage(
			placeholders,
			() => builder.leaves(record, manifest, tier),
			() => placeholderLeaves(record, tier),
		),
	);
	let prototypes: ShootPrototype[] = [];
	let cards: SpeciesKitData['cards'] = {
		size: 0,
		color: new Uint8Array(0),
		surface: new Uint8Array(0),
	};
	if (record.shoots) {
		const uncarded = stage(
			placeholders,
			() => shootPrototypes(record, manifest, leavesByTier),
			() => placeholderPrototypes(record, leavesByTier),
		);
		const baked = stage(
			placeholders,
			() => bakeCards(record, manifest, detail, uncarded),
			() => placeholderCardBake(record, uncarded),
		);
		prototypes = uncarded.map((prototype, index) => {
			const card = baked.cells[index];
			if (!card) throw new Error(`the card bake gave no cells for prototype ${index}`);
			return { ...prototype, card };
		});
		const hooks = speciesHooks(record.id);
		if (hooks?.shoot) for (const prototype of prototypes) hooks.shoot(prototype, record);
		cards = baked.atlas;
	}
	const header = stage(
		placeholders,
		() => speciesHeader(record, manifest, box),
		() => placeholderHeader(record, box),
	);
	return {
		record,
		manifest,
		key: kitKey(record, manifest, detail),
		detail,
		box,
		prototypes,
		leaves: leavesByTier[DETAILS.indexOf(detail)] ?? [],
		cards,
		header,
		placeholders,
	};
}

/**
 * The parts of a mesh, quantised: one per piece of at most `PART_VERTICES` vertices, so each has
 * 16-bit indices; none when the mesh is empty.
 */
function partOf(
	kit: SpeciesKitData,
	name: PlantPart['name'],
	mesh: MeshArrays | undefined,
	uvSteps: number,
): PlantPart[] {
	if (!mesh || mesh.indices.length === 0) return [];
	const pieces = stage(
		kit.placeholders,
		() => quantiseParts(mesh, kit.box, uvSteps),
		() => [placeholderQuantise(mesh, kit.box, uvSteps)],
	);
	return pieces.map((arrays) => ({ name, arrays }));
}

/** The grown skeleton and its dressing: the stages before the meshes. */
function dress(kit: SpeciesKitData, options: GrowOptions): MeshInput {
	const record = kit.record;
	const placeholders = kit.placeholders;
	const growInput: GrowInput = {
		record,
		seed: options.seed >>> 0,
		variant: options.variant,
		season: options.season ?? record.seasons.default,
	};
	const detail = options.detail ?? kit.detail;
	const grown = stage(
		placeholders,
		() => grower(record.growth.model).grow(growInput),
		() => placeholderSkeleton(growInput),
	);
	speciesHooks(record.id)?.afterGrow?.(grown, record, growInput.seed);
	// A stand-in grows as it is at any coarseness.
	const coarseness = placeholders
		? 0
		: coarsenessFor(kit, { ...growInput, skeleton: grown }, detail, options);
	const dressInput: DressInput = {
		...growInput,
		kit,
		skeleton: cutSkeleton(kit, coarsenSkeleton(grown, coarseness), options.cutting),
		coarseness,
	};
	const rows =
		record.lod.nearFoliage === 'instanced' && kit.prototypes.length > 0
			? stage(
					placeholders,
					() => placeShoots(dressInput),
					() => placeholderRows(dressInput),
				)
			: emptyRows();
	const crown = stage(
		placeholders,
		() => lightCrown(dressInput, rows),
		() => placeholderCrown(dressInput),
	);
	return { ...dressInput, rows, crown, detail };
}

/** Whether a cutting is cut from the grown skeleton rather than built from the kit alone. */
function cutsSkeleton(kit: SpeciesKitData, cutting: CuttingOptions | undefined): boolean {
	if (!cutting) return false;
	return (
		cutting.part === 'branch' ||
		cutting.part === 'subbranch' ||
		(cutting.part === 'cluster' && kit.prototypes.length === 0)
	);
}

/** The grown skeleton, or the piece a cutting takes from it. */
function cutSkeleton(
	kit: SpeciesKitData,
	skeleton: MacroSkeleton,
	cutting: CuttingOptions | undefined,
): MacroSkeleton {
	if (!cutting || !cutsSkeleton(kit, cutting)) return skeleton;
	return cutBranch(skeleton, kit.record, cutting)?.skeleton ?? skeleton;
}

/** The bounds of a mesh's positions, or a point at the origin for an empty one. */
function meshBounds(mesh: MeshArrays): { min: Vec3; max: Vec3 } {
	const min = [0, 0, 0];
	const max = [0, 0, 0];
	const p = mesh.positions;
	for (let i = 0; i < p.length; i += 3)
		for (let k = 0; k < 3; k++) {
			const v = p[i + k] as number;
			if (i === 0 || v < (min[k] as number)) min[k] = v;
			if (i === 0 || v > (max[k] as number)) max[k] = v;
		}
	return {
		min: [min[0] as number, min[1] as number, min[2] as number],
		max: [max[0] as number, max[1] as number, max[2] as number],
	};
}

/**
 * Grows one piece of a plant as a plant of its own: a branch or sub-branch cut from the grown
 * skeleton and dressed and meshed at the nearest level, with its shoot rows merged into one foliage
 * part, or a leaf cluster or leaf from the kit alone. The piece has no card levels and no impostor.
 */
function growCutting(
	kit: SpeciesKitData,
	options: GrowOptions,
	cutting: CuttingOptions,
): PlantAsset {
	const started = now();
	const record = kit.record;
	const detail = options.detail ?? kit.detail;
	const season = options.season ?? record.seasons.default;
	let skeleton: MacroSkeleton;
	let parts: PlantPart[];
	let wind: PlantAsset['wind'];
	let coarseness = 0;
	if (cutsSkeleton(kit, cutting)) {
		const mesh = dress(kit, options);
		coarseness = mesh.coarseness ?? 0;
		wind = stage(
			kit.placeholders,
			() => windRecords(mesh),
			() => placeholderWind(mesh),
		);
		const shoots = mergeShoots(kit, mesh.rows, detail, wind.base);
		parts = [
			...nearWood(mesh),
			...levelParts(mesh, 0),
			...partOf(kit, 'foliage', shoots, TEXTURE_UV_STEPS),
		];
		skeleton = mesh.skeleton;
	} else {
		const foliage = cutFoliage(kit, cutting, detail);
		parts = foliage ? partOf(kit, 'foliage', foliage, TEXTURE_UV_STEPS) : [];
		const builder = new SkeletonBuilder().finish(0);
		const bounds = foliage ? meshBounds(foliage) : builder.bounds;
		skeleton = { ...builder, bounds, height: bounds.max[1] };
		wind = { base: options.variant * VARIANT_RECORDS, count: 0, records: new Float32Array(0) };
	}
	const near = levelOf(0, parts, 0);
	const { min, max } = skeleton.bounds;
	const base = Math.min(skeleton.crownBase, max[1]);
	return {
		species: record.id,
		recordHash: hashText(JSON.stringify(record)),
		seed: options.seed >>> 0,
		variant: options.variant,
		season,
		coarseness,
		cutting,
		skeleton,
		shoots: emptyRows(),
		levels: [near, emptyLevel(1), emptyLevel(2)],
		wind,
		crown: {
			centre: [(min[0] + max[0]) / 2, (base + max[1]) / 2, (min[2] + max[2]) / 2],
			radius: Math.max((max[0] - min[0]) / 2, (max[1] - base) / 2, (max[2] - min[2]) / 2),
			base,
			top: max[1],
		},
		impostor: { level: 1, views: 0, texels: 0, from: 0 },
		stats: {
			milliseconds: now() - started,
			bytes: wind.records.byteLength + near.bytes,
			triangles: [near.triangles, 0, 0],
		},
	};
}

/** The nearest level's wood, quantised. */
function nearWood(mesh: MeshInput): PlantPart[] {
	const wood = stage(
		mesh.kit.placeholders,
		() => meshWood(mesh, 0),
		() => placeholderWood(mesh, 0),
	);
	return partOf(mesh.kit, 'wood', wood, WOOD_UV_STEPS);
}

/** The parts of one level, without the nearest level's wood. */
function levelParts(mesh: MeshInput, level: MeshLevel): PlantPart[] {
	const { kit, record } = mesh;
	const placeholders = kit.placeholders;
	const parts: PlantPart[] = [];
	if (level > 0) {
		const wood = stage(
			placeholders,
			() => meshWood(mesh, level),
			() => placeholderWood(mesh, level),
		);
		parts.push(...partOf(kit, 'wood', wood, WOOD_UV_STEPS));
	}
	if (record.lod.nearFoliage === 'merged') {
		const merged = stage(
			placeholders,
			() => {
				const build = grower(record.growth.model).foliage;
				if (!build) throw new NotBuiltError(`merged ${record.growth.model} foliage`);
				return build(mesh, level);
			},
			() => placeholderFoliage(mesh, level),
		);
		parts.push(...partOf(kit, 'foliage', merged, TEXTURE_UV_STEPS));
	} else if (level > 0) {
		const cardLevel = level as 1 | 2;
		const cards = stage(
			placeholders,
			() => cardMesh(mesh, cardLevel),
			() => placeholderCardMesh(mesh, cardLevel),
		);
		parts.push(...partOf(kit, 'cards', cards, TEXTURE_UV_STEPS));
	}
	const extras = stage(
		placeholders,
		() => extrasMesh(mesh, level),
		() => undefined,
	);
	parts.push(...partOf(kit, 'extras', extras, TEXTURE_UV_STEPS));
	return parts;
}

/** A clock for the stats, which no byte of the asset reads. */
const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

/**
 * Grows one variant on this thread: its skeleton, its shoot rows, its crown light, its wind records
 * and its three levels. Call `loadPlantCode` first. The nearest level's wood is meshed only when
 * `near` is set; otherwise `growNearWoodNow` meshes it in the background.
 *
 * @param kit The species' kit.
 * @param options The seed, the variant and the season.
 * @returns The grown variant.
 * @category api/vegetation
 */
export function growPlantNow(kit: SpeciesKitData, options: GrowOptions): PlantAsset {
	if (options.cutting) return growCutting(kit, options, options.cutting);
	const started = now();
	const record = kit.record;
	const mesh = dress(kit, options);
	const placeholders = kit.placeholders;
	const wind = stage(
		placeholders,
		() => windRecords(mesh),
		() => placeholderWind(mesh),
	);
	const starts = stage(
		placeholders,
		() => levelStarts(mesh),
		() => placeholderStarts(mesh),
	);
	const near = [...(options.near ? nearWood(mesh) : []), ...levelParts(mesh, 0)];
	const levels = [
		levelOf(0, near, 0),
		levelOf(1, levelParts(mesh, 1), starts[0]),
		levelOf(2, levelParts(mesh, 2), starts[1]),
	] as const;
	const { skeleton } = mesh;
	const { min, max } = skeleton.bounds;
	const centre = [
		(min[0] + max[0]) / 2,
		(skeleton.crownBase + skeleton.height) / 2,
		(min[2] + max[2]) / 2,
	] as const;
	const radius = Math.max(
		(max[0] - min[0]) / 2,
		(skeleton.height - skeleton.crownBase) / 2,
		(max[2] - min[2]) / 2,
	);
	let bytes = wind.records.byteLength;
	for (const level of levels) bytes += level.bytes;
	const asset: PlantAsset = {
		species: record.id,
		recordHash: hashText(JSON.stringify(record)),
		seed: mesh.seed,
		variant: options.variant,
		season: mesh.season,
		coarseness: mesh.coarseness ?? 0,
		skeleton,
		shoots: mesh.rows,
		levels,
		wind,
		crown: { centre, radius, base: skeleton.crownBase, top: skeleton.height },
		impostor: {
			level: 1,
			views: record.lod.impostor.views,
			texels: record.lod.impostor.texels,
			from: starts[2],
		},
		stats: {
			milliseconds: now() - started,
			bytes,
			triangles: [levels[0].triangles, levels[1].triangles, levels[2].triangles],
		},
	};
	return asset;
}

/**
 * Meshes a variant's nearest wood on this thread, for a page that grew the variant without `near`:
 * the same skeleton grows again from the same seed, so the wood fits the asset. Call `loadPlantCode`
 * first.
 *
 * @param kit The species' kit.
 * @param options The options the variant grew with.
 * @returns The nearest level's wood parts, none when the plant has no wood. A large plant's wood
 *   comes in several parts of at most 65,536 vertices each.
 * @category api/vegetation
 */
export function growNearWoodNow(kit: SpeciesKitData, options: GrowOptions): readonly PlantPart[] {
	return nearWood(dress(kit, options));
}

/**
 * Bakes a variant's far cards on this thread: the impostor atlases from its first card level. Call
 * `loadPlantCode` first.
 *
 * @param kit The species' kit.
 * @param asset The grown variant.
 * @returns The atlases.
 * @category api/vegetation
 */
export function bakeFarNow(kit: SpeciesKitData, asset: PlantAsset): FarBake {
	return stage(
		kit.placeholders,
		() => bakeFar(kit, asset),
		() => placeholderFar(kit, asset),
	);
}
