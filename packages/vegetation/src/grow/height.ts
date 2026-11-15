// A record's height target means the leaf form's top, the plant as its nearest level draws it,
// which every level is judged against: the grown skeleton and the shoot placement are scaled
// together so the highest point of the nearest foliage stands at the sampled target. A card level
// pictures that foliage at its own size, so no change to how the cards are baked or placed moves
// the plant. A uniform scale leaves the crown's base share and the plant's aspect as they were,
// which the target already governs as shares.
//
// The scale is applied before the crown's light grid, so a cell of the shadow pyramid keeps one
// meaning whatever the target is. The crown's reach is estimated from the kit before the light; the
// stage measures the leaf form's top after the placement and records the residual, and a residual
// over half a per cent is taken out by one corrective scale of the already-placed geometry.
import type { ShootRows, SpeciesKitData } from '../asset';
import type { MacroSkeleton } from '../core/graph';
import { unitAt } from '../core/hash';
import { quatRotate, type Vector3 } from '../core/math';
import type { Species } from '../core/record';
import { curveAt, DETAILS, spreadAt, spreadMax } from '../core/types';
import { CARD_CORNERS } from '../lod/cards';

/** The hash purpose each grower draws its height with. */
const HEIGHT_PURPOSE = 1;

/** The residual the stage accepts without a corrective scale. */
export const HEIGHT_RESIDUAL = 0.005;

/**
 * The height the record asks for this seed and variant, in metres: the drawn plant's top.
 *
 * @param record The record the plant grows from.
 * @param seed The seed.
 * @param variant The variant.
 * @returns The target height.
 * @category api/vegetation
 */
export function targetHeight(record: Species, seed: number, variant: number): number {
	return spreadAt(record.size.height, unitAt(seed, record.seedSalt >>> 0, variant, HEIGHT_PURPOSE));
}

/** A prototype's mesh at the kit's own tier, which the nearest level draws, with its box. */
interface LeafMesh {
	readonly positions: Float32Array;
	readonly min: readonly [number, number, number];
	readonly max: readonly [number, number, number];
}

/** Each kit's prototypes' nearest meshes and boxes, read once. */
const LEAF_MESHES = new WeakMap<SpeciesKitData, readonly (LeafMesh | undefined)[]>();

/** The kit's prototypes' nearest meshes, each with the box of its vertices. */
function leafMeshes(kit: SpeciesKitData): readonly (LeafMesh | undefined)[] {
	let meshes = LEAF_MESHES.get(kit);
	if (!meshes) {
		const tier = Math.max(0, DETAILS.indexOf(kit.detail));
		meshes = kit.prototypes.map((prototype) => {
			const positions = prototype.tiers[tier]?.positions;
			if (!positions || positions.length === 0) return undefined;
			const min: [number, number, number] = [Infinity, Infinity, Infinity];
			const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
			for (let i = 0; i < positions.length; i += 3) {
				const x = positions[i] as number;
				const y = positions[i + 1] as number;
				const z = positions[i + 2] as number;
				if (x < min[0]) min[0] = x;
				if (y < min[1]) min[1] = y;
				if (z < min[2]) min[2] = z;
				if (x > max[0]) max[0] = x;
				if (y > max[1]) max[1] = y;
				if (z > max[2]) max[2] = z;
			}
			return { positions, min, max };
		});
		LEAF_MESHES.set(kit, meshes);
	}
	return meshes;
}

/**
 * The crown's added height above the wood, estimated from the kit: the highest point of any
 * prototype's nearest mesh above its shoot, the largest placement scale and the height curve's top.
 * The topmost row's own rotation may tilt it, so this is an upper bound and the residual measure
 * corrects the difference.
 *
 * @param kit The species' kit.
 * @param record The record the plant grows from.
 * @returns The crown's reach in metres.
 * @category api/vegetation
 */
function leafReach(kit: SpeciesKitData, record: Species): number {
	const placement = record.shoots?.placement;
	if (!placement) return 0;
	let local = 0;
	const meshes = leafMeshes(kit);
	kit.prototypes.forEach((prototype, p) => {
		const mesh = meshes[p];
		if (prototype.cutting || !mesh) return;
		if (mesh.max[1] > local) local = mesh.max[1];
	});
	const curve = placement.scaleByHeight === undefined ? 1 : curveAt(placement.scaleByHeight, 1);
	return local * spreadMax(placement.scale) * curve;
}

/** The card of one prototype: its centre and half-extents, as the card level builds it. */
type Card = SpeciesKitData['prototypes'][number]['card'];

/** A prototype card's highest corner above its shoot, in prototype metres. */
function cardReach(card: Card): number {
	let top = 0;
	for (const plane of card.planes) {
		const y = plane.centre[1] + Math.abs(plane.right[1]) + Math.abs(plane.up[1]);
		if (y > top) top = y;
	}
	return top;
}

