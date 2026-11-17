// The body surface: the shared bake's one draw of a model's body axis. The axis gives the course
// and the girth, and the model states how many steps the axis holds; the rings themselves are the
// wood mesher's adaptive ones, so the family's own body mesh is drawn unchanged. The surface has no
// dependency on the grow stage: it takes the axis and the plant's drawing context and returns the
// mesh.
import type { MeshArrays } from '../asset';
import { AXIS_LIMB, type MacroSkeleton, SkeletonBuilder } from '../core/graph';
import { emptyRows } from '../core/placeholder';
import type { Vec3 } from '../core/types';
import type { MeshInput, MeshLevel } from '../stages';
import { meshWoodReport } from '../wood/wood-mesh';

/** One node of a body axis: its place and its radius there, in metres. */
export interface BodyNode {
	readonly at: Vec3;
	readonly radius: number;
}

/** The body's drawn mesh, its rings and its triangles. */
export interface BodySurface {
	/** The axis's mesh: its positions, normals, texture coordinates and indices. */
	readonly mesh: MeshArrays;
	/** The steps the model states for the axis. */
	readonly segments: number;
	/** The rings the adaptive draw placed. */
	readonly rings: number;
	/** The triangles drawn. */
	readonly triangles: number;
}

/**
 * Draws a model's body axis as one surface, at a level.
 *
 * The model states the axis's steps, not the rings the draw places: the wood mesher samples the
 * axis's nodes and radii and crowds or thins its rings as the course bends and the girth curves.
 * So the family's own body mesh is drawn unchanged, and the figure travels with the model without
 * becoming a draw constant. The axis is meshed on its own, so no other axis's weld changes its
 * bytes.
 *
 * @param nodes The body axis's nodes, from its foot to its top.
 * @param segments The steps the model states for the axis.
 * @param input The plant's drawing context: its record, kit, crown, seed and mesh tier.
 * @param level The level the surface is drawn at.
 * @returns The surface's mesh, its rings and its triangles.
 * @category api/vegetation
 */
export function bodySurface(
	nodes: readonly BodyNode[],
	segments: number,
	input: MeshInput,
	level: MeshLevel,
): BodySurface {
	if (nodes.length < 2) throw new Error('@null3d/vegetation: a body axis has at least two nodes');
	if (segments !== nodes.length - 1)
		throw new Error(
			`@null3d/vegetation: a body axis states ${nodes.length - 1} steps, not ${segments}`,
		);
	const builder = new SkeletonBuilder();
	const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_LIMB });
	let previous = -1;
	for (const node of nodes) {
		previous = builder.addNode({
			x: node.at[0] as number,
			y: node.at[1] as number,
			z: node.at[2] as number,
			radius: node.radius,
			parent: previous,
			axis,
			light: 0,
		});
	}
	const skeleton: MacroSkeleton = builder.finish(0);
	// The body is meshed alone: no shoot rows, so no support branch stands beside it.
	const report = meshWoodReport({ ...input, skeleton, rows: emptyRows() }, level);
	const rings = report.axisRings.get(axis)?.count ?? 0;
	return {
		mesh: report.mesh,
		segments,
		rings,
		triangles: report.mesh.indices.length / 3,
	};
}
