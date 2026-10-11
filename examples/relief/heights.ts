// The relief demo's height maps, made in code: rolling hills, lumps on a sphere and a wall of
// bricks, each as linear gray texels for a displacement map, with colors to go with them.
import { math } from '@null3d/engine';

/** Texels along each side of the height maps. */
export const SIZE = 256;
/** A height map from `height` at u and v, as linear gray texels, with the colors that `paint` gives. */
export function maps(
	height: (u: number, v: number) => number,
	paint = (_: number): number[] => [],
) {
	const gray = new Uint8Array(SIZE * SIZE * 4).fill(255);
	const color = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const h = height((x + 0.5) / SIZE, (y + 0.5) / SIZE);
			const at = (y * SIZE + x) * 4;
			gray.fill(h * 255, at, at + 3);
			color.set(paint(h), at);
		}
	return [gray, color] as const;
}

/** Waves along `n` directions, each finer and fainter than the one before: rolling relief from 0 to 1. */
export const waves = (u: number, v: number, n: number, seed: number) => {
	let sum = 0.5;
	for (let k = 0; k < n; k++) {
		const a = seed + k * 2.4;
		sum += (Math.sin((u * Math.cos(a) + v * Math.sin(a)) * 2 ** k * 6.28 + k) * 0.3) / 1.8 ** k;
	}
	return math.clamp(sum, 0, 1);
};

/** Lumps on a sphere, from waves through the point at u and v: no seam, and no pinch at the poles. */
export const lumps = (u: number, v: number) => {
	const [a, b] = [u * Math.PI * 2, v * Math.PI];
	const [x, y, z] = [Math.cos(a) * Math.sin(b), Math.cos(b), Math.sin(a) * Math.sin(b)];
	let sum = 0.5;
	for (let k = 0; k < 5; k++)
		sum +=
			(Math.sin(
				(x * Math.cos(k * 2.4) + y * Math.sin(k) + z * Math.sin(k * 2.4)) * 3 * 1.9 ** k + k,
			) *
				0.3) /
			1.7 ** k;
	return math.clamp(sum, 0, 1);
};

/** Bricks of 4 by 8 to the map, in running bond: rounded tops near 1, each its own, and sunken mortar at 0. */
export const bricks = (u: number, v: number) => {
	const row = Math.floor(v * 8);
	const along = u * 4 + (row % 2) * 0.5;
	const [x, y] = [along % 1, v * 8 - row];
	const edge = math.smoothstep(Math.min(x * 4, (1 - x) * 4, y * 2, (1 - y) * 2), 0.05, 0.4);
	const own = Math.sin(Math.floor(along) * 12.9898 + row * 78.233) * 43758.5453;
	return edge * (0.85 + 0.15 * (own - Math.floor(own)));
};
