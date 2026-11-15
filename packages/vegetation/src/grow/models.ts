// The growth models: one grower per model, each a lazy chunk of the generator's job-worker task, so
// a page that grows only broadleaves never downloads the palm grower. `loadGrower` loads a model's
// grower once per thread; `grower` hands it back on the same thread without a promise, so the stage
// functions stay synchronous after the kit stage has loaded the species' code.

import type { MeshArrays } from '../asset';
import type { MacroSkeleton } from '../core/graph';
import type { GrowthModel, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import type { WrittenPiece } from '../leaf/ground-piece';
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
	 * The pieces the model's sockets carry, which its grower writes itself, in the order a socket
	 * names them by: the kit holds each part as a prototype, as it holds a tree's branch pieces.
	 */
	pieces?(record: Species, manifest: TextureManifest): readonly WrittenPiece[];
}

/** Each model's grower, as a lazy chunk. */
const GROWERS: Readonly<Record<GrowthModel, () => Promise<{ readonly grower: Grower }>>> = {
	'self-organizing': () => import('./self-organizing'),
	scaffold: () => import('./scaffold'),
	frame: () => import('./frame'),
	architectural: () => import('./architectural'),
	conifer: () => import('./conifer'),
	'crown-rosette': () => import('./crown-rosette'),
	'frond-crown': () => import('./frond-crown'),
	culm: () => import('./culm'),
	'culm-clump': () => import('./culm-clump'),
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
