// The showcase scenes' Blender model files (tools/samples/blender/) as plain data: each file's path
// in the sample content, and the texture slots that each of its materials fills, in the file's
// material order. A scene finds its textures by these layouts (`blender-models.ts`), and
// `tools/samples/blender/models.test.ts` checks each layout against the pinned file it names.

/** A texture slot of a material of the scripts. */
export type Slot = 'map' | 'orm' | 'normal';

/** The slots that a material of the scripts fills, in the order the loader makes their textures. */
export type Slots = readonly Slot[];

/** A cutout card's material: its base color alone. */
export const CUTOUT: Slots = ['map'];
/** A bark's or a rock's material: its base color, its packed occlusion and roughness, its normals. */
export const SURFACE: Slots = ['map', 'orm', 'normal'];

/** One model file: its path in the sample content and its materials' slots. */
export interface ModelFile {
	readonly path: string;
	readonly layout: readonly Slots[];
}

/** Creek's files: its trees, its bank plants and its cave mouth. */
export const CREEK_FILES = {
	trees: {
		path: 'sources/showcase/creek/trees.glb',
		// The leaves, then the beech's, the birch's and the oak's bark.
		layout: [CUTOUT, SURFACE, SURFACE, SURFACE],
	},
	plants: {
		path: 'sources/showcase/creek/plants.glb',
		// The fern, the flowers, the hosta and the shrub.
		layout: [CUTOUT, CUTOUT, CUTOUT, CUTOUT],
	},
	cave: { path: 'sources/showcase/creek/cave.glb', layout: [SURFACE] },
} as const satisfies Record<string, ModelFile>;

/** The island's files: its trees and its shrubs. */
export const ISLAND_FILES = {
	trees: {
		path: 'sources/showcase/island/trees.glb',
		// The holm oak's card, leaves and bark, then the olive's and the stone pine's.
		layout: [CUTOUT, CUTOUT, SURFACE, CUTOUT, CUTOUT, SURFACE, CUTOUT, CUTOUT, SURFACE],
	},
	shrubs: {
		path: 'sources/showcase/island/shrubs.glb',
		// The oleander's card, its leaves and flowers, and its stems.
		layout: [CUTOUT, CUTOUT, SURFACE],
	},
} as const satisfies Record<string, ModelFile>;
