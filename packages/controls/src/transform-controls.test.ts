// The gizmo's handle meshes: every one keeps its full shape, because the handles hold one size on
// the screen at any distance.
import { describe, expect, test } from 'bun:test';
import type { PerspectiveCamera, SketchContext } from '@null3d/engine';
import { createTransformControls } from './transform-controls';

/** A stand-in that answers every call and every property with itself, and reads as 0 as a number. */
const stub: unknown = new Proxy(() => undefined, {
	get: (_target, key) => {
		if (key === 'then') return undefined;
		if (key === Symbol.toPrimitive) return () => 0;
		return stub;
	},
	apply: () => stub,
});

describe('the transform gizmo', () => {
	test('makes every handle mesh without levels', () => {
		const shapes: Record<string, unknown>[] = [];
		const record = (options: Record<string, unknown>) => {
			shapes.push(options);
			return stub;
		};
		const context = {
			scene: stub,
			input: stub,
			materials: stub,
			geometry: { box: record, cylinder: record, cone: record, torus: record },
		} as unknown as SketchContext;
		createTransformControls(context, stub as PerspectiveCamera);
		expect(shapes.length).toBeGreaterThan(0);
		for (const options of shapes) expect(options.levels).toBe(false);
	});
});
