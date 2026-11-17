// Ten regrows across the meadow's whole species list, with the controls moving, against a fake
// vegetation package and a fake sketch context: the figures show that each regrow reuses the page's
// plant materials instead of making a new set a species, which is what filled the render's material
// table. Before the sharing, the same ten regrows counted 120 sets — twelve species on each of the
// ten — and the case below expects 24: one a species for each of the two seasons used.
import { describe, expect, it, mock } from 'bun:test';

/** The page's species, as many as the meadow's real list. */
const IDS = [
	'alder',
	'ash',
	'birch',
	'cypress',
	'hawthorn',
	'holm-oak',
	'olive',
	'pine',
	'sequoia',
	'beech',
	'willow',
	'meadow',
] as const;

/** What the fakes counted while the meadow ran. */
const counted = { materials: 0, piecesDestroyed: 0, plantsGrown: 0 };

mock.module('@null3d/vegetation', () => ({
	speciesIds: () => IDS,
	loadSpecies: async (id: string) => ({ record: { id, name: id, latin: id, variants: 1 } }),
	prepareSpecies: async (_ctx: unknown, module: { record: { id: string; name: string } }) => ({
		record: module.record,
		placeholders: 'missing',
	}),
	growPlant: async () => {
		counted.plantsGrown++;
		return { skeleton: { height: 10 } };
	},
	plantMaterials: () => {
		counted.materials++;
		return {};
	},
	placePlants: () => ({
		destroy() {
			counted.piecesDestroyed++;
		},
	}),
}));

mock.module('./signage', () => ({ plantSign: () => {} }));

const { createMeadow } = await import('./meadow');

/** The fake sketch context the meadow and its signs ask for. */
const ctx = {
	scene: { createMesh: () => ({ destroy() {} }) },
	textures: { fromData: () => ({}) },
	materials: { standard: () => ({}) },
	geometry: { plane: () => ({}), cylinder: () => ({}) },
};

describe('the meadow over ten regrows', () => {
	it('makes one set of materials a species a season, not a set a species a grow', async () => {
		const seasons = ['summer', 'autumn'] as const;
		let season: (typeof seasons)[number] = seasons[0];
		let sparse = 0;
		const growing = createMeadow(ctx as never, { post: () => {} }, {
			controls: () => ({ season, sparse, maxTriangles: 200_000 as number | undefined }),
			onPlants: () => {},
		} as never);
		for (let grow = 0; grow < 10; grow++) {
			season = seasons[grow % seasons.length] as (typeof seasons)[number];
			sparse = (grow % 5) / 4;
			await growing(grow + 1);
		}
		// Every species grew on every regrow, and each regrow cleared the one before it.
		expect(counted.plantsGrown).toBe(10 * IDS.length);
		expect(counted.piecesDestroyed).toBe(9 * IDS.length);
		// The materials are the page's: one set a species for each season used, whatever the regrows.
		expect(counted.materials).toBe(IDS.length * seasons.length);
	});
});
