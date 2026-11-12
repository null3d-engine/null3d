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
	MeshArrays,
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
import { type MacroSkeleton, SkeletonBuilder } from './core/graph';
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
} from './grow/height';
import { leadOnThickest } from './grow/leaders';
import { grower, loadGrower } from './grow/models';
import { extrasMesh } from './leaf/extras';
import { dressShoots, pruneLight } from './leaf/instancer';
import { foliage, loadFoliage } from './leaf/kinds';
import { inLeaf } from './leaf/season';
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
	 * classes the crown alone uses.
	 */
	readonly cutting?: boolean;
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
	 * The leaf area on the wood against the record's own, from 0.4 to 2: 1 grows the record's
	 * leaves, a share below 1 draws smaller leaves on the same twigs, above 1 larger ones. Every
	 * species answers it the same way, since every record places its shoots at a scale its leaves
	 * follow.
	 */
	readonly leaves?: number;
	/**
	 * The wood itself against the record's own, from 0.4 to 2: 1 grows the record's crown, below 1
	 * keeps fewer shoots along the wood, fewer of its finest twigs and a sparser division of its
	 * branches, and above 1 keeps the shoots the record's own density drops. Every growth model
	 * answers its own count of limbs, so one option sets the wood of any species.
	 */
	readonly limbs?: number;
	/**
	 * How far toward its sparse form the plant grows, from 0 to 1: 0 is the record's own, and 1 the
	 * sparsest the species allows, with the record's `sparse` floors holding the limbs, the leaves
	 * and the coarseness at what still reads as its species. A record with no floors grows its own
	 * form whatever the level asks. A page sets it by the device class, so a phone or a tablet
	 * grows the light form and a desktop the full one.
	 */
	readonly sparse?: number;
	/**
	 * How far the wood's own sections are thinned, from 0 to 1: 0 is the level's own rings and
	 * sides, and 1 the fewest that still draws a closed run, with square ends and no rounded joins.
	 * A page rarely sets it; a sparse level raises it to the species' floor, if the record names
	 * one. Every growth model answers it the same way, since one wood mesher builds them all.
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

/** The least and the most share of leaves or limbs a growth may ask for. */
export const LEAVES_LEAST = 0.4;
export const LEAVES_MOST = 2;
export const LIMBS_LEAST = 0.4;
export const LIMBS_MOST = 2;
/**
 * The least share a sparse form may reach, below the shares a page passes on its own.
 *
 * @category api/vegetation
 */
export const SPARSE_LEAST = 0.05;

/**
 * The coarseness every species reaches at the full sparse level, whatever its record asks for. The
 * coarseness decides how finely each limb is meshed, so it moves the triangle count down without
 * changing what the plant grows: the twigs, the shoot rows and the leaves stay.
 *
 * @category api/vegetation
 */
export const SPARSE_COARSENESS = 0.85;

/**
 * The record a plant grows by when its leaf area is set against the record's own. A shoot carries
 * its leaves at its own scale, so the share is taken on the leaf's area and the scale moves by its
 * square root, and the wood the leaves stand on does not move at all. Every species moves the same
 * way, so one option sets the leaves of any of them.
 *
 * @param record The species record.
 * @param leaves The leaf-area share, 1 for the record's own; undefined or 1 leaves the record alone.
 * @returns The record to grow by.
 * @category api/vegetation
 */
export function withLeaves(
	record: Species,
	leaves: number | undefined,
	least: number = LEAVES_LEAST,
): Species {
	if (leaves === undefined || leaves === 1) return record;
	checkShare('leaves', leaves, least, LEAVES_MOST);
	const shoots = record.shoots;
	if (!shoots) return record;
	const grow = Math.sqrt(leaves);
	const scale = shoots.placement.scale;
	const scaled: Spread =
		typeof scale === 'number'
			? scale * grow
			: { mean: scale.mean * grow, spread: scale.spread * grow };
	const placement = shoots.placement;
	const density = placement.density;
	// A smaller shoot fits more often along the wood, so the shoot count would rise as the leaves
	// shrink. The count moves with the scale the other way, so it is taken back out and the plant
	// keeps the same wood, the same number of shoots and leaves of a new size.
	return {
		...record,
		shoots: {
			...shoots,
			placement: {
				...placement,
				scale: scaled,
				perMetre: scaledCurve(placement.perMetre, grow),
				...(density !== undefined ? { density: density * grow } : {}),
			},
		},
	};
}

