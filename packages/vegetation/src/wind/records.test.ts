// The wind records of a variant: where each axis leaves its parent, the span it turns about, its
// stiffness and flutter from the species' record, and the shared ids that a variant with more axes
// than its share of records gives its finest twigs.
import { describe, expect, it } from 'bun:test';
import type { ShootRows } from '../asset';
import { AXIS_LIMB, AXIS_STEM, SkeletonBuilder } from '../core/graph';
import { curveAt } from '../core/types';
import { record as oak } from '../species/pedunculate-oak/record';
import type { CrownLight, MeshInput } from '../stages';
import { VARIANT_RECORDS, WIND_RECORD_FLOATS, windRecords } from './records';

/** Empty shoot rows: the geometry checks name no row. */
function noRows(): ShootRows {
	return {
		count: 0,
		prototype: new Uint8Array(0),
		position: new Float32Array(0),
		rotation: new Float32Array(0),
		scale: new Float32Array(0),
		record: new Uint16Array(0),
		phase: new Uint8Array(0),
		sky: new Uint8Array(0),
		bent: new Uint8Array(0),
		order: new Uint32Array(0),
		axisOrder: new Uint8Array(0),
	};
}

/**
 * The input that the records stage reads: the record, the skeleton, the rows, the seed and the
 * variant. The kit and the crown belong to the stages after it.
 */
function input(
	skeleton: MeshInput['skeleton'],
	rows: ShootRows = noRows(),
	variant = 2,
	record: typeof oak = oak,
): MeshInput {
	return {
		record,
		seed: 11,
		variant,
		season: 'summer',
		kit: {} as MeshInput['kit'],
		skeleton,
		rows,
		crown: {} as CrownLight,
		detail: 'high',
	};
}

/** A record's numbers. */
function recordAt(table: ReturnType<typeof windRecords>, r: number): number[] {
	return [...table.records.subarray(r * WIND_RECORD_FLOATS, (r + 1) * WIND_RECORD_FLOATS)];
}

describe('the wind records', () => {
	// A stem from 1 to 4 m, and a limb that leaves the stem's second internode halfway along it.
	// The limb's own first node stands 2 m out from the junction, so the two differ.
	const builder = new SkeletonBuilder();
	const stem = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
	const stemNodes: number[] = [];
	for (let k = 0; k <= 4; k++)
		stemNodes.push(
			builder.addNode({
				x: 0,
				y: k,
				z: 0,
				radius: 0.3 - 0.05 * k,
				parent: k === 0 ? -1 : (stemNodes[k - 1] as number),
				axis: stem,
			}),
		);
	const limb = builder.addAxis({
		parent: stem,
		parentNode: stemNodes[2] as number,
		parentT: 0.5,
		order: 1,
		kind: AXIS_LIMB,
	});
	const limbBase = builder.addNode({
		x: 2,
		y: 2.5,
		z: 0,
		radius: 0.1,
		parent: stemNodes[2] as number,
		axis: limb,
	});
	builder.addNode({ x: 4, y: 2.5, z: 0, radius: 0.05, parent: limbBase, axis: limb });
	const twig = builder.addAxis({
		parent: limb,
		parentNode: limbBase,
		parentT: 0,
		order: 2,
		kind: AXIS_LIMB,
	});
	builder.addNode({ x: 5, y: 3, z: 0, radius: 0.02, parent: limbBase, axis: twig });
	const skeleton = builder.finish();

	it('turns each axis about the junction on its parent internode, not its own first node', () => {
		const table = windRecords(input(skeleton));
		expect(table.base).toBe(2 * VARIANT_RECORDS);
		expect(table.count).toBe(3);
		// The stem's pivot is its own base.
		const stemRecord = recordAt(table, 0);
		expect(stemRecord.slice(0, 3)).toEqual([0, 0, 0]);
		expect(stemRecord[3]).toBe(-1);
		expect(stemRecord.slice(4, 7)).toEqual([0, 1, 0]);
		expect(stemRecord[11]).toBe(4);
		// The limb leaves halfway along the stem's second internode, 2 to 3 m up.
		const limbRecord = recordAt(table, 1);
		expect(limbRecord.slice(0, 3)).toEqual([0, 2.5, 0]);
		expect(limbRecord.slice(4, 7)).toEqual([1, 0, 0]);
		expect(limbRecord[11]).toBe(4);
		// Its parent is the stem's record, in the species' table.
		expect(limbRecord[3]).toBe(table.base);
		// The twig leaves the limb at its base node.
		expect(recordAt(table, 2).slice(0, 3)).toEqual([2, 2.5, 0]);
		expect(recordAt(table, 2)[3]).toBe(table.base + 1);
	});

	it('takes its stiffness by the axis order and its flutter from the species record', () => {
		const table = windRecords(input(skeleton));
		const deepest = 2;
		const orders = [0, 1, 2];
		orders.forEach((order, r) => {
			const record = recordAt(table, r);
			// The species' curve reads the axis's share of the deepest order.
			expect(record[7]).toBeCloseTo(curveAt(oak.wind.stiffness, order / deepest), 6);
			expect(record[8]).toBe(oak.wind.flutter.amplitude);
			expect(record[9]).toBe(oak.wind.flutter.frequency);
			expect(record[10]).toBe(order);
		});
	});

	it('weighs the flutter by the axis height only where the record names a curve', () => {
		// The fixture's stems span 0 to 4 m, so an axis's middle reads its own share of the height.
		const byHeight: readonly (readonly [number, number])[] = [
			[0, 2],
			[1, 0.5],
		];
		const weighed = {
			...oak,
			wind: { ...oak.wind, flutter: { ...oak.wind.flutter, byHeight } },
		} as typeof oak;
		const middles = [2, 2.5, 3];
		const table = windRecords(input(skeleton, noRows(), 2, weighed));
		middles.forEach((middle, r) => {
			expect(recordAt(table, r)[8]).toBeCloseTo(
				oak.wind.flutter.amplitude * curveAt(byHeight, middle / 4),
				6,
			);
		});
		// Without the curve, every axis keeps the record's own amplitude, as it always has.
		const plain = windRecords(input(skeleton));
		for (let r = 0; r < plain.count; r++)
			expect(recordAt(plain, r)[8]).toBe(oak.wind.flutter.amplitude);
	});

	it('gives each axis a sway phase of its own, from the seed and the variant', () => {
		const table = windRecords(input(skeleton));
		const phases = [0, 1, 2].map((r) => recordAt(table, r)[12] as number);
		for (const phase of phases) {
			expect(phase).toBeGreaterThanOrEqual(0);
			expect(phase).toBeLessThan(1);
		}
		expect(new Set(phases).size).toBe(3);
		// The phase belongs to the axis, so the seed and the variant give another plant's.
		const other = windRecords(input(skeleton, noRows(), 3));
		expect(recordAt(other, 0)[12]).not.toBe(phases[0] as number);
		const again = windRecords(input(skeleton));
		expect(recordAt(again, 0)[12]).toBe(phases[0] as number);
	});

	it('gives no whip weight to a species without whips', () => {
		const table = windRecords(input(skeleton));
		for (let r = 0; r < table.count; r++) expect(recordAt(table, r)[13]).toBe(0);
	});

	it('leaves the axis records alone when a variant fits its share of ids', () => {
		const grown = new Uint16Array(skeleton.axes.record);
		const table = windRecords(input(skeleton));
		expect(table.count).toBe(skeleton.axes.count);
		expect([...skeleton.axes.record]).toEqual([...grown]);
	});
});

