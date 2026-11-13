// The growth models: one grower per model, each a lazy chunk of the generator's job-worker task, so
// a page that grows only broadleaves never downloads the palm grower. `loadGrower` loads a model's
// grower once per thread; `grower` hands it back on the same thread without a promise, so the stage
// functions stay synchronous after the kit stage has loaded the species' code.

import type { MeshArrays } from '../asset';
import type { MacroSkeleton } from '../core/graph';
import type { GrowthModel, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import type { PieceClass } from '../leaf/ground-piece';
import type { GrowInput, MeshInput, MeshLevel } from '../stages';

/**
 * One growth model's code: the skeleton it grows, the merged foliage of a species whose nearest
 * level draws its leaves in the variant's own mesh, and the classes of piece of a species whose
 * skeleton carries sockets.
 *
 * @category api/vegetation
 */
export interface Grower {
	/** Grows a variant's skeleton and bud sites. */
	grow(input: GrowInput): MacroSkeleton;
	/** Meshes a 'merged' species' foliage at a level: fronds, rosette leaves, blades. */
	foliage?(input: MeshInput, level: MeshLevel): MeshArrays;
	/**
	 * The classes of piece the model's sockets name, in the order their vigor bands stand: the kit
	 * builds a prototype of each, as it builds a tree's shoots.
	 */
	pieces?(record: Species, manifest: TextureManifest): readonly PieceClass[];
}

/** Each model's grower, as a lazy chunk. */
const GROWERS: Readonly<Record<GrowthModel, () => Promise<{ readonly grower: Grower }>>> = {
	'self-organizing': () => import('./self-organizing'),
	architectural: () => import('./architectural'),
	'crown-rosette': () => import('./crown-rosette'),
	culm: () => import('./culm'),
	rosette: () => import('./rosette'),
	'frond-colony': () => import('./frond-colony'),
	tuft: () => import('./tuft'),
	column: () => import('./column'),
};

/** The growers this thread has loaded. */
const loaded = new Map<GrowthModel, Grower>();

/**
 * Loads a growth model's grower on this thread, once.
 *
 * @param model The growth model.
 * @returns Its grower.
 */
export async function loadGrower(model: GrowthModel): Promise<Grower> {
	const known = loaded.get(model);
	if (known) return known;
	const { grower } = await GROWERS[model]();
	loaded.set(model, grower);
	return grower;
}

/**
 * The grower of a model that this thread has loaded.
 *
 * @param model The growth model.
 * @returns Its grower.
 */
export function grower(model: GrowthModel): Grower {
	const known = loaded.get(model);
	if (!known)
		throw new Error(
			`@null3d/vegetation: the '${model}' grower is not loaded on this thread; await loadPlantCode(record) first`,
		);
	return known;
}
