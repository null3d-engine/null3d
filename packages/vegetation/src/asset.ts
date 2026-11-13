// What the plant core makes: a species' kit, built once per page, and a variant's asset, grown per
// seed and variant. Both are plain data and typed arrays, so they cross from a job worker without a
// copy and compare byte for byte between devices. The shoot prototypes and their rows, the parts of
// each detail level, the wind table and the stats are here.

import type { SpeciesBox } from './core/box';
import type { MacroSkeleton } from './core/graph';
import { skeletonBuffers } from './core/graph';
import { hashBytes } from './core/hash';
import type { ShootClass, Species } from './core/record';
import type { TextureManifest } from './core/textures';
import type { Detail, Season, Vec3 } from './core/types';
import type { CuttingOptions } from './cutting';
import type { PieceAttitude } from './leaf/piece';

/**
 * One mesh before quantisation, in floats: what the meshers and the leaf builders write.
 *
 * @category api/vegetation
 */
export interface MeshArrays {
	/** 3 per vertex, in metres. */
	readonly positions: Float32Array;
	/** 3 per vertex, unit length. */
	readonly normals: Float32Array;
	/** 2 per vertex: wood in metres of bark, leaves and cards from 0 to 1 of the texture. */
	readonly uvs: Float32Array;
	/** 2 per vertex: what the part's material reads, such as a leaf's metres from its petiole tip. */
	readonly uvs1: Float32Array;
	/** 4 bytes per vertex: wind record high and low byte, then two bytes the part defines. */
	readonly colors: Uint8Array;
	/** 4 bytes per vertex: the packed offset from a blade's keel, its fourth byte 127 on a blade. */
	readonly tangents?: Int8Array;
	/** 3 per triangle. */
	readonly indices: Uint16Array | Uint32Array;
}

/**
 * One prototype's mesh at one detail tier. Floats: prototypes are few and shared per species.
 *
 * @category api/vegetation
 */
export interface PrototypeArrays {
	/** 3 per vertex, in metres of prototype space. */
	readonly positions: Float32Array;
	/** 3 per vertex. */
	readonly normals: Float32Array;
	/** Leaf-texture u and v, from 0 to 1 in the leaf frame. */
	readonly uvs: Float32Array;
	/** Per vertex: metres along and across the leaf from its petiole tip, which the flutter turns about. Zero on stems and buds. */
	readonly uvs1: Float32Array;
	/**
	 * Bytes per vertex: bend weight along the shoot (0 at its base), leaf flutter phase, surface kind
	 * (0 leaf, 1 stem or bud, 2 extra, in steps of 85) and self-occlusion inside the shoot.
	 */
	readonly colors: Uint8Array;
	/** 4 bytes per vertex: the packed offset from a blade's keel, its fourth byte 127 on a blade. */
	readonly tangents?: Int8Array;
	/** 3 per triangle. */
	readonly indices: Uint16Array;
}

/**
 * A shoot prototype: a small real shoot with its stem, buds and leaves, built once per species at
 * all four detail tiers from the same random choices.
 *
 * @category api/vegetation
 */
export interface ShootPrototype {
	/** Its index in the kit. */
	readonly index: number;
	/** The shoot class it belongs to, or `piece` for a part of a piece. */
	readonly class: ShootClass['name'] | 'piece';
	/**
	 * Set on a shoot that only a cutting draws. The crown never offers one, whatever vigor its buds
	 * carry, so adding a cutting class leaves the crown's shoots as they were.
	 */
	readonly cutting?: true;
	/** The bud vigor it serves. */
	readonly vigor: readonly [number, number];
	/** Metres from the attach point to the farthest tip, at scale 1. */
	readonly length: number;
	/** Bounding radius about the attach point. */
	readonly radius: number;
	/** Leaves on the shoot. */
	readonly leaves: number;
	/** One mesh per tier: low, medium, high, ultra. */
	readonly tiers: readonly [PrototypeArrays, PrototypeArrays, PrototypeArrays, PrototypeArrays];
	/** Its six cells in the card atlas: three planes, two faces each. */
	readonly card: CardCell;
	/**
	 * The branch piece this prototype is one part of, in a kit whose plant carries pieces at its
	 * sockets. Absent on a shoot prototype.
	 */
	readonly piece?: PrototypePiece;
}

