// The creek's water keeps two copies of some of its shader code, since each WGSL string compiles on
// its own: the long waves that move the surface, which the scene also works out on the CPU to know
// when the camera is under the water, and the caustics, which the view from under the water draws
// too. These tests fail when one copy changes without the other.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WATER } from './land';
import { surfaceHeight } from './water';

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
		for (const wave of ['0.14, 2.3, 0.9, 0.0', '-0.31, 3.7, 0.7, 0.0', '0.35, 5.9, 0.5, 0.0'])
			expect(waves).toContain(`vec4f(${wave})`);
		expect(source).toContain('[0.14, 2.3, 0.9],\n\t[-0.31, 3.7, 0.7],\n\t[0.35, 5.9, 0.5],');
		// The view from under the water finds the waterline from the same waves, per pixel.
		const under = wgslFunction(read('underwater.ts'), 'surface_height');
		for (const wave of ['0.14, 2.3, 0.9, 0.0', '-0.31, 3.7, 0.7, 0.0', '0.35, 5.9, 0.5, 0.0'])
			expect(under).toContain(`vec4f(${wave})`);
	});

	it('turns every wave within a fifth of a right angle of the stream', () => {
		// The owner's ruling: all visible motion follows the river. A wave travels along its own
		// direction, so every tilt from the current must stay small or its crests cross the stream.
		const waves = wgslFunction(read('water.ts'), 'waves');
		const tilts = [...waves.matchAll(/vec4f\((-?[\d.]+),/g)].map((match) => Number(match[1]));
		expect(tilts).toHaveLength(6);
		for (const tilt of tilts)
			expect(Math.abs(tilt), `the wave tilts ${tilt} radians from the current`).toBeLessThanOrEqual(
				0.36,
			);
		const under = wgslFunction(read('underwater.ts'), 'surface_height');
		for (const match of under.matchAll(/vec4f\((-?[\d.]+),/g))
			expect(Math.abs(Number(match[1]))).toBeLessThanOrEqual(0.36);
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
