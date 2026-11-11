// The wind scene's clump: every species the registry holds, grown for one seed and standing in a
// square. Loading a species, preparing its kit and growing its variant are dispatched together, so
// the engine's job workers run those stages side by side; the materials and the copies are made
// afterwards in the registry's order, so the scene's objects and the draws that follow keep it.
import type { SketchContext } from '@null3d/engine';
import {
	growPlant,
	loadSpecies,
	type PlantMaterial,
	placePlants,
	plantMaterials,
	prepareSpecies,
	speciesIds,
} from '@null3d/vegetation';
import type { WindField } from '@null3d/wind';
import { DEMO_SPARSENESS } from '../lib/plants';

/** A planted clump: the pieces to destroy, and the materials that the wind updates each frame. */
export interface WindClump {
	readonly planted: { destroy(): void }[];
	readonly materials: PlantMaterial[];
}

/** Metres between neighbouring plants in the clump. */
const SPACING = 20;

/**
 * Grows a clump of every species the registry holds and places each copy in a square.
 *
 * @param ctx The sketch.
 * @param field The wind field, which each material reads every frame.
 * @param seed The clump's seed.
 * @returns The pieces and the materials.
 */
export async function plantWindClump(
	ctx: SketchContext,
	field: WindField,
	seed: number,
): Promise<WindClump> {
	const ids = speciesIds();
	const across = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
	// Keep each species' kit and grown variant in the browser's store of derived data, so a later
	// visit reads the same bytes back instead of growing them again.
	const cache = ctx.assets.cache('vegetation-wind', 1);
	const options = { detail: 'high', placeholders: 'missing', cache } as const;
	// The species grow together, and each one that finishes moves the loading bar by the work it did,
	// so the bar follows the plants rather than a timer.
	const total = ids.length;
	let prepared = 0;
	let grownCount = 0;
	const report = (text: string, value: number, detail: string): void => {
		ctx.page.post('loading', { kind: 'build', text, value, detail });
	};
	report('Preparing the plants', 0, `0 of ${total} species`);
	const grown = await Promise.all(
		ids.map(async (id, index) => {
			const module = await loadSpecies(id);
			const kit = await prepareSpecies(ctx, module, options);
			prepared++;
			report('Preparing the plants', prepared / total, `${prepared} of ${total} species`);
			const asset = await growPlant(kit, {
				seed,
				variant: index % Math.max(1, kit.record.variants),
				near: true,
				sparse: DEMO_SPARSENESS,
			});
			grownCount++;
			report('Growing the plants', grownCount / total, `${grownCount} of ${total} species`);
			return { kit, asset };
		}),
	);
	const planted: { destroy(): void }[] = [];
	const materials: PlantMaterial[] = [];
	for (const [index, { kit, asset }] of grown.entries()) {
		const made = plantMaterials(ctx, kit, { wind: field });
		materials.push(made.wood, made.shoots, made.cards, made.foliage, made.extras);
		const x = ((index % across) - (across - 1) / 2) * SPACING;
		const z = (Math.floor(index / across) - (ids.length / across - 1) / 2) * SPACING;
		planted.push(
			placePlants(
				ctx,
				kit,
				[asset],
				{
					count: 1,
					position: new Float32Array([x, 0, z]),
					turn: new Float32Array([index * 0.6]),
					scale: new Float32Array([1]),
					variant: new Uint8Array([0]),
				},
				{ materials: made, view: { height: 1080, fov: 50 }, castShadows: true },
			),
		);
	}
	return { planted, materials };
}
