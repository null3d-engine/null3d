import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	bandFields,
	GRID,
	heightAt,
	type OceanBand,
	PASSES,
	STAGES,
	signedIndex,
	spectrum,
	waveField,
} from './spectrum';

/** The block between two markers of a file, trimmed. */
function marked(file: URL, name: string): string {
	const text = readFileSync(file, 'utf8');
	const start = text.indexOf(`// <${name}>`);
	const end = text.indexOf(`// </${name}>`);
	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);
	return text.slice(start + `// <${name}>`.length, end).trim();
}

/** A band for the tests: calm enough that its own numbers stay easy to read. */
const BAND: OceanBand = { tile: 64, height: 2, wind: 8, direction: 0.4, seed: 7 };

describe('the transform', () => {
	test('the staged inverse matches a direct sum', () => {
		// The GPU runs the same chain of radix-2 stages that this module does, so the chain is what
		// the test checks: a small grid, a spectrum of random numbers, and the sum the text defines.
		const n = 8;
		const data = new Float32Array(n * n * 4);
		let state = 12345;
		const next = () => {
			state = (Math.imul(state, 1103515245) + 12345) >>> 0;
			return state / 4294967296 - 0.5;
		};
		for (let at = 0; at < n * n; at++) {
			data[at * 4] = next();
			data[at * 4 + 1] = next();
		}
		const field = waveField(data, 0, BAND, n);
		// At time zero the transform's input is each wave plus its mirror's conjugate.
		const wave = (i: number, j: number): [number, number] => {
			const at = (j * n + i) * 4;
			const mirror = (((n - j) % n) * n + ((n - i) % n)) * 4;
			return [
				(data[at] as number) + (data[mirror] as number),
				(data[at + 1] as number) - (data[mirror + 1] as number),
			];
		};
		for (let y = 0; y < n; y++)
			for (let x = 0; x < n; x++) {
				let real = 0;
				for (let j = 0; j < n; j++)
					for (let i = 0; i < n; i++) {
						const [ar, ai] = wave(i, j);
						const angle = (2 * Math.PI * (i * x + j * y)) / n;
						real += ar * Math.cos(angle) - ai * Math.sin(angle);
					}
				expect((field[y * n + x] as number) - real).toBeCloseTo(0, 5);
			}
	});
});

describe('the spectrum', () => {
	test('the field has a spread of one meter, which the ocean scales', () => {
		// `spectrum` normalizes the waves so that the time-averaged spread of the height is one. A
		// frame's own spread wanders about that average, so the test takes several times.
		const data = spectrum(BAND, 32);
		let total = 0;
		const times = 24;
		for (let step = 0; step < times; step++) {
			const field = waveField(data, step * 0.37, BAND, 32);
			for (let at = 0; at < field.length; at++) total += (field[at] as number) ** 2;
		}
		const spread = Math.sqrt(total / (times * 32 * 32));
		expect(spread).toBeGreaterThan(0.75);
		expect(spread).toBeLessThan(1.25);
	});

	test('a calm sea has no waves, and a still one stays flat', () => {
		const flat = new Float32Array(16 * 16 * 4);
		const field = waveField(flat, 2.5, BAND, 16);
		for (const value of field) expect(value).toBe(0);
	});

	test('a band draws the same sea from the same seed', () => {
		const first = spectrum(BAND, 8);
		const second = spectrum(BAND, 8);
		expect(Array.from(first)).toEqual(Array.from(second));
		const other = spectrum({ ...BAND, seed: 8 }, 8);
		expect(Array.from(other)).not.toEqual(Array.from(first));
	});

	test('the wave of zero frequency holds nothing', () => {
		const data = spectrum(BAND, 8);
		expect(data[0]).toBe(0);
		expect(data[1]).toBe(0);
	});

	test('the frequency indices run from minus half the grid to half of it', () => {
		expect(signedIndex(0, 8)).toBe(0);
		expect(signedIndex(3, 8)).toBe(3);
		expect(signedIndex(4, 8)).toBe(-4);
		expect(signedIndex(7, 8)).toBe(-1);
	});
});

describe('the fields kept between reads', () => {
	test('reads at one time share a transform, and a new time transforms again', () => {
		const spectra = [spectrum(BAND, 8)];
		let transforms = 0;
		const counting: typeof waveField = (data, t, band, n = 8, out = new Float32Array(n * n)) => {
			transforms++;
			return waveField(data, t, band, n, out);
		};
		const fieldOf = bandFields(spectra, [{ tile: BAND.tile }], 8, counting);
		const first = fieldOf(0, 3);
		expect(fieldOf(0, 3)).toBe(first);
		expect(transforms).toBe(1);
		fieldOf(0, 4);
		expect(transforms).toBe(2);
	});
});

describe('the height at a place', () => {
	test('it reads the field with the tile wrapping around', () => {
		const n = 8;
		const data = new Float32Array(n * n * 4);
		data[0] = 1;
		const field = waveField(data, 0, BAND, n);
		const at = (x: number, z: number) => heightAt(field, x, z, BAND.tile, 1, n);
		// One tile past a place is the same place.
		expect(at(3, 1)).toBeCloseTo(at(3 + BAND.tile, 1), 5);
		expect(at(0, 0)).toBeCloseTo(field[0] as number, 5);
	});
});

describe('the shaders', () => {
	test('the compute form and the WebGL2 fragment form hold one transform', () => {
		// The shader build resolves only the engine's library, so the two forms carry copies, and this
		// keeps them equal.
		expect(marked(new URL('./fft.fallback.wgsl', import.meta.url), 'wave-transform')).toBe(
			marked(new URL('./fft.wgsl', import.meta.url), 'wave-transform'),
		);
		expect(marked(new URL('./bands.fallback.wgsl', import.meta.url), 'band-field')).toBe(
			marked(new URL('./bands.wgsl', import.meta.url), 'band-field'),
		);
	});

	test('the shaders’ stage count is the module’s', () => {
		const text = marked(new URL('./fft.wgsl', import.meta.url), 'wave-transform');
		const stages = /const WAVE_STAGES: i32 = (\d+);/.exec(text);
		expect(Number(stages?.[1])).toBe(STAGES);
		expect(PASSES).toBe(STAGES * 2);
		expect(GRID).toBe(2 ** STAGES);
	});
});
