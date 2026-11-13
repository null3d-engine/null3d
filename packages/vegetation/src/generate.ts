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
import type {
	ClusterCount,
	MeshArrays,
	PartTriangles,
	PlantAsset,
	PlantPart,
	PrototypeArrays,
	ShootPrototype,
	ShootRows,
	SpeciesKitData,
} from './asset';
import { type CoarsenessOptions, coarsenessFor, coarsenessKey } from './coarseness';
import { speciesBox } from './core/box';
import { formRecord } from './core/forms';
import { type MacroSkeleton, SkeletonBuilder, skeletonCopy } from './core/graph';
import { hashText } from './core/hash';
import { quatRotate } from './core/math';
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
import type { Growth, Species, SpeciesModule } from './core/record';
import { loadSpeciesHooks, speciesHooks } from './core/registry';
import type { TextureManifest } from './core/textures';
import {
	type Curve,
	DETAILS,
	type Detail,
	type Season,
	type Spread,
	type Vec3,
} from './core/types';
import { lightCrown } from './crown/visibility';
import type { CuttingPart } from './cutting';
import {
	type CuttingOptions,
	clusterRow,
	cutBranch,
	cutFoliage,
	cutsShoot,
	mergeShoots,
} from './cutting';
import {
	cardTop,
	crownReach,
	HEIGHT_RESIDUAL,
	scaledPlacement,
	scaledRows,
	scaledSkeleton,
	targetHeight,
	topRow,
} from './grow/height';
import { leadOnThickest } from './grow/leaders';
import { grower, loadGrower } from './grow/models';
import {
	FOLIAGE_FLOOR,
	GREAT_LIMB_SHARE,
	type SparseOrder,
	sparseKeep,
	sparseOrder,
	sparsePlant,
	woodParts,
} from './grow/sparse';
import { extrasMesh } from './leaf/extras';
import { writtenPieces } from './leaf/ground-piece';
import { dressShoots, pruneLight } from './leaf/instancer';
import { type FoliageBuilder, foliage, loadFoliage } from './leaf/kinds';
import {
	type PieceLeaf,
	type PiecePrototype,
	type PieceRule,
	piecePrototypes,
	pieceRecord,
} from './leaf/piece';
import { carriesPieces, kitPiece, PROTOTYPES_MOST, writesPieces } from './leaf/piece-rows';
import { inLeaf } from './leaf/season';
import { shootPrototypes } from './leaf/shoot';
import { bakeWithBrushes } from './lod/brush-cards';
import {
	type BudgetInput,
	type LevelBuild,
	levelBuild,
	levelWithin,
	NO_CLUSTERS,
	NO_TRIANGLES,
	referenceTriangles,
	shootPartTriangles,
} from './lod/budget';
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
export const GENERATOR_VERSION = '2';

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
	/**
	 * One of the record's other forms by name, such as `young` or `woodland`: the kit and every
	 * variant grown from it take the record that the form grows from. The record as it stands when
	 * not given.
	 */
	readonly form?: string;
	/**
	 * Build a cutting kit: the classes its cut pieces draw and no card levels or crown classes. A
	 * cut piece is drawn only at the nearest level, so its kit never pays for the cards or for the
	 * classes the crown alone uses. The part names the piece the kit is built for, so a hint's own
	 * shoot density applies to it; a bare `true` takes the species' own.
	 */
	readonly cutting?: boolean | CuttingPart;
}

/**
 * How one variant grows. Its level-of-detail options come from the kit, as `prepareSpecies` took
 * them, when it gives none of its own.
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
	/**
	 * How much of its foliage, and of the branches that carried it, the plant gives up, from 0 to 1:
	 * 0 is the plant as grown, at its full density, and 1 is the sparsest, the trunk and the great
	 * limbs with the share of the foliage the record's `sparse.foliage` floor names. The plant grows
	 * once, and a sparser plant is the same plant with shoots and branches removed: nothing moves,
	 * no leaf is scaled, every piece stays joined to the root, and each sparser plant holds only
	 * shoots and wood that every denser one holds. Stand-in species and cut pieces grow as they are.
	 */
	readonly sparse?: number;
	/**
	 * The most triangles one copy of the plant may draw at any of its levels, its shoot rows
	 * counted in the nearest. Without it, each level draws what its best look needs: the wood at the
	 * variant's tier, every shoot row at that tier, and the extras at their nearest form. With it,
	 * the maximum is shared out across the trunk, the great limbs, the branches, the shoots and the
	 * extras in proportion to what each holds at that best look, each part steps down to fit its
	 * share, and no level draws more. It acts at any sparseness, on what the sparseness left. A
	 * stand-in species and a cut piece grow as they are.
	 */
	readonly maxTriangles?: number;
	/**
	 * How far the wood's own sections are thinned, from 0 to 1: 0 is the level's own rings and
	 * sides, and 1 the fewest that still draws a closed run, with square ends and no rounded joins.
	 * A page rarely sets it. Every growth model answers it the same way, since one wood mesher
	 * builds them all.
	 */
	readonly sections?: number;
	/**
	 * The share of a card level's own card rows to keep, from 0.05 to 1: 1 keeps the level's own
	 * cards and their size, and below 1 thins the rows by the level's rule, so the kept cards grow.
	 * A review redraw sets it to measure what the cards buy; a page rarely does.
	 */
	readonly cards?: number;
	/** How a card joins the plant when its branch is not drawn: `remove`, `branch` or `twig`. */
	readonly cardJoin?: 'remove' | 'branch' | 'twig';
}

