// The ocean's wave spectrum and the CPU form of its inverse transform. A band of the ocean is a
// square tile of the sea whose waves are a sum of plane waves: the spectrum gives each wave's
// amplitude from the wind, a seeded random number gives its phase, and the inverse transform turns
// the sum into the height of the sea at each point of the tile. The GPU runs the same transform as
// a chain of butterfly passes, and this module gives the tests and a page's own queries the field
// the GPU should draw.

/** The metres a second squared that gravity adds to a falling object. */
export const GRAVITY = 9.81;
/** The texels of a band's tile across each way, which the butterfly passes run on. */
export const GRID = 128;
/** The stages of one axis' butterfly: the radix-2 steps that 128 points take. */
export const STAGES = 7;
/** The passes that one band's two axes take: a horizontal chain, then a vertical one. */
export const PASSES = STAGES * 2;

/**
 * One band of the ocean: a tile of sea of its own, whose waves run at its own scale.
 *
 * @category api/water
 */
export interface OceanBand {
	/** The metres that one tile covers each way. */
	readonly tile: number;
	/** The significant wave height of the band, in meters: about four times its own spread. */
	readonly height: number;
	/** The wind's speed in meters a second. */
	readonly wind: number;
	/** The wind's heading in radians, where 0 blows toward +x and pi/2 toward +z. */
	readonly direction: number;
	/** The seed of the band's random waves, so the same seed draws the same sea. */
	readonly seed: number;
}

/** The small waves that a band drops, in meters: the length below which the wind leaves the sea smooth. */
const CUTOFF = 0.15;
/** The least wind a band takes, so a still wind leaves a flat but finite spectrum. */
const MIN_WIND = 0.5;

