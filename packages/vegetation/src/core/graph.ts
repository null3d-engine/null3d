// The macro skeleton: the contract between the growers, the shoot instancer and the wood mesher.
// Every grower returns one, and nothing later in the pipeline knows which model grew the plant. It
// is plain typed arrays in plant space (metres, +Y up, the main stem's base at the origin), so it
// crosses from a job worker without a copy. `SkeletonBuilder` grows the arrays as a grower adds
// nodes, axes and bud sites, and trims them to their lengths at the end.
import type { Vec3 } from './types';

/**
 * Node flag: a branch shed for want of light; its radius stays.
 *
 * @category api/vegetation
 */
export const NODE_SHED = 1;
/**
 * Node flag: a dead stub left where a branch was shed.
 *
 * @category api/vegetation
 */
export const NODE_STUB = 2;
/**
 * Node flag: a fork, where two axes of like size part.
 *
 * @category api/vegetation
 */
export const NODE_FORK = 4;
/**
 * Node flag: a node on the ground, such as a surface root's.
 *
 * @category api/vegetation
 */
export const NODE_GROUND = 8;
/**
 * Node flag: a pillar root's node, which carries load.
 *
 * @category api/vegetation
 */
export const NODE_PILLAR = 16;

/**
 * Axis kind: a stem.
 *
 * @category api/vegetation
 */
export const AXIS_STEM = 0;
/**
 * Axis kind: a limb or branch.
 *
 * @category api/vegetation
 */
export const AXIS_LIMB = 1;
/**
 * Axis kind: a root.
 *
 * @category api/vegetation
 */
export const AXIS_ROOT = 2;
/**
 * Axis kind: a bamboo culm.
 *
 * @category api/vegetation
 */
export const AXIS_CULM = 3;
/**
 * Axis kind: a frond's rachis.
 *
 * @category api/vegetation
 */
export const AXIS_RACHIS = 4;
/**
 * Axis kind: a column's arm.
 *
 * @category api/vegetation
 */
export const AXIS_ARM = 5;
/**
 * Axis kind: a fern's stipe.
 *
 * @category api/vegetation
 */
export const AXIS_STIPE = 6;

/**
 * Bud kind: the bud at an axis's tip.
 *
 * @category api/vegetation
 */
export const BUD_TERMINAL = 0;
/**
 * Bud kind: a bud beside a node.
 *
 * @category api/vegetation
 */
export const BUD_LATERAL = 1;
/**
 * Bud kind: a short spur shoot's bud.
 *
 * @category api/vegetation
 */
export const BUD_SPUR = 2;
/**
 * Bud kind: a dormant bud on old wood.
 *
 * @category api/vegetation
 */
export const BUD_DORMANT = 3;
/**
 * Bud kind: a flower bud.
 *
 * @category api/vegetation
 */
export const BUD_FLOWER = 4;
/**
 * Bud kind: a cactus areole.
 *
 * @category api/vegetation
 */
export const BUD_AREOLE = 5;
/**
 * Bud kind: a joint of a culm, where a node ring stands. It carries no shoot.
 *
 * @category api/vegetation
 */
export const BUD_JOINT = 6;
/**
 * One plant's grown structure: nodes joined into axes, and the bud sites shoots attach to. Plain
 * typed arrays in plant space (metres, +Y up, the main stem's base at the origin), so it crosses
 * from a job worker without a copy.
 *
 * @category api/vegetation
 */
export interface MacroSkeleton {
	/** Nodes in the skeleton. */
	readonly nodeCount: number;
	/** 3 per node. */
	readonly position: Float32Array;
	/** Pipe-model radius in metres; never shrinks when branches are shed. */
	readonly radius: Float32Array;
	/** The node this one grew from, or -1 at a stem base. A pillar's top node also names its limb. */
	readonly parent: Int32Array;
	/** The axis each node belongs to. */
	readonly axisOf: Uint32Array;
	/** Light at the end of growth, 0 to 1. */
	readonly light: Float32Array;
	/** Years since the node formed. */
	readonly age: Uint16Array;
	/** The node flags, such as `NODE_SHED`. */
	readonly flags: Uint8Array;
	/** The axes. */
	readonly axes: AxisTable;
	/** The bud sites. */
	readonly buds: BudSites;
	/** The skeleton's bounds in metres. */
	readonly bounds: { readonly min: Vec3; readonly max: Vec3 };
	/** Height of the lowest foliage in metres. */
	readonly crownBase: number;
	/** Height of the top in metres. */
	readonly height: number;
}