/** A curve with every value multiplied by a factor. */
function scaledCurve(curve: Curve, factor: number): Curve {
	return typeof curve === 'number'
		? curve * factor
		: curve.map(([at, value]) => [at, value * factor] as [number, number]);
}

/**
 * Builds a species' branch pieces on this thread, each variant at every detail tier, from the
 * species' own leaf meshes. Call `loadPlantCode` first.
 *
 * @param source The species' record and texture manifest, such as its module.
 * @param rules The species' piece rules.
 * @param bare Whether the pieces carry no leaves, as a deciduous plant's do in winter: the wood and
 * the bud at each stem's end.
 * @param leaf The leaf the species' pieces wear where it differs from the record's.
 * @returns The pieces, each rule's variants together, in the rules' order.
 */
export function buildPiecesNow(
	source: KitSource,
	rules: readonly PieceRule[],
	bare = false,
	leaf?: PieceLeaf,
): PiecePrototype[] {
	const record = pieceRecord(source.record, leaf);
	const builder = foliage(record.foliage.kind);
	const manifest = source.textures.manifest;
	const leavesOf = (from: Species) =>
		bare ? DETAILS.map(() => []) : pieceLeaves(builder, from, manifest);
	const leaves = leavesOf(record);
	// A rule whose blades bend in their own plane takes leaves built with no bend at the stalk.
	const straight =
		record.foliage.kind === 'blade' && rules.some((rule) => rule.leafDroop === 'plane')
			? leavesOf({
					...record,
					foliage: {
						...record.foliage,
						leaf: {
							...record.foliage.leaf,
							petiole: { ...record.foliage.leaf.petiole, droop: 0 },
						},
					},
				})
			: leaves;
	return piecePrototypes(record, rules, leaves, straight);
}

/**
 * A species' leaf meshes for its branch pieces at every tier, low first: its kind's piece cut where
 * the kind cuts a piece's leaves apart from the crown's, since a tree carries thousands of pieces,
 * and the crown's own leaves where it does not.
 */
function pieceLeaves(
	builder: FoliageBuilder,
	record: Species,
	manifest: TextureManifest,
): (readonly PrototypeArrays[])[] {
	return DETAILS.map((tier) =>
		builder.pieceLeaves
			? builder.pieceLeaves(record, manifest, tier)
			: builder.leaves(record, manifest, tier),
	);
}

/**
 * The record a cutting kit grows by: the species' own, with the shoots a close piece carries over
 * the crown's. A piece is drawn at the nearest level alone, so its kit pays for no cards, and a
 * covering denser than the crown can afford costs the piece's own kit rather than the crown's.
 */
