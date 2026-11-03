// The first plant generator, at `@null3d/vegetation/legacy`: trees, conifers, shrubs, ferns, hostas
// and grass clumps grown from a short record of numbers and a seed, with the bark and leaf atlases
// that the browser paints, the plant material, the per-vertex wind and the far tree. The plant core
// at the add-on's main entry replaces it; the demos and test pages read it from here until they move.
// The main entry loads first, so the add-on's version check and namespace run once for both.
import '../index';
import { runTask } from '@null3d/engine';
import type { PlantAsset } from './asset';
import type { GenerateOptions } from './generate';
import type { Species } from './species';

export type {
	ImpostorSource,
	PartName,
	PlantAsset,
	PlantLevel,
	PlantPart,
	PlantStats,
	WindData,
} from './asset';
export { SHADOW_CASTER_MIN_TRIANGLES, shadowCasterLevel } from './asset';
export type {
	AtlasMap,
	LeafCell,
	PlantAtlas,
	PlantAtlases,
	PlantMaterial,
	PlantMaterialOptions,
	PlantMaterialPart,
	PlantMorph,
} from './atlas';
export {
	BARK_CELLS_BY_KIND,
	bakePlantAtlases,
	barkCellFor,
	LEAF_CELLS_BY_KIND,
	leafCellFor,
	plantMaterial,
} from './atlas';
export type { AtlasPixels, PaintedAtlas } from './atlas-pixels';
export { paintBark, paintLeaf } from './atlas-pixels';
export type { PartArrays } from './builder';
export {
	ALL_SPECIES,
	BUILTIN_SPECIES,
	builtInSpecies,
	CREEK_SPECIES,
} from './builtin';
export type { CrownData } from './crown';
export type { GenerateOptions } from './generate';
export { generatePlant, generateVariantSet, WIND_STRIDE } from './generate';
export type { FarTree, FarTreeOptions } from './impostor';
export { bakeFarTree, handOverToCards } from './impostor';
export type { PlantWind, PlantWindOptions } from './plant';
export { plantWind, setWindLayer, treeValues } from './plant';
export {
	builtinRules,
	type SpeciesRuleFields,
	speciesCrownRadius,
	speciesRule,
} from './rules';
export type {
	BarkCellName,
	BranchLevel,
	Crown,
	CrownShape,
	Leaf,
	LeafCellName,
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
export { PLANT_SWAY_DISTANCE, swayDistanceFor } from './wind-presets';

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
		{ name: 'vegetation-legacy', script: new URL('./generate-task.ts', import.meta.url) },
		{
			species,
			seed: options.seed,
			variant: options.variant,
			levels: options.levels,
		},
	);
}
