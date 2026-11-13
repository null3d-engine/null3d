// The rows of a plant that carries pieces at its sockets: its kit holds its pieces' parts as
// prototypes, each socket carries every part of one variant at one place with one turn, wind record
// and phase, and the same seed places the same rows.
import { beforeAll, describe, expect, it } from 'bun:test';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { capsFor } from '../core/caps';
import { hashBytes } from '../core/hash';
import { loadSpecies } from '../core/registry';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { carriesPieces, PROTOTYPES_MOST } from './piece-rows';

const LONG = scaledBudget(120_000);

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

	it('draws the plant to its height and inside its caps', () => {
		const height = kit.record.size.height;
		const [low, high] =
			typeof height === 'number'
				? [height, height]
				: [height.mean - height.spread, height.mean + height.spread];
		expect(asset.skeleton.height).toBeGreaterThan(low * 0.9);
		expect(asset.skeleton.height).toBeLessThanOrEqual(high);
		expect(capsFor(kit.record)).toBeDefined();
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