/**
 * The axes of a skeleton: chains of nodes from a base to a tip.
 *
 * @category api/vegetation
 */
export interface AxisTable {
	/** Axes in the table. */
	readonly count: number;
	/** First node of each axis; an axis is a chain from base to tip in node order. */
	readonly first: Uint32Array;
	/** Last node of each axis. */
	readonly last: Uint32Array;
	/** The axis it leaves, or -1 for a stem. */
	readonly parent: Int32Array;
	/** The parent node before its base, or -1 for a stem. */
	readonly parentNode: Int32Array;
	/** The share along the parent's internode where it leaves. */
	readonly parentT: Float32Array;
	/** The botanical order: 0 for a stem. */
	readonly order: Uint8Array;
	/** The axis kind, such as `AXIS_LIMB`. */
	readonly kind: Uint8Array;
	/** The axis's wind record, global in the species' records table. */
	readonly record: Uint16Array;
	/** Metres of bark along the axis at its base: the parent's coordinate at the junction. */
	readonly barkV: Float32Array;
	/** Radians about the parent where the axis leaves, so the child's bark starts where the parent's is. */
	readonly barkU: Float32Array;
	/**
	 * The share along the original axis where each axis's first node stands, where a cut took a
	 * span of one axis; 0 for an axis grown in place.
	 */
	readonly cutFrom: Float32Array;
	/**
	 * The share along the original axis where each axis's last node stands, so a cut piece reads
	 * its shoot's curves between the two shares; 1 for an axis grown in place.
	 */
	readonly cutTo: Float32Array;
	/** Whether each axis draws the grown bark layer rather than the young bark; 0 for young bark. */
	readonly grownBark: Uint8Array;
	/**
	 * Each axis's index in the plant as grown, on a skeleton that axes were removed from, so a choice
	 * keyed on an axis stays the same on the sparser plant. Absent on a skeleton as grown.
	 */
	readonly origin?: Uint32Array;
}

/**
 * The places on a skeleton where a shoot prototype, an extra or nothing attaches.
 *
 * @category api/vegetation
 */
export interface BudSites {
	/** Bud sites in the table. */
	readonly count: number;
	/** The node a lateral bud sits at, or the tip node for a terminal bud. */
	readonly node: Uint32Array;
	/** 3 per bud, plant space. Laterals sit between samples, never rounded onto one. */
	readonly position: Float32Array;
	/** 4 per bud, a unit quaternion: +Y the shoot's direction, +Z the side toward the sky. */
	readonly frame: Float32Array;
	/** The bud kind, such as `BUD_LATERAL`. */
	readonly kind: Uint8Array;
	/** Resource share 0 to 1, which picks the shoot class. */
	readonly vigor: Float32Array;
	/** Light at the bud, 0 to 1. */
	readonly light: Float32Array;
	/** The axis (and so the wind record) the shoot hangs on. */
	readonly axis: Uint32Array;
	/** Wood radius at the bud, so the shoot's stem base matches it. */
	readonly woodRadius: Float32Array;
	/**
	 * Each bud site's index in the plant as grown, on a skeleton that axes were removed from. Absent
	 * on a skeleton as grown.
	 */
	readonly origin?: Uint32Array;
	/**
	 * What each bud site holds when the sites are sockets, each of which carries one piece: the
	 * ends of a directed plant's branches, or the shoots of a ground form's stool. Absent on every
	 * other skeleton.
	 */
	readonly sockets?: SocketSites;
}

/**
 * The sockets of a plant of pieces, one per bud site in the same order. A socket's place, its frame,
 * its axis and its wood are its bud site's; these are what a piece needs beside them.
 *
 * @category api/vegetation
 */
export interface SocketSites {
	/** The size of the socket's piece against the species' own, 1 for the record's. */
	readonly scale: Float32Array;
	/**
	 * A rank from 0 that orders the sockets for thinning: the sockets below any rank stand spread
	 * through the crown, so a level that keeps only those keeps the crown's shape.
	 */
	readonly rank: Uint32Array;
	/** The foliage mass the socket belongs to. */
	readonly lobe: Uint16Array;
	/**
	 * The piece each socket carries, as its place among the plant's pieces in the order its kit
	 * holds them, where the sockets carry different pieces: a tuft's sheath, blades and flowering
	 * stems. Absent where every socket carries the one piece its record names.
	 */
	readonly piece?: Uint16Array;
}

