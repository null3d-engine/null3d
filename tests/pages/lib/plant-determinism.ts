// The species that the plant determinism test grows, and how: every species of the registry, with
// its stages as they are, and the stand-in species, with stand-ins for the stages that are not
// built yet. The page grows them in a job worker and the test grows them again in its own process,
// so both read this one list. It imports only the plant core's engine-free modules.
import type { SpeciesModule } from '../../../packages/vegetation/src/core/record.ts';
import { loadSpecies, speciesIds } from '../../../packages/vegetation/src/core/registry.ts';
import { standInSpecies } from '../../../packages/vegetation/src/core/stand-in.ts';
import type { GrowOptions } from '../../../packages/vegetation/src/generate.ts';

/** The growth that every species takes: variant 0 of one seed, with its nearest wood. */
export const DETERMINISM_GROWTH: GrowOptions = { seed: 11, variant: 0, near: true };

/**
 * One species to grow: its id, its module and which stages its kit grows as stand-ins: every stage,
 * or only those not built yet.
 */
export interface DeterminismEntry {
	readonly id: string;
	readonly load: () => Promise<SpeciesModule>;
	readonly placeholders: true | 'missing';
}

/** Every species to grow, the stand-in last. */
export function determinismEntries(): DeterminismEntry[] {
	return [
		...speciesIds().map((id) => ({
			id,
			load: () => loadSpecies(id),
			placeholders: 'missing' as const,
		})),
		{ id: 'stub', load: async () => standInSpecies('stub'), placeholders: true as const },
	];
}

/** One species' digest, as the page and the test report it. */
export interface GrownDigest {
	readonly id: string;
	readonly digest: string;
}