/**
 * What a kit keeps of a branch piece on each of its prototypes: the piece's name and variant, which
 * part of the variant the prototype is, how a socket holds the piece, and its flat plane.
 *
 * @category api/vegetation
 */
export interface PrototypePiece {
	/** The piece's name, unique in its species. */
	readonly name: string;
	/** Which of the piece's variants this is. */
	readonly variant: number;
	/** Which part of the variant this is. */
	readonly part: number;
	/** How many parts the variant has. */
	readonly parts: number;
	/** How a socket turns the piece. */
	readonly attitude: PieceAttitude;
	/** The unit normal of the piece's flat plane in its rest frame, where it has one. */
	readonly plane?: Vec3;
	/** Degrees it is turned about its own line at every socket (`PieceRule.roll`). */
	readonly roll?: number;
}

/**
 * A prototype's cells in the card atlas: three planes through its attach point, front and back.
 *
 * @category api/vegetation
 */
export interface CardCell {
	/** The three planes: two vertical and crossed, one horizontal. */
	readonly planes: readonly {
		/** The plane's centre in prototype space. */
		readonly centre: Vec3;
		/** Its right half-extent. */
		readonly right: Vec3;
		/** Its up half-extent. */
		readonly up: Vec3;
		/** Atlas rectangle of the front face, in texels: x, y, width, height. */
		readonly front: readonly [x: number, y: number, w: number, h: number];
		/** Atlas rectangle of the back face, in texels. */
		readonly back: readonly [x: number, y: number, w: number, h: number];
	}[];
}

/**
 * The shoot rows of one variant, in plant space: one row per shoot on the plant.
 *
 * @category api/vegetation
 */
export interface ShootRows {
	/** Rows in the table. */
	readonly count: number;
	/** The prototype each row draws. */
	readonly prototype: Uint8Array;
	/** 3 per row. */
	readonly position: Float32Array;
	/** 4 per row, a unit quaternion. */
	readonly rotation: Float32Array;
	/** One per row. */
	readonly scale: Float32Array;
	/** The parent axis's wind record. */
	readonly record: Uint16Array;
	/** The row's flutter phase, 0 to 255. */
	readonly phase: Uint8Array;
	/** Sky visibility 0 to 250, from the crown's leaf-density grid. */
	readonly sky: Uint8Array;
	/** Bent normal, octahedral, 4 bits a side: 0 to 255. */
	readonly bent: Uint8Array;
	/** Space-filling order, which the second card level thins by. */
	readonly order: Uint32Array;
	/**
	 * 3 per row: the vector from the row's place back along its axis to the stretch's far end, the
	 * previous bud or the parent node. Absent, a card draws no stalk.
	 */
	readonly back?: Float32Array;
	/** The skeleton node each row stands on. Absent on rows that stand on no skeleton. */
	readonly node?: Uint32Array;
	/**
	 * Each row's index in the plant as grown, on a plant that rows were removed from, so a choice
	 * keyed on a row stays the same on the sparser plant. Absent on rows as grown.
	 */
	readonly id?: Uint32Array;
}

/**
 * A part of a detail level.
 *
 * @category api/vegetation
 */
export type PartName = 'wood' | 'foliage' | 'cards' | 'extras';

/**
 * One part's quantised arrays, ready for `geometry.fromArrays` with integer attributes.
 *
 * @category api/vegetation
 */
