// The species registry's functions: the ids of every species folder, and each species' module and
// shape code loaded on first use. The registry itself is generated from the folders (species/
// registry.generated.ts), so a species adds files only and no worker edits a shared list.
import { SPECIES, SPECIES_HOOKS, type SpeciesId } from '../species/registry.generated';
import type { SpeciesHooks, SpeciesModule } from './record';

export type { SpeciesId };

/** Each species folder's loader, keyed by any text, for a lookup by a page's parameter. */
const LOADERS = SPECIES as Readonly<
	Record<string, () => Promise<{ readonly species: SpeciesModule }>>
>;
const HOOK_LOADERS = SPECIES_HOOKS as Readonly<
	Record<string, (() => Promise<{ readonly hooks: SpeciesHooks }>) | undefined>
>;

/**
 * The id of every species folder, sorted.
 *
 * @returns The ids.
 * @category api/vegetation
 */
export function speciesIds(): readonly SpeciesId[] {
	return Object.keys(LOADERS).sort() as SpeciesId[];
}

/**
 * Whether a text names a species folder, such as a page's query parameter.
 *
 * @param id The text.
 * @returns True when a species folder has that name.
 * @category api/vegetation
 */
export function isSpeciesId(id: string): id is SpeciesId {
	return Object.hasOwn(LOADERS, id);
}

/**
 * Loads a species: its record, its texture files and their manifest. The species is a chunk of its
 * own, so a page fetches only the species it asks for. Its textures load later, when a page
 * prepares it.
 *
 * @param id The species' id.
 * @returns Its module.
 * @category api/vegetation
 */
export async function loadSpecies(id: SpeciesId): Promise<SpeciesModule> {
	const loader = LOADERS[id];
	if (!loader)
		throw new Error(
			`@null3d/vegetation: no species is named '${id}'. The species are: ${speciesIds().join(', ') || 'none yet'}.`,
		);
	return (await loader()).species;
}

/** The hooks each species has loaded on this thread; null where a species has none. */
const loadedHooks = new Map<string, SpeciesHooks | null>();

/**
 * Loads a species' own shape code on this thread, once, if its folder has any.
 *
 * @param id The species' id.
 * @returns Its hooks, or undefined.
 */
export async function loadSpeciesHooks(id: string): Promise<SpeciesHooks | undefined> {
	if (loadedHooks.has(id)) return loadedHooks.get(id) ?? undefined;
	const loader = HOOK_LOADERS[id];
	const hooks = loader ? (await loader()).hooks : null;
	loadedHooks.set(id, hooks);
	return hooks ?? undefined;
}

/**
 * The shape code a species has loaded on this thread, if any.
 *
 * @param id The species' id.
 * @returns Its hooks, or undefined.
 */
export function speciesHooks(id: string): SpeciesHooks | undefined {
	return loadedHooks.get(id) ?? undefined;
}
