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
		for (const wave of ['1.0, 0.15, 2.3, 0.9', '0.8, -0.6, 3.7, 0.7', '0.6, 0.8, 5.9, 0.5'])
			expect(waves).toContain(`vec4f(${wave})`);
		expect(source).toContain(
			'[1.0, 0.15, 2.3, 0.9],\n\t[0.8, -0.6, 3.7, 0.7],\n\t[0.6, 0.8, 5.9, 0.5],',
		);
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
});