/** A typed array type that the builder can grow. */
type Growable = Float32Array | Int32Array | Uint32Array | Uint16Array | Uint8Array | Float32Array;

/** A copy of `array` with room for `size` items, keeping its values. */
function grown<T extends Growable>(array: T, size: number): T {
	const next = new (array.constructor as new (length: number) => T)(size);
	next.set(array);
	return next;
}

/** A copy of the first `length` items of `array`, so the skeleton holds no spare room. */
function trimmed<T extends Growable>(array: T, length: number): T {
	return array.slice(0, length) as T;
}

/**
 * One node to add: where it is, how thick, what it grew from and on which axis.
 *
 * @category api/vegetation
 */
export interface NodeInput {
	/** Plant-space position in metres. */
	readonly x: number;
	/** Plant-space height in metres. */
	readonly y: number;
	/** Plant-space position in metres. */
	readonly z: number;
	/** Pipe-model radius in metres. */
	readonly radius: number;
	/** The node it grew from, or -1 at a stem base. */
	readonly parent: number;
	/** Its axis. */
	readonly axis: number;
	/** Light at the end of growth, 0 to 1. */
	readonly light?: number;
	/** Years since it formed. */
	readonly age?: number;
	/** Its flags. */
	readonly flags?: number;
}

/**
 * One axis to add: where it leaves its parent, its order and its kind.
 *
 * @category api/vegetation
 */
export interface AxisInput {
	/** The axis it leaves, or -1 for a stem. */
	readonly parent: number;
	/** The parent node before its base, or -1 for a stem. */
	readonly parentNode: number;
	/** The share along the parent's internode where it leaves. */
	readonly parentT?: number;
	/** The botanical order. */
	readonly order: number;
	/** The axis kind. */
	readonly kind: number;
	/** Metres of bark along the parent at the junction. */
	readonly barkV?: number;
	/** Radians about the parent where it leaves. */
	readonly barkU?: number;
	/**
	 * The share along the original axis where this piece's first node stands, for a cut that took
	 * a span of one axis. 0, the default, for an axis grown in place.
	 */
	readonly cutFrom?: number;
	/**
	 * The share along the original axis where this piece's last node stands: the shoot's curves
	 * are read between the two shares. 1, the default, for an axis grown in place.
	 */
	readonly cutTo?: number;
	/**
	 * Whether the axis draws the grown bark layer rather than the young bark a thin shoot takes:
	 * a rolled young frond is fleshy and hairy, not the smooth young wood of a twig. False, the
	 * default, for every axis grown in place.
	 */
	readonly grownBark?: boolean;
}

/**
 * One bud site to add.
 *
 * @category api/vegetation
 */
export interface BudInput {
	/** The node it sits at. */
	readonly node: number;
	/** Plant-space position in metres. */
	readonly x: number;
	/** Plant-space height in metres. */
	readonly y: number;
	/** Plant-space position in metres. */
	readonly z: number;
	/** Its frame, a unit quaternion as x, y, z, w. */
	readonly frame: ArrayLike<number>;
	/** The bud kind. */
	readonly kind: number;
	/** Resource share 0 to 1. */
	readonly vigor: number;
	/** Light at the bud. */
	readonly light: number;
	/** The axis it hangs on. */
	readonly axis: number;
	/** Wood radius at the bud. */
	readonly woodRadius: number;
	/** The socket the bud site is, on a plant of pieces: its piece's size, rank, mass and piece. */
	readonly socket?: {
		readonly scale: number;
		readonly rank: number;
		readonly lobe: number;
		readonly piece?: number;
	};
}

/**
 * Builds a macro skeleton in typed arrays that grow as a grower adds to them, never one object per
 * node. `finish` trims the arrays and measures the bounds, the crown base and the height.
 *
 * @category api/vegetation
 */
