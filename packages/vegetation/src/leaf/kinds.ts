// The foliage kinds: one leaf builder per kind, each a lazy chunk of the generator's job-worker
// task, so a page that grows only broadleaves never downloads the frond builder. `loadFoliage` loads
// a kind's builder once per thread; `foliage` hands it back on the same thread without a promise.
import type { PrototypeArrays } from '../asset';
import type { FoliageKind, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import type { Detail } from '../core/types';

/**
 * One foliage kind's code: the species' leaf meshes at one detail tier, which the shoot prototypes
 * place at their nodes, the merged foliage reuses, and the 'leaf' cutting draws.
 *
 * @category api/vegetation
 */
export interface FoliageBuilder {
	/**
	 * The species' leaf meshes at one tier: a blade, a needle, a fascicle, a spray or a frond. `age`
	 * names how far the leaf has opened, for the kinds that grow through a shape a picture can show;
	 * absent, the leaf is drawn as it stands on a mature plant.
	 */
	leaves(
		record: Species,
		manifest: TextureManifest,
		detail: Detail,
		age?: number,
	): readonly PrototypeArrays[];
}

/** A plant with no leaves, such as a bare saguaro, builds none. */
const NO_LEAVES: FoliageBuilder = { leaves: () => [] };

/** Each kind's builder, as a lazy chunk. */
const KINDS: Readonly<Record<FoliageKind, () => Promise<{ readonly builder: FoliageBuilder }>>> = {
	blade: () => import('./leaf-mesh'),
	needle: () => import('./needle'),
	fascicle: () => import('./fascicle'),
	'scale-spray': () => import('./scale-spray'),
	frond: () => import('./frond'),
	'grass-blade': () => import('./grass-blade'),
	thick: () => import('./thick-leaf'),
	none: async () => ({ builder: NO_LEAVES }),
};

/** The builders this thread has loaded. */
const loaded = new Map<FoliageKind, FoliageBuilder>();

/**
 * Loads a foliage kind's builder on this thread, once.
 *
 * @param kind The foliage kind.
 * @returns Its builder.
 */
export async function loadFoliage(kind: FoliageKind): Promise<FoliageBuilder> {
	const known = loaded.get(kind);
	if (known) return known;
	const { builder } = await KINDS[kind]();
	loaded.set(kind, builder);
	return builder;
}

/**
 * The builder of a foliage kind that this thread has loaded.
 *
 * @param kind The foliage kind.
 * @returns Its builder.
 */
export function foliage(kind: FoliageKind): FoliageBuilder {
	const known = loaded.get(kind);
	if (!known)
		throw new Error(
			`@null3d/vegetation: the '${kind}' leaf builder is not loaded on this thread; await loadPlantCode(record) first`,
		);
	return known;
}