describe('the records that a crowded variant shares', () => {
	// One stem, two coarse limbs and 4,000 twigs on each: more axes than a variant may hold.
	function crowded(): { skeleton: MeshInput['skeleton']; limbs: number[]; twigs: number[][] } {
		const builder = new SkeletonBuilder();
		const stem = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		const base = builder.addNode({ x: 0, y: 0, z: 0, radius: 0.4, parent: -1, axis: stem });
		const top = builder.addNode({ x: 0, y: 3, z: 0, radius: 0.3, parent: base, axis: stem });
		const limbs: number[] = [];
		const twigs: number[][] = [];
		for (let l = 0; l < 2; l++) {
			const limb = builder.addAxis({
				parent: stem,
				parentNode: top,
				parentT: 0.5,
				order: 1,
				kind: AXIS_LIMB,
			});
			const at = builder.addNode({
				x: 1 + l,
				y: 3,
				z: 0,
				radius: 0.2,
				parent: top,
				axis: limb,
			});
			limbs.push(limb);
			// The twig table of each limb, in the order the records reach them.
			const own: number[] = [];
			for (let t = 0; t < 4000; t++) {
				const twig = builder.addAxis({
					parent: limb,
					parentNode: at,
					parentT: 1,
					order: 2,
					kind: AXIS_LIMB,
				});
				builder.addNode({
					x: 1 + l + 0.01 * t,
					y: 4,
					z: 0,
					radius: 0.02,
					parent: at,
					axis: twig,
				});
				own.push(twig);
			}
			twigs.push(own);
		}
		return { skeleton: builder.finish(), limbs, twigs };
	}

	/** Two rows that name one twig of each limb, as grown. */
	function rowsFor(twigs: number[][]): ShootRows {
		return {
			...noRows(),
			count: 2,
			record: new Uint16Array([twigs[0]?.[0] as number, twigs[1]?.[3999] as number]),
		};
	}

	it('makes one record per coarse axis and one per twig system under each limb', () => {
		const { skeleton, limbs, twigs } = crowded();
		expect(skeleton.axes.count).toBeGreaterThan(VARIANT_RECORDS);
		const rows = rowsFor(twigs);
		const table = windRecords(input(skeleton, rows));
		expect(table.count).toBe(5);
		// Every twig of one limb takes the record of the first twig of that limb.
		const lead0 = skeleton.axes.record[twigs[0]?.[0] as number] as number;
		const lead1 = skeleton.axes.record[twigs[1]?.[0] as number] as number;
		expect(lead0).not.toBe(lead1);
		for (const t of twigs[0] as number[]) expect(skeleton.axes.record[t] as number).toBe(lead0);
		for (const t of twigs[1] as number[]) expect(skeleton.axes.record[t] as number).toBe(lead1);
		// The rows name the shared ids that the meshes read.
		expect(rows.record[0]).toBe(lead0);
		expect(rows.record[1]).toBe(lead1);
		// A shared twig record keeps its limb as its parent.
		const limbRecord = table.base + (skeleton.axes.record[limbs[0] as number] as number);
		expect(recordAt(table, lead0)[3]).toBe(limbRecord);
	});

	it('gives one seed and variant the same table and the same shared ids twice', () => {
		const first = crowded();
		const second = crowded();
		const firstRows = rowsFor(first.twigs);
		const secondRows = rowsFor(second.twigs);
		const a = windRecords(input(first.skeleton, firstRows));
		const b = windRecords(input(second.skeleton, secondRows));
		expect(a.base).toBe(b.base);
		expect(a.count).toBe(b.count);
		expect([...a.records]).toEqual([...b.records]);
		// The skeleton and the rows are renumbered to the same shared ids.
		expect([...first.skeleton.axes.record]).toEqual([...second.skeleton.axes.record]);
		expect([...firstRows.record]).toEqual([...secondRows.record]);
	});
});
