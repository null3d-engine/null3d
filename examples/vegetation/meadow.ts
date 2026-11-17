// Growing the vegetation meadow: every species the add-on registers, planted across a field, with
// a note that counts them as they come.
import {
	growPlant,
	loadSpecies,
	type PlantMaterials,
	placePlants,
	plantMaterials,
	prepareSpecies,
	type SpeciesId,
	type SpeciesKit,
	speciesIds,
} from '@null3d/vegetation';
import { createFill } from './fill';
import type { MeadowControls } from './hud';
import { plantSign } from './signage';

/**
 * The page's plant materials, one set a species and season for the page's life. A regrow frees its
 * pieces; a piece's destroy stops its batches and its meshes and leaves the materials it draws with
 * alone, so a set outlives every build. Making a new six a species a build fills the renderer's
 * material table and every grow fails once it is full.
 */
const PAGE_MATERIALS = new WeakMap<object, Map<string, PlantMaterials>>();

/**
 * The materials a species draws with this season, made once and kept for the page's life.
 *
 * @param ctx The sketch's context, whose page owns the sets.
 * @param kit The species' kit.
 * @param season The season the meadow stands in, which keys the set where it changes the materials.
 * @returns The species' materials.
 */
function pageMaterials(ctx: object, kit: SpeciesKit, season: string): PlantMaterials {
	let sets = PAGE_MATERIALS.get(ctx);
	if (!sets) {
		sets = new Map();
		PAGE_MATERIALS.set(ctx, sets);
	}
	const key = `${kit.record.id}|${season}`;
	let materials = sets.get(key);
	if (!materials) {
		materials = plantMaterials(ctx as Parameters<typeof plantMaterials>[0], kit, {});
		sets.set(key, materials);
	}
	return materials;
}

/** One plant standing in the meadow: where its foot is and how tall it is. */
export interface MeadowPlant {
	readonly x: number;
	readonly z: number;
	readonly height: number;
	readonly name: string;
}

/** What the meadow needs to know while it grows. */
export interface MeadowOptions {
	/** The controls as they stand at the moment of a build. */
	controls(): MeadowControls;
	/**
	 * The species to draw, when a held picture names a fixed subset; absent draws every registered
	 * species, as the live page does.
	 */
	species?: readonly SpeciesId[];
	/** Told the plants the meadow stands, each time one lands, so a picker sees the field as it fills. */
	onPlants?: (plants: readonly MeadowPlant[]) => void;
}

/** A plant piece the meadow can take down again. */
interface Piece {
	destroy(): void;
}

/**
 * A meadow of every registered species, rebuilt whenever the controls change. The first build counts
 * on the sketch's own loading bar; every later one shows in a note of its own.
 */