export interface QuantisedArrays {
	/**
	 * 3 per vertex: 16-bit positions inside the species box, which the plant shader reads as
	 * fractions of the box and turns into metres, and the copy's transform scales.
	 */
	readonly positions: Uint16Array;
	/** 3 per vertex: 8-bit normals that read from -1 to 1. */
	readonly normals: Int8Array;
	/**
	 * 2 per vertex, plain 16-bit: wood in 1/1024 m of bark; leaves and cards in 1/65535 of the
	 * texture; extras, which draw no texture, each position's rest below one step of the box.
	 */
	readonly uvs: Uint16Array;
	/** 2 per vertex, plain 16-bit, in the part's own units. */
	readonly uvs1: Uint16Array;
	/** 4 per vertex: wind record high and low byte, then two bytes the part's mode defines. */
	readonly colors: Uint8Array;
	/** 4 bytes per vertex: the packed offset from a blade's keel, its fourth byte 127 on a blade. */
	readonly tangents?: Int8Array;
	/** 3 per triangle. */
	readonly indices: Uint16Array | Uint32Array;
}

/**
 * One part of a detail level: its name and its arrays.
 *
 * @category api/vegetation
 */
export interface PlantPart {
	/** Which part. */
	readonly name: PartName;
	/** Its quantised arrays. */
	readonly arrays: QuantisedArrays;
}

/**
 * One detail level of a variant.
 *
 * @category api/vegetation
 */
export interface PlantLevel {
	/** The level: 0 real geometry, 1 shoot cards, 2 thinned cards. */
	readonly level: 0 | 1 | 2;
	/**
	 * Its parts. Several may share a name: a large mesh comes in pieces of at most 65,536 vertices,
	 * so every part's indices fit 16 bits.
	 */
	readonly parts: readonly PlantPart[];
	/** Metres at which this level starts, for a reference view; the page sets its own from its view. */
	readonly from: number;
	/** Its triangles. */
	readonly triangles: number;
	/** Its bytes. */
	readonly bytes: number;
}

/**
 * The wind records of one variant.
 *
 * @category api/vegetation
 */
export interface WindTable {
	/** First global record of this variant in the species' table. */
	readonly base: number;
	/** Records in the table. */
	readonly count: number;
	/** 16 floats per record. */
	readonly records: Float32Array;
}

/**
 * The triangles of each part of a plant at one level.
 *
 * @category api/vegetation
 */
export interface PartTriangles {
	/** The trunk: every axis with no parent, with its roots. */
	readonly trunk: number;
	/** The great limbs. */
	readonly limbs: number;
	/** Every other axis of the skeleton. */
	readonly branches: number;
	/** The twig wood inside the shoot rows: their stems and buds. */
	readonly twigs: number;
	/** The leaves: the shoot rows' leaves, the leaf cards, or a merged plant's foliage mesh. */
	readonly leaves: number;
	/** The extras: cones, fruit, flowers, catkins, thorns and spines. */
	readonly extras: number;
}

/**
 * The card clusters of one level under a triangle maximum, and how they join the plant.
 *
 * @category api/vegetation
 */
export interface ClusterCount {
	/** The clusters the level draws; none where it draws shoot rows or the level's own cards. */
	readonly clusters: number;
	/** The clusters joined by a stalk: their cards touch neither the drawn wood nor a joined card. */
	readonly stalks: number;
	/** The clusters with no drawn wood to hang on, where the maximum leaves the level no wood. */
	readonly free: number;
}

/**
 * One grown variant of a species, with its levels, its shoot rows and its wind records.
 *
 * @category api/vegetation
 */
