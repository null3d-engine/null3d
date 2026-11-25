// The gizmo's handle meshes: every one keeps its full shape, because the handles hold one size on
// the screen at any distance.
import { describe, expect, test } from 'bun:test';
import type { Object3D, PerspectiveCamera, SketchContext } from '@null3d/engine';
import { createTransformControls, type TransformControlsOptions } from './transform-controls';

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

/** A gizmo whose handle meshes record whether they show, by their names, such as "translate XY". */
function recordingGizmo(options: TransformControlsOptions = {}) {
	const shown = new Map<string, boolean>();
	const createMesh = (mesh: { name: string }) =>
		new Proxy(() => undefined, {
			get: (_target, key) => {
				if (key === 'setVisible') return (visible: boolean) => shown.set(mesh.name, visible);
				if (key === 'then') return undefined;
				if (key === Symbol.toPrimitive) return () => 0;
				return stub;
			},
			apply: () => stub,
		});
	const scene = new Proxy(
		{},
		{
			get: (_target, key) =>
				key === 'createMesh' ? createMesh : key === 'then' ? undefined : stub,
		},
	);
	const context = {
		scene,
		input: stub,
		materials: stub,
		geometry: stub,
	} as unknown as SketchContext;
	const controls = createTransformControls(context, stub as PerspectiveCamera, options);
	controls.attach(stub as Object3D);
	/** Whether the drawn handle and its picker of one mode and axis show. */
	const visible = (mode: string, axis: string) => shown.get(`${mode} ${axis}`);
	return { controls, visible };
}

describe('the plane handle flags', () => {
	test('show every plane handle by default', () => {
		const { visible } = recordingGizmo();
		for (const axis of ['XY', 'YZ', 'XZ', 'XYZ']) expect(visible('translate', axis)).toBe(true);
	});

	test('hide one plane handle each, and keep the axes', () => {
		for (const [flag, axis] of [
			['showXY', 'XY'],
			['showYZ', 'YZ'],
			['showXZ', 'XZ'],
		] as const) {
			const { visible } = recordingGizmo({ [flag]: false });
			expect(visible('translate', axis)).toBe(false);
			for (const other of ['XY', 'YZ', 'XZ'].filter((name) => name !== axis))
				expect(visible('translate', other)).toBe(true);
			for (const single of ['X', 'Y', 'Z']) expect(visible('translate', single)).toBe(true);
		}
	});

	test("hide the center handle with XY or YZ, by three.js's rule of names", () => {
		expect(recordingGizmo({ showXY: false }).visible('translate', 'XYZ')).toBe(false);
		expect(recordingGizmo({ showYZ: false }).visible('translate', 'XYZ')).toBe(false);
		expect(recordingGizmo({ showXZ: false }).visible('translate', 'XYZ')).toBe(true);
	});

	test('hide a plane handle with either of its axes, as three.js does', () => {
		const { visible } = recordingGizmo({ showX: false });
		expect(visible('translate', 'XY')).toBe(false);
		expect(visible('translate', 'XZ')).toBe(false);
		expect(visible('translate', 'YZ')).toBe(true);
	});

	test('take a change of a flag when the handles refresh', () => {
		const { controls, visible } = recordingGizmo();
		controls.showXZ = false;
		controls.setMode('translate');
		expect(visible('translate', 'XZ')).toBe(false);
		controls.showXZ = true;
		controls.setMode('translate');
		expect(visible('translate', 'XZ')).toBe(true);
	});
});

describe('the limits of a move', () => {
	test('default to no limit, and keep the values that the options give', () => {
		const free = recordingGizmo().controls;
		expect([free.minX, free.minY, free.minZ]).toEqual([
			Number.NEGATIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
		]);
		expect([free.maxX, free.maxY, free.maxZ]).toEqual([
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
			Number.POSITIVE_INFINITY,
		]);
		const held = recordingGizmo({
			minX: -1,
			maxX: 1,
			minY: 0,
			maxY: 2,
			minZ: -3,
			maxZ: 3,
		}).controls;
		expect([held.minX, held.maxX, held.minY, held.maxY, held.minZ, held.maxZ]).toEqual([
			-1, 1, 0, 2, -3, 3,
		]);
	});
});
