// Growing the vegetation meadow: every species the add-on registers, planted across a field, with
// a note that counts them as they come.
import {
	growPlant,
	loadSpecies,
	placePlants,
	plantMaterials,
	prepareSpecies,
	speciesIds,
} from '@null3d/vegetation';
import type { MeadowControls } from './hud';
import { plantSign } from './signage';

/** What the meadow needs to know while it grows. */
export interface MeadowOptions {
	/** The controls as they stand at the moment of a build. */
	controls(): MeadowControls;
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
	/** The note that shows while the meadow grows, counting the species it has finished. */
	const growing = (() => {
		let box: HTMLElement | undefined;
		let said: HTMLElement | undefined;
		return {
			begin(): void {
				if (box) return;
				box = document.createElement('div');
				box.style.cssText = [
					'position:fixed',
					'left:50%',
					'top:18px',
					'transform:translateX(-50%)',
					'padding:10px 16px',
					'border-radius:10px',
					'background:rgba(16,18,20,0.86)',
					'color:#e8eaec',
					'font:13px/1.4 system-ui,sans-serif',
					'letter-spacing:0.02em',
					'z-index:20',
					'pointer-events:none',
				].join(';');
				said = document.createElement('span');
				box.append(said);
				document.body.append(box);
			},
			set(done: number, total: number): void {
				if (said)
					said.textContent = `Growing the meadow, ${Math.round((done / Math.max(1, total)) * 100)}%`;
			},
			end(): void {
				box?.remove();
				box = undefined;
				said = undefined;
			},
		};
	})();

	return async function growMeadow(seed: number): Promise<void> {
		for (const piece of planted) piece.destroy();
		planted = [];
		const { season, sparse } = options.controls();
		const ids = speciesIds();
		const across = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
		const step = 34;
		const first = !grown;
		if (first) page.post('starting', { done: 0, total: ids.length });
		else {
			growing.begin();
			growing.set(0, ids.length);
		}
		let done = 0;
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
				const asset = await growPlant(kit, {
					seed,
					variant: index % Math.max(1, kit.record.variants),
					near: true,
					season,
					sparse,
				});
				// Count each species as it finishes, so the note moves while the rest still grow.
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
			const x = ((index % across) - (across - 1) / 2) * step;
			const z = (Math.floor(index / across) - (ids.length / across - 1) / 2) * step;
			// The sign stands beside the plant's foot, clear of its trunk.
			plantSign(ctx, kit.record.name, kit.record.latin, [x + 13, z + 6]);
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
