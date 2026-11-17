// The shared grow stage: a plant's skeleton built from its family's intermediate model.
//
// The model states the plant as axes, sockets and pieces (see model.ts). This stage builds the
// skeleton the dressing stages read: every axis where the model puts it, each socket on the node
// of the axis that carries it, the state's share of the sockets by their keep rank, and the
// plant's top and box read from every socket it grew, so no sparseness moves the frame.
//
// A family supplies only what its own form needs: the kind each axis is drawn as, the wood its
// pieces stand beside in the box, and any wood the model does not state, such as the roots under a
// stool. Pricing and the state a model is emitted at belong to the family's own plan; the shared
// stages close, allocate and bake.
import {
	AXIS_CULM,
	AXIS_LIMB,
	AXIS_ROOT,
	AXIS_STEM,
	type MacroSkeleton,
	SkeletonBuilder,
} from '../core/graph';
import { atan2, cos, sin } from '../core/math';
import type { ModelAxis, ModelSocket, PlantModel } from './model';
import { addSockets, type Socket } from './sockets';

/**
 * The kind of wood a model's axis is drawn as: a root, a stem, a culm or a limb.
 *
 * @category api/vegetation
 */
export type ModelWoodKind = 'root' | 'stem' | 'culm' | 'limb';

/**
 * What a family's own form adds to the shared grow.
 *
 * @category api/vegetation
 */
export interface ModelGrowOptions {
	/** The kind of wood each axis is drawn as. By default a root axis, then a stem or a limb. */
	readonly kind?: (axis: ModelAxis, index: number) => ModelWoodKind;
	/**
	 * Wood the model does not state, such as a stool's roots, added once the root axis stands and
	 * before the other axes, so its own wood keeps the place it had. It may hold the root axis's
	 * nodes, which its wood leaves from.
	 */
	readonly extra?: (
		builder: SkeletonBuilder,
		axes: readonly { readonly builderAxis: number; readonly nodes: readonly number[] }[],
	) => void;
	/** Half the width of the widest piece, which the box carries beside each socket. */
	readonly beside?: number;
	/** The plant's base, under which no part stands. 0 when not given. */
	readonly crownBase?: number;
}

/** The skeleton builder's axis kind for a model's wood kind. */
const WOOD_KIND: Readonly<Record<ModelWoodKind, number>> = {
	root: AXIS_ROOT,
	stem: AXIS_STEM,
	culm: AXIS_CULM,
	limb: AXIS_LIMB,
};

/** The default kind of an axis: the first is the plant's root, a body is a stem, the rest limbs. */
function defaultKind(axis: ModelAxis, index: number): ModelWoodKind {
	if (index === 0 && axis.parent < 0) return 'root';
	return axis.body ? 'stem' : 'limb';
}

/** The node of an axis that stands at a share along it, the nearest one to an even division. */
function nodeAt(nodes: readonly number[], share: number): number {
	if (nodes.length === 0) return -1;
	if (nodes.length === 1) return nodes[0] as number;
	const at = Math.round(Math.max(0, Math.min(1, share)) * (nodes.length - 1));
	return nodes[at] as number;
}

/**
 * Grows a plant's skeleton from its family's model, at the state the model states.
 *
 * @param model The family's model.
 * @param options The family's own form: its axes' kinds, its extra wood and its piece's width.
 * @returns The skeleton, before any family scales it.
 * @category api/vegetation
 */