/**
 * The record a plant grows by when its wood is set against the record's own. Each growth model
 * keeps its own count of limbs, and the share moves that count: the branches a self-organizing
 * plant puts out, the finest order of an architectural plant, a rosette's fronds or a tuft's
 * tillers, a culm's culms or a column's arms. A record that carries shoots also thins the shoots
 * along its finest axes, and keeps its lit rim by raising the shade line it prunes under.
 *
 * @param record The species record.
 * @param limbs The limb share, 1 for the record's own; undefined or 1 leaves the record alone.
 * @returns The record to grow by.
 * @category api/vegetation
 */
export function withLimbs(
	record: Species,
	limbs: number | undefined,
	least: number = LIMBS_LEAST,
): Species {
	if (limbs === undefined || limbs === 1) return record;
	checkShare('limbs', limbs, least, LIMBS_MOST);
	const thin = Math.min(1, limbs);
	const growth = thinnedGrowth(record.growth, thin);
	const shoots = record.shoots;
	if (!shoots) return { ...record, growth };
	const placement = shoots.placement;
	const own = placement.skyPrune;
	// A share above the record's own keeps the shoots its shade line drops; below it the shoots
	// along the finest axes thin, and the line rises so the crown keeps its lit rim.
	const line = own === undefined ? undefined : Math.min(0.95, Math.max(0, own / limbs));
	const density = placement.density;
	return {
		...record,
		growth,
		shoots: {
			...shoots,
			placement: {
				...placement,
				...(line !== undefined ? { skyPrune: line } : {}),
				perMetre: thin < 1 ? scaledCurve(placement.perMetre, thin) : placement.perMetre,
				...(density !== undefined ? { density: density * thin } : {}),
			},
		},
	};
}

/** The share's range, or an error that says what it may be. */
function checkShare(name: string, share: number, least: number, most: number): void {
	if (share >= least && share <= most) return;
	throw new Error(
		`@null3d/vegetation: ${name} ${share} is outside ${least} to ${most}; 1 grows the record's own.`,
	);
}

/** A growth spec with a share of its model's own limbs removed: the wood a sparse plant keeps. */
function thinnedGrowth(growth: Species['growth'], thin: number): Species['growth'] {
	switch (growth.model) {
		// The branching multiplier is 1 where a record does not give one, so a share moves it
		// whatever the record says: this is the dial that decides how many limbs a crown puts out.
		case 'self-organizing':
			return { ...growth, branching: (growth.branching ?? 1) * thin };
		// A conifer's limbs are its boughs, so the share moves the boughs at the leader and leaves
		// the orders below them their own division.
		case 'architectural':
			return {
				...growth,
				tiers: {
					...growth.tiers,
					perWhorl: scaledSpread(growth.tiers.perWhorl, thin),
					between: growth.tiers.between * thin,
				},
			};
		case 'crown-rosette':
			return {
				...growth,
				crown: { ...growth.crown, fronds: scaledSpread(growth.crown.fronds, thin) },
			};
		case 'culm':
			return { ...growth, culms: scaledSpread(growth.culms, thin) };
		case 'rosette':
			return { ...growth, shoots: scaledSpread(growth.shoots, thin) };
		case 'frond-colony':
			return { ...growth, fronds: scaledSpread(growth.fronds, thin) };
		case 'tuft':
			return { ...growth, shoots: scaledSpread(growth.shoots, thin) };
		case 'column':
			return { ...growth, arms: { ...growth.arms, count: scaledSpread(growth.arms.count, thin) } };
	}
}