export function createMeadow(
	ctx: Parameters<typeof prepareSpecies>[0],
	page: {
		post(name: string, value: unknown): void;
	},
	options: MeadowOptions,
) {
	let planted: Piece[] = [];
	/** The field's fill: a build that a newer one overtook stands nothing. */
	const fill = createFill<SpeciesId>();
	/** Whether the field's signs stand: they name the species, which no control changes. */
	let signsStand = false;
	/** The page's bar that shows while the meadow grows, counting the species it has finished. */
	const growing = (() => {
		// A sketch runs in a worker, where the page has no document, so the bar is the page's: it is
		// posted, drawn by the page's runner, and cleared when the last species lands.
		let shown = false;
		return {
			begin(): void {
				shown = true;
				page.post('growing', { done: 0, total: 0 });
			},
			set(done: number, total: number): void {
				if (shown) page.post('growing', { done, total });
			},
			end(): void {
				if (shown) page.post('growing', undefined);
				shown = false;
			},
		};
	})();

	return async function growMeadow(seed: number): Promise<void> {
		// The field changes hands before any work, so a build whose species fail to load has still
		// stopped the build before it: no plant of the older build lands in a field this one cleared.
		const build = fill.take();
		for (const piece of planted) piece.destroy();
		planted = [];
		const { season, sparse, maxTriangles } = options.controls();
		const ids = options.species ?? speciesIds();
		const across = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
		const step = 34;
		// The bar shows on the first build too, so the meadow's first plants announce their progress
		// once the sketch has started rather than only on a regrow. A build that a newer one took the
		// field from leaves the bar to the newer build.
		if (build.current()) {
			growing.begin();
			growing.set(0, ids.length);
		}
		/** Where one species' plant stands: its column and row in the meadow's grid. */
		const slotOf = (index: number): [number, number] => [
			((index % across) - (across - 1) / 2) * step,
			(Math.floor(index / across) - (ids.length / across - 1) / 2) * step,
		];
		// The species load together, and every sign stands as soon as its record is in hand: the meadow
		// is named before any plant starts to grow, so the names are there while the first build runs.
		// A species that fails to load is named and left out, rather than holding the meadow.
		const modules = await Promise.all(
			ids.map((id) =>
				loadSpecies(id).catch((error: unknown) => {
					console.error(`the meadow could not load ${id}`, error);
					return undefined;
				}),
			),
		);
		if (!build.current()) return;
		try {
			// The signs name the species, and no control changes them, so they stand on the first build
			// and a regrow leaves them where they are.
			if (!signsStand) {
				ids.forEach((_id, index) => {
					const record = modules[index]?.record;
					if (!record) return;
					const [x, z] = slotOf(index);
					// The sign stands beside the plant's foot, clear of its trunk.
					plantSign(ctx, record.name, record.latin, [x + 13, z + 6]);
				});
				signsStand = true;
			}
			// Load, prepare and grow every species at once, and stand each plant the moment its own build
			// finishes: the field fills as the builds land rather than standing empty until the last one.
			// One species that fails is named and left out; it must not hold the meadow or its bar.
			await fill.fill(
				ids,
				{
					grow: async (_id, index, current) => {
						if (!current()) return undefined;
						const module = modules[index];
						// A species that failed to load was named above; its slot stays empty.
						if (!module) return undefined;
						// The meadow carries several species at once, and at close range every copy near the camera
						// draws its real shoots: the medium tier keeps each plant's shape while halving the nearest
						// level's triangles, which is what made a pan after a zoom crawl.
						const kit = await prepareSpecies(ctx, module, {
							detail: 'medium',
							placeholders: 'missing',
						});
						const asset = await growPlant(kit, {
							seed,
							variant: index % Math.max(1, kit.record.variants),
							near: true,
							season,
							sparse,
							maxTriangles,
						});
						// The plant stands at its own slot as soon as it is grown, drawing with the page's
						// own set for its species and season, so the field shows every finished plant and
						// a regrow makes no new materials.
						const materials = pageMaterials(ctx, kit, season);
						const [x, z] = slotOf(index);
						const piece = placePlants(
							ctx,
							kit,
							[asset],
							{
								count: 1,
								position: new Float32Array([x, 0, z]),
								turn: new Float32Array([index * 0.4]),
								scale: new Float32Array([1]),
								variant: new Uint8Array([0]),
							},
							{ materials, view: { height: 1080, fov: 45 }, castShadows: true },
						);
						return { piece, plant: { x, z, height: asset.skeleton.height, name: kit.record.name } };
					},
					// Each species keeps its slot's place in the list, so a picker sees the meadow in its grid
					// order whatever order the builds finish in. The picker hears of the field as it fills, so
					// a double-click finds a plant that has already landed.
					land: (grown) => {
						planted = grown.map((item) => item.piece);
						options.onPlants?.(grown.map((item) => item.plant));
					},
					// Count each species as it finishes, so the bar moves while the rest still grow.
					progress: (done, total) => growing.set(done, total),
					// A plant that a newer build overtook never joins a field that is no longer its own.
					discard: (grown) => grown.piece.destroy(),
					failed: (id, error) => console.error(`the meadow could not grow ${id}`, error),
					// A build that a newer one overtook leaves the bar to the newer build.
					settled: () => growing.end(),
				},
				build,
			);
		} finally {
			// A build that threw after it took the field has no newer build to end its bar.
			if (build.current()) growing.end();
		}
	};
}
