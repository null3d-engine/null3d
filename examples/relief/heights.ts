// The relief demo's height maps, made in code: rolling hills, cut rock on a sphere, a wall of bricks
// and the grain of stone, each as linear gray texels for a displacement or bump map, with colors to
// go with them, which the paints at the end give.
import { math } from '@null3d/engine';

/** Texels along each side of the height maps, unless a map asks for more. */
const SIZE = 256;
/**
 * A height map from `height` at u and v, as linear gray texels, with the colors that `paint` gives
 * for each height and place: `size` texels along each side.
 */
export function maps(
	height: (u: number, v: number) => number,
	paint = (_h: number, _u: number, _v: number): number[] => [],
	size = SIZE,
) {
	const gray = new Uint8Array(size * size * 4).fill(255);
	const color = new Uint8Array(size * size * 4).fill(255);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const [u, v] = [(x + 0.5) / size, (y + 0.5) / size];
			const h = height(u, v);
			const at = (y * size + x) * 4;
			gray.fill(h * 255, at, at + 3);
			color.set(paint(h, u, v), at);
		}
	return [gray, color] as const;
}

/** A steady random number from 0 to 1 for each whole point, from an integer hash so that every
 * GPU and CPU works out the same value. */
const hash = (x: number, y: number, z: number) => {
	let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1442695041)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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

/**
 * A low, gentle valley in the middle that falls from left to right, with rougher hills that rise
 * around it.
 */
export const hills = (u: number, v: number) => {
	const rim = math.smoothstep(Math.hypot(u - 0.5, v - 0.5) * 2, 0.3, 0.9);
	const fall = Math.tanh((0.5 - u) * 6) * 0.15;
	const rough = (layers(u * 4, v * 4, 0, 6) - 0.5) * (0.5 + rim);
	return math.clamp(0.3 + rim * 0.45 + fall + rough, 0, 1);
};

/** The point on a sphere of radius 1 at u around it and v from its top. */
export const onSphere = (u: number, v: number) => {
	const [a, b] = [u * Math.PI * 2, v * Math.PI];
	return [Math.cos(a) * Math.sin(b), Math.cos(b), Math.sin(a) * Math.sin(b)] as const;
};

/** Sixteen flat faces of a cut stone, each as its outward direction and its distance from the middle. */
function faces(seed: number) {
	return Array.from({ length: 16 }, (_, i) => {
		// A spiral spreads the directions over the sphere, and a jitter breaks its order.
		const y = math.clamp(1 - ((i + 0.5) / 16) * 2 + (hash(i, seed, 1) - 0.5) * 0.3, -1, 1);
		const [a, r] = [i * 2.4 + hash(i, seed, 2), Math.sqrt(1 - y * y)];
		return [Math.cos(a) * r, y, Math.sin(a) * r, 0.78 + hash(i, seed, 3) * 0.2] as const;
	});
}

/**
 * A boulder of flat faces and sharp edges, with grain and thin cracks, on a sphere of radius 1: from
 * 0 at a radius of 0.7 to 1 at a radius of 1.4.
 */
export const rock = (seed: number) => {
	const cuts = faces(seed);
	return (u: number, v: number) => {
		const [x, y, z] = onSphere(u, v);
		let reach = 1.4;
		for (const [a, b, c, d] of cuts) {
			const facing = x * a + y * b + z * c;
			if (facing > 0.05) reach = Math.min(reach, d / facing);
		}
		const grain = layers(x * 7, y * 7, z * 7 + seed * 5, 4) - 0.5;
		const crack = 1 - Math.abs(layers(x * 3, y * 3, z * 3 + seed * 7 + 31, 3) * 2 - 1);
		reach += grain * 0.05 - math.smoothstep(crack, 0.93, 1) * 0.04;
		return math.clamp((reach - 0.7) / 0.7, 0, 1);
	};
};

/** The brick at u and v, as its place along its course in bricks, and its course. */
const brickAt = (u: number, v: number) => {
	const row = Math.floor(v * 8);
	return [u * 4 + (row % 2) * 0.5, row] as const;
};

/** Bricks of 4 by 8 to the map, in running bond: rounded tops near 1, each its own, and sunken mortar at 0. */
export const bricks = (u: number, v: number) => {
	const [along, row] = brickAt(u, v);
	const [x, y] = [along % 1, v * 8 - row];
	const edge = math.smoothstep(Math.min(x * 4, (1 - x) * 4, y * 2, (1 - y) * 2), 0.05, 0.4);
	return edge * (0.8 + 0.2 * hash(Math.floor(along), row, 0));
};

/** A steady number from 0 to 1 for the brick at u and v, which picks its shade. */
const brickTone = (u: number, v: number) => {
	const [along, row] = brickAt(u, v);
	return hash(Math.floor(along), row, 1);
};

/** Fine grain for a bump map on stone, from 0 to 1. */
export const grain = (u: number, v: number) => layers(u * 10, v * 10, 11, 5);

/** The color a share `t` of the way from `from` to `to`. */
const blend = (from: number[], to: number[], t: number) =>
	from.map((c, i) => math.lerp(c, to[i] ?? c, t));
/** A color broken up by a mottle of finer noise, `w` strong, `scale` patches to the map. */
const mottle = (color: number[], u: number, v: number, w: number, scale: number) =>
	color.map((c) => c * (1 - w + 2 * w * layers(u * scale, v * scale, 3, 2)));

/** Grass in the hills' hollows, blending into dry earth, then bare rock on the tops. */
export const hillColor = (h: number, u: number, v: number) => {
	const dry = blend([86, 116, 52], [150, 122, 82], math.smoothstep(h, 0.4, 0.55));
	return mottle(blend(dry, [168, 160, 150], math.smoothstep(h, 0.7, 0.85)), u, v, 0.2, 160);
};

/** Gray rock with lichen on the faces that look up, for the rock of `rock(seed)`. */
export const rockColor = (seed: number) => (_h: number, u: number, v: number) => {
	const up = onSphere(u, v)[1] + (layers(u * 24, v * 12, seed, 3) - 0.5) * 0.8;
	return blend(
		mottle([128, 122, 114], u, v, 0.25, 40),
		[150, 150, 88],
		math.smoothstep(up, 0.4, 0.6),
	);
};

/** Fired bricks, each its own shade and a few burnt dark, in pale mortar. */
export const brickColor = (h: number, u: number, v: number) => {
	const tone = brickTone(u, v);
	const fired = tone < 0.12 ? [72, 34, 30] : blend([118, 44, 32], [182, 96, 64], tone);
	return h > 0.04 ? mottle(fired, u, v, 0.12, 64) : [158, 148, 130];
};

/** Pale sandstone, lighter where its grain stands higher. */
export const grainColor = (h: number, u: number, v: number) =>
	mottle(blend([170, 150, 118], [214, 198, 166], h), u, v, 0.08, 30);
