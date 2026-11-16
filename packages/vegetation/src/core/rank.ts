// The order a plant's sockets are thinned in: one rank for each socket across the whole plant, so
// that the sockets below any rank stand spread through the crown.

/**
 * A rank for each point so that the points below any rank stand spread through the box they fill:
 * the points are ordered along a space-filling curve, and their places along it are numbered by
 * reversed bits, so each next rank falls in the widest stretch the ranks before it left.
 */
export function thinningRanks(points: readonly (readonly number[])[]): Uint32Array {
	const count = points.length;
	const out = new Uint32Array(count);
	if (count === 0) return out;
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const point of points)
		for (let c = 0; c < 3; c++) {
			min[c] = Math.min(min[c] as number, point[c] as number);
			max[c] = Math.max(max[c] as number, point[c] as number);
		}
	const side = Math.max(
		1e-6,
		(max[0] as number) - (min[0] as number),
		(max[1] as number) - (min[1] as number),
		(max[2] as number) - (min[2] as number),
	);
	const BITS = 10;
	const top = (1 << BITS) - 1;
	const keys = points.map((point) => {
		const cell = [0, 1, 2].map((c) =>
			Math.min(
				top,
				Math.max(0, Math.round((((point[c] as number) - (min[c] as number)) / side) * top)),
			),
		);
		let key = 0;
		for (let bit = BITS - 1; bit >= 0; bit--)
			for (const value of cell) key = key * 2 + ((value >> bit) & 1);
		return key;
	});
	const alongCurve = keys
		.map((_, i) => i)
		.sort((a, b) => (keys[a] as number) - (keys[b] as number) || a - b);
	let bits = 1;
	while (1 << bits < count) bits++;
	const reversed = alongCurve.map((_, place) => {
		let value = 0;
		for (let bit = 0; bit < bits; bit++) value |= ((place >> bit) & 1) << (bits - 1 - bit);
		return value;
	});
	const byReversed = alongCurve
		.map((_, place) => place)
		.sort((a, b) => (reversed[a] as number) - (reversed[b] as number) || a - b);
	byReversed.forEach((place, r) => {
		out[alongCurve[place] as number] = r;
	});
	return out;
}
