// The rows of a plant that carries pieces at its sockets: its kit holds its pieces' parts as
// prototypes, built as the piece builder builds them, each socket carries every part of one variant
// at one place with one turn, wind record and phase, and the same seed places the same rows.
import { beforeAll, describe, expect, it } from 'bun:test';
import { files as holmTextures } from '@null3d/vegetation-textures/holm-oak';
import { files as oakTextures } from '@null3d/vegetation-textures/pedunculate-oak';
import { files as willowTextures } from '@null3d/vegetation-textures/weeping-willow';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { hashBytes } from '../core/hash';
import type { SpeciesModule } from '../core/record';
import { loadSpecies } from '../core/registry';
import { DETAILS } from '../core/types';
import { buildKitNow, buildPiecesNow, growPlantNow, loadPlantCode } from '../generate';
import { foliageBox } from '../lod/card-size.test-support';
import { drawnAtOnce, TALLEST_VIEWS } from '../lod/drawn';
import { directed as holmDirected } from '../species/holm-oak/directed';
import { directed as oakDirected } from '../species/pedunculate-oak/directed';
import { directed as willowDirected } from '../species/weeping-willow/directed';
import { PIECES as WILLOW_PIECES } from '../species/weeping-willow/pieces';
import { carriesPieces, PROTOTYPES_MOST } from './piece-rows';

const LONG = scaledBudget(120_000);

/** A plant that carries pieces at its sockets, as these tests grow it. */
interface Dressed {
	readonly title: string;
	/** The species' module: the registered one, or a directed record that is not registered yet. */
	readonly module: () => Promise<SpeciesModule>;
	/** The piece every socket carries, and whether it is flattened onto one card plane. */
	readonly piece: string;
	readonly flat: boolean;
}

const DRESSED: readonly Dressed[] = [
	{
		title: 'the Scots pine, grown with its boughs at sockets',
		module: () => loadSpecies('scots-pine'),
		piece: 'bough',
		flat: true,
	},
	{
		title: 'the pedunculate oak, framed, with its branch ends at sockets',
		module: async () => ({ record: oakDirected, textures: oakTextures }),
		piece: 'branch-end',
		flat: false,
	},
	{
		title: 'the holm oak, framed, with its branch ends at sockets',
		module: async () => ({ record: holmDirected, textures: holmTextures }),
		piece: 'branch-end',
		flat: false,
	},
	{
		title: 'the weeping willow, framed, with its long strands at sockets',
		module: async () => ({ record: willowDirected, textures: willowTextures }),
		piece: 'strand-long',
		flat: false,
	},
	{
		title: 'the silver birch, framed, with its sprays at sockets',
		module: () => loadSpecies('silver-birch'),
		piece: 'spray',
		flat: false,
	},
	{
		title: 'the olive, framed, with its branch ends at sockets',
		module: () => loadSpecies('olive'),
		piece: 'branch-end',
		flat: false,
	},
];

