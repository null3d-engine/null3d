// 32-bit floats as the 16-bit floats of half-float textures, rounded to the nearest half float,
// with ties to even, as the GPU rounds them. A value past the largest half float, 65,504, becomes
// that largest value, as Chrome stores it on the Mac's GPU: an infinite texel would turn into
// black in the tone mapping, and spread through any filter that reads it.

const float = new Float32Array(1);
const bits = new Uint32Array(float.buffer);

/** The bits of the largest finite half float, 65,504, without the sign. */
const LARGEST = 0x7bff;

/** The bits of the half float nearest to `value`, no larger than the largest finite one. */
export function toHalfFloat(value: number): number {
	float[0] = value;
	const word = bits[0] as number;
	const sign = (word >>> 16) & 0x8000;
	const exponent = ((word >>> 23) & 0xff) - 127 + 15;
	let mantissa = word & 0x7fffff;
	if (exponent === 128 + 15 && mantissa !== 0) return sign | 0x7e00;
	if (exponent >= 0x1f) return sign | LARGEST;
	if (exponent <= 0) {
		// Below the smallest normal half float: a subnormal, or zero.
		if (exponent < -10) return sign;
		mantissa |= 0x800000;
		const shift = 14 - exponent;
		return sign | roundShift(mantissa, shift);
	}
	// A carry out of the mantissa raises the exponent, as it should, up to the largest value.
	return sign | Math.min((exponent << 10) + roundShift(mantissa, 13), LARGEST);
}

/** `value` shifted right by `shift` bits, rounded to the nearest, with ties to even. */
function roundShift(value: number, shift: number): number {
	const kept = value >>> shift;
	const rest = value & ((1 << shift) - 1);
	const half = 1 << (shift - 1);
	return rest > half || (rest === half && (kept & 1) === 1) ? kept + 1 : kept;
}

/** Writes each value of `from` into `to` as a half float. */
export function toHalfFloats(from: Float32Array, to: Uint16Array): void {
	for (let k = 0; k < from.length; k++) to[k] = toHalfFloat(from[k] as number);
}
