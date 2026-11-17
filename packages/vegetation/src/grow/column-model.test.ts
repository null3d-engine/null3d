// The column family's adapter, held to the shared model's contract: one socket at each areole with
// its carrier, the axes with their girth and course, and the spine cluster's piece from the
// record's measured leaf length. The grown plant is the model's evidence: its areoles are the
// sockets, and its growth digest is pinned so the conversion cannot move it.
import { beforeAll, describe, expect, it } from 'bun:test';
import type { PlantAsset, SpeciesKitData } from '../asset';
import { plantAssetDigest } from '../asset';
import { BUD_AREOLE } from '../core/graph';
import type { Column, SpeciesModule } from '../core/record';
import { loadSpecies } from '../core/registry';
import { spreadMean } from '../core/types';
import { buildKitNow, growPlantNow, loadPlantCode } from '../generate';
import { emitColumn, growColumn } from './column';
import { crownOf } from './model';

let saguaro: SpeciesModule;
let kit: SpeciesKitData;

beforeAll(async () => {
	saguaro = await loadSpecies('saguaro');
	await loadPlantCode(saguaro.record);
	kit = buildKitNow(saguaro, { placeholders: 'missing', detail: 'high' });
});

/** The saguaro grown at one seed and variant. */
function grow(seed: number, variant: number): PlantAsset {
	return growPlantNow(kit, { seed, variant, near: false, detail: 'high' });
}

/** How many of a plant's buds are of one kind. */
function budsOf(asset: PlantAsset, kind: number): number {
	const buds = asset.skeleton.buds;
	let count = 0;
	for (let b = 0; b < buds.count; b++) if ((buds.kind[b] as number) === kind) count++;
	return count;
}