for (const dressed of DRESSED)
	describe(dressed.title, () => {
		let kit: SpeciesKitData;
		let asset: PlantAsset;

		beforeAll(async () => {
			const module = await dressed.module();
			await loadPlantCode(module.record);
			kit = buildKitNow(module, { detail: 'high', placeholders: 'missing' });
			asset = growPlantNow(kit, { seed: 11, variant: 0, season: 'summer', near: true });
		}, LONG);

		it('keeps its pieces in the kit, each part a prototype with its card cells', () => {
			expect(carriesPieces(kit.record)).toBe(true);
			expect(kit.prototypes.length).toBeGreaterThan(0);
			expect(kit.prototypes.length).toBeLessThanOrEqual(PROTOTYPES_MOST);
			const rules = kit.record.pieces ?? [];
			expect(kit.prototypes.length).toBeGreaterThanOrEqual(
				rules.reduce((sum, rule) => sum + rule.variants, 0),
			);
			kit.prototypes.forEach((prototype, index) => {
				expect(prototype.index).toBe(index);
				expect(prototype.piece).toBeDefined();
				expect(prototype.card.planes.length).toBeGreaterThan(0);
				expect(prototype.leaves).toBeGreaterThan(0);
			});
			// A flattened piece names its card plane.
			const piece = kit.prototypes.find((prototype) => prototype.piece?.name === dressed.piece);
			expect(piece).toBeDefined();
			if (dressed.flat) expect(piece?.piece?.plane).toEqual([0, 0, 1]);
		});

		it('places every part of one variant at each socket, with one turn, wind record and phase', () => {
			const { shoots, skeleton } = asset;
			const sockets = skeleton.buds.count;
			expect(sockets).toBeGreaterThan(100);
			// The rows by their place: each place is one socket's.
			const places = new Map<string, number[]>();
			for (let r = 0; r < shoots.count; r++) {
				const key = [0, 1, 2]
					.map((k) => (shoots.position[r * 3 + k] as number).toFixed(4))
					.join(',');
				const at = places.get(key) ?? [];
				at.push(r);
				places.set(key, at);
			}
			expect(places.size).toBe(sockets);
			for (const rows of places.values()) {
				const first = rows[0] as number;
				const piece = kit.prototypes[shoots.prototype[first] as number]?.piece;
				expect(piece).toBeDefined();
				if (!piece) continue;
				expect(piece.name).toBe(dressed.piece);
				expect(rows.length).toBe(piece.parts);
				const parts = rows.map((r) => kit.prototypes[shoots.prototype[r] as number]?.piece);
				expect(parts.map((part) => part?.part).sort()).toEqual(
					Array.from({ length: piece.parts }, (_, k) => k),
				);
				for (const r of rows) {
					expect(kit.prototypes[shoots.prototype[r] as number]?.piece?.variant).toBe(piece.variant);
					expect(shoots.record[r]).toBe(shoots.record[first] as number);
					expect(shoots.phase[r]).toBe(shoots.phase[first] as number);
					expect(shoots.scale[r]).toBe(shoots.scale[first] as number);
					for (let k = 0; k < 4; k++)
						expect(shoots.rotation[r * 4 + k]).toBe(shoots.rotation[first * 4 + k] as number);
				}
			}
		});

		it("draws its foliage to the record's height, the far cards at the size of the pieces they picture", () => {
			const height = kit.record.size.height;
			const [low, high] =
				typeof height === 'number'
					? [height, height]
					: [height.mean - height.spread, height.mean + height.spread];
			const near = foliageBox(kit, asset, 0);
			const top = near.max[1] as number;
			// The top of the drawn boughs stands inside the heights the record may draw.
			expect(top).toBeGreaterThanOrEqual(low);
			expect(top).toBeLessThanOrEqual(high * 1.01);
			// Each card level stands as tall and as wide as the boughs it stands for: a far tree larger
			// than the near one is a different tree.
			for (const level of [1, 2] as const) {
				const far = foliageBox(kit, asset, level);
				expect(Math.abs((far.max[1] as number) - top)).toBeLessThan(0.015 * top);
				for (const k of [0, 2] as const) {
					const wide = (near.max[k] as number) - (near.min[k] as number);
					expect(Math.abs((far.max[k] as number) - (far.min[k] as number) - wide)).toBeLessThan(
						0.03 * wide,
					);
				}
			}
		});

		it(
			'places the same rows from the same seed',
			() => {
				const again = growPlantNow(kit, { seed: 11, variant: 0, season: 'summer', near: true });
				const digest = (plant: PlantAsset): string =>
					[
						hashBytes(new Uint8Array(plant.shoots.position.buffer), 1),
						hashBytes(new Uint8Array(plant.shoots.rotation.buffer), 2),
						hashBytes(plant.shoots.prototype, 3),
					].join(':');
				expect(digest(again)).toBe(digest(asset));
			},
			LONG,
		);
	});

/** A plant that carries pieces, with the rules its kit builds. */
const KITS: readonly { readonly title: string; readonly module: SpeciesModule }[] = [
	{
		title: "the pedunculate oak's branch ends",
		module: { record: oakDirected, textures: oakTextures },
	},
	{
		title: "the weeping willow's strands, whose blades bend in their own plane",
		module: { record: { ...willowDirected, pieces: WILLOW_PIECES }, textures: willowTextures },
	},
];

/** The digest of a mesh's positions, so two builds compare byte for byte. */
const positionsDigest = (positions: Float32Array | undefined): number =>
	hashBytes(new Uint8Array(positions?.buffer ?? new ArrayBuffer(0)), 1);

describe('a kit that carries pieces', () => {
	for (const { title, module } of KITS)
		it(
			`builds ${title} as the piece builder does, in the leaves cut for pieces`,
			async () => {
				await loadPlantCode(module.record);
				const kit = buildKitNow(module, { detail: 'high', placeholders: 'missing' });
				const built = buildPiecesNow(module, module.record.pieces ?? []);
				expect(kit.prototypes.length).toBe(built.length);
				const high = DETAILS.indexOf('high');
				kit.prototypes.forEach((prototype, index) => {
					const own = built[index];
					expect(prototype.piece?.name).toBe(own?.piece);
					for (let tier = 0; tier <= high; tier++) {
						expect(prototype.tiers[tier]?.indices.length).toBe(own?.tiers[tier]?.indices.length);
						expect(positionsDigest(prototype.tiers[tier]?.positions)).toBe(
							positionsDigest(own?.tiers[tier]?.positions),
						);
					}
				});
				// The oak carries thousands of branch ends, so its own is held to 1,000 triangles.
				if (module.record.id === 'pedunculate-oak')
					for (const prototype of kit.prototypes)
						expect((prototype.tiers[high]?.indices.length ?? 0) / 3).toBeLessThanOrEqual(1000);
			},
			LONG,
		);
});

