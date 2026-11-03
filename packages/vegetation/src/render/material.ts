// The plant materials: one shader with four roles, wood, shoots, cards and merged foliage, with an
// energy-correct two-sided leaf, a tangent frame from derivatives, and occlusion on sky light only.
// It throws until the materials are built.
import type { Material, SketchContext } from '@null3d/engine';
import type { WindField } from '@null3d/wind';
import { notBuilt } from '../core/not-built';
import type { SpeciesKit } from './textures';

/**
 * One plant material: a role of the one plant shader.
 *
 * @category api/vegetation
 */
export type PlantMaterial = Material;

/**
 * The four materials of a species, one per role.
 *
 * @category api/vegetation
 */
export interface PlantMaterials {
	/** Stems, limbs, branches, roots and fins. */
	readonly wood: PlantMaterial;
	/** The nearest level's shoot rows. */
	readonly shoots: PlantMaterial;
	/** The card levels. */
	readonly cards: PlantMaterial;
	/** Merged fronds, blades and rosette leaves. */
	readonly foliage: PlantMaterial;
}

/**
 * Makes a species' four materials from its kit.
 *
 * @param ctx The sketch's context.
 * @param kit The species' kit, from `prepareSpecies`.
 * @param options The wind field the materials read, and the distance past which they stop swaying.
 * @returns The materials.
 * @category api/vegetation
 */
export function plantMaterials(
	ctx: SketchContext,
	kit: SpeciesKit,
	options?: { readonly wind?: WindField; readonly swayDistance?: number },
): PlantMaterials {
	void ctx;
	void kit;
	void options;
	throw notBuilt('the plant materials');
}

/**
 * Gives each frame's newest wind state to the plant materials.
 *
 * @param materials The materials that read the field.
 * @param field The wind field.
 * @category api/vegetation
 */
export function setWindLayer(materials: readonly PlantMaterial[], field: WindField): void {
	void materials;
	void field;
	throw notBuilt('the plant materials');
}
