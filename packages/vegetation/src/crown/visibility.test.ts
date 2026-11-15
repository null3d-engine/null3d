// The crown's light: an open sky reads 250 everywhere and bends straight up; leaves above a point
// darken it and bend its normal away from them; the octahedral byte keeps a direction's side.
import { describe, expect, it } from 'bun:test';
import type { ShootPrototype, ShootRows, SpeciesKitData } from '../asset';
import { SkeletonBuilder } from '../core/graph';
import { standInRecord } from '../core/stand-in';
import type { DressInput } from '../stages';
import { crownSkyAt, lightCrown, packBent } from './visibility';

/** A plain stem 10 m tall, so the grid spans a tree's height. */
function stem() {
	const builder = new SkeletonBuilder();
	const axis = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: 0 });
	builder.addNode({ x: -3, y: 0, z: -3, radius: 0.2, parent: -1, axis });
	builder.addNode({ x: 3, y: 10, z: 3, radius: 0.05, parent: 0, axis });
	return builder.finish(2);
}

/** Shoot rows pointing up, each with a prototype of 40 leaves, at the given points. */
function rowsAt(points: readonly (readonly [number, number, number])[]): ShootRows {
	const count = points.length;
	return {
		count,
		prototype: new Uint8Array(count),
		position: Float32Array.from(points.flat()),
		rotation: Float32Array.from(points.flatMap(() => [0, 0, 0, 1])),
		scale: new Float32Array(count).fill(1),
		record: new Uint16Array(count),
		phase: new Uint8Array(count),
		sky: new Uint8Array(count),
		bent: new Uint8Array(count),
		order: new Uint32Array(count),
	};
}

/** The dressing input of the stem with a kit of one prototype of the given leaves. */
function input(leaves = 40): DressInput {
	const record = standInRecord('crown-test');
	const prototype = { length: 0.4, leaves } as unknown as ShootPrototype;
	const kit = { record, prototypes: [prototype] } as unknown as SpeciesKitData;
	return { record, seed: 1, variant: 0, season: 'summer', kit, skeleton: stem() };
}

describe("the crown's light", () => {
	it('reads the whole sky, straight up, where no leaves stand', () => {
		const rows = rowsAt([[0, 5, 0]]);
		const crown = lightCrown(input(), rowsAt([]));
		expect(crownSkyAt(crown, 0, 5, 0)).toBeCloseTo(1, 6);
		lightCrown(input(0), rows);
		expect(rows.sky[0]).toBe(250);
		expect(rows.bent[0]).toBe(packBent(0, 1, 0));
	});

	it('darkens a shoot under a layer of leaves and bends its normal out from under them', () => {
		// A layer over the whole grid but its +z edge; the shoot sits under it, near that edge.
		const layer: [number, number, number][] = [];
		for (let x = -3.5; x <= 3.5; x += 0.25)
			for (let z = -3.5; z <= 0.5; z += 0.25) layer.push([x, 6, z]);
		const rows = rowsAt([...layer, [0, 5.4, 0], [0, 9.5, 2.5]]);
		lightCrown(input(), rows);
		const under = rows.count - 2;
		const top = rows.count - 1;
		expect(rows.sky[top] as number).toBeGreaterThan(200);
		expect(rows.sky[under] as number).toBeLessThan((rows.sky[top] as number) - 60);
		// The open sky lies toward +z, so the normal leans that way: the low four bits pass the middle.
		expect((rows.bent[under] as number) & 15).toBeGreaterThan(8);
	});

	it('packs the octahedral byte with Y up', () => {
		expect(packBent(0, 1, 0)).toBe(0x88);
		expect(packBent(1, 0, 0) >> 4).toBe(15);
		expect(packBent(-1, 0, 0) >> 4).toBe(0);
		expect(packBent(0, 0, 1) & 15).toBe(15);
	});

	it('takes a species sky-to-leaf value as the crown extinction, the constant where none', () => {
		// A layer over the whole grid but its +z edge; a shoot sits under it.
		const layer: [number, number, number][] = [];
		for (let x = -3.5; x <= 3.5; x += 0.25)
			for (let z = -3.5; z <= 0.5; z += 0.25) layer.push([x, 6, z]);
		const at = () => rowsAt([...layer, [0, 5.4, 0]]);
		const under = at().count - 1;
		const withValue = (skyToLeaf?: number): DressInput => {
			const base = input();
			return {
				...base,
				record: { ...base.record, ...(skyToLeaf !== undefined && { skyToLeaf }) },
			};
		};
		const baseRows = at();
		lightCrown(withValue(), baseRows);
		// Naming the default's own value leaves the bake exactly as the constant does.
		const sameRows = at();
		lightCrown(withValue(0.3), sameRows);
		expect(sameRows.sky[under]).toBe(baseRows.sky[under] as number);
		// A denser extinction leaves the shoot less sky.
		const denserRows = at();
		lightCrown(withValue(0.8), denserRows);
		expect(denserRows.sky[under]).toBeLessThan(baseRows.sky[under] as number);
	});
});
