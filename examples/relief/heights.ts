// The relief demo's height maps, made in code: rolling hills, rock on a sphere and a wall of bricks,
// each as linear gray texels for a displacement map, with colors to go with them.
import { math } from '@null3d/engine';

/** Texels along each side of the height maps. */
export const SIZE = 256;
/**
 * A height map from `height` at u and v, as linear gray texels, with the colors that `paint` gives
 * for each height and place.
 */
export function maps(
	height: (u: number, v: number) => number,
	paint = (_h: number, _u: number, _v: number): number[] => [],
) {
	const gray = new Uint8Array(SIZE * SIZE * 4).fill(255);
	const color = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const [u, v] = [(x + 0.5) / SIZE, (y + 0.5) / SIZE];
			const h = height(u, v);
			const at = (y * SIZE + x) * 4;
			gray.fill(h * 255, at, at + 3);
			color.set(paint(h, u, v), at);
		}
	return [gray, color] as const;
}

/** A steady random number from 0 to 1 for each whole point. */
const hash = (x: number, y: number, z: number) => {
	const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
	return s - Math.floor(s);
};
/** Smooth value noise from 0 to 1, blended between the whole points around a point. */
function noise(x: number, y: number, z: number) {
	const [i, j, k] = [Math.floor(x), Math.floor(y), Math.floor(z)];
	const ease = (f: number) => f * f * (3 - 2 * f);
	const [u, v, w] = [ease(x - i), ease(y - j), ease(z - k)];
	const plane = (c: number) =>
		math.lerp(
			math.lerp(hash(i, j, c), hash(i + 1, j, c), u),
			math.lerp(hash(i, j + 1, c), hash(i + 1, j + 1, c), u),
			v,
		);
	return math.lerp(plane(k), plane(k + 1), w);
}
/** Noise in `n` layers, each twice as fine and half as strong as the one before: from 0 to 1. */
export function layers(x: number, y: number, z: number, n: number) {
	let [sum, weight] = [0, 0];
	for (let k = 0; k < n; k++) {
		sum += noise(x * 2 ** k, y * 2 ** k, z * 2 ** k + k * 17) / 2 ** k;
		weight += 1 / 2 ** k;
	}
	return sum / weight;
}

/** A low, gentle valley in the middle, with rougher hills that rise around it. */
export const hills = (u: number, v: number) => {
	const rim = math.smoothstep(Math.hypot(u - 0.5, v - 0.5) * 2, 0.3, 0.9);
	return math.clamp(0.3 + rim * 0.45 + (layers(u * 4, v * 4, 0, 6) - 0.5) * (0.5 + rim), 0, 1);
};

/** Rock on a sphere, from noise through the point at u and v: no seam, and no pinch at the poles. */
export const rock = (u: number, v: number) => {
	const [a, b] = [u * Math.PI * 2, v * Math.PI];
	const [x, y, z] = [Math.cos(a) * Math.sin(b), Math.cos(b), Math.sin(a) * Math.sin(b)];
	// Ridges where the noise crosses its middle, over broad bulges.
	const ridges = 1 - Math.abs(layers(x * 2.5, y * 2.5, z * 2.5, 5) * 2 - 1);
	return math.clamp(layers(x * 1.2, y * 1.2, z * 1.2 + 9, 3) * 0.6 + ridges * 0.5 - 0.05, 0, 1);
};

/** Bricks of 4 by 8 to the map, in running bond: rounded tops near 1, each its own, and sunken mortar at 0. */
export const bricks = (u: number, v: number) => {
	const row = Math.floor(v * 8);
	const along = u * 4 + (row % 2) * 0.5;
	const [x, y] = [along % 1, v * 8 - row];
	const edge = math.smoothstep(Math.min(x * 4, (1 - x) * 4, y * 2, (1 - y) * 2), 0.05, 0.4);
	return edge * (0.8 + 0.2 * hash(Math.floor(along), row, 0));
};