export class SkeletonBuilder {
	/** Nodes added. */
	nodeCount = 0;
	/** Axes added. */
	axisCount = 0;
	/** Bud sites added. */
	budCount = 0;
	/** Node positions, 3 per node; the builder grows it. */
	position = new Float32Array(3 * 64);
	/** Node radii. */
	radius = new Float32Array(64);
	/** Each node's parent node. */
	parent = new Int32Array(64);
	/** Each node's axis. */
	axisOf = new Uint32Array(64);
	/** Each node's light. */
	light = new Float32Array(64);
	/** Each node's age in years. */
	age = new Uint16Array(64);
	/** Each node's flags. */
	flags = new Uint8Array(64);
	private axisFirst = new Uint32Array(16);
	private axisLast = new Uint32Array(16);
	private axisParent = new Int32Array(16);
	private axisParentNode = new Int32Array(16);
	private axisParentT = new Float32Array(16);
	private axisOrder = new Uint8Array(16);
	private axisKind = new Uint8Array(16);
	private axisRecord = new Uint16Array(16);
	private axisBarkV = new Float32Array(16);
	private axisBarkU = new Float32Array(16);
	private axisCutFrom = new Float32Array(16);
	private axisCutTo = new Float32Array(16);
	private axisGrownBark = new Uint8Array(16);
	private budNode = new Uint32Array(64);
	private budPosition = new Float32Array(3 * 64);
	private budFrame = new Float32Array(4 * 64);
	private budKind = new Uint8Array(64);
	private budVigor = new Float32Array(64);
	private budLight = new Float32Array(64);
	private budAxis = new Uint32Array(64);
	private budRadius = new Float32Array(64);
	private socketScale: Float32Array | undefined;
	private socketRank: Uint32Array | undefined;
	private socketLobe: Uint16Array | undefined;
	private socketPiece: Uint16Array | undefined;

	/**
	 * Adds an axis and returns its index. Its first and last nodes follow from the nodes added to it.
	 *
	 * @param axis The axis.
	 * @returns The axis's index.
	 */
	addAxis(axis: AxisInput): number {
		const index = this.axisCount;
		if (index === this.axisFirst.length) {
			const size = index * 2;
			this.axisFirst = grown(this.axisFirst, size);
			this.axisLast = grown(this.axisLast, size);
			this.axisParent = grown(this.axisParent, size);
			this.axisParentNode = grown(this.axisParentNode, size);
			this.axisParentT = grown(this.axisParentT, size);
			this.axisOrder = grown(this.axisOrder, size);
			this.axisKind = grown(this.axisKind, size);
			this.axisRecord = grown(this.axisRecord, size);
			this.axisBarkV = grown(this.axisBarkV, size);
			this.axisBarkU = grown(this.axisBarkU, size);
			this.axisCutFrom = grown(this.axisCutFrom, size);
			this.axisCutTo = grown(this.axisCutTo, size);
			this.axisGrownBark = grown(this.axisGrownBark, size);
		}
		this.axisFirst[index] = 0xffffffff;
		this.axisLast[index] = 0;
		this.axisParent[index] = axis.parent;
		this.axisParentNode[index] = axis.parentNode;
		this.axisParentT[index] = axis.parentT ?? 1;
		this.axisOrder[index] = axis.order;
		this.axisKind[index] = axis.kind;
		this.axisRecord[index] = index;
		this.axisBarkV[index] = axis.barkV ?? 0;
		this.axisBarkU[index] = axis.barkU ?? 0;
		this.axisCutFrom[index] = axis.cutFrom ?? 0;
		this.axisCutTo[index] = axis.cutTo ?? 1;
		this.axisGrownBark[index] = axis.grownBark ? 1 : 0;
		this.axisCount++;
		return index;
	}

	/**
	 * Adds a node and returns its index. Nodes of one axis are added from its base to its tip.
	 *
	 * @param node The node.
	 * @returns The node's index.
	 */
	addNode(node: NodeInput): number {
		const index = this.nodeCount;
		if (index === this.radius.length) {
			const size = index * 2;
			this.position = grown(this.position, size * 3);
			this.radius = grown(this.radius, size);
			this.parent = grown(this.parent, size);
			this.axisOf = grown(this.axisOf, size);
			this.light = grown(this.light, size);
			this.age = grown(this.age, size);
			this.flags = grown(this.flags, size);
		}
		this.position[index * 3] = node.x;
		this.position[index * 3 + 1] = node.y;
		this.position[index * 3 + 2] = node.z;
		this.radius[index] = node.radius;
		this.parent[index] = node.parent;
		this.axisOf[index] = node.axis;
		this.light[index] = node.light ?? 1;
		this.age[index] = node.age ?? 0;
		this.flags[index] = node.flags ?? 0;
		if ((this.axisFirst[node.axis] as number) === 0xffffffff) this.axisFirst[node.axis] = index;
		this.axisLast[node.axis] = index;
		this.nodeCount++;
		return index;
	}