describe('the column adapter', () => {
	it('emits the grown stem and arms, with the areoles as its sockets', () => {
		const plant = grow(11, 0);
		const model = emitColumn({ record: saguaro.record, seed: 11, variant: 0, season: 'summer' });
		// One stem then its arms, as the skeleton grows them.
		expect(model.axes.length).toBe(plant.skeleton.axes.count);
		expect(model.axes[0]?.parent).toBe(-1);
		expect(model.axes[0]?.order).toBe(0);
		for (const axis of model.axes.slice(1)) {
			expect(axis.parent).toBe(0);
			expect(axis.order).toBe(1);
			expect(axis.parentShare).toBeGreaterThanOrEqual(0);
			expect(axis.parentShare).toBeLessThanOrEqual(1);
		}
		// The stem's girth is the grown axis's own. The pipeline scales the skeleton to the record's
		// height target after growth, so the model's adult figures sit at that one scale above it.
		const bare = growColumn({
			record: saguaro.record,
			seed: 11,
			variant: 0,
			season: 'summer',
		});
		const scale = plant.skeleton.height / bare.height;
		expect(scale).toBeGreaterThan(0.99);
		expect(scale).toBeLessThan(1.01);
		const first = plant.skeleton.axes.first[0] as number;
		const last = plant.skeleton.axes.last[0] as number;
		expect((model.axes[0]?.radius[0] as number) * scale).toBeCloseTo(
			plant.skeleton.radius[first] as number,
			6,
		);
		expect((model.axes[0]?.radius[1] as number) * scale).toBeCloseTo(
			plant.skeleton.radius[last] as number,
			6,
		);
		for (const axis of model.axes) expect(axis.body).toBe(true);
		// One socket at each areole, and none for the flower rings or the nest holes.
		expect(model.sockets.length).toBe(budsOf(plant, BUD_AREOLE));
		expect(model.sockets.length + 78 + 30).toBe(plant.skeleton.buds.count);
		for (const socket of model.sockets) {
			expect(socket.piece).toBe(0);
			expect(socket.scale).toBe(1);
			expect(socket.keep).toBe(0);
			expect(socket.share).toBeGreaterThanOrEqual(0);
			expect(socket.share).toBeLessThanOrEqual(1);
			// A socket on the stem is its first order; on an arm, one order deeper.
			expect(socket.order).toBe(socket.axis === 0 ? 1 : 2);
			expect(model.axes[socket.axis]).toBeDefined();
		}
		expect(model.least).toBe(model.sockets.length);
		expect(model.keepShare).toBe(1);
		expect(model.scale).toBe(1);
	});

	it('states the spine-cluster piece from the record’s measured leaf length', () => {
		const model = emitColumn({ record: saguaro.record, seed: 11, variant: 0, season: 'summer' });
		const growth = saguaro.record.growth as Column;
		const leaf = saguaro.record.foliage.kind === 'blade' ? saguaro.record.foliage.leaf : undefined;
		const shoot = saguaro.record.shoots?.classes[0];
		const length = leaf ? spreadMean(leaf.length) : 0;
		expect(model.pieces).toHaveLength(1);
		const piece = model.pieces[0];
		if (!piece) throw new Error('the saguaro model states no piece');
		expect(piece.name).toBe(shoot?.name ?? 'areole');
		// The cluster's span is the record's leaf length; the card is flat, so it has no depth, and
		// its midrib runs down the axis, so it reaches below its socket and not above it.
		expect(piece.length).toBeCloseTo(length, 12);
		expect(piece.width).toBeCloseTo(length, 12);
		expect(piece.depth).toBe(0);
		expect(piece.top).toBe(0);
		expect(piece.reach).toBe(0);
		expect(piece.bottom).toBeCloseTo(length, 12);
		// The record's own figures, by name, as the price and the crown box read them.
		expect(piece.figures.leafLength).toBeCloseTo(length, 12);
		expect(piece.figures.shootStem).toBeCloseTo(shoot ? spreadMean(shoot.length) : 0, 12);
		expect(piece.figures.areoleSpacing).toBeCloseTo(growth.areoles, 12);
		expect(piece.figures.prototypes).toBe(saguaro.record.shoots?.prototypes ?? 1);
		expect(piece.figures.cardDepth).toBe(0);
	});

	it('reads the crown box from the pieces', () => {
		const plant = grow(11, 0);
		const model = emitColumn({ record: saguaro.record, seed: 11, variant: 0, season: 'summer' });
		const crown = crownOf(model.sockets, model.pieces);
		expect(model.crown.top).toBeCloseTo(crown.top, 12);
		expect(model.crown.reach).toBeCloseTo(crown.reach, 12);
		expect(model.crown.base).toBeCloseTo(crown.base, 12);
		// The areoles stop under the rounded top; the lowest run reaches the ground.
		expect(model.crown.top).toBeGreaterThan(plant.skeleton.height * 0.9);
		expect(model.crown.top).toBeLessThanOrEqual(plant.skeleton.height);
		expect(model.crown.base).toBeGreaterThanOrEqual(0);
		expect(model.crown.base).toBeLessThan(0.02);
		expect(model.crown.reach).toBeGreaterThan(0);
	});

	it('holds the grown plant’s digest across the conversion', () => {
		// Measured at the base head 4009261d2 and again after the adapter was written: one digest a
		// state. A change to the layout, the draws or the skeleton fails here.
		const man = grow(11, 0);
		expect(plantAssetDigest(man)).toBe('1153d8cc0c9a42a7');
		expect(plantAssetDigest(grow(11, 1))).toBe('45d7cf4559879b16');
		expect(plantAssetDigest(grow(3, 0))).toBe('634489e8cb63ff06');
		// The capsule figures, beside the digest: height, crown base, axes, areoles and the levels.
		expect(man.skeleton.height).toBeCloseTo(11.9379, 4);
		expect(man.skeleton.crownBase).toBe(0);
		expect(man.skeleton.axes.count).toBe(5);
		expect(budsOf(man, BUD_AREOLE)).toBe(5535);
		expect(man.levels.map((level) => level.triangles)).toEqual([1920, 44389, 19426]);
	});

	it('is the same model at every seed, and still the grown plant’s', () => {
		for (const seed of [3, 11, 23]) {
			const plant = grow(seed, 0);
			const model = emitColumn({ record: saguaro.record, seed, variant: 0, season: 'summer' });
			expect(model.sockets.length).toBe(budsOf(plant, BUD_AREOLE));
			expect(model.axes.length).toBe(plant.skeleton.axes.count);
		}
	});
});
