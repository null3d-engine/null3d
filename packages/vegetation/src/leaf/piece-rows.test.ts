// The rows of a plant that carries pieces at its sockets: its kit holds its pieces' parts as
// prototypes, each socket carries every part of one variant at one place with one turn, wind record
// and phase, and the same seed places the same rows.
import { beforeAll, describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { hashBytes } from '../core/hash';
import { quatRotate, type Vector3 } from '../core/math';
import { loadSpecies } from '../core/registry';
import { DETAILS } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { carriesPieces, PROTOTYPES_MOST } from './piece-rows';

const LONG = scaledBudget(120_000);

/** A box in plant space. */
interface Box {
	readonly min: number[];
	readonly max: number[];
}

/** An empty box that any point widens. */
const emptyBox = (): Box => ({
	min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
	max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
});

/** The box of every placed row's mesh: its prototype's own box, scaled, turned and moved. */
function placedBox(kit: SpeciesKitData, asset: PlantAsset): Box {
	const tier = DETAILS.indexOf(kit.detail);
	const boxes = kit.prototypes.map((prototype) => {
		const box = emptyBox();
		const positions = prototype.tiers[tier]?.positions ?? new Float32Array(0);
		for (let i = 0; i < positions.length; i += 3)
			for (let k = 0; k < 3; k++) {
				box.min[k] = Math.min(box.min[k] as number, positions[i + k] as number);
				box.max[k] = Math.max(box.max[k] as number, positions[i + k] as number);
			}
		return box;
	});
	const rows = asset.shoots;
	const out = emptyBox();
	const corner: Vector3 = [0, 0, 0];
	const turned: Vector3 = [0, 0, 0];
	for (let r = 0; r < rows.count; r++) {
		const box = boxes[rows.prototype[r] as number] as Box;
		const scale = rows.scale[r] as number;
		for (let c = 0; c < 8; c++) {
			for (let k = 0; k < 3; k++)
				corner[k as 0] = ((c & (1 << k) ? box.max : box.min)[k] as number) * scale;
			quatRotate(rows.rotation, r * 4, corner, turned);
			for (let k = 0; k < 3; k++) {
				const at = turned[k as 0] + (rows.position[r * 3 + k] as number);
				out.min[k] = Math.min(out.min[k] as number, at);
				out.max[k] = Math.max(out.max[k] as number, at);
			}
		}
	}
	return out;
}

/** The box of a card level's cards, read from their quantised positions inside the species' box. */
function cardBox(kit: SpeciesKitData, asset: PlantAsset, level: 1 | 2): Box {
	const out = emptyBox();
	for (const part of asset.levels[level].parts) {
		if (part.name !== 'cards') continue;
		const positions = part.arrays.positions;
		for (let i = 0; i < positions.length; i += 3)
			for (let k = 0; k < 3; k++) {
				const low = kit.box.min[k] as number;
				const at =
					low + ((positions[i + k] as number) / 65535) * ((kit.box.max[k] as number) - low);
				out.min[k] = Math.min(out.min[k] as number, at);
				out.max[k] = Math.max(out.max[k] as number, at);
			}
	}
	return out;
}

describe('the Scots pine, grown with its boughs at sockets', () => {
	let kit: SpeciesKitData;
	let asset: PlantAsset;

	beforeAll(async () => {
		const module = await loadSpecies('scots-pine');
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
		// The flattened bough names its card plane.
		const bough = kit.prototypes.find((prototype) => prototype.piece?.name === 'bough');
		expect(bough?.piece?.plane).toEqual([0, 0, 1]);
	});

	it('places every part of one variant at each socket, with one turn, wind record and phase', () => {
		const { shoots, skeleton } = asset;
		const sockets = skeleton.buds.count;
		expect(sockets).toBeGreaterThan(100);
		// The rows by their place: each place is one socket's.
		const places = new Map<string, number[]>();
		for (let r = 0; r < shoots.count; r++) {
			const key = [0, 1, 2].map((k) => (shoots.position[r * 3 + k] as number).toFixed(4)).join(',');
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
			expect(piece.name).toBe('bough');
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

	it("draws its foliage to the record's height, the far cards at the size of the boughs they picture", () => {
		const height = kit.record.size.height;
		const [low, high] =
			typeof height === 'number'
				? [height, height]
				: [height.mean - height.spread, height.mean + height.spread];
		const near = placedBox(kit, asset);
		const top = near.max[1] as number;
		// The top of the drawn boughs stands inside the heights the record may draw.
		expect(top).toBeGreaterThanOrEqual(low);
		expect(top).toBeLessThanOrEqual(high * 1.01);
		// Each card level stands as tall and as wide as the boughs it stands for: a far tree larger
		// than the near one is a different tree.
		for (const level of [1, 2] as const) {
			const far = cardBox(kit, asset, level);
			expect(Math.abs((far.max[1] as number) - top)).toBeLessThan(0.015 * top);
			for (const k of [0, 2] as const) {
				const wide = (near.max[k] as number) - (near.min[k] as number);
				expect(Math.abs((far.max[k] as number) - (far.min[k] as number) - wide)).toBeLessThan(
					0.03 * wide,
				);
			}
		}
	});

	it("counts the triangles of its boughs beside its wood's", () => {
		const tier = DETAILS.indexOf(kit.detail);
		let rows = 0;
		for (let r = 0; r < asset.shoots.count; r++)
			rows +=
				(kit.prototypes[asset.shoots.prototype[r] as number]?.tiers[tier]?.indices.length ?? 0) / 3;
		expect(asset.stats.shoots).toBe(rows);
		// The boughs hold far more of the plant than its wood does.
		expect(asset.stats.shoots).toBeGreaterThan(asset.stats.triangles[0]);
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