/** The crown's added height estimated from the kit's card corners, as the level drew it before. */
function cardCrownReach(kit: SpeciesKitData, record: Species): number {
	const placement = record.shoots?.placement;
	if (!placement) return 0;
	let local = 0;
	for (const prototype of kit.prototypes) {
		if (prototype.cutting) continue;
		const reach = cardReach(prototype.card);
		if (reach > local) local = reach;
	}
	const curve = placement.scaleByHeight === undefined ? 1 : curveAt(placement.scaleByHeight, 1);
	return local * spreadMax(placement.scale) * curve;
}

/**
 * Whether a record scales its plant to its drawn card level rather than its leaf form. A record that
 * names `lod.heightAtLeafTop` measures the nearest foliage, which no card change moves; every other
 * record keeps the card level's measure it was judged with.
 */
export function scalesToLeafTop(record: Species): boolean {
	return record.lod.heightAtLeafTop === true;
}

/**
 * The crown's added height above the wood, estimated from the kit: the leaf form's highest point, or
 * the card level's highest corner where the record scales to the card level, times the largest
 * placement scale and the height curve's top. The topmost row's own rotation may tilt it, so this
 * is an upper bound and the residual measure corrects the difference.
 *
 * @param kit The species' kit.
 * @param record The record the plant grows from.
 * @returns The crown's reach in metres.
 * @category api/vegetation
 */
export function crownReach(kit: SpeciesKitData, record: Species): number {
	return scalesToLeafTop(record) ? leafReach(kit, record) : cardCrownReach(kit, record);
}

/** A row's turn as the second row of its matrix, times its scale: a vertex's height is its dot. */
function heightAxis(rows: ShootRows, r: number): [number, number, number] {
	const x = rows.rotation[r * 4] as number;
	const y = rows.rotation[r * 4 + 1] as number;
	const z = rows.rotation[r * 4 + 2] as number;
	const w = rows.rotation[r * 4 + 3] as number;
	const scale = rows.scale[r] as number;
	return [
		2 * (x * y + z * w) * scale,
		(1 - 2 * (x * x + z * z)) * scale,
		2 * (y * z - x * w) * scale,
	];
}

/**
 * The shoot row whose nearest mesh reaches highest, and that height in metres. Each row's box,
 * turned as the row turns it, bounds its top; the rows are read vertex by vertex from the highest
 * bound down, until no bound left can pass the highest top found.
 */
function highest(
	kit: SpeciesKitData,
	rows: ShootRows,
): { readonly row: number; readonly top: number } {
	const meshes = leafMeshes(kit);
	const bounds = new Float64Array(rows.count).fill(Number.NEGATIVE_INFINITY);
	const order: number[] = [];
	for (let r = 0; r < rows.count; r++) {
		const mesh = meshes[rows.prototype[r] as number];
		if (!mesh) continue;
		const [ax, ay, az] = heightAxis(rows, r);
		const { min, max } = mesh;
		let bound = rows.position[r * 3 + 1] as number;
		bound += Math.max(ax * min[0], ax * max[0]);
		bound += Math.max(ay * min[1], ay * max[1]);
		bound += Math.max(az * min[2], az * max[2]);
		bounds[r] = bound;
		order.push(r);
	}
	order.sort((a, b) => (bounds[b] as number) - (bounds[a] as number));
	let best = -1;
	let top = Number.NEGATIVE_INFINITY;
	for (const r of order) {
		if ((bounds[r] as number) <= top) break;
		const { positions } = meshes[rows.prototype[r] as number] as LeafMesh;
		const [ax, ay, az] = heightAxis(rows, r);
		let reach = Number.NEGATIVE_INFINITY;
		for (let i = 0; i < positions.length; i += 3) {
			const height =
				ax * (positions[i] as number) +
				ay * (positions[i + 1] as number) +
				az * (positions[i + 2] as number);
			if (height > reach) reach = height;
		}
		reach += rows.position[r * 3 + 1] as number;
		if (reach > top) {
			top = reach;
			best = r;
		}
	}
	return { row: best, top };
}

/**
 * The highest point of the leaf form, in metres: every shoot's nearest mesh, turned and placed as
 * the shoot places it.
 *
 * @param kit The species' kit.
 * @param rows The dressed shoot rows.
 * @returns The leaf form's top, or 0 with no rows.
 * @category api/vegetation
 */
export function leafTop(kit: SpeciesKitData, rows: ShootRows): number {
	return Math.max(0, highest(kit, rows).top);
}

/**
 * The shoot row whose nearest mesh reaches highest, which holds the leaf form's top.
 *
 * @param kit The species' kit.
 * @param rows The dressed shoot rows.
 * @returns The row, or -1 when no row draws a mesh.
 */
export function topRow(kit: SpeciesKitData, rows: ShootRows): number {
	return highest(kit, rows).row;
}