describe("the Scots pine's boughs at sockets, by the pine's own figures", () => {
	let kit: SpeciesKitData;
	let asset: PlantAsset;

	beforeAll(async () => {
		const module = await loadSpecies('scots-pine');
		await loadPlantCode(module.record);
		kit = buildKitNow(module, { detail: 'high', placeholders: 'missing' });
		asset = growPlantNow(kit, { seed: 11, variant: 0, season: 'summer', near: true });
	}, LONG);

	it("counts the triangles of its boughs beside its wood's", () => {
		const tier = DETAILS.indexOf(kit.detail);
		let rows = 0;
		for (let r = 0; r < asset.shoots.count; r++)
			rows +=
				(kit.prototypes[asset.shoots.prototype[r] as number]?.tiers[tier]?.indices.length ?? 0) / 3;
		expect(asset.stats.shoots).toBe(rows);
		expect(asset.stats.triangles[0]).toBe(asset.levels[0].triangles + rows);
		// The boughs hold far more of the plant than its wood does.
		expect(asset.stats.shoots).toBeGreaterThan(asset.levels[0].triangles);
	});

	it('draws at once the most from an eye inside its fullest pad, within its budget at the reference lens', () => {
		// The engine draws every bough whose bounds come within its switch distance at the kit's one
		// tier. An eye inside a pad has the most boughs in reach, and at the tallest view the High
		// preset gives, through the engine's reference lens, the pine's boughs stay within the
		// record's budget for the nearest level. The species walk holds the narrower lens.
		const [reference] = TALLEST_VIEWS;
		expect(reference).toBeDefined();
		if (!reference) return;
		const drawn = drawnAtOnce(kit, asset, reference);
		expect(drawn.eye).toBe('foliage');
		expect(drawn.triangles).toBeGreaterThan(drawnAtOnce(kit, asset, reference, false).triangles);
		expect(drawn.triangles).toBeLessThanOrEqual(kit.record.lod.budget.lod0Triangles);
	});

	it('stands on a round foot 1.6 times as wide as the bole, with low roots and no buttress', () => {
		const height = asset.skeleton.height;
		/** The wood's farthest reach from the trunk's line in each of 36 directions, between two heights. */
		const ring = (from: number, to: number): number[] => {
			const reach = new Array<number>(36).fill(0);
			for (const part of asset.levels[0].parts) {
				if (part.name !== 'wood') continue;
				const positions = part.arrays.positions;
				for (let i = 0; i < positions.length; i += 3) {
					const at = [0, 1, 2].map((k) => {
						const low = kit.box.min[k] as number;
						return (
							low + ((positions[i + k] as number) / 65535) * ((kit.box.max[k] as number) - low)
						);
					});
					if ((at[1] as number) < from * height || (at[1] as number) > to * height) continue;
					const turn = Math.atan2(at[2] as number, at[0] as number) / (2 * Math.PI);
					const sector = Math.floor((((turn % 1) + 1) % 1) * 36) % 36;
					reach[sector] = Math.max(
						reach[sector] as number,
						Math.hypot(at[0] as number, at[2] as number),
					);
				}
			}
			return reach.sort((a, b) => a - b);
		};
		// Still 02: the foot at the ground is 1.6 times the bole at a tenth of the height. Between
		// the roots the ground ring is the bole's own, so its lower quarter reads the foot.
		const ground = ring(0, 0.005);
		const bole = ring(0.09, 0.11);
		const foot = (ground[9] as number) / (bole[18] as number);
		expect(foot).toBeGreaterThanOrEqual(1.45);
		expect(foot).toBeLessThanOrEqual(1.75);
		// Stills 14 and 17: above the roots the bole is round, with no buttress and no flute.
		const above = ring(0.03, 0.06);
		expect((above[35] as number) / (above[0] as number)).toBeLessThanOrEqual(1.05);
		// Still 14: the roots run out over the ground no farther than three bole widths.
		expect(ground[35] as number).toBeGreaterThan((ground[9] as number) * 1.2);
		expect(ground[35] as number).toBeLessThanOrEqual((bole[18] as number) * 2 * 3);
	});
});
