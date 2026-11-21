// The water's waves and caustics live in two places: the surface shader, and the view from under
// the water, since each WGSL string compiles on its own. The surface also works the long waves out
// on the CPU, so a scene knows when the camera is under the water. These tests fail when one copy
// changes without the other.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CARRY_CYCLE, LONG_WAVES, waveHeight } from './water';

const read = (name: string) => readFileSync(join(import.meta.dirname, name), 'utf8');

/** The long waves, as the shaders write them. */
const WAVES = [
	'vec4f(1.0, 0.15, 2.3, 0.9)',
	'vec4f(0.8, -0.6, 3.7, 0.7)',
	'vec4f(0.6, 0.8, 5.9, 0.5)',
] as const;

/**
 * A WGSL function of plain arithmetic made runnable in JavaScript, so a test can check its sums:
 * `fract`, `abs`, `floor` and `vec4f` map to their JavaScript forms, and `cycle` stands for the
 * shader's carry cycle.
 */
function shaderFunction(
	source: string,
	name: string,
	cycle: number,
): (...args: number[]) => unknown {
	const start = source.indexOf(`fn ${name}(`);
	const end = source.indexOf('\n}', start);
	const text = source.slice(start, end + 2);
	const params =
		/\(([^)]*)\)/
			.exec(text)?.[1]
			?.split(',')
			.map((p) => p.split(':')[0]?.trim()) ?? [];
	const body = text
		.slice(text.indexOf('{') + 1, text.lastIndexOf('}'))
		.replace(/\blet\b/g, 'const')
		.replace(/\bvec4f\(/g, 'vec4f(');
	const make = new Function(
		'fract',
		'abs',
		'floor',
		'vec4f',
		'CARRY_CYCLE',
		`return function (${params.join(', ')}) {${body}};`,
	) as (...helpers: unknown[]) => (...args: number[]) => unknown;
	return make(
		(v: number) => v - Math.floor(v),
		Math.abs,
		Math.floor,
		(...parts: number[]) => parts,
		cycle,
	);
}

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

	it('carries its patterns in the same two copies in both shaders and on the CPU', () => {
		const surface = read('water.wgsl');
		const under = read('underwater.wgsl');
		for (const name of ['carried', 'cycle_seed', 'caustic_net'])
			expect(wgslFunction(under, name)).toBe(wgslFunction(surface, name));
		const cycle = (source: string) =>
			Number(/const CARRY_CYCLE: f32 = ([0-9.]+);/.exec(source)?.[1]);
		expect(cycle(surface)).toBe(CARRY_CYCLE);
		expect(cycle(under)).toBe(CARRY_CYCLE);
		// Each wave reads both copies, with the seeds that start each one afresh, wherever the long
		// waves are worked out: the surface, the waterline under it, and the CPU's height.
		for (const body of [wgslFunction(surface, 'waves'), wgslFunction(under, 'surface_height')]) {
			expect(body).toContain('carried(t)');
			expect(body).toContain('cycle_seed(t, 0.0)');
			expect(body).toContain('cycle_seed(t, 0.5)');
		}
		expect(wgslFunction(surface, 'cycle_seed')).toContain('0.618034');
		expect(read('water.ts')).toContain('0.618034');
	});

	it('weighs its two copies to a whole, each nothing as it starts afresh, as the shaders sum them', () => {
		const surface = read('water.wgsl');
		const carried = shaderFunction(surface, 'carried', CARRY_CYCLE) as (t: number) => number[];
		const seed = shaderFunction(surface, 'cycle_seed', CARRY_CYCLE) as (
			t: number,
			w: number,
		) => number;
		for (let t = 0; t < 9; t += 0.137) {
			const [first, second, wa, wb] = carried(t) as [number, number, number, number];
			expect(wa + wb).toBeCloseTo(1, 12);
			expect(first).toBeGreaterThanOrEqual(0);
			expect(first).toBeLessThan(CARRY_CYCLE);
			expect(second).toBeGreaterThanOrEqual(0);
			expect(second).toBeLessThan(CARRY_CYCLE);
			// A copy's weight follows how far it is through its cycle: nothing at its start and end.
			expect(wa).toBeCloseTo(1 - Math.abs((2 * first) / CARRY_CYCLE - 1), 12);
		}
		// At a copy's restart its weight is nothing and its seed changes, so the jump never shows.
		for (const restart of [2, 4, 6]) {
			expect((carried(restart) as number[])[2]).toBeCloseTo(0, 12);
			expect(seed(restart - 1e-6, 0)).not.toBeCloseTo(seed(restart + 1e-6, 0), 3);
			expect(seed(restart - 1e-6, 0.5)).toBeCloseTo(seed(restart + 1e-6, 0.5), 12);
		}
		// The shaders sum the two copies by their weights, and the CPU's height is that same sum.
		for (const source of [surface, read('underwater.wgsl')])
			expect(source).toContain('copies.z * sin(first) + copies.w * sin(second)');
		const current: [number, number] = [0.21, -0.28];
		const speed = Math.hypot(...current);
		for (const [x, z, t] of [
			[1.5, -2, 0.3],
			[-7, 4.2, 3.9],
			[12, 0.5, 61.7],
		] as const) {
			const [first, second, wa, wb] = carried(t) as [number, number, number, number];
			let height = 0;
			LONG_WAVES.forEach(([ownX, ownZ, k], index) => {
				const length = Math.hypot(ownX, ownZ);
				const ax = ownX / length;
				const az = ownZ / length;
				const cx = current[0] / speed;
				const cz = current[1] / speed;
				const dx = cx * ax - cz * az;
				const dz = cz * ax + cx * az;
				const base = k * (dx * x + dz * z);
				const run = k * speed * (dx * cx + dz * cz);
				const turn = 6.2831853 * (index + 1);
				const a = base - run * first + seed(t, 0) * turn;
				const b = base - run * second + seed(t, 0.5) * turn;
				height += ((0.05 / k) * (wa * Math.sin(a) + wb * Math.sin(b))) as number;
			});
			expect(waveHeight(x, z, t, 0, current, 1)).toBeCloseTo(height, 6);
		}
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