export interface PlantAsset {
	/** The species' id. */
	readonly species: string;
	/** The hash of the record it grew from. */
	readonly recordHash: string;
	/** The seed it grew from. */
	readonly seed: number;
	/** Its variant index. */
	readonly variant: number;
	/** The season it grew for. */
	readonly season: Season;
	/**
	 * How much simpler than grown it is, from 0 to 1: the coarseness its options gave, or the one its
	 * triangle target picked. Stand-ins are always 0.
	 */
	readonly coarseness: number;
	/** The piece it was cut to, for a close review. */
	readonly cutting?: CuttingOptions;
	/** Its grown structure. */
	readonly skeleton: MacroSkeleton;
	/** The nearest level's foliage of an 'instanced' species; empty for a 'merged' one. */
	readonly shoots: ShootRows;
	/** The nearest level, then the two card levels. The nearest level's wood may be empty until it arrives. */
	readonly levels: readonly [PlantLevel, PlantLevel, PlantLevel];
	/** Its wind records. */
	readonly wind: WindTable;
	/** Crown centre and radius, for card normals at the second card level and the impostor. */
	readonly crown: {
		readonly centre: Vec3;
		readonly radius: number;
		readonly base: number;
		readonly top: number;
	};
	/** The level the impostor bakes from, its grid, and the metres at which it starts at the reference view. */
	readonly impostor: {
		readonly level: 1;
		readonly views: number;
		readonly texels: number;
		readonly from: number;
	};
	/**
	 * The most triangles each of its levels may draw, where its growth named a maximum. The nearest
	 * level counts its shoot rows at the tier they draw at.
	 */
	readonly maxTriangles?: number;
	/**
	 * How its shoot rows draw near the camera, where a triangle maximum moved them: at a tier below
	 * the kit's, or `none` where the nearest level draws leaf cards in their place. The rows are
	 * still the plant's foliage, which the far bake reads. Absent, the rows draw at the kit's tier.
	 */
	readonly shootDetail?: Detail | 'none';
	/** How long it took, its bytes, and each level's triangles. */
	readonly stats: {
		readonly milliseconds: number;
		readonly bytes: number;
		readonly triangles: readonly [number, number, number];
		/**
		 * Each level's triangles part by part. The nearest level counts its shoot rows at the tier
		 * they draw at, as leaves and as twig wood, and its wood once that is meshed: none on a variant
		 * grown without `near`. A stand-in's wood counts as its trunk.
		 */
		readonly parts: readonly [PartTriangles, PartTriangles, PartTriangles];
		/**
		 * Each part's allowance at each level under a triangle maximum: its share of the maximum, and
		 * what was handed on to it from the parts that used less. Absent without a maximum.
		 */
		readonly allowed?: readonly [PartTriangles, PartTriangles, PartTriangles];
		/**
		 * The card clusters each level draws under a triangle maximum, where it draws clusters in
		 * place of a card set for each shoot row. Absent without a maximum.
		 */
		readonly clusters?: readonly [ClusterCount, ClusterCount, ClusterCount];
	};
}

/**
 * What a species builds once per page: plain data, so it crosses to every growth task.
 *
 * @category api/vegetation
 */
export interface SpeciesKitData {
	/**
	 * The record the kit grows from: the species' own, or the record of the form it was built for,
	 * without the forms themselves.
	 */
	readonly record: Species;
	/** The texture manifest. */
	readonly manifest: TextureManifest;
	/** A hash of the generator's version, the record, the manifest and the detail tier. */
	readonly key: string;
	/** The mesh tier it was built at. */
	readonly detail: Detail;
	/** The box every part's positions are quantised against. */
	readonly box: SpeciesBox;
	/** The shoot prototypes. */
	readonly prototypes: readonly ShootPrototype[];
	/** One leaf mesh per texture layer pair, for merged foliage and the 'leaf' cutting. */
	readonly leaves: readonly PrototypeArrays[];
	/** The card atlas's pixels, kept until the impostor bakes have read them. */
	readonly cards: {
		readonly size: number;
		readonly color: Uint8Array;
		readonly surface: Uint8Array;
	};
	/** The records texture's header rows. */
	readonly header: Float32Array;
	/**
	 * Which stages grow their stand-ins: every stage with `true`, so a stand-in species draws the same
	 * as stages land; only the stages that are not built yet with `'missing'`, so a species grows
	 * through every built stage before the rest exist.
	 */
	readonly placeholders?: boolean | 'missing';
	/** The coarseness its variants grow at when their own options give none, as `prepareSpecies` took it. */
	readonly coarseness?: number;
	/** The triangle target its variants grow to when their own options give none. */
	readonly triangles?: number;
}

