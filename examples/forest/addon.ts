// The forest's near trees through the vegetation add-on: the demo's near rows grown as the add-on's
// plants at the preset's triangle maximum. The three fir kinds take the Scots pine's first three
// variants, and the broadleaf kind takes the European beech. The far rows stay the demo's own
// cut-out cards, so the add-on's far band is not used. The materials take the scene's wind field.
import type { SketchContext } from '@null3d/engine';
import { type PlantMaterial, setWindLayer } from '@null3d/vegetation';
import type { WindField } from '@null3d/wind';
import { type PlantSpot, plantSpecies } from '../lib/plants';
import { FOREST_BROADLEAF, FOREST_PINE } from '../lib/stand-ins';
import { NEAR } from './planting';
import type { Rows } from './woods';

/** The height the two species grow at, in metres, which turns a row's height into a copy's scale. */
const REFERENCE_HEIGHT = 20;

/** The spots of one kind's near rows, at the variant the kind names. */
function spotsOf(rows: Rows, kind: number, variant: number): PlantSpot[] {
	const spots: PlantSpot[] = [];
	for (let k = 0; k < NEAR; k++) {
		if (rows.kind[k] !== kind) continue;
		spots.push({
			x: rows.place[k * 4] as number,
			y: rows.place[k * 4 + 1] as number,
			z: rows.place[k * 4 + 2] as number,
			turn: rows.place[k * 4 + 3] as number,
			scale: (rows.size[k * 2] as number) / REFERENCE_HEIGHT,
			variant,
		});
	}
	return spots;
}

/**
 * Grows the forest's near trees as the add-on's plants and places them on the demo's rows. Each
 * copy draws in no more triangles than the preset's maximum.
 */
export async function plantAddon(
	ctx: SketchContext,
	options: { readonly rows: Rows; readonly wind: WindField; readonly maxTriangles: number },
): Promise<{
	readonly materials: readonly PlantMaterial[];
	setWindLayer(field: WindField): void;
	destroy(): void;
}> {
	const { rows, wind, maxTriangles } = options;
	const firs = [0, 1, 2].flatMap((kind) => spotsOf(rows, kind, kind));
	const broadleaves = spotsOf(rows, 3, 0);
	const [pine, beech] = await Promise.all([
		plantSpecies(ctx, {
			id: FOREST_PINE.id,
			standIn: FOREST_PINE.standIn,
			seed: 11,
			spots: firs,
			variants: 3,
			wind,
			maxTriangles,
		}),
		plantSpecies(ctx, {
			id: FOREST_BROADLEAF.id,
			standIn: FOREST_BROADLEAF.standIn,
			seed: 11,
			spots: broadleaves,
			variants: 1,
			wind,
			maxTriangles,
		}),
	]);
	const materials = [...pine.materials, ...beech.materials];
	return {
		materials,
		setWindLayer(field) {
			setWindLayer(materials, field);
		},
		destroy() {
			pine.placed.destroy();
			beech.placed.destroy();
		},
	};
}
