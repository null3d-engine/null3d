// The water's waves and caustics live in two places: the surface shader, and the view from under
// the water, since each WGSL string compiles on its own. The surface also works the long waves out
// on the CPU, so a scene knows when the camera is under the water. These tests fail when one copy
// changes without the other.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LONG_WAVES, waveHeight } from './water';

const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');

/** The long waves, as the shaders write them. */
const WAVES = [
	'vec4f(1.0, 0.15, 2.3, 0.9)',
	'vec4f(0.8, -0.6, 3.7, 0.7)',
	'vec4f(0.6, 0.8, 5.9, 0.5)',
] as const;

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

describe('the water’s waves', () => {
	it('keeps the CPU’s long waves in step with the surface shader', () => {
		expect(LONG_WAVES).toHaveLength(WAVES.length);
		const waves = wgslFunction(read('water.wgsl'), 'waves');
		for (const wave of WAVES) expect(waves).toContain(wave);
	});

	it('finds the same waterline in the view from under the water', () => {
		const under = wgslFunction(read('underwater.wgsl'), 'surface_height');
		for (const wave of WAVES) expect(under).toContain(wave);
	});

	it('moves its surface a few centimeters about the water level', () => {
		const current: [number, number] = [0.35, 0];
		let lowest = Number.POSITIVE_INFINITY;
		let highest = Number.NEGATIVE_INFINITY;
		for (let k = 0; k < 2000; k++) {
			const h = waveHeight((k % 40) - 20, ((k * 7) % 9) - 4, k * 0.037, 0, current, 1);
			lowest = Math.min(lowest, h);
			highest = Math.max(highest, h);
		}
		const reach = 0.05 * (1 / 2.3 + 1 / 3.7 + 1 / 5.9);
		expect(lowest).toBeGreaterThanOrEqual(-reach);
		expect(highest).toBeLessThanOrEqual(reach);
		expect(highest - lowest).toBeGreaterThan(reach);
	});

	it('scales its height with the wave amplitude, and leaves the surface at its level without one', () => {
		const current: [number, number] = [0.3, 0];
		const level = 4;
		expect(waveHeight(1, 2, 3, level, current, 1, 0)).toBe(level);
		const half = waveHeight(1, 2, 3, level, current, 1, 0.5) - level;
		const full = waveHeight(1, 2, 3, level, current, 1, 1) - level;
		expect(half).toBeCloseTo(full * 0.5, 10);
	});

	it('scales its waves with the ripple, and leaves a still surface flat without them', () => {
		const current: [number, number] = [0, 0];
		expect(waveHeight(1, 2, 3, 5, current, 0)).toBe(5);
		const one = waveHeight(1, 2, 3, 5, current, 1) - 5;
		const two = waveHeight(1, 2, 3, 5, current, 2) - 5;
		expect(two).toBeCloseTo(one * 2, 10);
	});

	it('gives the long waves and the wind’s lift the surface’s height factor, and the fine ripples none', () => {
		const surface = read('water.wgsl');
		expect(wgslFunction(surface, 'waves')).toContain(
			'select(material.waveAmplitude, 1.0, k >= 3u)',
		);
		expect(wgslFunction(surface, 'vertexOffset')).toContain('material.waveAmplitude');
		// The view from under the water scales its waterline with the same factor.
		expect(wgslFunction(read('underwater.wgsl'), 'surface_height')).toContain(
			'uniforms.waveAmplitude',
		);
	});

	it('draws the same caustics from under the water as on its surface', () => {
		expect(wgslFunction(read('underwater.wgsl'), 'caustics')).toBe(
			wgslFunction(read('water.wgsl'), 'caustics'),
		);
	});

	it('carries the waves with the current, and never stretches them where the current changes', () => {
		// Two points 1 cm apart whose currents differ by 1 mm/s. A wave slid by the current times the
		// clock drifts out of step between them by a little more every second: after an hour their
		// heights would differ by most of a wave. Each carried copy rides for one cycle at most, so
		// the step between them stays as small as the waves' own slope over 1 cm allows.
		const slow: [number, number] = [0.3, 0];
		const fast: [number, number] = [0.301, 0];
		const steepest = 0.05 * LONG_WAVES.length;
		for (const t of [10, 600, 3600]) {
			const step = Math.abs(waveHeight(2, 1, t, 0, slow, 1) - waveHeight(2.01, 1, t, 0, fast, 1));
			expect(step).toBeLessThan(steepest * 0.01 * 2);
		}
		// The water moves: a point's height changes as the current carries the waves past it.
		expect(waveHeight(2, 1, 0.9, 0, slow, 1)).not.toBeCloseTo(waveHeight(2, 1, 0.5, 0, slow, 1), 4);
	});

	it('starts each carried copy afresh without a jump in the surface', () => {
		const current: [number, number] = [0.21, -0.28];
		for (const restart of [2, 3, 4, 101])
			expect(waveHeight(1.5, -2, restart - 1e-6, 0, current, 1)).toBeCloseTo(
				waveHeight(1.5, -2, restart + 1e-6, 0, current, 1),
				5,
			);
	});

	it('keeps a lake’s waves moving without a current', () => {
		const still: [number, number] = [0, 0];
		expect(waveHeight(1, 2, 1, 0, still, 1)).not.toBeCloseTo(waveHeight(1, 2, 0, 0, still, 1), 3);
	});
});

describe('the water’s wind', () => {
	/** The block between the field markers in a shader. */
	const block = (source: string, name: string) => {
		const from = `// <${name}>`;
		const to = `// </${name}>`;
		return source.slice(source.indexOf(from), source.indexOf(to));
	};

	it('reads the field with the wind add-on’s own sampling function', () => {
		// The water takes a plain texture and its box, so it imports no code from the wind add-on.
		// This test holds its copy of the sampling function equal to the add-on's own.
		const field = readFileSync(
			join(import.meta.dirname, '..', '..', 'wind', 'shaders', 'field.wgsl'),
			'utf8',
		);
		for (const name of ['wind-steady', 'wind-sample']) {
			expect(block(read('water.wgsl'), name).length).toBeGreaterThan(0);
			expect(block(read('water.wgsl'), name)).toBe(block(field, name));
		}
	});

	it('reads the air only for a surface that names a field', () => {
		const shader = read('water.wgsl');
		expect(shader).toContain('material.windStrength > 0.0');
		expect(shader).toContain('wind_sample(');
	});
});

describe('the water’s color along a low view', () => {
	it('mixes the depth with the view’s whole path by the material’s share', () => {
		const thickness =
			wgslFunction(read('water.wgsl'), 'surface')
				.split('\n')
				.find((line) => line.startsWith('s.thickness =')) ?? '';
		expect(thickness).toContain('mix(depth, gap,');
		expect(thickness).toContain('material.viewPath');
	});
});
