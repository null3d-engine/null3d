// How much of a chunk's surface its first splats cover. A chunk keeps its splats in importance
// order, and a coarse level draws a prefix of them. A prefix that still covers the surface needs no
// help, as in a dense cloud whose splats overlap; a prefix that leaves holes, as on a scan's ground
// of small flat splats, grows its splats until they cover the holes again.
//
// The measure sees the chunk from three directions, along each axis, through a grid of cells about
// the size of a typical splat. It walks the splats in order, and each one hides the cells under its
// projected ellipse by its own Gaussian. A cell counts as covered once the splats over it hide half
// of what lies behind, so the measure follows what a view of the chunk shows. The share of the whole chunk's covered cells that each prefix covers is recorded at
// prefix lengths that halve every two steps, from the whole chunk down to one splat.

/**
 * The most cells that a splat reaches along each axis of a view on each side of its center, which
 * bounds its work: a splat larger than that is counted as covering that much.
 */
const MOST_REACH = 16;

/** How far a splat reaches, in standard deviations. */
const REACH_DEVIATIONS = 2;

/** The square root of two pi, the width of a unit Gaussian's area along one axis. */
const GAUSSIAN_WIDTH = Math.sqrt(2 * Math.PI);

/** The share of what lies behind a cell that its splats must hide before it counts as covered. */
const COVERED = 0.5;

/** The cells of one axis of the grid at most, so a cell's index fits in a safe whole number. */
const MOST_CELLS = 65_536;

/** The opacity under which a splat's share of a cell is left out. */
const FAINTEST = 1 / 255;

/** The table of the cells that a measure has touched, which the measures share and grow. */
let keys = new Float64Array(0);
let clear = new Float32Array(0);

/**
 * The share of the chunk's covered cells that its first splats cover, at the prefix lengths that
 * `coveragePrefix` names: index 0 is the whole chunk, whose share is 1, and each next index keeps
 * a prefix the square root of two times shorter. The arrays hold the chunk's splats in order.
 *
 * The chunk is seen from three directions, along each axis. In each view, a splat hides the cells
 * under its projected ellipse by its own Gaussian, so a flat splat seen face on covers its disc and
 * one seen edge on a line. A splat narrower than a cell along an axis takes the share of the cell
 * that it covers along that axis, so a crowd of tiny splats covers a cell as their areas add up.
 */
export function coverageShares(
	positions: Float32Array,
	rotations: Float32Array,
	scales: Float32Array,
	colors: Float32Array,
	count: number,
	center: readonly [number, number, number],
	radius: number,
): Float32Array {
	const steps = count > 1 ? Math.floor(2 * Math.log2(count)) + 1 : 1;
	const shares = new Float32Array(steps).fill(1);
	if (count < 2) return shares;
	// A cell about the size of the chunk's middle splat, and no finer than the grid allows.
	const sizes = new Float32Array(count);
	let largest = 0;
	for (let i = 0; i < count; i++) {
		const a = scales[i * 3] as number;
		const b = scales[i * 3 + 1] as number;
		const c = scales[i * 3 + 2] as number;
		sizes[i] = Math.sqrt(Math.max(a * b, b * c, a * c));
		largest = Math.max(largest, a, b, c);
	}
	sizes.sort();
	const span = 2 * (radius + REACH_DEVIATIONS * largest) + 1e-6;
	const cell = Math.max(sizes[count >> 1] as number, span / (MOST_CELLS - 1), 1e-9);
	const origin = [
		(center[0] as number) - span / 2,
		(center[1] as number) - span / 2,
		(center[2] as number) - span / 2,
	];
	const capacity = tableFor(count);
	const mask = capacity - 1;
	keys.fill(0, 0, capacity);
	clear.fill(1, 0, capacity);
	let used = 0;
	let covered = 0;
	// The prefix lengths at which the walk records how many cells were covered, shortest last.
	const marks = new Int32Array(steps);
	for (let k = 0; k < steps; k++) marks[k] = coveragePrefix(count, k);
	const coveredAt = new Float64Array(steps);
	let next = steps - 1;
	const sigma = [0, 0, 0, 0, 0, 0];
	for (let i = 0; i < count; i++) {
		const alpha = Math.min(Math.max(colors[i * 4 + 3] as number, 0), 1);
		if (alpha >= FAINTEST) {
			covarianceOf(scales, rotations, i, sigma);
			for (let view = 0; view < 3; view++) {
				// The view looks along one axis, and its cells lie across the other two.
				const a = VIEW_AXES[view * 2] as number;
				const b = VIEW_AXES[view * 2 + 1] as number;
				const saa = (sigma[SIGMA_AT[a * 3 + a] as number] as number) + 1e-12;
				const sbb = (sigma[SIGMA_AT[b * 3 + b] as number] as number) + 1e-12;
				const sab = sigma[SIGMA_AT[a * 3 + b] as number] as number;
				const det = Math.max(saa * sbb - sab * sab, 1e-24);
				const wa = Math.sqrt(saa);
				const wb = Math.sqrt(sbb);
				const ra = Math.min(MOST_REACH, Math.floor((REACH_DEVIATIONS * wa) / cell));
				const rb = Math.min(MOST_REACH, Math.floor((REACH_DEVIATIONS * wb) / cell));
				const fa = ra === 0 ? Math.min(1, (GAUSSIAN_WIDTH * wa) / cell) : 1;
				const fb = rb === 0 ? Math.min(1, (GAUSSIAN_WIDTH * wb) / cell) : 1;
				const pa = (positions[i * 3 + a] as number) - (origin[a] as number);
				const pb = (positions[i * 3 + b] as number) - (origin[b] as number);
				const ca = Math.floor(pa / cell);
				const cb = Math.floor(pb / cell);
				for (let v = cb - rb; v <= cb + rb; v++)
					for (let u = ca - ra; u <= ca + ra; u++) {
						if (u < 0 || v < 0 || u >= MOST_CELLS || v >= MOST_CELLS) continue;
						// The cell's center from the splat's, in the ellipse's own measure; an axis that
						// the splat is narrower than a cell along takes its share instead.
						const da = ra === 0 ? 0 : (u + 0.5) * cell - pa;
						const db = rb === 0 ? 0 : (v + 0.5) * cell - pb;
						const power = (0.5 * (sbb * da * da - 2 * sab * da * db + saa * db * db)) / det;
						const hides = alpha * fa * fb * Math.exp(-power);
						if (hides < FAINTEST) continue;
						const key = u + v * MOST_CELLS + view * MOST_CELLS * MOST_CELLS + 1;
						let slot = hash(u, v, view) & mask;
						while (keys[slot] !== 0 && keys[slot] !== key) slot = (slot + 1) & mask;
						if (keys[slot] === 0) {
							// A full table counts each new cell as covered, which only lowers the growth.
							if (used * 4 >= capacity * 3) {
								covered++;
								continue;
							}
							keys[slot] = key;
							used++;
						}
						const before = clear[slot] as number;
						const after = before * (1 - hides);
						clear[slot] = after;
						if (before > COVERED && after <= COVERED) covered++;
					}
			}
		}
		while (next >= 0 && i + 1 === marks[next]) {
			coveredAt[next] = covered;
			next--;
		}
	}
	const whole = coveredAt[0] as number;
	if (whole > 0) for (let k = 0; k < steps; k++) shares[k] = (coveredAt[k] as number) / whole;
	return shares;
}

