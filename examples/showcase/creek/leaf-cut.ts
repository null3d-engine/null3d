// The maples' far leaves, for the lowest quality tier only. While the tier applies, a leaf copy
// past the cut distance draws nothing, so the crowns that the tier keeps everywhere still shed the
// pixels the far ones take; while the tier is off, the file's own levels come back. The maples'
// wood is untouched either way.
import type { MeshGeometry, MeshLevel, SketchContext } from '@null3d/engine';

/** The distance past which the maples' leaves draw nothing while the lowest tier applies, in meters. */
export const FAR_LEAVES = 60;

/**
 * The leaves' levels with the far cut: the file's levels that switch before the cut are kept, and a
 * level at the cut draws an empty mesh. The maple's own levels are error levels that switch past
 * the cut, so the cut leaves the empty level alone and every copy past the cut draws no leaves.
 */
export function farLeafLevels(
	levels: readonly MeshLevel[],
	empty: MeshGeometry,
	cut = FAR_LEAVES,
): MeshLevel[] {
	// The switches must grow, so only the levels that switch before the cut stay in front of it.
	const kept = levels.filter((level) => level.distance !== undefined && level.distance < cut);
	return [...kept, { mesh: empty, distance: cut, fade: false }];
}

/** The sketch's quality as the lowest tier reports it, where the engine carries the tier. */
interface TieredQuality {
	/** What the frame-budget governor has lowered, whose `lowest` names the tier. */
	readonly governor?: { readonly lowest?: boolean };
	/** Calls the handler after each change of the quality settings, once the tier's cuts apply. */
	readonly onChange?: (handler: () => void) => () => void;
}

/**
 * Applies the far leaves while the lowest tier is active, and gives the file's levels back when it
 * is not. Returns the function that stops watching. On an engine without the tier the leaves keep
 * their levels.
 */
export function watchFarLeaves(ctx: SketchContext, leaves: MeshGeometry): () => void {
	const tier = ctx.quality as unknown as TieredQuality;
	if (tier.onChange === undefined) return () => {};
	// An empty level draws no triangles: three positions fill its bounds and no index draws them.
	const empty = ctx.geometry.fromArrays({
		positions: new Float32Array(9),
		normals: new Float32Array(9),
		indices: new Uint32Array(0),
	});
	const own = leaves.levels;
	let cut = false;
	const apply = (): void => {
		const on = tier.governor?.lowest === true;
		if (on === cut) return;
		cut = on;
		leaves.setLevels(on ? farLeafLevels(own, empty) : own, { fade: false });
	};
	apply();
	return tier.onChange(apply);
}
