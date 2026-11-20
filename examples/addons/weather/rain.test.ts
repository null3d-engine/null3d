// The falling rain: its shader keeps the box's height and the streak's length that the mesh is built
// with, and a scene's options reach the mesh and the material, while a scene that names none gets
// Skyway's rain. The context is a stand-in that records what the add-on asked the engine for.
import { describe, expect, it } from 'bun:test';
import type { SketchContext } from '@null3d/engine';
import { createRain, falling, HEIGHT, LENGTH, type RainOptions } from './rain';

/** What the rain asked the engine for: its mesh's arrays, its material's uniforms and its layers. */
function rainWith(options?: RainOptions) {
	const made: {
		positions?: Float32Array;
		uniforms?: Record<string, unknown>;
		layers?: number;
	} = {};
	const ctx = {
		scene: {
			createMesh(mesh: { mesh: { positions: Float32Array }; layers?: number }) {
				made.positions = mesh.mesh.positions;
				if (mesh.layers !== undefined) made.layers = mesh.layers;
				return { setCastShadows() {}, setPosition() {}, setVisible() {} };
			},
		},
		geometry: { fromArrays: (arrays: unknown) => arrays },
		materials: {
			shader(material: { uniforms: Record<string, unknown> }) {
				made.uniforms = material.uniforms;
				return { set() {} };
			},
		},
	} as unknown as SketchContext;
	createRain(ctx, options);
	return made;
}

describe('the falling rain', () => {
	it('keeps the shader’s box height and streak length in step with the mesh', () => {
		expect(falling).toContain(`let span = ${HEIGHT.toFixed(1)};`);
		expect(falling).toContain(`input.uv.y * ${LENGTH};`);
	});

	it('gives a scene that names nothing Skyway’s rain', () => {
		const made = rainWith();
		// 4,800 streaks of two crossed strips, four corners each.
		expect(made.positions?.length).toBe(4800 * 2 * 4 * 3);
		expect(made.uniforms?.tint).toEqual([0.34, 0.42, 0.55]);
		expect(made.layers).toBeUndefined();
		let reach = 0;
		for (let k = 0; k < (made.positions?.length ?? 0); k += 3)
			reach = Math.max(reach, Math.abs(made.positions?.[k] as number));
		expect(reach).toBeGreaterThan(60);
		expect(reach).toBeLessThanOrEqual(62.03);
	});

	it('takes the scene’s streaks, reach, color and layers', () => {
		const made = rainWith({ streaks: 10, reach: 5, color: [0.5, 0.5, 0.5], layers: 4 });
		expect(made.positions?.length).toBe(10 * 2 * 4 * 3);
		expect(made.uniforms?.tint).toEqual([0.5, 0.5, 0.5]);
		expect(made.layers).toBe(4);
		for (let k = 0; k < (made.positions?.length ?? 0); k += 3) {
			expect(Math.abs(made.positions?.[k] as number)).toBeLessThanOrEqual(5.03);
			expect(Math.abs(made.positions?.[k + 2] as number)).toBeLessThanOrEqual(5.03);
		}
	});

	it('places the same streaks for the same seed', () => {
		expect(rainWith({ streaks: 20, seed: 7 }).positions).toEqual(
			rainWith({ streaks: 20, seed: 7 }).positions,
		);
		expect(rainWith({ streaks: 20, seed: 7 }).positions).not.toEqual(
			rainWith({ streaks: 20, seed: 8 }).positions,
		);
	});
});