export function growPlantModel(model: PlantModel, options: ModelGrowOptions = {}): MacroSkeleton {
	const kindOf = options.kind ?? defaultKind;
	const builder = new SkeletonBuilder();
	const built: { builderAxis: number; nodes: number[] }[] = [];
	// The wood's own extent, which the box carries beside the pieces'.
	const woodLow: [number, number, number] = [
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
		Number.POSITIVE_INFINITY,
	];
	const woodHigh: [number, number, number] = [
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	];
	for (let index = 0; index < model.axes.length; index++) {
		const spec = model.axes[index] as ModelAxis;
		const parent = spec.parent < 0 ? undefined : built[spec.parent];
		const parentNode = parent === undefined ? -1 : nodeAt(parent.nodes, spec.parentShare);
		const builderAxis = builder.addAxis({
			parent: parent === undefined ? -1 : parent.builderAxis,
			parentNode,
			...(parent === undefined ? {} : { parentT: 1 }),
			order: spec.order,
			kind: WOOD_KIND[kindOf(spec, index)],
		});
		const nodes =
			spec.nodes ??
			([
				{ at: spec.from, radius: spec.radius[0] },
				{ at: spec.to, radius: spec.radius[1] },
			] as const);
		let prior = parentNode;
		const builtNodes: number[] = [];
		for (const node of nodes) {
			prior = builder.addNode({
				x: node.at[0] as number,
				y: node.at[1] as number,
				z: node.at[2] as number,
				radius: node.radius,
				parent: prior,
				axis: builderAxis,
				light: 1,
			});
			builtNodes.push(prior);
			for (let k = 0; k < 3; k++) {
				woodLow[k] = Math.min(woodLow[k] as number, node.at[k] as number);
				woodHigh[k] = Math.max(woodHigh[k] as number, node.at[k] as number);
			}
		}
		built.push({ builderAxis, nodes: builtNodes });
		if (index === 0) options.extra?.(builder, built);
	}
	const candidates: Socket[] = model.sockets.map((socket: ModelSocket) => {
		const carrier = built[socket.axis] as { builderAxis: number; nodes: number[] };
		return {
			axis: carrier.builderAxis,
			node: nodeAt(carrier.nodes, socket.share),
			at: socket.at,
			direction: socket.direction,
			piece: socket.piece,
			scale: socket.scale,
			keep: socket.keep,
			group: socket.group,
		};
	});
	// A sparser plant keeps the first sockets in the order the plant thins by, so every sparser
	// plant is a subset of a denser one: no piece moves and no piece outlasts its carrier.
	let keptSockets = candidates;
	if (model.keepShare < 1) {
		const least = candidates.reduce((count, socket) => count + (socket.keep === 0 ? 1 : 0), 0);
		const most = Math.min(
			candidates.length,
			Math.max(least, Math.round(candidates.length * model.keepShare)),
		);
		const order = candidates.map((_, index) => index);
		order.sort((a, b) => (candidates[a] as Socket).keep - (candidates[b] as Socket).keep || a - b);
		const kept = new Set(order.slice(0, most));
		keptSockets = candidates.filter((_, index) => kept.has(index));
	}
	addSockets(builder, keptSockets);
	const finished = builder.finish(options.crownBase ?? 0);
	// The plant's top and its box are its pieces': the tallest piece, and each piece's reach from
	// its carrier with half the widest piece beside it.
	const root = model.axes[0];
	const radius = root === undefined || root.parent >= 0 ? 0 : root.radius[0];
	let top = 0;
	const low: [number, number] = [-radius, -radius];
	const high: [number, number] = [radius, radius];
	for (const socket of candidates) {
		const piece = model.pieces[socket.piece];
		if (!piece) continue;
		top = Math.max(top, (socket.at[1] as number) + piece.top * socket.scale);
		const out = piece.reach * socket.scale;
		if (!(out > 0)) continue;
		const heading = atan2(socket.direction[2] as number, socket.direction[0] as number);
		const x = (socket.at[0] as number) + cos(heading) * out;
		const z = (socket.at[2] as number) + sin(heading) * out;
		low[0] = Math.min(low[0], x);
		low[1] = Math.min(low[1], z);
		high[0] = Math.max(high[0], x);
		high[1] = Math.max(high[1], z);
	}
	const beside = options.beside ?? 0;
	const hasWood = Number.isFinite(woodLow[0]);
	return {
		...finished,
		height: Math.max(top, hasWood ? (woodHigh[1] as number) : top),
		bounds: {
			min: [
				Math.min(low[0] - beside, hasWood ? (woodLow[0] as number) : low[0] - beside),
				0,
				Math.min(low[1] - beside, hasWood ? (woodLow[2] as number) : low[1] - beside),
			],
			max: [
				Math.max(high[0] + beside, hasWood ? (woodHigh[0] as number) : high[0] + beside),
				Math.max(top, hasWood ? (woodHigh[1] as number) : top),
				Math.max(high[1] + beside, hasWood ? (woodHigh[2] as number) : high[1] + beside),
			],
		},
	};
}
