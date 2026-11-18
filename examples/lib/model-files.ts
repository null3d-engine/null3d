// The showcase scenes' Blender model files (tools/samples/blender/) as plain data: each file's path
// in the sample content, and each of its materials in the file's order, with the texture slots that
// it fills and the parts that it draws. A scene finds a part's textures by these lists
// (`examples/lib/blender-models.ts`), and `tools/samples/blender/models.test.ts` checks each list
// against the pinned file it names.

/** A texture slot of a material of the scripts. */
export type Slot = 'map' | 'orm' | 'normal';

/** The slots that a material of the scripts fills, in the order the loader makes their textures. */
export type Slots = readonly Slot[];

/** A cutout card's material: its base color alone. */
export const CUTOUT: Slots = ['map'];
/** A bark's or a rock's material: its base color, its packed occlusion and roughness, its normals. */
export const SURFACE: Slots = ['map', 'orm', 'normal'];

/** One material of a file: the slots it fills and the names of the parts it draws. */
export interface ModelMaterial {
	readonly slots: Slots;
	readonly parts: readonly string[];
}

/** One model file: its path in the sample content and its materials, in the file's order. */
export interface ModelFile {
	readonly path: string;
	readonly materials: readonly ModelMaterial[];
}

/** Creek's files: its trees, its bank plants and its cave mouth. */
export const CREEK_FILES = {
	trees: {
		path: 'sources/showcase/creek/trees.glb',
		materials: [
			{ slots: CUTOUT, parts: ['oak-leaves', 'beech-leaves', 'birch-leaves'] },
			{ slots: SURFACE, parts: ['beech-wood'] },
			{ slots: SURFACE, parts: ['birch-wood'] },
			{ slots: SURFACE, parts: ['oak-wood'] },
		],
	},
	plants: {
		path: 'sources/showcase/creek/plants.glb',
		materials: [
			{ slots: CUTOUT, parts: ['fern'] },
			{ slots: CUTOUT, parts: ['flowers'] },
			{ slots: CUTOUT, parts: ['hosta'] },
			{ slots: CUTOUT, parts: ['shrub'] },
		],
	},
	cave: {
		path: 'sources/showcase/creek/cave.glb',
		materials: [{ slots: SURFACE, parts: ['cave'] }],
	},
} as const satisfies Record<string, ModelFile>;

/** The materials of one island plant: its card, its leaves and its wood, in the files' order. */
const islandPlant = (plant: string): ModelMaterial[] => [
	{ slots: CUTOUT, parts: [`${plant}-card`] },
	{ slots: CUTOUT, parts: [`${plant}-leaves`] },
	{ slots: SURFACE, parts: [`${plant}-wood`] },
];

/** The island's files: its trees and its shrubs. */
export const ISLAND_FILES = {
	trees: {
		path: 'sources/showcase/island/trees.glb',
		materials: [...islandPlant('holm-oak'), ...islandPlant('olive'), ...islandPlant('stone-pine')],
	},
	shrubs: {
		path: 'sources/showcase/island/shrubs.glb',
		materials: islandPlant('oleander'),
	},
} as const satisfies Record<string, ModelFile>;
