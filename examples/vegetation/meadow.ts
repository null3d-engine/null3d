// Growing the vegetation meadow: every species the add-on registers, planted across a field, with
// a note that counts them as they come.
import {
	growPlant,
	loadSpecies,
	placePlants,
	plantMaterials,
	prepareSpecies,
	type SpeciesId,
	speciesIds,
} from '@null3d/vegetation';
import type { MeadowControls } from './hud';
import { plantSign } from './signage';

/** What the meadow needs to know while it grows. */
export interface MeadowOptions {
	/** The controls as they stand at the moment of a build. */
	controls(): MeadowControls;
	/**
	 * The species to draw, when a held picture names a fixed subset; absent draws every registered
	 * species, as the live page does.
	 */
	species?: readonly SpeciesId[];
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
	/** Whether the meadow has been built once: its first build belongs to the sketch's own start. */
	let grown = false;
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
		for (const piece of planted) piece.destroy();
		planted = [];
		const { season, sparse, maxTriangles } = options.controls();
		const ids = options.species ?? speciesIds();
		const across = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
		const step = 34;
		const first = !grown;
		if (first) page.post('starting', { done: 0, total: ids.length });
		else {
			growing.begin();
			growing.set(0, ids.length);
		}
		let done = 0;
		/** Where one species' plant stands: its column and row in the meadow's grid. */
		const slotOf = (index: number): [number, number] => [
			((index % across) - (across - 1) / 2) * step,
			(Math.floor(index / across) - (ids.length / across - 1) / 2) * step,
		];
		// Load, prepare and grow every species at once: the job workers run the stages side by side.
		const prepared = await Promise.all(
			ids.map(async (id, index) => {
				const module = await loadSpecies(id);
				// The meadow carries several species at once, and at close range every copy near the camera
				// draws its real shoots: the medium tier keeps each plant's shape while halving the nearest
				// level's triangles, which is what made a pan after a zoom crawl.
				const kit = await prepareSpecies(ctx, module, {
					detail: 'medium',
					placeholders: 'missing',
				});
				// The sign stands as soon as the species is ready, so the meadow is named before any of
				// its plants has grown. The sign stands beside the plant's foot, clear of its trunk.
				const [x, z] = slotOf(index);
				plantSign(ctx, kit.record.name, kit.record.latin, [x + 13, z + 6]);
				const asset = await growPlant(kit, {
					seed,
					variant: index % Math.max(1, kit.record.variants),
					near: true,
					season,
					sparse,
					maxTriangles,
				});
				// Count each species as it finishes, so the bar moves while the rest still grow.
				done++;
				if (first) page.post('starting', { done, total: ids.length });
				else growing.set(done, ids.length);
				return { kit, asset };
			}),
		);
		// Make the materials and place the copies in the registry's order, so the signs, the objects and
		// the draws that follow from them keep their order.
		let index = 0;
		for (const { kit, asset } of prepared) {
			const materials = plantMaterials(ctx, kit, {});
			const [x, z] = slotOf(index);
			planted.push(
				placePlants(
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
				),
			);
			index++;
		}
		growing.end();
		grown = true;
	};
}
