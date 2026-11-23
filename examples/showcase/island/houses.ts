// The island's houses: thirteen Mediterranean forms, one for each kind that the town plan's lots
// name. A script builds them in Blender (tools/samples/blender/island-houses.py), and the asset tool
// optimizes them, so they load as a developer ships models: quantized meshes and KTX2 textures. They
// live in the sample-assets repository, packed into one file.
//
// A form is a node for each material it uses, such as `house-balcony-walls` or `house-balcony-roof`,
// with two lower levels of detail. The town draws each node as one instance batch over the lots of
// its kind, so a form's hundreds of copies cost a few draw calls and each copy picks its own level.
// A plot keeps its approved footprint, height and yaw: every form stands at its kind's own extents,
// with the front toward +z, as the code-built house forms do.
import type { InstanceBatch, SketchContext } from '@null3d/engine';
import { type Part, partsOf, type Stand, standPart } from '../../lib/blender-models';
import { sampleUrl } from '../../lib/samples';

/** The parts that a house's file may hold. The walls and the roof are always there. */
export const HOUSE_PARTS = ['walls', 'trim', 'roof', 'timber', 'glass', 'paint', 'vine'] as const;
export type HousePartName = (typeof HOUSE_PARTS)[number];

/** A house's parts. A form that has no shutters, trim or leaves leaves them out. */
export interface HouseParts {
	readonly walls: Part;
	readonly roof: Part;
	readonly trim: Part | undefined;
	readonly timber: Part | undefined;
	readonly glass: Part | undefined;
	readonly paint: Part | undefined;
	readonly vine: Part | undefined;
}

/** One form of house, and the plan's house kind that it stands. */
export interface HouseModel {
	readonly kind: number;
	readonly form: string;
	readonly parts: HouseParts;
}

/** A lot as the houses read it: its ground point, its turn and its kind. */
export interface HouseLot {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly yaw: number;
	readonly kind: number;
}

/** The one file that holds every house form. */
export const HOUSES_MODEL = sampleUrl('sources/showcase/island-houses/houses.glb');

/**
 * Each house kind, as `kit.ts` numbers it, and the form that stands it. The forms cover a country
 * farmhouse, a villa, an L-shaped house, a roof terrace, a long arcade, a veranda, a courtyard, and
 * the town's balcony house, shop, loggia, stone block, cottage and roof terrace.
 */
export const HOUSE_MODELS: readonly { readonly kind: number; readonly form: string }[] = [
	{ kind: 0, form: 'farm' },
	{ kind: 1, form: 'villa' },
	{ kind: 2, form: 'wing' },
	{ kind: 3, form: 'terrace' },
	{ kind: 4, form: 'arcade' },
	{ kind: 5, form: 'veranda' },
	{ kind: 6, form: 'courtyard' },
	{ kind: 7, form: 'balcony' },
	{ kind: 8, form: 'shop' },
	{ kind: 9, form: 'loggia' },
	{ kind: 10, form: 'block' },
	{ kind: 11, form: 'cottage' },
	{ kind: 12, form: 'roof-terrace' },
];

/** The name of one part of one form in the file. */
export function partName(form: string, part: HousePartName): string {
	return `house-${form}-${part}`;
}

/** A part that the file may leave out, such as a house whose walls carry all its stone. */
function optionalPart(part: (name: string) => Part, name: string): Part | undefined {
	try {
		return part(name);
	} catch {
		return undefined;
	}
}

/**
 * Loads the forms from the file. A form without its walls or its roof is left out, so the town
 * keeps that kind's code-built house instead of a broken one.
 */
export async function loadHouses({
	assets,
}: SketchContext): Promise<readonly (HouseModel | undefined)[]> {
	const part = partsOf(await assets.loadGltf(HOUSES_MODEL));
	return HOUSE_MODELS.map(({ kind, form }) => {
		const walls = optionalPart(part, partName(form, 'walls'));
		const roof = optionalPart(part, partName(form, 'roof'));
		if (!walls || !roof) return undefined;
		return {
			kind,
			form,
			parts: {
				walls,
				roof,
				trim: optionalPart(part, partName(form, 'trim')),
				timber: optionalPart(part, partName(form, 'timber')),
				glass: optionalPart(part, partName(form, 'glass')),
				paint: optionalPart(part, partName(form, 'paint')),
				vine: optionalPart(part, partName(form, 'vine')),
			},
		};
	});
}

/**
 * The stands of each house kind: the lots that name it, in the plan's order, ready for a form's
 * parts. A kind with no lots holds an empty list.
 */
export function standsByKind(
	lots: readonly HouseLot[],
	kinds: number,
): readonly (readonly Stand[])[] {
	const byKind: Stand[][] = Array.from({ length: kinds }, () => []);
	for (const lot of lots) {
		if (lot.kind < 0 || lot.kind >= kinds) continue;
		(byKind[lot.kind] as Stand[]).push({ x: lot.x, y: lot.y, z: lot.z, yaw: lot.yaw, size: 1 });
	}
	return byKind;
}

/**
 * Stands one form's parts over the stands of its kind, and returns their batches. A part that fails
 * takes back the batches already made, so a kind never half stands in its model form.
 */
export function standHouse(
	ctx: SketchContext,
	model: HouseModel,
	stands: readonly Stand[],
): InstanceBatch[] {
	const made: InstanceBatch[] = [];
	try {
		for (const name of HOUSE_PARTS) {
			const part = model.parts[name];
			if (part) made.push(standPart(ctx, part, stands, part.material));
		}
	} catch (error) {
		for (const batch of made) batch.destroy();
		throw error;
	}
	return made;
}