/** The highest point of one shoot row's cards, in metres. */
function rowCardTop(kit: SpeciesKitData, rows: ShootRows, r: number): number {
	const prototype = kit.prototypes[rows.prototype[r] as number];
	if (!prototype) return Number.NEGATIVE_INFINITY;
	const local: Vector3 = [0, 0, 0];
	const world: Vector3 = [0, 0, 0];
	const scale = rows.scale[r] as number;
	const y = rows.position[r * 3 + 1] as number;
	let top = Number.NEGATIVE_INFINITY;
	for (const plane of prototype.card.planes) {
		for (const [sx, sy] of CARD_CORNERS) {
			for (let c = 0; c < 3; c++)
				local[c] =
					(plane.centre[c] as number) +
					sx * (plane.right[c] as number) +
					sy * (plane.up[c] as number);
			local[0] *= scale;
			local[1] *= scale;
			local[2] *= scale;
			quatRotate(rows.rotation, r * 4, local, world);
			if (y + (world[1] as number) > top) top = y + (world[1] as number);
		}
	}
	return top;
}

/**
 * The highest point of the drawn card level, in metres: every shoot's card planes at the shoot's own
 * size, turned and placed as the shoot places them.
 *
 * @param kit The species' kit.
 * @param rows The dressed shoot rows.
 * @returns The card level's top.
 * @category api/vegetation
 */
export function cardTop(kit: SpeciesKitData, rows: ShootRows): number {
	let top = 0;
	for (let r = 0; r < rows.count; r++) top = Math.max(top, rowCardTop(kit, rows, r));
	return top;
}

/** The shoot row whose cards reach highest, which holds the drawn top of the card level. */
function cardTopRow(kit: SpeciesKitData, rows: ShootRows): number {
	let best = -1;
	let top = Number.NEGATIVE_INFINITY;
	for (let r = 0; r < rows.count; r++) {
		const reach = rowCardTop(kit, rows, r);
		if (reach > top) {
			top = reach;
			best = r;
		}
	}
	return best;
}

/**
 * The top a record's plant is scaled to: its leaf form's where the record names
 * `lod.heightAtLeafTop`, else its drawn card level's, which is the measure it was judged with.
 *
 * @param kit The species' kit.
 * @param rows The dressed shoot rows.
 * @param record The record the plant grows from.
 * @returns The top in metres.
 * @category api/vegetation
 */
export function plantTop(kit: SpeciesKitData, rows: ShootRows, record: Species): number {
	return scalesToLeafTop(record) ? leafTop(kit, rows) : cardTop(kit, rows);
}

/**
 * The shoot row that holds the top the plant is scaled to, as `plantTop` measures it.
 *
 * @param kit The species' kit.
 * @param rows The dressed shoot rows.
 * @param record The record the plant grows from.
 * @returns The row, or -1 when no row draws a shape.
 * @category api/vegetation
 */
export function plantTopRow(kit: SpeciesKitData, rows: ShootRows, record: Species): number {
	return scalesToLeafTop(record) ? topRow(kit, rows) : cardTopRow(kit, rows);
}

/** The record with its shoot placement scaled by `factor`, so the crown scales with the wood. */
export function scaledPlacement(record: Species, factor: number): Species {
	const shoots = record.shoots;
	if (!shoots) return record;
	const scale = shoots.placement.scale;
	const mean = typeof scale === 'number' ? scale : scale.mean;
	const spread = typeof scale === 'number' ? 0 : scale.spread;
	return {
		...record,
		shoots: {
			...shoots,
			placement: { ...shoots.placement, scale: { mean: mean * factor, spread: spread * factor } },
		},
	};
}

/** The skeleton with every position, radius and length scaled by `factor`. */
export function scaledSkeleton(skeleton: MacroSkeleton, factor: number): MacroSkeleton {
	return {
		...skeleton,
		position: skeleton.position.map((value) => value * factor),
		radius: skeleton.radius.map((value) => value * factor),
		bounds: {
			min: skeleton.bounds.min.map((value) => value * factor) as [number, number, number],
			max: skeleton.bounds.max.map((value) => value * factor) as [number, number, number],
		},
		height: skeleton.height * factor,
		crownBase: skeleton.crownBase * factor,
		axes: { ...skeleton.axes, barkV: skeleton.axes.barkV.map((value) => value * factor) },
		buds: {
			...skeleton.buds,
			position: skeleton.buds.position.map((value) => value * factor),
			woodRadius: skeleton.buds.woodRadius.map((value) => value * factor),
		},
	};
}

/**
 * The skeleton scaled by `factor` with the pieces at its sockets scaled with it, for a plant that is
 * its pieces, such as a tuft or a frond colony, whose size is the plant's own.
 */
export function scaledWithPieces(skeleton: MacroSkeleton, factor: number): MacroSkeleton {
	const scaled = scaledSkeleton(skeleton, factor);
	const sockets = scaled.buds.sockets;
	return sockets
		? {
				...scaled,
				buds: {
					...scaled.buds,
					sockets: { ...sockets, scale: sockets.scale.map((value) => value * factor) },
				},
			}
		: scaled;
}

/** The shoot rows with every position, scale and stalk vector scaled by `factor`. */
export function scaledRows(rows: ShootRows, factor: number): ShootRows {
	return {
		...rows,
		position: rows.position.map((value) => value * factor),
		scale: rows.scale.map((value) => value * factor),
		...(rows.back ? { back: rows.back.map((value) => value * factor) } : {}),
	};
}
