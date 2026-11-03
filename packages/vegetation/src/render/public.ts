// The public names of the plant core's page side: preparing a species, its materials, placing its
// copies and the scene's near pool.
export { type PlantMaterial, type PlantMaterials, plantMaterials, setWindLayer } from './material';
export { createNearPool, type NearPool, type NearPoolOptions } from './near-pool';
export {
	type PlacedPlants,
	type PlaceOptions,
	type PlantCopies,
	placePlants,
} from './place';
export { prepareSpecies, type SpeciesKit, type SpeciesTextures } from './textures';
