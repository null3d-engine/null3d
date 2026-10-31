import { describe, expect, test } from 'bun:test';
import { S7_CAMERA, S7_PAVING, S7_PLANE, S7_SURFACE, s7Camera, s7Paving } from './s7';
import { PARITY_CANVAS } from './spec';

describe('S7', () => {
	test('holds the camera still, so every run draws the same view', () => {
		const first = new Float64Array(3);
		const firstTarget = new Float64Array(3);
		const later = new Float64Array(3);
		const laterTarget = new Float64Array(3);
		s7Camera(0, first, firstTarget);
		s7Camera(3600, later, laterTarget);
		expect([...later]).toEqual([...first]);
		expect([...laterTarget]).toEqual([...firstTarget]);
		expect([...first]).toEqual([...S7_CAMERA.position]);
	});

	test('draws the surface to the horizon: its far edge lies under a pixel below the horizon line', () => {
		const eyeHeight = S7_CAMERA.position[1];
		const farEdge = S7_PLANE.height / 2 + S7_CAMERA.position[2];
		const belowHorizon = (Math.atan2(eyeHeight, farEdge) * 180) / Math.PI;
		expect(belowHorizon * (PARITY_CANVAS.height / S7_CAMERA.fov)).toBeLessThan(1);
	});

	test("draws the whole surface within the camera's far plane", () => {
		const [width, height] = [S7_PLANE.width / 2, S7_PLANE.height / 2];
		expect(S7_CAMERA.far).toBeGreaterThan(Math.hypot(width, height) + S7_CAMERA.position[2]);
	});

	test('keeps the surface smooth enough to mirror the sky', () => {
		expect(S7_SURFACE.roughness).toBeLessThan(0.2);
	});

	test('paves the surface with a fixed texture of the size it states', () => {
		const paving = s7Paving();
		const { size, tiles } = S7_PAVING;
		expect([paving.width, paving.height]).toEqual([size, size]);
		expect(paving.data.length).toBe(size * size * 4);
		const shade = (x: number, y: number) => paving.data[(y * size + x) * 4] as number;
		// A joint runs along the texture's first row, and a stone lies inside the first tile.
		expect(shade(0, 0)).toBeLessThan(shade(size / tiles / 2, size / tiles / 2));
		expect([...s7Paving().data]).toEqual([...paving.data]);
	});
});