/** A random number in [0, 1), from a seed, as the same sequence on every machine. */
function randomOf(seed: number): () => number {
	let state = (seed | 0) >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** One Gaussian number from two uniforms, as Box and Muller drew them. */
function gaussian(next: () => number): number {
	const first = Math.max(next(), 1e-12);
	const second = next();
	return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

/** The frequency index that a texel holds, from -n/2 to n/2 less one. */
export function signedIndex(texel: number, n: number): number {
	return texel < n / 2 ? texel : texel - n;
}

/** The wave number that a texel holds on each axis, in radians a metre. */
function waveNumber(texel: number, n: number, tile: number): number {
	return (2 * Math.PI * signedIndex(texel, n)) / tile;
}

/**
 * The waves of `band` as four numbers a texel: the real and imaginary parts of the spectrum, then
 * two channels that hold zero, in rows from the tile's near edge. The field is scaled so that its
 * time-averaged height has a spread of one metre, which the ocean then scales to the band's height.
 */
export function spectrum(band: OceanBand, n: number = GRID): Float32Array {
	const data = new Float32Array(n * n * 4);
	const windX = Math.cos(band.direction);
	const windZ = Math.sin(band.direction);
	const wind = Math.max(band.wind, MIN_WIND);
	const length = (wind * wind) / GRAVITY;
	const next = randomOf(band.seed);
	let spread = 0;
	for (let j = 0; j < n; j++)
		for (let i = 0; i < n; i++) {
			const at = (j * n + i) * 4;
			const kx = waveNumber(i, n, band.tile);
			const kz = waveNumber(j, n, band.tile);
			const k2 = kx * kx + kz * kz;
			if (k2 === 0) continue;
			const k = Math.sqrt(k2);
			const along = ((kx / k) * windX + (kz / k) * windZ) ** 2;
			const fall = Math.exp(-1 / (k * length) ** 2) / (k2 * k2);
			const amplitude = along * fall * Math.exp(-k2 * CUTOFF * CUTOFF);
			const scale = Math.sqrt(amplitude / 2);
			const real = gaussian(next) * scale;
			const imaginary = gaussian(next) * scale;
			data[at] = real;
			data[at + 1] = imaginary;
			spread += real * real + imaginary * imaginary;
		}
	// The time-averaged spread of the height is twice the spectrum's own. The transform's chain adds
	// the spectrum straight, with no scaling of its own, so this factor also holds the grid's area
	// that a textbook inverse would divide out. Every intermediate value then stays within the range
	// that a 16-bit float keeps, and the last pass writes the height in meters.
	if (spread <= 0) return data;
	const norm = 1 / Math.sqrt(2 * spread);
	for (let at = 0; at < data.length; at += 4) {
		data[at] = (data[at] as number) * norm;
		data[at + 1] = (data[at + 1] as number) * norm;
	}
	return data;
}

/**
 * The spectrum's wave at one frequency and a sketch time, in the transform's own units: the wave
 * that runs forward through time, and the mirrored one that runs against it.
 */
function waveAt(
	data: Float32Array,
	wave: [number, number],
	i: number,
	j: number,
	kx: number,
	kz: number,
	t: number,
	n: number,
): void {
	const at = (j * n + i) * 4;
	const mirror = (((n - j) % n) * n + ((n - i) % n)) * 4;
	const angle = Math.sqrt(GRAVITY * Math.hypot(kx, kz)) * t;
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const ar = data[at] as number;
	const ai = data[at + 1] as number;
	// The mirrored wave arrives as its conjugate, running the other way through time.
	const br = data[mirror] as number;
	const bi = data[mirror + 1] as number;
	wave[0] = ar * cos - ai * sin + br * cos - bi * sin;
	wave[1] = ar * sin + ai * cos - br * sin - bi * cos;
}

/** The bits of an index, turned around, for the butterfly's first stage. */
function reversed(value: number, bits: number): number {
	let result = 0;
	for (let i = 0; i < bits; i++) {
		result = (result << 1) | (value & 1);
		value >>>= 1;
	}
	return result;
}

/** One axis of the inverse transform, at `offset` and `stride`, in place. */
function transform(
	real: Float64Array,
	imaginary: Float64Array,
	offset: number,
	stride: number,
	n: number,
): void {
	const bits = Math.round(Math.log2(n));
	for (let i = 0; i < n; i++) {
		const j = reversed(i, bits);
		if (j <= i) continue;
		const a = offset + i * stride;
		const b = offset + j * stride;
		const ar = real[a] as number;
		const ai = imaginary[a] as number;
		real[a] = real[b] as number;
		imaginary[a] = imaginary[b] as number;
		real[b] = ar;
		imaginary[b] = ai;
	}
	for (let length = 2; length <= n; length <<= 1) {
		const half = length >> 1;
		const angle = (2 * Math.PI) / length;
		for (let start = 0; start < n; start += length)
			for (let j = 0; j < half; j++) {
				const cos = Math.cos(angle * j);
				const sin = Math.sin(angle * j);
				const p = offset + (start + j) * stride;
				const q = p + half * stride;
				const vr = (real[q] as number) * cos - (imaginary[q] as number) * sin;
				const vi = (real[q] as number) * sin + (imaginary[q] as number) * cos;
				const ur = real[p] as number;
				const ui = imaginary[p] as number;
				real[p] = ur + vr;
				imaginary[p] = ui + vi;
				real[q] = ur - vr;
				imaginary[q] = ui - vi;
			}
	}
}

/**
 * The height of the sea at each point of a band's tile, in multiples of the band's height spread: a
 * row of `n` values for each row of the tile, from the tile's near edge. `t` is the sketch time, and
 * `data` holds the band's spectrum, which `spectrum` gives.
 */
export function waveField(
	data: Float32Array,
	t: number,
	band: Pick<OceanBand, 'tile'>,
	n: number = GRID,
	out: Float32Array = new Float32Array(n * n),
): Float32Array {
	const real = new Float64Array(n * n);
	const imaginary = new Float64Array(n * n);
	const wave: [number, number] = [0, 0];
	for (let j = 0; j < n; j++)
		for (let i = 0; i < n; i++) {
			waveAt(data, wave, i, j, waveNumber(i, n, band.tile), waveNumber(j, n, band.tile), t, n);
			real[j * n + i] = wave[0];
			imaginary[j * n + i] = wave[1];
		}
	for (let j = 0; j < n; j++) transform(real, imaginary, j * n, 1, n);
	for (let i = 0; i < n; i++) transform(real, imaginary, i, n, n);
	for (let at = 0; at < n * n; at++) out[at] = real[at] as number;
	return out;
}

/**
 * The bands' fields, kept between reads. The spectrum and the band are made once and never change,
 * so the sketch time alone decides when a band's field must be transformed again: every read at one
 * time shares one transform, and a read at a new time transforms.
 */
export function bandFields(
	spectra: readonly Float32Array[],
	bands: readonly Pick<OceanBand, 'tile'>[],
	n: number = GRID,
	transform: typeof waveField = waveField,
): (band: number, time: number) => Float32Array {
	const fields: Float32Array[] = [];
	const times: number[] = [];
	return (band, time) => {
		let field = fields[band];
		if (!field) fields[band] = field = new Float32Array(n * n);
		if (times[band] !== time) {
			transform(
				spectra[band] as Float32Array,
				time,
				bands[band] as Pick<OceanBand, 'tile'>,
				n,
				field,
			);
			times[band] = time;
		}
		return field;
	};
}

/**
 * The height of a band's sea at a place of its tile and a sketch time, in meters. `x` and `z` run
 * from 0 at the tile's near corner and wrap around the tile. `field` is the band's `waveField`.
 */
export function heightAt(
	field: Float32Array,
	x: number,
	z: number,
	tile: number,
	height: number,
	n: number = GRID,
): number {
	const u = (x / tile) * n;
	const v = (z / tile) * n;
	const i0 = Math.floor(u);
	const j0 = Math.floor(v);
	const fu = u - i0;
	const fv = v - j0;
	const wrap = (i: number, j: number): number => {
		const a = ((j % n) + n) % n;
		const b = ((i % n) + n) % n;
		return field[a * n + b] as number;
	};
	const near = wrap(i0, j0) * (1 - fu) + wrap(i0 + 1, j0) * fu;
	const far = wrap(i0, j0 + 1) * (1 - fu) + wrap(i0 + 1, j0 + 1) * fu;
	return (near * (1 - fv) + far * fv) * height;
}