	/**
	 * Adds a bud site and returns its index.
	 *
	 * @param bud The bud site.
	 * @returns The bud's index.
	 */
	addBud(bud: BudInput): number {
		const index = this.budCount;
		if (index === this.budNode.length) {
			const size = index * 2;
			this.budNode = grown(this.budNode, size);
			this.budPosition = grown(this.budPosition, size * 3);
			this.budFrame = grown(this.budFrame, size * 4);
			this.budKind = grown(this.budKind, size);
			this.budVigor = grown(this.budVigor, size);
			this.budLight = grown(this.budLight, size);
			this.budAxis = grown(this.budAxis, size);
			this.budRadius = grown(this.budRadius, size);
			if (this.socketScale) this.socketScale = grown(this.socketScale, size);
			if (this.socketRank) this.socketRank = grown(this.socketRank, size);
			if (this.socketLobe) this.socketLobe = grown(this.socketLobe, size);
			if (this.socketPiece) this.socketPiece = grown(this.socketPiece, size);
		}
		this.budNode[index] = bud.node;
		this.budPosition[index * 3] = bud.x;
		this.budPosition[index * 3 + 1] = bud.y;
		this.budPosition[index * 3 + 2] = bud.z;
		for (let k = 0; k < 4; k++) this.budFrame[index * 4 + k] = bud.frame[k] as number;
		this.budKind[index] = bud.kind;
		this.budVigor[index] = bud.vigor;
		this.budLight[index] = bud.light;
		this.budAxis[index] = bud.axis;
		this.budRadius[index] = bud.woodRadius;
		if (bud.socket) {
			// A socket's size is 1 until a site says otherwise, so a skeleton may mix the two.
			const room = this.budNode.length;
			this.socketScale ??= new Float32Array(room).fill(1);
			this.socketRank ??= new Uint32Array(room);
			this.socketLobe ??= new Uint16Array(room);
			this.socketScale[index] = bud.socket.scale;
			this.socketRank[index] = bud.socket.rank;
			this.socketLobe[index] = bud.socket.lobe;
			if (bud.socket.piece !== undefined) {
				this.socketPiece ??= new Uint16Array(room);
				this.socketPiece[index] = bud.socket.piece;
			}
		} else if (this.socketScale) this.socketScale[index] = 1;
		this.budCount++;
		return index;
	}

	/**
	 * The finished skeleton: every array trimmed to its length, with its bounds, crown base and
	 * height measured from the nodes. A grower that knows its crown base passes it; otherwise the
	 * lowest bud site's height stands for it.
	 *
	 * @param crownBase The height of the lowest foliage in metres, when the grower knows it.
	 * @returns The skeleton.
	 */
	finish(crownBase?: number): MacroSkeleton {
		const n = this.nodeCount;
		const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
		const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
		for (let i = 0; i < n; i++) {
			const r = this.radius[i] as number;
			for (let k = 0; k < 3; k++) {
				const v = this.position[i * 3 + k] as number;
				const low = k === 1 ? v : v - r;
				const high = k === 1 ? v : v + r;
				if (low < (min[k] as number)) min[k] = low;
				if (high > (max[k] as number)) max[k] = high;
			}
		}
		if (n === 0) {
			min.fill(0);
			max.fill(0);
		}
		let lowestBud = Number.POSITIVE_INFINITY;
		for (let b = 0; b < this.budCount; b++) {
			const y = this.budPosition[b * 3 + 1] as number;
			if (y < lowestBud) lowestBud = y;
		}
		const base = crownBase ?? (Number.isFinite(lowestBud) ? lowestBud : 0);
		const axes = this.axisCount;
		const buds = this.budCount;
		return {
			nodeCount: n,
			position: trimmed(this.position, n * 3),
			radius: trimmed(this.radius, n),
			parent: trimmed(this.parent, n),
			axisOf: trimmed(this.axisOf, n),
			light: trimmed(this.light, n),
			age: trimmed(this.age, n),
			flags: trimmed(this.flags, n),
			axes: {
				count: axes,
				first: trimmed(this.axisFirst, axes),
				last: trimmed(this.axisLast, axes),
				parent: trimmed(this.axisParent, axes),
				parentNode: trimmed(this.axisParentNode, axes),
				parentT: trimmed(this.axisParentT, axes),
				order: trimmed(this.axisOrder, axes),
				kind: trimmed(this.axisKind, axes),
				record: trimmed(this.axisRecord, axes),
				barkV: trimmed(this.axisBarkV, axes),
				barkU: trimmed(this.axisBarkU, axes),
				cutFrom: trimmed(this.axisCutFrom, axes),
				cutTo: trimmed(this.axisCutTo, axes),
				grownBark: trimmed(this.axisGrownBark, axes),
			},
			buds: {
				count: buds,
				node: trimmed(this.budNode, buds),
				position: trimmed(this.budPosition, buds * 3),
				frame: trimmed(this.budFrame, buds * 4),
				kind: trimmed(this.budKind, buds),
				vigor: trimmed(this.budVigor, buds),
				light: trimmed(this.budLight, buds),
				axis: trimmed(this.budAxis, buds),
				woodRadius: trimmed(this.budRadius, buds),
				...(this.socketScale && this.socketRank && this.socketLobe
					? {
							sockets: {
								scale: trimmed(this.socketScale, buds),
								rank: trimmed(this.socketRank, buds),
								lobe: trimmed(this.socketLobe, buds),
								...(this.socketPiece ? { piece: trimmed(this.socketPiece, buds) } : {}),
							},
						}
					: {}),
			},
			bounds: {
				min: [min[0] as number, min[1] as number, min[2] as number],
				max: [max[0] as number, max[1] as number, max[2] as number],
			},
			crownBase: base,
			height: max[1] as number,
		};
	}
}

