// The island's hero landmarks: its domed church with a bell tower, its hilltop keep, its harbour
// lighthouse and three harbour-front houses. A script builds them in Blender
// (tools/samples/blender/island-town.py), and the asset tool optimizes them, so they load as a
// developer ships models: quantized meshes and KTX2 textures. They live in the sample-assets
// repository, packed into one file.
//
// Each landmark is a node for each material it uses, such as `church-walls` or `church-dome`, with
// two lower levels of detail. The town stands every node as one instance batch over its copies, so
// the keeps' three copies share one mesh and each copy picks its own level.
import type { SketchContext } from '@null3d/engine';
import { type Part, partsOf } from '../../lib/blender-models';
import { sampleUrl } from '../../lib/samples';

/** The church's parts: its rendered walls, its stone trim, its roofs, its blue dome, its timber and its glass. */
export interface ChurchParts {
	readonly walls: Part;
	readonly stone: Part;
	readonly roof: Part;
	readonly dome: Part;
	readonly wood: Part;
	readonly glass: Part;
}

/** A keep's stone and its dark openings. */
export interface KeepParts {
	readonly stone: Part;
	readonly glass: Part;
}

/** The lighthouse's painted shaft, its stone foot and its lamp room. */
export interface LighthouseParts {
	readonly walls: Part;
	readonly stone: Part;
	readonly glass: Part;
}

/** A harbour-front house's parts. A house without its own roof keeps the code-built one. */
export interface WaterfrontParts {
	readonly walls: Part;
	readonly roof: Part | undefined;
	readonly wood: Part;
	readonly glass: Part;
}

/** Every landmark's parts, as the town stands them. */
export interface Landmarks {
	readonly church: ChurchParts;
	readonly keep: KeepParts;
	readonly lighthouse: LighthouseParts;
	/** The three harbour-front houses, in the order that the town's `waterfrontLots` names them. */
	readonly waterfront: readonly WaterfrontParts[];
}

/** The one file that holds every landmark. */
export const TOWN_MODEL = sampleUrl('sources/showcase/island-town/town.glb');

/** A part that the file may leave out, such as a house that shares another house's roof. */
function optionalPart(part: (name: string) => Part, name: string): Part | undefined {
	try {
		return part(name);
	} catch {
		return undefined;
	}
}

/** Loads the town's model file and reads each landmark's parts from it. */
export async function loadLandmarks({ assets }: SketchContext): Promise<Landmarks> {
	const part = partsOf(await assets.loadGltf(TOWN_MODEL));
	return {
		church: {
			walls: part('church-walls'),
			stone: part('church-stone'),
			roof: part('church-roof'),
			dome: part('church-dome'),
			wood: part('church-wood'),
			glass: part('church-glass'),
		},
		keep: { stone: part('keep-stone'), glass: part('keep-glass') },
		lighthouse: {
			walls: part('lighthouse-walls'),
			stone: part('lighthouse-stone'),
			glass: part('lighthouse-glass'),
		},
		waterfront: ['a', 'b', 'c'].map((variant) => ({
			walls: part(`waterfront-${variant}-walls`),
			roof: optionalPart(part, `waterfront-${variant}-roof`),
			wood: part(`waterfront-${variant}-wood`),
			glass: part(`waterfront-${variant}-glass`),
		})),
	};
}
