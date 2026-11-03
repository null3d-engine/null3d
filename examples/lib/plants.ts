// Plants for the demos from the vegetation add-on's plant core. A demo names each species by its id
// and gives the size, colours and ecology of its stand-in; the species draws as that stand-in until
// its folder lands in the add-on, and as itself after. Its kit and its variants grow in the engine's
// job workers, and its copies stand where the demo puts them, with far cards past the distance
// where a plant spans a few pixels.
import type { SketchContext } from '@null3d/engine';
import {
	bakeFarPlant,
	growPlant,
	loadSpeciesOrStandIn,
	type PlacedPlants,
	type PlantCopies,
	type PlantMaterial,
	placePlants,
	plantMaterials,
	prepareSpecies,
	type StandInOptions,
} from '@null3d/vegetation';
import type { WindField } from '@null3d/wind';

/** One copy of a plant: where it stands, its turn about +Y in radians, its scale and variant. */
export interface PlantSpot {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly turn: number;
	readonly scale: number;
	readonly variant: number;
}

/** What a demo plants of one species. */
export interface PlantSpeciesOptions {
	/** The species' id in the add-on's catalogue, such as 'pedunculate-oak'. */
	readonly id: string;
	/** The stand-in's size, colours and ecology, until the species lands. */
	readonly standIn: StandInOptions;
	/** The scene's seed. */
	readonly seed: number;
	/** Where the copies stand. */
	readonly spots: readonly PlantSpot[];
	/** The variants grown; one more than the highest variant a spot names by default. */
	readonly variants?: number;
	/** The scene's wind field, which the plant materials read. */
	readonly wind?: WindField;
	/** Hand the copies over to far cards past the distance where a plant spans a few pixels. */
	readonly far?: boolean;
	/** Whether the copies cast shadows; true by default. */
	readonly castShadows?: boolean;
	/** The camera's vertical field of view in degrees, which sets the switch distances. */
	readonly fov?: number;
}

/** A species planted in a scene: its materials, for the wind, and its placement. */
export interface PlantedSpecies {
	/** The species' materials, which the frame gives the wind field's newest state. */
	readonly materials: readonly PlantMaterial[];
	/** The copies as drawn. */
	readonly placed: PlacedPlants;
}

/** The plant core's copy rows from a list of spots. */
export function plantCopies(spots: readonly PlantSpot[]): PlantCopies {
	const count = spots.length;
	const position = new Float32Array(count * 3);
	const turn = new Float32Array(count);
	const scale = new Float32Array(count);
	const variant = new Uint8Array(count);
	spots.forEach((spot, k) => {
		position.set([spot.x, spot.y, spot.z], k * 3);
		turn[k] = spot.turn;
		scale[k] = spot.scale;
		variant[k] = spot.variant;
	});
	return { count, position, turn, scale, variant };
}

/**
 * Grows a species' variants in the job workers and places its copies. Every stage that the plant
 * core has not built yet grows its stand-in.
 */
export async function plantSpecies(
	ctx: SketchContext,
	options: PlantSpeciesOptions,
): Promise<PlantedSpecies> {
	let variants = options.variants ?? 0;
	if (options.variants === undefined)
		for (const spot of options.spots) variants = Math.max(variants, spot.variant + 1);
	const module = await loadSpeciesOrStandIn(options.id, {
		variants: Math.max(1, variants),
		...options.standIn,
	});
	const kit = await prepareSpecies(ctx, module, { placeholders: true });
	const materials = plantMaterials(ctx, kit, options.wind && { wind: options.wind });
	const assets = await Promise.all(
		Array.from({ length: variants }, (_, variant) =>
			growPlant(kit, { seed: options.seed, variant, near: true }),
		),
	);
	const far = options.far
		? await Promise.all(assets.map((asset) => bakeFarPlant(kit, asset)))
		: undefined;
	const placed = placePlants(ctx, kit, assets, plantCopies(options.spots), {
		materials,
		...(far && { far }),
		view: { height: 1080, fov: options.fov ?? 50 },
		castShadows: options.castShadows ?? true,
	});
	return { materials: Object.values(materials), placed };
}