function cuttingRecord(record: Species, part?: CuttingPart): Species {
	const hints = record.cuttings;
	const hinted = part !== undefined && part !== 'leaf' ? hints?.[part]?.density : undefined;
	const share = hinted ?? hints?.density;
	const shoots = record.shoots;
	if (share === undefined || !shoots) return record;
	const factor = Math.min(8, Math.max(0.25, share));
	const growth = record.growth;
	// A piece's bough carries the branchlets its photograph shows: the finest order divides by the
	// same share, so the covering has wood to stand on.
	const cutGrowth: Growth =
		growth.model === 'architectural' && growth.orders.length > 0
			? {
					...growth,
					orders: growth.orders.map((order, index) =>
						index === growth.orders.length - 1
							? { ...order, density: scaledCurve(order.density, factor) }
							: order,
					),
				}
			: growth;
	return {
		...record,
		growth: cutGrowth,
		shoots: {
			...shoots,
			placement: {
				...shoots.placement,
				perMetre: scaledCurve(shoots.placement.perMetre, factor),
			},
		},
	};
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
 * A tier a kit does not hold: a mesh with no vertices. Each is new, since a kit's arrays are
 * transferred to the job worker, and a shared array would be detached at its second transfer.
 */
function emptyTier(): PrototypeArrays {
	return {
		positions: new Float32Array(0),
		normals: new Float32Array(0),
		uvs: new Float32Array(0),
		uvs1: new Float32Array(0),
		colors: new Uint8Array(0),
		indices: new Uint16Array(0),
	};
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
export function kitKey(
	record: Species,
	manifest: TextureManifest,
	detail: Detail,
	cutting: boolean | CuttingPart = false,
): string {
	return hashText(
		`${GENERATOR_VERSION}|${JSON.stringify(record)}|${JSON.stringify(manifest)}|${detail}${cutting ? `:cutting${typeof cutting === 'string' ? `:${cutting}` : ''}` : ''}`,
	);
}

/**
 * The key of a grown variant: its kit's key, the seed, the variant, the season, the tier, the
 * cutting, the coarseness options, the sparseness and the triangle maximum.
 *
 * @param kit The species' kit.
 * @param options The growth's options.
 * @returns The key.
 * @category api/vegetation
 */
export function variantKey(kit: SpeciesKitData, options: GrowOptions): string {
	const season = options.season ?? kit.record.seasons.default;
	const cutting = options.cutting ? JSON.stringify(options.cutting) : '';
	// A sparser plant holds less of the plant, and section sparsity meshes the same plant coarser:
	// each is a different asset.
	const level = sparseLevel(kit, options);
	const sparse = level > 0 ? `:sparse=${level}` : '';
	const most = maxOf(kit, options);
	const max = most === undefined ? '' : `:max=${most}`;
	const sections =
		options.sections === undefined || options.sections === 0 ? '' : `:sections=${options.sections}`;
	const cards = options.cards === undefined || options.cards === 1 ? '' : `:cards=${options.cards}`;
	const join =
		options.cardJoin === undefined || options.cardJoin === 'remove'
			? ''
			: `:join=${options.cardJoin}`;
	return `${kit.key}:${options.seed >>> 0}:${options.variant}:${season}:${options.detail ?? kit.detail}:${cutting}${coarsenessKey(kit, options)}${sparse}${max}${sections}${cards}${join}`;
}

/**
 * Builds a species' kit on this thread: its leaf meshes at every tier, its shoot prototypes, its
 * card atlas and its records header, from the record of the form the options name, or from the
 * record as it stands. Call `loadPlantCode` first.
 *
 * @param source The species' record and texture manifest, such as its module.
 * @param options The tier, whether every stage grows its stand-in, and the form.
 * @returns The kit.
 * @category api/vegetation
 */
export function buildKitNow(source: KitSource, options: KitOptions = {}): SpeciesKitData {
	const base = formRecord(source.record, options.form);
	const manifest = source.textures.manifest;
	const detail = options.detail ?? 'high';
	const placeholders = options.placeholders ?? false;
	const cutting = options.cutting ?? false;
	const record = cutting
		? cuttingRecord(base, typeof cutting === 'string' ? cutting : undefined)
		: base;
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
	// A species whose grower writes its own pieces builds them where a tree builds its shoots, in a
	// cutting's kit too; a stand-in's holds none. A plant that carries branch pieces at its sockets
	// keeps those in the kit, each part a prototype of its own; any other keeps its shoot prototypes.
	const written =
		writesPieces(record) && placeholders !== true
			? grower(record.growth.model).pieces?.(record, manifest)
			: undefined;
	if (record.shoots || written) {
		const pieces = !cutting && carriesPieces(record) ? record.pieces : undefined;
		const uncarded = written
			? writtenPieces(written).map(kitPiece)
			: stage(
					placeholders,
					() =>
						pieces
							? piecePrototypes(record, pieces, pieceLeaves(builder, record, manifest)).map(
									kitPiece,
								)
							: shootPrototypes(record, manifest, leavesByTier, cutting !== false),
					() => placeholderPrototypes(record, leavesByTier),
				);
		if (uncarded.length > PROTOTYPES_MOST)
			throw new Error(
				`@null3d/vegetation: '${record.id}' builds ${uncarded.length} prototypes; a kit holds ${PROTOTYPES_MOST} at most`,
			);
		// A cutting kit holds no card levels: its pieces are drawn at the nearest level alone. A piece
		// that draws brush cards takes them in the bake, which pictures its leaves first.
		const baked = cutting
			? { atlas: cards, cells: uncarded.map(() => ({ planes: [] })), prototypes: uncarded }
			: stage(
					placeholders,
					() => bakeWithBrushes(record, manifest, detail, uncarded),
					() => ({ ...placeholderCardBake(record, uncarded), prototypes: uncarded }),
				);
		// The kit keeps its own tier's meshes and the tiers below it, which the near band draws
		// farther out; a page draws at one preset, so the tiers above it are left empty. The card
		// bake, the lengths and the radii read the full build first.
		const kept = DETAILS.indexOf(detail);
		prototypes = baked.prototypes.map((prototype, index) => {
			const card = baked.cells[index];
			if (!card) throw new Error(`the card bake gave no cells for prototype ${index}`);
			const tiers = prototype.tiers.map((tier, t) =>
				t <= kept ? tier : emptyTier(),
			) as unknown as ShootPrototype['tiers'];
			return { ...prototype, tiers, card };
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
		key: kitKey(record, manifest, detail, cutting),
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
 * 16-bit indices; none when the mesh is empty. A part of small shapes that draws no texture keeps
 * each position's rest below the box's step in its texture coordinates.
 */
function partOf(
	kit: SpeciesKitData,
	name: PlantPart['name'],
	mesh: MeshArrays | undefined,
	uvSteps: number,
	rest = false,
): PlantPart[] {
	if (!mesh || mesh.indices.length === 0) return [];
	const pieces = stage(
		kit.placeholders,
		() => quantiseParts(mesh, kit.box, uvSteps, rest),
		() => [placeholderQuantise(mesh, kit.box, uvSteps)],
	);
	return pieces.map((arrays) => ({ name, arrays }));
}

/**
 * The record a cut piece grows by, where the species cuts its crown's own shoots: a plant with no
 * shoot prototypes has no class to place a piece's leaves, so the piece's leaf count and its leaf
 * size come from its cutting hint. A species with prototypes, or a plant with no hint, grows as it
 * always did.
 */
function cuttingLeaves(record: Species, cutting: CuttingOptions | undefined): Species {
	if (!cutting || record.shoots) return record;
	const growth = record.growth;
	const leaves = record.cuttings?.leaves;
	const hint = record.cuttings?.[cutting.part];
	const scale = hint && 'order' in hint ? hint.scale : undefined;
	let out = record;
	// A crown-rosette's piece keeps the fronds it was cut from and takes leaflets of its own size:
	// the pinna length curve is the share of the frond's length each leaflet stands, so the share is
	// scaled and the places, and with them the count, are left as they stand.
	if (scale !== undefined && growth.model === 'crown-rosette' && 'frond' in growth) {
		const frond = growth.frond;
		const pinnae = frond.pinnae;
		if (pinnae !== undefined)
			out = {
				...record,
				growth: {
					...growth,
					frond: { ...frond, pinnae: { ...pinnae, length: scaledCurve(pinnae.length, scale) } },
				},
			};
	}
	const leaf =
		growth.model === 'rosette' && record.foliage.kind === 'thick' ? record.foliage.leaf : undefined;
	if (scale !== undefined && leaf) {
		const sized: Spread =
			typeof leaf.length === 'number'
				? leaf.length * scale
				: { mean: leaf.length.mean * scale, spread: leaf.length.spread * scale };
		out = { ...out, foliage: { kind: 'thick', leaf: { ...leaf, length: sized } } };
	}
	if (leaves === undefined || growth.model !== 'rosette') return out;
	return { ...out, growth: { ...growth, leaves } };
}

/** Checks a growth's shares, with an error that says what each may be. */
function checkGrowOptions(options: GrowOptions): void {
	const { sections, cards, sparse } = options;
	if (sections !== undefined && !(sections >= 0 && sections <= 1))
		throw new Error(`sections is ${sections}; a section sparsity lies from 0 to 1`);
	if (cards !== undefined && !(cards >= 0.05 && cards <= 1))
		throw new Error(`cards is ${cards}; a share of the card rows lies from 0.05 to 1`);
	if (sparse !== undefined && !(sparse >= 0 && sparse <= 1))
		throw new Error(`sparse is ${sparse}; a sparseness lies from 0 to 1`);
	const max = options.maxTriangles;
	if (max !== undefined && !(Number.isFinite(max) && max > 0))
		throw new Error(`maxTriangles is ${max}; a maximum is a positive number of triangles`);
}

/**
 * The triangle maximum a growth takes: the one its options give, or none for a stand-in species and
 * for a cut piece, which grow as they are.
 *
 * @param kit The species' kit.
 * @param options The growth's options.
 * @returns The maximum, or undefined for none.
 */
function maxOf(kit: SpeciesKitData, options: GrowOptions): number | undefined {
	if (options.cutting || kit.placeholders === true) return undefined;
	return options.maxTriangles;
}

/**
 * The sparseness a growth takes: the one its options give, or none for a stand-in species and for a
 * cut piece, which grow as they are.
 *
 * @param kit The species' kit.
 * @param options The growth's options.
 * @returns The sparseness, from 0 to 1.
 */
function sparseLevel(kit: SpeciesKitData, options: GrowOptions): number {
	if (options.cutting || kit.placeholders === true) return 0;
	return Math.min(1, Math.max(0, options.sparse ?? 0));
}

/**
 * The kinds of device a page tells apart: the engine's own class, named here so the orchestrator
 * holds no engine import and a job worker runs it alike.
 *
 * @category api/vegetation
 */
export type DeviceClass = 'phone' | 'tablet' | 'desktop';

/**
 * The sparseness a device class asks for: a phone or a tablet grows the sparsest form of each
 * species, and a desktop grows the plant as grown at every preset. A page reads its class from the
 * engine's chooser and passes this level beside the record.
 *
 * @param kind The device class the engine chose.
 * @returns The level for `GrowOptions.sparse`.
 * @category api/vegetation
 */
export function sparseForDevice(kind: DeviceClass): number {
	return kind === 'desktop' ? 0 : 1;
}

/**
 * A plant as grown, at its full density: what every sparseness of one variant is cut from. Its
 * arrays are never written after it is made, so each growth that reads it takes copies.
 */
interface GrownPlant {
	/** What the dressing stages read: the record at the plant's own scale, the kit and the skeleton as grown. */
	readonly input: DressInput;
	/** The shoot rows as grown, before the crown lights them, each naming its axis as its record. */
	readonly rows: ShootRows;
	/** The mesh tier. */
	readonly detail: Detail;
	/** The order its foliage goes in as it thins, found when a sparseness first asks for it. */
	order?: SparseOrder;
}

/** The plants as grown that this thread keeps, by key, the one read last at the end. */
const GROWN = new Map<string, GrownPlant>();

/** The most plants as grown that a thread keeps: a page changes the sparseness of a few at a time. */
const GROWN_KEPT = 8;

/** The plants this thread has grown from a seed. */
let grownFromSeed = 0;

/**
 * How many plants this thread has grown from a seed. A change of sparseness cuts the plant that is
 * kept as grown and so leaves the count where it was, while the thread still keeps that plant.
 *
 * @returns The count.
 */
export function plantsGrown(): number {
	return grownFromSeed;
}

/** Forgets every plant this thread keeps as grown, so the next growth starts from its seed. */
export function forgetGrownPlants(): void {
	GROWN.clear();
}

/**
 * The plant as grown for a kit and a growth's options: kept from the growth before, or grown now.
 * Its key holds everything that moves the grown plant and leaves out the sparseness, which only
 * cuts it.
 */
function grownPlant(kit: SpeciesKitData, options: GrowOptions): GrownPlant {
	const stand = kit.placeholders === 'missing' ? ':missing' : kit.placeholders ? ':stand-ins' : '';
	const key = `${variantKey(kit, { ...options, sparse: 0, maxTriangles: undefined })}${stand}`;
	const kept = GROWN.get(key);
	if (kept) {
		GROWN.delete(key);
		GROWN.set(key, kept);
		return kept;
	}
	const grown = growFull(kit, options);
	GROWN.set(key, grown);
	if (GROWN.size > GROWN_KEPT) GROWN.delete(GROWN.keys().next().value as string);
	return grown;
}

/** Grows a plant from its seed at its full density: the skeleton, its height and its shoot rows. */
function growFull(kit: SpeciesKitData, options: GrowOptions): GrownPlant {
	grownFromSeed++;
	const record = cuttingLeaves(kit.record, options.cutting);
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
		() => {
			const skeleton = grower(record.growth.model).grow(growInput);
			// A self-organizing plant's wood runs on into the larger limb where its leader collapsed.
			return record.growth.model === 'self-organizing' ? leadOnThickest(skeleton) : skeleton;
		},
		() => placeholderSkeleton(growInput),
	);
	speciesHooks(record.id)?.afterGrow?.(grown, record, growInput.seed);
	// The record's height means the drawn plant's top: the grown skeleton and the shoot placement are
	// scaled together before the light, so the drawn crown aims at the sampled target. A cut piece
	// keeps its own size. An instanced plant draws its cards, and a merged plant its foliage mesh;
	// both are scaled through the skeleton, and each is measured at its own drawn level.
	const merged = record.lod.nearFoliage === 'merged';
	// A directed crown lays its trunk and its fronds at the variant's drawn height itself: a palm
	// grows taller by its trunk, and a scale of the skeleton alone would leave the pieces at its
	// sockets their own size.
	const target =
		!options.cutting &&
		placeholders !== true &&
		record.growth.model !== 'frond-crown' &&
		(merged
			? grower(record.growth.model).foliage !== undefined
			: record.lod.nearFoliage === 'instanced' && kit.prototypes.length > 0)
			? targetHeight(record, options.seed, options.variant)
			: 0;
	let calibrated = grown;
	let calibratedRecord = record;
	if (target > 0) {
		// A merged plant's foliage rises from the skeleton itself, so no kit reach is added.
		const aim = grown.height + (merged ? 0 : crownReach(kit, record));
		if (aim > 0) {
			const factor = target / aim;
			calibrated = scaledSkeleton(grown, factor);
			calibratedRecord = scaledPlacement(record, factor);
		}
	}
	const calibratedInput: GrowInput = { ...growInput, record: calibratedRecord };
	// The crown's light as grown, which a sky prune reads at every coarseness the search tries and
	// at the one it settles on, so it is found once. A cut piece lights its own rows.
	const light =
		placeholders ||
		cutsSkeleton(kit, options.cutting) ||
		record.lod.nearFoliage !== 'instanced' ||
		kit.prototypes.length === 0
			? undefined
			: pruneLight({ ...calibratedInput, kit, skeleton: calibrated });
	const lit = light ? { pruneLight: light } : {};
	// A stand-in grows as it is at any coarseness. A real species that falls back to a stand-in for a
	// stage it does not build is still a real plant, so it takes the coarseness it is asked for.
	const coarseness =
		placeholders === true
			? 0
			: coarsenessFor(kit, { ...calibratedInput, skeleton: calibrated, ...lit }, detail, options);
	const dressInput: DressInput = {
		...calibratedInput,
		kit,
		// The coarseness dial changes how smoothly the wood is meshed, never what the plant grows.
		skeleton: cutSkeleton(kit, calibrated, options.cutting),
		coarseness,
		cutting: options.cutting,
		sections: options.sections,
		cards: options.cards,
		cardJoin: options.cardJoin,
		...lit,
	};
	// The shoots stand on the skeleton, which loses the bare twigs the record trims once they stand.
	const dressed =
		record.lod.nearFoliage === 'instanced' && kit.prototypes.length > 0
			? stage(
					placeholders,
					// A record with shoots dresses its buds, and a plant of pieces stands one at each
					// socket.
					() =>
						record.shoots || carriesPieces(record)
							? dressShoots(dressInput)
							: { rows: emptyRows(), skeleton: dressInput.skeleton },
					() => ({ rows: placeholderRows(dressInput), skeleton: dressInput.skeleton }),
				)
			: { rows: emptyRows(), skeleton: dressInput.skeleton };
	let rows = dressed.rows;
	let skeleton = dressed.skeleton;
	// The reach is an estimate from the kit, so the drawn top is measured once the shoots stand. A
	// residual over the accepted share is taken out by one scale of the already-placed geometry: a
	// matrix scale, not a second growth.
	if (target > 0) {
		const top = merged
			? mergedTop(
					{
						...dressInput,
						skeleton,
						rows,
						crown: placeholderCrown({ ...dressInput, skeleton }),
						detail,
					},
					1,
				)
			: rows.count > 0
				? Math.max(skeleton.height, cardTop(kit, rows))
				: 0;
		if (top > 0 && Math.abs(top - target) / target > HEIGHT_RESIDUAL) {
			const corrective = target / top;
			skeleton = scaledSkeleton(skeleton, corrective);
			rows = scaledRows(rows, corrective);
		}
	}
	return { input: { ...dressInput, skeleton }, rows, detail };
}

/** A copy of shoot rows, which a growth may light and renumber without touching the rows it read. */
function rowsCopy(rows: ShootRows): ShootRows {
	return {
		...rows,
		prototype: rows.prototype.slice(),
		position: rows.position.slice(),
		rotation: rows.rotation.slice(),
		scale: rows.scale.slice(),
		record: rows.record.slice(),
		phase: rows.phase.slice(),
		sky: rows.sky.slice(),
		bent: rows.bent.slice(),
		order: rows.order.slice(),
		...(rows.back ? { back: rows.back.slice() } : {}),
		...(rows.node ? { node: rows.node.slice() } : {}),
	};
}

/** A dressed variant and what a level's parts and a triangle maximum read beside it. */
interface Dressed {
	/** The dressed variant the meshing stages read. */
	readonly mesh: MeshInput;
	/** What a level is built from: the variant, its wood's parts and the walk of its shoot rows. */
	readonly budget: (wood: boolean) => BudgetInput;
}

/** The order a grown plant's foliage goes in, found once and kept beside the plant. */
function orderOf(kit: SpeciesKitData, grown: GrownPlant): SparseOrder {
	if (!grown.order) {
		// The row that holds the drawn top stays, so every sparseness keeps the plant's height.
		const top = topRow(kit, grown.rows);
		grown.order = sparseOrder(
			grown.input.skeleton,
			grown.rows,
			kit.record.sparse?.limbs ?? GREAT_LIMB_SHARE,
			top >= 0 ? [top] : [],
		);
	}
	return grown.order;
}

/**
 * The dressed variant the meshing stages read: the plant as grown, or the same plant with the share
 * of its foliage that the sparseness asks for removed, and its crown lit as it then stands. Every
 * array is the growth's own, since the crown's light and the wind records write them in place and
 * a job worker moves them to the page.
 */
function dressed(kit: SpeciesKitData, options: GrowOptions): Dressed {
	const grown = grownPlant(kit, options);
	const sparse = sparseLevel(kit, options);
	// Rows that name no node stand on no skeleton, so no wood can follow them out.
	const thins = grown.rows.count === 0 || grown.rows.node !== undefined;
	const full = { skeleton: grown.input.skeleton, rows: grown.rows };
	let thinned: ReturnType<typeof sparsePlant>;
	if (thins && sparse > 0) {
		const order = orderOf(kit, grown);
		const floor = kit.record.sparse?.foliage ?? FOLIAGE_FLOOR;
		thinned = sparsePlant(full.skeleton, full.rows, order, sparseKeep(order, sparse, floor));
	}
	const input: DressInput = thinned
		? { ...grown.input, skeleton: thinned.skeleton, grown: full }
		: { ...grown.input, skeleton: skeletonCopy(full.skeleton) };
	const rows = rowsCopy(thinned ? thinned.rows : grown.rows);
	const crown = stage(
		kit.placeholders,
		() => lightCrown(input, rows),
		() => placeholderCrown(input),
	);
	const mesh: MeshInput = { ...input, rows, crown, detail: grown.detail };
	const limbs = kit.record.sparse?.limbs ?? GREAT_LIMB_SHARE;
	/** What a level of a plant is built from, for the plant as dressed or with fewer carriers. */
	const budgetOf = (of: MeshInput, wood: boolean): BudgetInput => {
		const order = thins && kit.placeholders !== true ? orderOf(kit, grown) : undefined;
		let walk: Uint32Array | undefined;
		if (order?.byRows) {
			// The rows this plant holds, in the order the walk of the grown plant meets them.
			const held = new Int32Array(full.rows.count).fill(-1);
			for (let r = 0; r < of.rows.count; r++) held[of.rows.id?.[r] ?? r] = r;
			const kept: number[] = [];
			for (const row of order.list) if ((held[row] as number) >= 0) kept.push(held[row] as number);
			walk = Uint32Array.from(kept);
		}
		let carriers = 0;
		if (order && !order.byRows) {
			const origin = of.skeleton.axes.origin;
			for (let a = 0; a < of.skeleton.axes.count; a++)
				if ((order.place[origin?.[a] ?? a] as number) < order.carriers) carriers++;
		}
		return {
			mesh: of,
			parts: woodParts(of.skeleton, limbs),
			wood,
			...(walk ? { walk } : {}),
			...(order && !order.byRows
				? {
						carriers,
						thin: (keep: number) => {
							const fewer = sparsePlant(full.skeleton, full.rows, order, keep, 1);
							if (!fewer) return undefined;
							// The wood that stays keeps the wind records the variant's table gives it.
							const records = new Uint16Array(full.skeleton.axes.count);
							const from = mesh.skeleton.axes;
							for (let a = 0; a < from.count; a++)
								records[from.origin?.[a] ?? a] = from.record[a] as number;
							const axes = fewer.skeleton.axes;
							const record = axes.record.map((_, a) => records[axes.origin?.[a] ?? a] as number);
							const skeleton = { ...fewer.skeleton, axes: { ...axes, record } };
							return budgetOf({ ...of, skeleton, grown: full }, wood);
						},
					}
				: {}),
		};
	};
	return { mesh, budget: (wood) => budgetOf(mesh, wood) };
}

/** The dressed variant alone, for the stages that read no more. */
function dress(kit: SpeciesKitData, options: GrowOptions): MeshInput {
	return dressed(kit, options).mesh;
}

/**
 * The drawn top of a merged plant's first card level: its foliage mesh, its extras and its wood, in
 * metres. The mesh colours read a crown light, which moves no vertex, so a stand-in light serves the
 * measure before the real one is found.
 */
function mergedTop(input: MeshInput, level: MeshLevel): number {
	let top = input.skeleton.height;
	const build = grower(input.record.growth.model).foliage;
	for (const mesh of [build?.(input, level), extrasMesh(input, level)]) {
		if (!mesh) continue;
		const positions = mesh.positions;
		for (let i = 1; i < positions.length; i += 3)
			if ((positions[i] as number) > top) top = positions[i] as number;
	}
	return top;
}

/** Whether a cutting is cut from the grown skeleton rather than built from the kit alone. */
function cutsSkeleton(kit: SpeciesKitData, cutting: CuttingOptions | undefined): boolean {
	if (!cutting || cutting.part === 'leaf') return false;
	// A plant of pieces at sockets has no shoot to stand alone: its cluster is a shoot of its frame
	// with the pieces that stand on it.
	if (!kit.record.shoots) return true;
	return !cutsShoot(kit.record, cutting.part) || kit.prototypes.length === 0;
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
 * skeleton and dressed and meshed at the nearest level with its shoot rows, a leaf cluster as one
 * shoot row of the kit's prototype, or a leaf from the kit alone. A stand-in kit merges the rows
 * into one foliage part instead. The piece has no card levels and no impostor.
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
	// A real kit's piece keeps its shoots as rows, which draw as the whole plant's do, stems and
	// buds included; a stand-in kit, whose placement draws no rows, merges them into its foliage.
	const merge = kit.placeholders === true;
	let rows: ShootRows = emptyRows();
	let single: ReturnType<typeof clusterRow> | undefined;
	let coarseness = 0;
	if (cutsSkeleton(kit, cutting)) {
		const mesh = dress(kit, options);
		coarseness = mesh.coarseness ?? 0;
		wind = stage(
			kit.placeholders,
			() => windRecords(mesh),
			() => placeholderWind(mesh),
		);
		parts = [...nearWood(mesh), ...levelParts(mesh, 0)];
		if (merge)
			parts.push(
				...partOf(kit, 'foliage', mergeShoots(kit, mesh.rows, detail, wind.base), TEXTURE_UV_STEPS),
			);
		else rows = mesh.rows;
		skeleton = mesh.skeleton;
	} else {
		single =
			cutting.part !== 'leaf' && !merge
				? clusterRow(kit, cutting, detail, inLeaf(record, season, 1, 1))
				: undefined;
		const foliage = single ? undefined : cutFoliage(kit, cutting, detail);
		parts = foliage ? partOf(kit, 'foliage', foliage, TEXTURE_UV_STEPS) : [];
		const builder = new SkeletonBuilder().finish(0);
		const bounds = single?.bounds ?? (foliage ? meshBounds(foliage) : builder.bounds);
		skeleton = { ...builder, bounds, height: bounds.max[1] };
		wind = { base: options.variant * VARIANT_RECORDS, count: 0, records: new Float32Array(0) };
	}
	if (single) rows = single.rows;
	else if (rows.count > 0) {
		const bounds = rowBounds(kit, rows, skeleton.bounds);
		skeleton = { ...skeleton, bounds, height: Math.max(skeleton.height, bounds.max[1]) };
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
		shoots: rows,
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
			parts: [
				countedParts(parts, shootPartTriangles({ kit }, rows, detail)),
				NO_TRIANGLES,
				NO_TRIANGLES,
			],
			shoots: shootTriangles(kit, rows),
		},
	};
}

/**
 * The bounds that hold a piece's shoots as well as its wood: every vertex of each row's prototype at
 * the kit's tier, turned, scaled and placed as the row places it.
 */
function rowBounds(
	kit: SpeciesKitData,
	rows: ShootRows,
	start: MacroSkeleton['bounds'],
): MacroSkeleton['bounds'] {
	const min = [...start.min];
	const max = [...start.max];
	const tier = DETAILS.indexOf(kit.detail);
	const p: [number, number, number] = [0, 0, 0];
	for (let r = 0; r < rows.count; r++) {
		const positions = kit.prototypes[rows.prototype[r] as number]?.tiers[tier]?.positions;
		if (!positions) continue;
		const scale = rows.scale[r] as number;
		for (let i = 0; i < positions.length; i += 3) {
			p[0] = (positions[i] as number) * scale;
			p[1] = (positions[i + 1] as number) * scale;
			p[2] = (positions[i + 2] as number) * scale;
			quatRotate(rows.rotation, r * 4, p, p);
			for (let k = 0; k < 3; k++) {
				const at = (p[k] as number) + (rows.position[r * 3 + k] as number);
				min[k] = Math.min(min[k] as number, at);
				max[k] = Math.max(max[k] as number, at);
			}
		}
	}
	return {
		min: [min[0] as number, min[1] as number, min[2] as number],
		max: [max[0] as number, max[1] as number, max[2] as number],
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
	} else {
		if (level > 0) {
			const cardLevel = level as 1 | 2;
			const cards = stage(
				placeholders,
				() => cardMesh(mesh, cardLevel),
				() => placeholderCardMesh(mesh, cardLevel),
			);
			parts.push(...partOf(kit, 'cards', cards, TEXTURE_UV_STEPS));
		}
		// A plant whose pieces stand at sockets may draw a part of its own beside them, such as
		// what lies in the soil under a stool.
		const own =
			!record.shoots && placeholders !== true ? grower(record.growth.model).foliage : undefined;
		if (own) parts.push(...partOf(kit, 'foliage', own(mesh, level), TEXTURE_UV_STEPS));
	}
	const extras = stage(
		placeholders,
		() => extrasMesh(mesh, level),
		() => undefined,
	);
	// Fruit and cones are a few centimetres across, where the box's steps are near a millimetre.
	parts.push(...partOf(kit, 'extras', extras, TEXTURE_UV_STEPS, true));
	return parts;
}

/** One level's quantised parts, each part's triangles, and what a maximum allowed each. */
interface BuiltLevel {
	readonly parts: PlantPart[];
	readonly triangles: PartTriangles;
	readonly allowed?: PartTriangles;
	readonly shoots?: LevelBuild['shoots'];
	readonly clusters: ClusterCount;
}

/** The parts' triangles of a level whose wood no mesher split: its wood counts as its trunk. */
function countedParts(
	parts: readonly PlantPart[],
	shoots: readonly [leaves: number, twigs: number],
): PartTriangles {
	const of = (name: PlantPart['name']) => {
		let triangles = 0;
		for (const part of parts) if (part.name === name) triangles += part.arrays.indices.length / 3;
		return triangles;
	};
	return {
		...NO_TRIANGLES,
		trunk: of('wood'),
		twigs: shoots[1],
		leaves: shoots[0] + of('cards') + of('foliage'),
		extras: of('extras'),
	};
}

/**
 * The three levels of a variant: each as its best look draws it, or within the triangle maximum the
 * growth names. A stand-in kit, and a species whose stage is not built yet, draw each level's
 * stand-in stages and count their wood as one part.
 */
function builtLevels(
	kit: SpeciesKitData,
	plant: Dressed,
	options: GrowOptions,
): readonly [BuiltLevel, BuiltLevel, BuiltLevel] {
	const { mesh } = plant;
	const most = maxOf(kit, options);
	const input = plant.budget(options.near === true);
	const reference = most === undefined ? undefined : referenceOf(kit, input);
	const level = (at: MeshLevel): BuiltLevel => {
		const standIn = (): BuiltLevel => {
			const parts = [...(at === 0 && options.near ? nearWood(mesh) : []), ...levelParts(mesh, at)];
			const rows = at === 0 && mesh.record.lod.nearFoliage === 'instanced';
			const shoots = rows ? shootPartTriangles(mesh, mesh.rows, mesh.detail) : ([0, 0] as const);
			return { parts, triangles: countedParts(parts, shoots), clusters: NO_CLUSTERS };
		};
		const real = (): BuiltLevel => {
			const build =
				most === undefined || !reference
					? levelBuild(input, at)
					: levelWithin(input, at, most, reference);
			return {
				parts: [
					...partOf(kit, 'wood', build.wood, WOOD_UV_STEPS),
					...partOf(kit, 'foliage', build.foliage, TEXTURE_UV_STEPS),
					...partOf(kit, 'cards', build.cards, TEXTURE_UV_STEPS),
					// Fruit and cones are a few centimetres across, where the box's steps are near a millimetre.
					...partOf(kit, 'extras', build.extras, TEXTURE_UV_STEPS, true),
				],
				triangles: build.triangles,
				...(build.allowed ? { allowed: build.allowed } : {}),
				...(build.shoots !== undefined ? { shoots: build.shoots } : {}),
				clusters: build.clusters ?? NO_CLUSTERS,
			};
		};
		return stage(kit.placeholders, real, standIn);
	};
	return [level(0), level(1), level(2)];
}

/** What each part holds at a plant's best look, or undefined where a stage of it is not built. */
function referenceOf(kit: SpeciesKitData, input: BudgetInput): PartTriangles | undefined {
	return stage(
		kit.placeholders,
		() => referenceTriangles(input),
		() => undefined,
	);
}

/** A clock for the stats, which no byte of the asset reads. */
const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

/**
 * The triangles a variant's shoot rows draw at the kit's detail: each row draws one prototype of
 * the kit, which no level's own mesh holds.
 */
function shootTriangles(kit: SpeciesKitData, rows: PlantAsset['shoots']): number {
	const tier = DETAILS.indexOf(kit.detail);
	let triangles = 0;
	for (let r = 0; r < rows.count; r++)
		triangles +=
			(kit.prototypes[rows.prototype[r] as number]?.tiers[tier]?.indices.length ?? 0) / 3;
	return triangles;
}

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
	checkGrowOptions(options);
	if (options.cutting) return growCutting(kit, options, options.cutting);
	const started = now();
	const record = kit.record;
	const plant = dressed(kit, options);
	const mesh = plant.mesh;
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
	const built = builtLevels(kit, plant, options);
	const levels = [
		levelOf(0, built[0].parts, 0),
		levelOf(1, built[1].parts, starts[0]),
		levelOf(2, built[2].parts, starts[1]),
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
	const most = maxOf(kit, options);
	const shoots = built[0].shoots;
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
		...(most !== undefined ? { maxTriangles: most } : {}),
		...(shoots !== undefined && shoots !== mesh.detail ? { shootDetail: shoots } : {}),
		stats: {
			milliseconds: now() - started,
			bytes,
			triangles: [levels[0].triangles, levels[1].triangles, levels[2].triangles],
			parts: [built[0].triangles, built[1].triangles, built[2].triangles],
			...(built[0].allowed && built[1].allowed && built[2].allowed
				? {
						allowed: [built[0].allowed, built[1].allowed, built[2].allowed] as const,
						clusters: [built[0].clusters, built[1].clusters, built[2].clusters] as const,
					}
				: {}),
			shoots: record.lod.nearFoliage === 'instanced' ? shootTriangles(kit, mesh.rows) : 0,
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
	checkGrowOptions(options);
	const plant = dressed(kit, options);
	const most = maxOf(kit, options);
	if (most === undefined) return nearWood(plant.mesh);
	// Under a maximum the nearest wood is the wood its level's shares leave it.
	const input = plant.budget(true);
	const level = levelWithin(input, 0, most, referenceTriangles(input));
	return partOf(kit, 'wood', level.wood, WOOD_UV_STEPS);
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