/** The two axes that the cells of each view lie across: the views look along z, x and y. */
const VIEW_AXES = [0, 1, 1, 2, 0, 2] as const;

/** Where each entry of a symmetric 3 x 3 matrix lies in its six stored values. */
const SIGMA_AT = [0, 1, 2, 1, 3, 4, 2, 4, 5] as const;

/** The length of the prefix that index `k` of a chunk's coverage shares measures. */
export function coveragePrefix(count: number, k: number): number {
	return Math.max(1, Math.ceil(count / 2 ** (k / 2)));
}

/**
 * The share of the chunk's covered cells that its first `kept` splats cover, read between the
 * recorded prefix lengths along the halving of the prefix.
 */
export function coverageAt(shares: Float32Array, count: number, kept: number): number {
	if (kept >= count || shares.length < 2) return 1;
	const step = Math.min(2 * Math.log2(count / Math.max(kept, 1)), shares.length - 1);
	const low = Math.floor(step);
	const high = Math.min(low + 1, shares.length - 1);
	const t = step - low;
	return (shares[low] as number) * (1 - t) + (shares[high] as number) * t;
}

/**
 * The covariance of splat `i`, its rotation times its squared spreads times the rotation turned
 * back, as the six values xx, xy, xz, yy, yz and zz in `out`.
 */
function covarianceOf(
	scales: Float32Array,
	rotations: Float32Array,
	i: number,
	out: number[],
): void {
	const qx = rotations[i * 4] as number;
	const qy = rotations[i * 4 + 1] as number;
	const qz = rotations[i * 4 + 2] as number;
	const qw = rotations[i * 4 + 3] as number;
	const length = Math.hypot(qx, qy, qz, qw) || 1;
	const x = qx / length;
	const y = qy / length;
	const z = qz / length;
	const w = qw / length;
	const sx = scales[i * 3] as number;
	const sy = scales[i * 3 + 1] as number;
	const sz = scales[i * 3 + 2] as number;
	// The rotation's columns, each scaled by its spread.
	const m00 = (1 - 2 * (y * y + z * z)) * sx;
	const m10 = 2 * (x * y + z * w) * sx;
	const m20 = 2 * (x * z - y * w) * sx;
	const m01 = 2 * (x * y - z * w) * sy;
	const m11 = (1 - 2 * (x * x + z * z)) * sy;
	const m21 = 2 * (y * z + x * w) * sy;
	const m02 = 2 * (x * z + y * w) * sz;
	const m12 = 2 * (y * z - x * w) * sz;
	const m22 = (1 - 2 * (x * x + y * y)) * sz;
	out[0] = m00 * m00 + m01 * m01 + m02 * m02;
	out[1] = m00 * m10 + m01 * m11 + m02 * m12;
	out[2] = m00 * m20 + m01 * m21 + m02 * m22;
	out[3] = m10 * m10 + m11 * m11 + m12 * m12;
	out[4] = m10 * m20 + m11 * m21 + m12 * m22;
	out[5] = m20 * m20 + m21 * m21 + m22 * m22;
}

/** A cell's place in the table, mixed from its three indices. */
function hash(x: number, y: number, z: number): number {
	return (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ Math.imul(z, 83_492_791)) >>> 0;
}

/** Makes the shared table hold room for a chunk of `count` splats, and gives its size. */
function tableFor(count: number): number {
	const want = Math.min(2 ** 22, Math.max(1024, 2 ** Math.ceil(Math.log2(count * 16))));
	if (keys.length < want) {
		keys = new Float64Array(want);
		clear = new Float32Array(want);
	}
	return want;
}
