// The vegetation add-on for null3D. The plant core grows each species from a record in its own
// folder: a macro skeleton per variant, shoot prototypes per species, real leaves near the camera
// and cards beyond, wood with bark in metres, one plant shader, and wind records per axis. The main
// entry also holds the scatter that places plants by ecological rules, the ground maps it reads, the
// grass and the floating leaves. Until a species ships, a page grows a stand-in of its size and
// colours in its place. Each module keeps its public names in its own `public.ts`, and this file only
// re-exports them. Built on the engine's public API only.
import { checkAddonVersion, declareAddonNamespace } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/vegetation', VERSION);

/**
 * The add-on's names, claimed once as the page loads: its error codes and its quality keys.
 *
 * @category api/vegetation
 */
export const NAMESPACE = declareAddonNamespace({
	name: 'vegetation',
	package: '@null3d/vegetation',
	errorCodes: [2300, 2399],
});

export {
	type CardCell,
	type MeshArrays,
	type PartName,
	type PlantAsset,
	type PlantLevel,
	type PlantPart,
	type PrototypeArrays,
	plantAssetBuffers,
	plantAssetDigest,
	plantPartBuffers,
	type QuantisedArrays,
	type ShootPrototype,
	type ShootRows,
	type SpeciesKitData,
	type WindTable,
} from './asset';
export { type CoarsenessOptions, nearTriangles } from './coarseness';
export * from './core/public';
export * from './crown/public';
export { CUTTING_LENGTH, type CuttingOptions, type CuttingPart } from './cutting';
export * from './ecology/public';
export * from './floating-leaves/public';
export {
	bakeFarNow,
	buildKitNow,
	GENERATOR_VERSION,
	type GrowOptions,
	growNearWoodNow,
	growPlantNow,
	type KitOptions,
	type KitSource,
	kitKey,
	loadPlantCode,
	variantKey,
} from './generate';
export * from './grass/public';
export * from './grid/public';
export * from './ground/public';
export * from './grow/public';
export * from './leaf/public';
export * from './lod/public';
export * from './render/public';
export * from './scatter/public';
export type { FarBake } from './stages';
export { bakeFarPlant, buildKit, growNearWood, growPlant, type PageKitOptions } from './tasks';
export * from './variance/public';
export * from './wind/public';
export * from './wood/public';
