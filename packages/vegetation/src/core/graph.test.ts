import { describe, expect, it } from 'bun:test';
import {
	AXIS_LIMB,
	AXIS_STEM,
	BUD_TERMINAL,
	SkeletonBuilder,
	skeletonBuffers,
	skeletonCopy,
} from './graph';

describe('the skeleton builder', () => {
	it('grows its arrays as nodes arrive, and trims them when it finishes', () => {
		const builder = new SkeletonBuilder();
		const stem = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		let previous = -1;
		for (let i = 0; i < 200; i++)
			previous = builder.addNode({
				x: 0,
				y: i * 0.1,
				z: 0,
				radius: 0.2,
				parent: previous,
				axis: stem,
			});
		const limb = builder.addAxis({ parent: stem, parentNode: 100, order: 1, kind: AXIS_LIMB });
		for (let i = 1; i <= 20; i++)
			previous = builder.addNode({
				x: i * 0.2,
				y: 10,
				z: 0,
				radius: 0.05,
				parent: i === 1 ? 100 : previous,
				axis: limb,
			});
		builder.addBud({
			node: previous,
			x: 4,
			y: 10,
			z: 0,
			frame: [0, 0, 0, 1],
			kind: BUD_TERMINAL,
			vigor: 1,
			light: 1,
			axis: limb,
			woodRadius: 0.05,
		});
		const skeleton = builder.finish();
		expect(skeleton.nodeCount).toBe(220);
		expect(skeleton.position.length).toBe(660);
		expect(skeleton.axes.count).toBe(2);
		expect(skeleton.axes.first[1]).toBe(200);
		expect(skeleton.axes.last[1]).toBe(219);
		expect(skeleton.axes.record[1]).toBe(1);
		expect(skeleton.buds.count).toBe(1);
		expect(skeleton.height).toBeCloseTo(19.9, 5);
		// The crown base falls back to the lowest bud's height, and the bounds hold each node's radius.
		expect(skeleton.crownBase).toBe(10);
		expect(skeleton.bounds.min[0]).toBeCloseTo(-0.2, 6);
		expect(skeleton.bounds.max[0]).toBeCloseTo(4.05, 6);
		// Each array has a buffer of its own, so a worker can move them all.
		const buffers = skeletonBuffers(skeleton);
		expect(new Set(buffers).size).toBe(buffers.length);
	});

	it('copies every array, so a growth may move the copy to another thread', () => {
		const builder = new SkeletonBuilder();
		const stem = builder.addAxis({ parent: -1, parentNode: -1, order: 0, kind: AXIS_STEM });
		builder.addNode({ x: 0, y: 0, z: 0, radius: 0.2, parent: -1, axis: stem });
		builder.addNode({ x: 0, y: 1, z: 0, radius: 0.15, parent: 0, axis: stem });
		const skeleton = builder.finish();
		const copy = skeletonCopy(skeleton);
		// A buffer that the copy keeps would be detached from the skeleton when the copy moves to
		// the page, so the next growth of the same plant would send a detached array.
		const source = new Set(skeletonBuffers(skeleton));
		for (const buffer of skeletonBuffers(copy)) expect(source.has(buffer)).toBe(false);
		for (const view of Object.values(copy.axes))
			if (ArrayBuffer.isView(view)) expect(source.has(view.buffer as ArrayBuffer)).toBe(false);
	});
});
