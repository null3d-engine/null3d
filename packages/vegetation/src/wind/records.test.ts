// The wind records on hand-built plants: a plant of 3,000 axes keeps one record per axis, each
// with 16-bit global ids; a plant past a variant's share of ids shares records among its finest
// axes by parent and renumbers its axes and shoot rows to match; a child's pivot is the junction on
// its parent's internode.
import { describe, expect, it } from 'bun:test';
import type { ShootRows } from '../asset';
import { AXIS_LIMB, AXIS_STEM, type MacroSkeleton, SkeletonBuilder } from '../core/graph';
import { emptyRows } from '../core/placeholder';
import { standInRecord } from '../core/stand-in';
import type { MeshInput } from '../stages';
import { VARIANT_RECORDS, WIND_RECORD_FLOATS, windRecords } from './records';

/**
 * A stem of `branches + 1` nodes up +Y, a limb from each node but the last, and `twigs` twigs on
 * each limb's tip, each twig two nodes long.
 */
function plant(branches: number, twigs: number): MacroSkeleton {
	const b = new SkeletonBuilder();
	const stem = b.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const stemNodes: number[] = [];
	for (let i = 0; i <= branches; i++)
		stemNodes.push(
			b.addNode({
				x: 0,
				y: i * 0.1,
				z: 0,
				radius: 0.2,
				parent: i === 0 ? -1 : (stemNodes[i - 1] as number),
				axis: stem,
			}),
		);
	for (let i = 0; i < branches; i++) {
		const limb = b.addAxis({
			parent: stem,
			parentNode: stemNodes[i] as number,
			parentT: 0.5,
			order: 1,
			kind: AXIS_LIMB,
		});
		const a = b.addNode({
			x: 0.3,
			y: i * 0.1 + 0.05,
			z: 0,
			radius: 0.05,
			parent: stemNodes[i] as number,
			axis: limb,
		});
		const tip = b.addNode({ x: 0.8, y: i * 0.1 + 0.2, z: 0, radius: 0.03, parent: a, axis: limb });
		for (let t = 0; t < twigs; t++) {
			const twig = b.addAxis({ parent: limb, parentNode: tip, order: 2, kind: AXIS_LIMB });
			const n = b.addNode({
				x: 0.9,
				y: i * 0.1 + 0.2,
				z: t * 0.05,
				radius: 0.01,
				parent: tip,
				axis: twig,
			});
			b.addNode({ x: 1, y: i * 0.1 + 0.25, z: t * 0.05, radius: 0.005, parent: n, axis: twig });
		}
	}
	return b.finish(0);
}

/** Shoot rows, one on each axis, naming the axis by its record as grown. */
function rowsOn(skeleton: MacroSkeleton): ShootRows {
	const rows = emptyRows();
	const count = skeleton.axes.count;
	return { ...rows, count, record: Uint16Array.from(skeleton.axes.record.subarray(0, count)) };
}

function input(skeleton: MacroSkeleton, variant: number): MeshInput {
	return {
		record: standInRecord('wind-test'),
		seed: 11,
		variant,
		season: 'summer',
		kit: {} as MeshInput['kit'],
		skeleton,
		rows: rowsOn(skeleton),
		crown: { cells: [1, 1, 1], min: [0, 0, 0], cell: 1, sky: new Float32Array(1) },
		detail: 'high',
	};
}

describe('wind records', () => {
	it('give each of 3,000 axes its own record, with 16-bit global ids', () => {
		const skeleton = plant(1000, 1);
		expect(skeleton.axes.count).toBe(2001);
		const big = plant(1499, 1);
		expect(big.axes.count).toBe(2999);
		const variant = 7;
		const table = windRecords(input(big, variant));
		expect(table.base).toBe(variant * VARIANT_RECORDS);
		expect(table.count).toBe(big.axes.count);
		expect(table.base + table.count).toBeLessThan(65536);
		for (let a = 0; a < big.axes.count; a++) {
			expect(big.axes.record[a]).toBe(a);
			const parent = table.records[a * WIND_RECORD_FLOATS + 3] as number;
			const own = big.axes.parent[a] as number;
			expect(parent).toBe(own < 0 ? -1 : table.base + own);
		}
	});

	it('turn a child about the junction on its parent, and give the stem its base', () => {
		const skeleton = plant(4, 1);
		const table = windRecords(input(skeleton, 0));
		const at = (record: number, k: number) =>
			table.records[record * WIND_RECORD_FLOATS + k] as number;
		// Limb 1 leaves stem node 0 halfway to node 1: y 0.05.
		expect(at(1, 0)).toBeCloseTo(0, 6);
		expect(at(1, 1)).toBeCloseTo(0.05, 6);
		expect(at(0, 1)).toBeCloseTo(0, 6);
		// The axis runs from the pivot to the tip, and its length is that span.
		const length = Math.hypot(0.8, 0.2 - 0.05);
		expect(at(1, 11)).toBeCloseTo(length, 5);
		expect(at(1, 4)).toBeCloseTo(0.8 / length, 5);
	});

	it('share the finest axes by parent past a variant share, and renumber the rows', () => {
		const skeleton = plant(900, 9);
		expect(skeleton.axes.count).toBeGreaterThan(VARIANT_RECORDS);
		const job = input(skeleton, 2);
		const twigRecordBefore = job.rows.record[skeleton.axes.count - 1];
		expect(twigRecordBefore).toBe(skeleton.axes.count - 1);
		const table = windRecords(job);
		expect(table.count).toBeLessThanOrEqual(VARIANT_RECORDS);
		// The stem and every limb keep a record of their own; each limb's twigs share one.
		expect(table.count).toBe(1 + 900 + 900);
		const seen = new Set<number>();
		for (let a = 0; a < skeleton.axes.count; a++) {
			const record = skeleton.axes.record[a] as number;
			expect(record).toBeLessThan(table.count);
			if ((skeleton.axes.order[a] as number) < 2) {
				expect(seen.has(record)).toBe(false);
				seen.add(record);
			}
		}
		const lastTwig = skeleton.axes.count - 1;
		const sibling = lastTwig - 8;
		expect(skeleton.axes.record[lastTwig]).toBe(skeleton.axes.record[sibling] as number);
		expect(job.rows.record[lastTwig]).toBe(skeleton.axes.record[lastTwig] as number);
		// A shared record's parent is its limb's own record.
		const twig = skeleton.axes.record[lastTwig] as number;
		const limb = skeleton.axes.parent[lastTwig] as number;
		expect(table.records[twig * WIND_RECORD_FLOATS + 3]).toBe(
			table.base + (skeleton.axes.record[limb] as number),
		);
	});
});