/**
 * A copy of a skeleton that shares no array with it, so one may be written or moved to another
 * thread while the other is read.
 *
 * @param skeleton The skeleton.
 * @returns The copy.
 * @category api/vegetation
 */
export function skeletonCopy(skeleton: MacroSkeleton): MacroSkeleton {
	const { axes, buds } = skeleton;
	return {
		...skeleton,
		position: skeleton.position.slice(),
		radius: skeleton.radius.slice(),
		parent: skeleton.parent.slice(),
		axisOf: skeleton.axisOf.slice(),
		light: skeleton.light.slice(),
		age: skeleton.age.slice(),
		flags: skeleton.flags.slice(),
		axes: {
			...axes,
			first: axes.first.slice(),
			last: axes.last.slice(),
			parent: axes.parent.slice(),
			parentNode: axes.parentNode.slice(),
			parentT: axes.parentT.slice(),
			order: axes.order.slice(),
			kind: axes.kind.slice(),
			record: axes.record.slice(),
			barkV: axes.barkV.slice(),
			barkU: axes.barkU.slice(),
			...(axes.origin ? { origin: axes.origin.slice() } : {}),
		},
		buds: {
			...buds,
			node: buds.node.slice(),
			position: buds.position.slice(),
			frame: buds.frame.slice(),
			kind: buds.kind.slice(),
			vigor: buds.vigor.slice(),
			light: buds.light.slice(),
			axis: buds.axis.slice(),
			woodRadius: buds.woodRadius.slice(),
			...(buds.origin ? { origin: buds.origin.slice() } : {}),
		},
	};
}

/**
 * Every buffer a skeleton holds, so a job worker can move them to the page rather than copy them.
 *
 * @param skeleton The skeleton.
 * @returns Its arrays' buffers.
 * @category api/vegetation
 */
export function skeletonBuffers(skeleton: MacroSkeleton): ArrayBuffer[] {
	const { axes, buds } = skeleton;
	return [
		skeleton.position,
		skeleton.radius,
		skeleton.parent,
		skeleton.axisOf,
		skeleton.light,
		skeleton.age,
		skeleton.flags,
		axes.first,
		axes.last,
		axes.parent,
		axes.parentNode,
		axes.parentT,
		axes.order,
		axes.kind,
		axes.record,
		axes.barkV,
		axes.barkU,
		buds.node,
		buds.position,
		buds.frame,
		buds.kind,
		buds.vigor,
		buds.light,
		buds.axis,
		buds.woodRadius,
		...(buds.sockets ? [buds.sockets.scale, buds.sockets.rank, buds.sockets.lobe] : []),
		...(buds.sockets?.piece ? [buds.sockets.piece] : []),
	].map((array) => array.buffer as ArrayBuffer);
}