/** The typed arrays of a part, in a fixed order. */
function quantisedViews(arrays: QuantisedArrays): ArrayBufferView[] {
	return [
		arrays.positions,
		arrays.normals,
		arrays.uvs,
		arrays.uvs1,
		arrays.colors,
		...(arrays.tangents ? [arrays.tangents] : []),
		arrays.indices,
	];
}

/**
 * The kit's prototypes a crown may draw: all of them but those a class grows only for cuttings, so
 * a species that grows cuttings from shoots of their own dresses its crown as it did without them.
 *
 * @param prototypes The kit's prototypes.
 * @returns The crown's, in kit order.
 * @category api/vegetation
 */
export function crownPrototypes<T extends { readonly cutting?: true }>(
	prototypes: readonly T[],
): T[] {
	return prototypes.filter((prototype) => !prototype.cutting);
}

/**
 * Every buffer a part holds, so a job worker can move them to the page rather than copy them.
 *
 * @param part The part.
 * @returns Its arrays' buffers.
 * @category api/vegetation
 */
export function plantPartBuffers(part: PlantPart): ArrayBuffer[] {
	return quantisedViews(part.arrays).map((view) => view.buffer as ArrayBuffer);
}

/** The typed arrays of shoot rows, in a fixed order. */
function rowViews(rows: ShootRows): ArrayBufferView[] {
	return [
		rows.prototype,
		rows.position,
		rows.rotation,
		rows.scale,
		rows.record,
		rows.phase,
		rows.sky,
		rows.bent,
		rows.order,
		...(rows.node ? [rows.node] : []),
		...(rows.id ? [rows.id] : []),
	];
}

/** Every typed array of an asset, in a fixed order. */
function assetViews(asset: PlantAsset): ArrayBufferView[] {
	const views: ArrayBufferView[] = [];
	const { skeleton } = asset;
	views.push(
		skeleton.position,
		skeleton.radius,
		skeleton.parent,
		skeleton.axisOf,
		skeleton.light,
		skeleton.age,
		skeleton.flags,
		...Object.values(skeleton.axes).filter((v): v is ArrayBufferView => ArrayBuffer.isView(v)),
		...Object.values(skeleton.buds).filter((v): v is ArrayBufferView => ArrayBuffer.isView(v)),
	);
	views.push(...rowViews(asset.shoots));
	for (const level of asset.levels)
		for (const part of level.parts) views.push(...quantisedViews(part.arrays));
	views.push(asset.wind.records);
	return views;
}

/**
 * A digest of every byte of an asset and of its numbers, as sixteen hexadecimal digits. Two growths
 * of one species, seed and variant give the same digest on every device; the determinism tests and
 * the cache keys compare it.
 *
 * @param asset The asset.
 * @returns Its digest.
 * @category api/vegetation
 */
export function plantAssetDigest(asset: PlantAsset): string {
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (const view of assetViews(asset)) {
		const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
		a = hashBytes(bytes, a);
		b = hashBytes(bytes, b ^ 0x5bd1e995);
	}
	const numbers = new Float64Array([
		asset.seed,
		asset.variant,
		asset.skeleton.crownBase,
		asset.skeleton.height,
		...asset.crown.centre,
		asset.crown.radius,
		asset.crown.base,
		asset.crown.top,
		asset.wind.base,
		...asset.levels.map((level) => level.from),
		asset.impostor.from,
	]);
	const bytes = new Uint8Array(numbers.buffer);
	a = hashBytes(bytes, a);
	b = hashBytes(bytes, b);
	return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * Every buffer an asset holds, so a job worker can move them to the page rather than copy them.
 *
 * @param asset The asset.
 * @returns Its arrays' buffers, each once.
 * @category api/vegetation
 */
export function plantAssetBuffers(asset: PlantAsset): ArrayBuffer[] {
	const buffers = new Set<ArrayBuffer>(skeletonBuffers(asset.skeleton));
	for (const view of assetViews(asset)) buffers.add(view.buffer as ArrayBuffer);
	return [...buffers];
}
