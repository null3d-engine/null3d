// The forest's near trees through the vegetation add-on, for the budget route: the demo's near rows
// grown as the add-on's plants, with the per-level triangle budgets a page asks for. The far rows
// stay the demo's own cut-out cards, so the add-on's far band is not used. The route's default is
// the add-on's sparse form; a page that names a budget draws that instead.
import type { SketchContext } from '@null3d/engine';
import { type PlantMaterial, setWindLayer } from '@null3d/vegetation';
import type { WindField } from '@null3d/wind';
import { type PlantSpot, plantSpecies } from '../lib/plants';
import { FOREST_BROADLEAF, FOREST_PINE } from '../lib/stand-ins';
import { NEAR, RADIUS, TREES } from './planting';
import { plantRows, type Rows } from './woods';

/** The height each kind's species grows at in the add-on, in metres, which sets a row's scale. */
const REFERENCE = [20, 20, 20, 21.5] as const;

/** The spots of one kind's near rows, at the variant the kind names. */
function spotsOf(rows: Rows, kind: number, variant: number): PlantSpot[] {
	const spots: PlantSpot[] = [];
	for (let k = 0; k < TREES && k < NEAR; k++) {
		if (rows.kind[k] !== kind) continue;
		spots.push({
			x: rows.place[k * 4] as number,
			y: rows.place[k * 4 + 1] as number,
			z: rows.place[k * 4 + 2] as number,
			turn: rows.place[k * 4 + 3] as number,
			scale: (rows.size[k * 2] as number) / (REFERENCE[kind] as number),
			variant,
		});
	}
	return spots;
}

/**
 * Grows the forest's near trees as the add-on's plants and places them on the demo's rows: the
 * three fir kinds as the Scots pine's first three variants, and the broadleaf kind as the European
 * beech. The materials take the scene's wind field each frame.
 */
export async function plantAddon(
	ctx: SketchContext,
	options: { readonly wind: WindField; readonly budgets?: readonly [number, number, number] },
): Promise<{ readonly materials: readonly PlantMaterial[]; setWindLayer(field: WindField): void }> {
	const rows = plantRows(TREES, RADIUS);
	const firs = [0, 1, 2].flatMap((kind) => spotsOf(rows, kind, kind));
	const broadleaves = spotsOf(rows, 3, 0);
	const [pine, beech] = await Promise.all([
		plantSpecies(ctx, {
			id: FOREST_PINE.id,
			standIn: FOREST_PINE.standIn,
			seed: 11,
			spots: firs,
			variants: 3,
			wind: options.wind,
			...(options.budgets && { budgets: options.budgets }),
		}),
		plantSpecies(ctx, {
			id: FOREST_BROADLEAF.id,
			standIn: FOREST_BROADLEAF.standIn,
			seed: 11,
			spots: broadleaves,
			variants: 1,
			wind: options.wind,
			...(options.budgets && { budgets: options.budgets }),
		}),
	]);
	const materials = [...pine.materials, ...beech.materials];
	return {
		materials,
		setWindLayer(field) {
			setWindLayer(materials, field);
		},
	};
}