/** A count's spread with its mean scaled, never below one whole limb. */
function scaledSpread(spread: Spread, factor: number): Spread {
	if (typeof spread === 'number') return Math.max(1, spread * factor);
	return { mean: Math.max(1, spread.mean * factor), spread: spread.spread * factor };
}

/** A curve with every value multiplied by a factor. */
function scaledCurve(curve: Curve, factor: number): Curve {
	return typeof curve === 'number'
		? curve * factor
		: curve.map(([at, value]) => [at, value * factor] as [number, number]);
}

/**
 * The record a cutting kit grows by: the species' own, with the shoots a close piece carries over
 * the crown's. A piece is drawn at the nearest level alone, so its kit pays for no cards, and a
 * covering denser than the crown can afford costs the piece's own kit rather than the crown's.
 */
function cuttingRecord(record: Species): Species {
	const share = record.cuttings?.density;
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
	cutting = false,
): string {
	return hashText(
		`${GENERATOR_VERSION}|${JSON.stringify(record)}|${JSON.stringify(manifest)}|${detail}${cutting ? ':cutting' : ''}`,
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
	// A share of leaves or limbs grows a different plant, so it keys a different asset. Section
	// sparsity meshes the same plant coarser, which is a different asset too.
	const leaves =
		options.leaves === undefined || options.leaves === 1 ? '' : `:leaves=${options.leaves}`;
	const limbs = options.limbs === undefined || options.limbs === 1 ? '' : `:limbs=${options.limbs}`;
	const sections =
		options.sections === undefined || options.sections === 0 ? '' : `:sections=${options.sections}`;
	const cards = options.cards === undefined || options.cards === 1 ? '' : `:cards=${options.cards}`;
	const join =
		options.cardJoin === undefined || options.cardJoin === 'remove'
			? ''
			: `:join=${options.cardJoin}`;
	return `${kit.key}:${options.seed >>> 0}:${options.variant}:${season}:${options.detail ?? kit.detail}:${cutting}${coarsenessKey(kit, options)}${leaves}${limbs}${sections}${cards}${join}`;
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
	const cutting = options.cutting === true;
	const record = cutting ? cuttingRecord(base) : base;
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
			() => shootPrototypes(record, manifest, leavesByTier, cutting),
			() => placeholderPrototypes(record, leavesByTier),
		);
		// A cutting kit holds no card levels: its pieces are drawn at the nearest level alone.
		const baked = cutting
			? { atlas: cards, cells: uncarded.map(() => ({ planes: [] })) }
			: stage(
					placeholders,
					() => bakeCards(record, manifest, detail, uncarded),
					() => placeholderCardBake(record, uncarded),
				);
		// The kit keeps its own tier's meshes and the tiers below it, which the near band draws
		// farther out; a page draws at one preset, so the tiers above it are left empty. The card
		// bake, the lengths and the radii read the full build first.
		const kept = DETAILS.indexOf(detail);
		prototypes = uncarded.map((prototype, index) => {
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
	const growth = record.growth;
	if (!cutting || record.shoots || growth.model !== 'rosette') return record;
	const leaves = record.cuttings?.leaves;
	const hint = record.cuttings?.[cutting.part as 'branch' | 'subbranch'];
	const scale = hint && 'order' in hint ? hint.scale : undefined;
	const leaf = record.foliage.kind === 'thick' ? record.foliage.leaf : undefined;
	let out = record;
	if (scale !== undefined && leaf) {
		const sized: Spread =
			typeof leaf.length === 'number'
				? leaf.length * scale
				: { mean: leaf.length.mean * scale, spread: leaf.length.spread * scale };
		out = { ...record, foliage: { kind: 'thick', leaf: { ...leaf, length: sized } } };
	}
	if (leaves === undefined) return out;
	return { ...out, growth: { ...growth, leaves } };
}

/**
 * The grow options a sparse level asks for: the leaves, limbs, coarseness and section sparsity
 * moved toward the record's floors by the level, from 0, the record's own form, to 1, the sparsest
 * the species allows. A record with no floors, or a level of 0, leaves the options as they stand.
 * The level is kept in the options so the shares it sets are taken at the sparse bound rather than
 * a page's own.
 *
 * @param record The species record.
 * @param options The options as the page gave them.
 * @returns The options to grow by.
 * @category api/vegetation
 */
export function withSparse<T extends GrowOptions>(record: Species, options: T): GrowOptions {
	if (options.sections !== undefined && !(options.sections >= 0 && options.sections <= 1))
		throw new Error(`sections is ${options.sections}; a section sparsity lies from 0 to 1`);
	if (options.cards !== undefined && !(options.cards >= 0.05 && options.cards <= 1))
		throw new Error(`cards is ${options.cards}; a share of the card rows lies from 0.05 to 1`);
	const floors = record.sparse;
	const asked = options.sparse;
	if (!floors || asked === undefined || asked <= 0) return options;
	if (asked > 1) throw new Error(`sparse is ${asked}; a sparse level lies from 0 to 1`);
	const level = asked;
	const at = (least: number) => Math.max(least, 1 - level * (1 - least));
	return {
		...options,
		leaves: at(floors.leaves),
		limbs: at(floors.limbs),
		coarseness: Math.max(
			options.coarseness ?? 0,
			level * Math.max(floors.coarseness, SPARSE_COARSENESS),
		),
		sections: Math.max(options.sections ?? 0, level * (floors.sections ?? 0)),
	};
}

/**
 * The kinds of device a page tells apart: the engine's own class, named here so the orchestrator
 * holds no engine import and a job worker runs it alike.
 *
 * @category api/vegetation
 */
export type DeviceClass = 'phone' | 'tablet' | 'desktop';

/**
 * The sparse level a device class asks for: a phone or a tablet grows the light form of a species
 * that records floors, and a desktop grows the record's own at every preset. A page reads its class
 * from the engine's chooser and passes this level beside the record.
 *
 * @param kind The device class the engine chose.
 * @returns The level for `GrowOptions.sparse`.
 * @category api/vegetation
 */
export function sparseForDevice(kind: DeviceClass): number {
	return kind === 'desktop' ? 0 : 1;
}

/** The grown skeleton and its dressing: the stages before the meshes. */
function dress(kit: SpeciesKitData, options: GrowOptions): MeshInput {
	// A sparse form's shares may sit below what a page may ask for on its own.
	const least = options.sparse !== undefined ? SPARSE_LEAST : LEAVES_LEAST;
	const record = cuttingLeaves(
		withLimbs(withLeaves(kit.record, options.leaves, least), options.limbs, least),
		options.cutting,
	);
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
	const target =
		!options.cutting &&
		placeholders !== true &&
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
					() => dressShoots(dressInput),
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
				? Math.max(skeleton.height, cardTop(kit, rows, record.lod.cardGrow ?? 1))
				: 0;
		if (top > 0 && Math.abs(top - target) / target > HEIGHT_RESIDUAL) {
			const corrective = target / top;
			skeleton = scaledSkeleton(skeleton, corrective);
			rows = scaledRows(rows, corrective);
		}
	}
	const input: DressInput = { ...dressInput, skeleton };
	const crown = stage(
		placeholders,
		() => lightCrown(input, rows),
		() => placeholderCrown(input),
	);
	return { ...input, rows, crown, detail };
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
	// Fruit and cones are a few centimetres across, where the box's steps are near a millimetre.
	parts.push(...partOf(kit, 'extras', extras, TEXTURE_UV_STEPS, true));
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
	options = withSparse(kit.record, options);
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
	return nearWood(dress(kit, withSparse(kit.record, options)));
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
