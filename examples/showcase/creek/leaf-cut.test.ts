// The maples' far leaves belong to the lowest quality tier alone: while the tier applies, a leaf
// copy past the cut distance draws nothing, and the file's own levels come back when the tier
// does not. The wood keeps its levels either way, since the cut is on the leaves' mesh.
import { expect, test } from 'bun:test';
import type { MeshGeometry, MeshLevel, SketchContext } from '@null3d/engine';
import { FAR_LEAVES, farLeafLevels, watchFarLeaves } from './leaf-cut';

const empty = {} as MeshGeometry;
const errorLevel = (error: number): MeshLevel => ({ mesh: {} as MeshGeometry, error });
const distanceLevel = (distance: number): MeshLevel => ({ mesh: {} as MeshGeometry, distance });

test('the cut keeps the levels that switch before it and ends on an empty one', () => {
	// The maple's own levels switch by their errors, past the cut, so the empty level stands alone.
	const cut = farLeafLevels([errorLevel(138), errorLevel(231)], empty);
	expect(cut).toHaveLength(1);
	expect(cut[0]?.mesh).toBe(empty);
	expect(cut[0]?.distance).toBe(FAR_LEAVES);
	// A level that switches before the cut stays in front of it, where its switches still grow.
	const kept = farLeafLevels([distanceLevel(25), distanceLevel(40)], empty, 60);
	expect(kept.map((level) => level.distance)).toEqual([25, 40, 60]);
	expect(kept[2]?.mesh).toBe(empty);
});

test('the cut applies only while the lowest tier is on, and the levels come back after', () => {
	const applied: (readonly MeshLevel[])[] = [];
	const own = [errorLevel(138), errorLevel(231)];
	const leaves = {
		get levels() {
			return own;
		},
		setLevels(levels: readonly MeshLevel[]) {
			applied.push(levels);
		},
	} as unknown as MeshGeometry;
	const handlers = new Set<() => void>();
	const tier = { governor: { lowest: false } };
	const ctx = {
		quality: {
			governor: tier.governor,
			onChange(handler: () => void) {
				handlers.add(handler);
				return () => handlers.delete(handler);
			},
		},
		geometry: { fromArrays: () => empty },
	} as unknown as SketchContext;
	const stop = watchFarLeaves(ctx, leaves);
	// The tier is off, so nothing changes.
	expect(applied).toHaveLength(0);
	tier.governor.lowest = true;
	for (const handler of handlers) handler();
	expect(applied).toHaveLength(1);
	expect(applied[0]).toHaveLength(1);
	expect(applied[0]?.[0]?.distance).toBe(FAR_LEAVES);
	// A second notice with the tier still on sets nothing again.
	for (const handler of handlers) handler();
	expect(applied).toHaveLength(1);
	tier.governor.lowest = false;
	for (const handler of handlers) handler();
	expect(applied).toHaveLength(2);
	expect(applied[1]).toBe(own);
	// The listener stops when the watcher is dropped.
	stop();
	tier.governor.lowest = true;
	for (const handler of handlers) handler();
	expect(applied).toHaveLength(2);
});

test('an engine without the tier leaves the leaves as they are', () => {
	const applied: (readonly MeshLevel[])[] = [];
	const leaves = {
		get levels() {
			return [];
		},
		setLevels(levels: readonly MeshLevel[]) {
			applied.push(levels);
		},
	} as unknown as MeshGeometry;
	const ctx = { quality: {}, geometry: { fromArrays: () => empty } } as unknown as SketchContext;
	watchFarLeaves(ctx, leaves)();
	expect(applied).toHaveLength(0);
});
