// The connected body of one mesh level: its drawn wood from the root, and the cards joined to it. A
// level thins the wood by its orders and the cards by their share; every card whose branch went is
// dropped, so the level's plant is one body reaching the root.
import { AXIS_LIMB, AXIS_STEM, AXIS_STIPE } from '../core/graph';
import type { MeshInput, MeshLevel } from '../stages';
import { connectedCards } from './cards';

/** One level's plant: its connected components, and whether the stem's root is one of them. */
export interface ConnectedBody {
	/** The components of the drawn wood, from its roots. The drawn cards are joined by rule. */
	readonly components: number;
	/** Whether a stem of the plant is drawn at this level, so the body reaches the root. */
	readonly reachesRoot: boolean;
	/** The cards or shoots the level draws, all joined to the body. */
	readonly cards: number;
}

/**
 * Counts a level's connected body: its drawn wood is one component per root, and every drawn card is
 * joined to it by the card rule, so a card whose branch went is not drawn.
 *
 * @param input The dressed variant.
 * @param level The mesh level.
 * @returns The level's components, root and drawn cards.
 * @category api/vegetation
 */
export function connectedBody(input: MeshInput, level: MeshLevel): ConnectedBody {
	const { axes } = input.skeleton;
	const keep = level === 0 ? 255 : (input.record.lod.woodOrders[level - 1] ?? 255);
	let components = 0;
	let reachesRoot = false;
	for (let a = 0; a < axes.count; a++) {
		if ((axes.order[a] as number) > keep) continue;
		const parent = axes.parent[a] as number;
		const kind = axes.kind[a] as number;
		const wood = parent >= 0 || kind === AXIS_STEM || kind === AXIS_STIPE || kind === AXIS_LIMB;
		if (!wood) continue;
		if (parent < 0) components++;
		if (kind === AXIS_STEM && (axes.order[a] as number) === 0) reachesRoot = true;
	}
	let cards = 0;
	if (level > 0) {
		const flags = connectedCards(input, level as 1 | 2);
		for (let r = 0; r < flags.length; r++) if (flags[r] === 1) cards++;
	}
	return { components, reachesRoot, cards };
}

/**
 * The connected components of a mesh's triangles: vertices at the same place (to a tenth of a
 * millimetre) are welded, and triangles that share a welded vertex join. A plant drawn as one body
 * has one component, and a piece that hangs free has its own.
 *
 * @param mesh The mesh's positions and triangle indices.
 * @returns The number of components.
 * @category api/vegetation
 */
export function geometryComponents(mesh: {
	readonly positions: ArrayLike<number>;
	readonly indices: ArrayLike<number>;
}): number {
	const count = mesh.positions.length / 3;
	const parent = new Int32Array(count);
	for (let i = 0; i < count; i++) parent[i] = i;
	const find = (i: number): number => {
		let root = i;
		while ((parent[root] as number) !== root) root = parent[root] as number;
		while ((parent[i] as number) !== root) {
			const next = parent[i] as number;
			parent[i] = root;
			i = next;
		}
		return root;
	};
	const union = (a: number, b: number): void => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[rb] = ra;
	};
	const welded = new Map<string, number>();
	for (let i = 0; i < count; i++) {
		const key = `${Math.round((mesh.positions[i * 3] as number) * 1e4)},${Math.round((mesh.positions[i * 3 + 1] as number) * 1e4)},${Math.round((mesh.positions[i * 3 + 2] as number) * 1e4)}`;
		const first = welded.get(key);
		if (first === undefined) welded.set(key, i);
		else union(first, i);
	}
	for (let t = 0; t < mesh.indices.length; t += 3) {
		const a = mesh.indices[t] as number;
		const b = mesh.indices[t + 1] as number;
		const c = mesh.indices[t + 2] as number;
		union(a, b);
		union(b, c);
	}
	const roots = new Set<number>();
	for (let t = 0; t < mesh.indices.length; t += 3) roots.add(find(mesh.indices[t] as number));
	return roots.size;
}
