// The plant core's types that the review page's cameras read. The review tools' unit tests check
// these modules in the root project, which carries no browser types, so they take the types from
// the plant core's own modules rather than from the package's entry, which brings in the engine.
export type {
	PlantAsset,
	PlantPart,
	ShootPrototype,
	ShootRows,
	SpeciesKitData,
} from '../../../../packages/vegetation/src/asset';
export type { SpeciesBox } from '../../../../packages/vegetation/src/core/box';
export type { MacroSkeleton } from '../../../../packages/vegetation/src/core/graph';
export type { Detail } from '../../../../packages/vegetation/src/core/types';
