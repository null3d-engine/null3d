// The growth models: one grower per model, each a lazy chunk of the generator's job-worker task, so
// a page that grows only broadleaves never downloads the palm grower. `loadGrower` loads a model's
// grower once per thread; `grower` hands it back on the same thread without a promise, so the stage
// functions stay synchronous after the kit stage has loaded the species' code.

import type { MeshArrays } from '../asset';
import { formRecord } from '../core/forms';
import type { MacroSkeleton } from '../core/graph';
import type { GrowthModel, Species } from '../core/record';
import type { TextureManifest } from '../core/textures';
import type { WrittenPiece } from '../leaf/ground-piece';
import type { DetailPlan, GrowInput, GrowRequest, MeshInput, MeshLevel } from '../stages';

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
	/**
	 * What one state of the plant costs, as numbers, before any geometry is built: the plan a model
	 * that grows straight to the asked state builds to. Absent on a model that plans as it grows.
	 */
	plan?(record: Species, request: GrowRequest): DetailPlan;
	/** Meshes a 'merged' species' foliage at a level: fronds, rosette leaves, blades. */
	foliage?(input: MeshInput, level: MeshLevel): MeshArrays;
	/**
	 * The pieces the model's sockets carry, which its grower writes itself, in the order a socket
	 * names them by: the kit holds each part as a prototype, as it holds a tree's branch pieces.
	 */
	pieces?(record: Species, manifest: TextureManifest): readonly WrittenPiece[];
}

/** A model's grower, with the grower its planned adult uses where it has one apart from them. */
interface GrowerModule {
	readonly grower: Grower;
	/** The same family's grower for the planned model's adult, where the family carries one. */
	readonly plannedGrower?: Grower;
}

/** Each model's grower, as a lazy chunk. */
const GROWERS: Readonly<Record<GrowthModel, () => Promise<GrowerModule>>> = {
	'self-organizing': () => import('./self-organizing'),
	scaffold: () => import('./scaffold'),
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
	planned: () => import('./planned'),
};

/** The growers this thread has loaded. */
const loaded = new Map<GrowthModel, Grower>();

/** The planned adult each family's chunk writes, by the family's model. */
const plannedAdults = new Map<GrowthModel, Grower>();

/**
 * Loads a growth model's grower on this thread, once.
 *
 * @param model The growth model.
 * @returns Its grower.
 */
export async function loadGrower(model: GrowthModel): Promise<Grower> {
	const known = loaded.get(model);
	if (known) return known;
	const module = await GROWERS[model]();
	loaded.set(model, module.grower);
	if (module.plannedGrower) plannedAdults.set(model, module.plannedGrower);
	return module.grower;
}

/**
 * The family whose grower serves a record: a planned tuft's adult, its pieces and its stool are the
 * tuft family's, so the planned model never carries the tuft's geometry itself.
 *
 * @param record The species record.
 * @returns The model whose grower serves it.
 * @category api/vegetation
 */
export function familyModel(record: Species): GrowthModel {
	const growth = record.growth;
	return growth.model === 'planned' && growth.adult === 'tuft' ? 'tuft' : growth.model;
}

/**
 * The grower a record's plant uses. A planned adult asks its family's planned grower, and any other
 * record asks its own model's grower.
 *
 * @param record The species record.
 * @returns Its grower.
 * @category api/vegetation
 */
export function plantGrower(record: Species): Grower {
	const model = familyModel(record);
	if (model === record.growth.model) return grower(model);
	const planned = plannedAdults.get(model);
	if (!planned)
		throw new Error(
			`@null3d/vegetation: the planned '${model}' adult is not loaded on this thread; await loadPlantCode(record) first`,
		);
	return planned;
}

/**
 * Loads the grower a record's plant uses, and every form's, on this thread.
 *
 * @param record The species record.
 * @category api/vegetation
 */
export async function loadPlantGrowers(record: Species): Promise<void> {
	const models = new Set<GrowthModel>([familyModel(record)]);
	for (const name of Object.keys(record.forms ?? {}))
		models.add(familyModel(formRecord(record, name)));
	await Promise.all([...models].map((model) => loadGrower(model)));
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
