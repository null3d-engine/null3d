// The creek's water keeps two copies of some of its shader code, since each WGSL string compiles on
// its own: the long waves that move the surface, which the scene also works out on the CPU to know
// when the camera is under the water, and the caustics, which the view from under the water draws
// too. These tests fail when one copy changes without the other.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { streamSlope, WATER } from './land';
import { FLOW, surfaceHeight } from './water';

const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');

/** The body of the WGSL function `name` in `source`, from its signature to its closing brace. */
function wgslFunction(source: string, name: string): string {
	const start = source.indexOf(`fn ${name}(`);
	expect(start).toBeGreaterThanOrEqual(0);
	const end = source.indexOf('\n}', start);
	return source
		.slice(start, end)
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '' && !line.startsWith('//'))
		.join('\n');
}

describe('the creek’s water', () => {
	it('works out the same long waves on the CPU as its vertex shader moves', () => {
		const source = read('water.ts');
		const waves = wgslFunction(source, 'waves');
		for (const wave of ['1.0, 0.15, 2.3, 0.9', '0.8, -0.6, 3.7, 0.7', '0.6, 0.8, 5.9, 0.5'])
			expect(waves).toContain(`vec4f(${wave})`);
		expect(source).toContain(
			'[1.0, 0.15, 2.3, 0.9],\n\t[0.8, -0.6, 3.7, 0.7],\n\t[0.6, 0.8, 5.9, 0.5],',
		);
		// The view from under the water finds the waterline from the same waves, per pixel.
		const under = wgslFunction(read('underwater.ts'), 'surface_height');
		for (const wave of ['1.0, 0.15, 2.3, 0.9', '0.8, -0.6, 3.7, 0.7', '0.6, 0.8, 5.9, 0.5'])
			expect(under).toContain(`vec4f(${wave})`);
	});

	it('keeps the waves crossing at the angles they had', () => {
		// The owner's ruling: the current changes which way the crests travel, not whether they
		// cross. The six directions stay as they were, so the set keeps its cross-hatch.
		const waves = wgslFunction(read('water.ts'), 'waves');
		const angles = [...waves.matchAll(/vec4f\((-?[\d.]+), (-?[\d.]+),/g)]
			.map((match) => {
				const x = Number(match[1]);
				const z = Number(match[2]);
				return (Math.atan2(z, x) * 180) / Math.PI;
			})
			.sort((a, b) => a - b);
		expect(angles).toHaveLength(6);
		// No two crest lines lie on one direction, and the set spans more than a right angle.
		let least = 360;
		for (let i = 0; i < angles.length; i++) {
			const next = angles[(i + 1) % angles.length] as number;
			const gap = ((next - (angles[i] as number) + 540) % 360) - 180;
			least = Math.min(least, Math.abs(gap));
		}
		expect(least).toBeGreaterThan(10);
		expect((angles[5] as number) - (angles[0] as number)).toBeGreaterThan(90);
	});

	it('drifts its whole pattern downstream with the current', () => {
		// The phase is measured in the current's frame, so the surface at a later time is the older
		// surface moved downstream. A wave that ran along its own direction in the world would fail.
		const x = 2.1;
		const z = 0.4;
		const t = 1.3;
		const dt = 0.1;
		const slope = streamSlope(x);
		const length = Math.hypot(1, slope);
		const vx = FLOW / length;
		const vz = (FLOW * slope) / length;
		const along = surfaceHeight(x - vx * dt, z - vz * dt, t);
		expect(surfaceHeight(x, z, t + dt)).toBeCloseTo(along, 4);
	});

	it('moves its surface a few centimeters about the water level', () => {
		let lowest = Number.POSITIVE_INFINITY;
		let highest = Number.NEGATIVE_INFINITY;
		for (let k = 0; k < 2000; k++) {
			const h = surfaceHeight((k % 40) - 20, ((k * 7) % 9) - 4, k * 0.037);
			lowest = Math.min(lowest, h);
			highest = Math.max(highest, h);
		}
		const reach = 0.05 * (1 / 2.3 + 1 / 3.7 + 1 / 5.9);
		expect(lowest).toBeGreaterThanOrEqual(WATER - reach);
		expect(highest).toBeLessThanOrEqual(WATER + reach);
		expect(highest - lowest).toBeGreaterThan(reach);
	});

	it('draws the same caustics from under the water as on its surface', () => {
		expect(wgslFunction(read('underwater.ts'), 'caustics')).toBe(
			wgslFunction(read('water.ts'), 'caustics'),
		);
	});

	it('finds the current the same way under the water as on its surface', () => {
		// The surface reads the flow from its material's uniforms and the effect from its own.
		const surface = wgslFunction(read('water.ts'), 'current_of').replace('material.flow', 'flow');
		const under = wgslFunction(read('underwater.ts'), 'current_of').replace(
			'uniforms.flow',
			'flow',
		);
		expect(under).toBe(surface);
	});
});
