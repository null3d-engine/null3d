// The vegetation add-on for null3D: trees, conifers, shrubs, ferns, hostas and grass grown from a
// short record of numbers and a seed. The generator makes every random choice in the skeleton, then
// meshes every detail level from it, so a crown keeps its shape as it thins. The asset carries wind
// data and the crown's bounds for the leaf and bark materials, and the source that a far card bakes
// from. Built on the engine's public API only.
import { checkAddonVersion, declareAddonNamespace, runTask } from '@null3d/engine';
import type { PlantAsset } from './asset';
import type { GenerateOptions } from './generate';
import type { Species } from './species';
import { VERSION } from './version';

checkAddonVersion('@null3d/vegetation', VERSION);

/**
 * The add-on's names, claimed once as the page loads: its error codes and its quality keys.
 *
 * @category api/vegetation
 */
export const NAMESPACE = declareAddonNamespace({ name: 'vegetation', errorCodes: [2300, 2399] });

export type {
	ImpostorSource,
	PartName,
	PlantAsset,
	PlantLevel,
	PlantPart,
	PlantStats,
	WindData,
} from './asset';
export type { PartArrays } from './builder';
export {
	ALL_SPECIES,
	BUILTIN_SPECIES,
	builtInSpecies,
	CREEK_SPECIES,
} from './builtin';
export type { CrownData } from './crown';
export {
	checkRules,
	type EcoCluster,
	type EcoInput,
	type EcoLayer,
	type EcoRule,
	LAYER_ORDER,
	ruleScore,
	type ToleranceCurve,
	toleranceScore,
} from './ecology';
export type { GenerateOptions } from './generate';
export { generatePlant, generateVariantSet, WIND_STRIDE } from './generate';
export { Grid } from './grid';
export {
	type GroundMaps,
	type GroundMask,
	type GroundOptions,
	type GroundSampler,
	type GroundShape,
	type GroundSource,
	groundMaps,
	maskValue,
} from './ground';
export {
	builtinRules,
	type SpeciesRuleFields,
	speciesCrownRadius,
	speciesRule,
} from './rules';
export {
	EcoScatter,
	SCATTER_LAYOUT,
	SCATTER_STRIDE,
	type ScatterOptions,
	type ScatterPoints,
	scatterChecksum,
	scatterVegetation,
} from './scatter';
export type {
	BranchLevel,
	Crown,
	CrownShape,
	Leaf,
	LeafKind,
	Rosette,
	Species,
	SpeciesColor,
	SpeciesKind,
	Wind,
} from './species';
export {
	branchLevel,
	checkSpecies,
	DEFAULT_VARIANTS,
	MAX_BRANCHES,
	MAX_LEVELS,
	speciesProblems,
} from './species';
export { type VarianceMaps, type VarianceOptions, varianceMaps } from './variance';

/**
 * Grows one plant in a job worker, beside the frames, and resolves with its asset. The work is the
 * same as {@link generatePlant}, so a page gets the same plant whether it waits for the worker or
 * calls the generator directly.
 *
 * @param species The species record.
 * @param options The seed, the variant and the levels to build.
 * @returns A promise for the plant's asset.
 * @category api/vegetation
 */
export function generatePlantInTask(
	species: Species,
	options: GenerateOptions,
): Promise<PlantAsset> {
	return runTask<PlantAsset>(
		{ name: 'vegetation', script: new URL('./generate-task.ts', import.meta.url) },
		{
			species,
			seed: options.seed,
			variant: options.variant,
			levels: options.levels,
		},
	);
}
