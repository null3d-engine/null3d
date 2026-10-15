// Detail made in code for the showcase scenes: seeded noise, tiling PBR texture sets from numbers,
// a height-field terrain and rough rocks. Every generator takes a seed, so a scene draws the same
// on every run and its held frames stay the same. The generators run once, in a sketch's setup.
import { type MeshArrays, math, Noise, type SketchContext, type Texture } from '@null3d/engine';

/** A seeded generator of numbers from 0 to 1: the engine's own, apart from `math.random`. */
export const random = math.generator;

/** Seeded value noise in two and three dimensions, from -1 to 1: the engine's. */
export { Noise };

/** A circle on the ground: its middle's x and z, and its radius. */
export interface Footprint {
	x: number;
	z: number;
	r: number;
}

/** A test of whether a point of the ground lies inside any of the footprints. */
export const within =
	(footprints: readonly Footprint[]) =>
	(x: number, z: number): boolean =>
		footprints.some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < f.r * f.r);

/** What a texture set's sampler gives for one texel. Colors are sRGB, from 0 to 1. */
export interface TexelSample {
	/** The surface's height, in texels' widths, which the normal map takes its slopes from. */
	height: number;
	r: number;
	g: number;
	b: number;
	roughness: number;
	/** How much ambient light reaches the texel, from 0 to 1. */
	occlusion: number;
}

/** The maps of a standard material, made from numbers. */
export interface TextureSet {
	map: Texture;
	normalMap: Texture;
	/** Occlusion in red, roughness in green and no metal in blue, as glTF packs them. */
	metalnessRoughnessMap: Texture;
}

/**
 * Makes a set of maps that tile, from a sampler that the generator calls once per texel with the
 * texel's place, from 0 to 1 on each axis. The sampler must tile too, such as noise with a period.
 */
export function textureSet(
	textures: SketchContext['textures'],
	size: number,
	sample: (u: number, v: number, out: TexelSample) => void,
	anisotropy = 8,
): TextureSet {
	const texels = size * size;
	const heights = new Float32Array(texels);
	const color = new Uint8Array(texels * 4);
	const packed = new Uint8Array(texels * 4);
	const normals = new Uint8Array(texels * 4);
	const out: TexelSample = { height: 0, r: 0, g: 0, b: 0, roughness: 1, occlusion: 1 };
	const byte = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255);
	for (let i = 0; i < texels; i++) {
		sample(((i % size) + 0.5) / size, (Math.floor(i / size) + 0.5) / size, out);
		heights[i] = out.height;
		color.set([byte(out.r), byte(out.g), byte(out.b), 255], i * 4);
		packed.set([byte(out.occlusion), byte(out.roughness), 0, 255], i * 4);
	}
	// The normal from the slope of the height, across the texels on each side, which wrap around.
	for (let i = 0; i < texels; i++) {
		const x = i % size;
		const y = Math.floor(i / size);
		const at = (dx: number, dy: number) =>
			heights[((y + dy + size) % size) * size + ((x + dx + size) % size)] as number;
		const sx = (at(1, 0) - at(-1, 0)) / 2;
		const sy = (at(0, 1) - at(0, -1)) / 2;
		const length = Math.hypot(sx, sy, 1);
		normals.set(
			[
				byte((-sx / length) * 0.5 + 0.5),
				byte((-sy / length) * 0.5 + 0.5),
				byte(0.5 / length + 0.5),
				255,
			],
			i * 4,
		);
	}
	const options = { width: size, height: size, wrap: 'repeat', mipmaps: true, anisotropy } as const;
	return {
		map: textures.fromData({ ...options, data: color, colorSpace: 'srgb' }),
		normalMap: textures.fromData({ ...options, data: normals, colorSpace: 'linear' }),
		metalnessRoughnessMap: textures.fromData({ ...options, data: packed, colorSpace: 'linear' }),
	};
}

/** The settings of a height-field terrain. */
export interface TerrainOptions {
	/** The width and depth of the square, in meters, centered on the origin. */
	size: number;
	/** The quads along each side. */
	quads: number;
	/** The meters that one repeat of the textures covers. */
	tile: number;
	/**
	 * How much finer the grid is at the middle than evenly spaced, from 0 to 1: 1 spaces the quads
	 * evenly, and a smaller value packs them toward the middle, where the camera looks.
	 */
	middle?: number;
	/** The height of the ground at a point. */
	height: (x: number, z: number) => number;
	/** The linear color of the ground at a point, written into `out` as r, g and b. */
	color: (x: number, z: number, y: number, slope: number, out: number[]) => void;
}

/** A square grid of quads that follows a height function, with a color at each vertex. */
export function terrain({
	size,
	quads,
	tile,
	height,
	color,
	middle = 1,
}: TerrainOptions): MeshArrays {
	const row = quads + 1;
	// A place from -1 to 1 across the grid, to meters: even for a middle of 1, denser in the middle below.
	const place = (s: number) => (size / 2) * (middle * s + (1 - middle) * s * s * s);
	const positions = new Float32Array(row * row * 3);
	const colors = new Float32Array(row * row * 3);
	const uvs = new Float32Array(row * row * 2);
	const step = (size / quads) * middle;
	const rgb = [0, 0, 0];
	for (let v = 0; v < row * row; v++) {
		const x = place(((v % row) / quads) * 2 - 1);
		const z = place((Math.floor(v / row) / quads) * 2 - 1);
		const y = height(x, z);
		const slope = Math.hypot(height(x + step, z) - y, height(x, z + step) - y) / step;
		color(x, z, y, slope, rgb);
		positions.set([x, y, z], v * 3);
		colors.set(rgb, v * 3);
		uvs.set([x / tile, -z / tile], v * 2);
	}
	// Two triangles per quad, counter-clockwise seen from above.
	const indices = new Uint32Array(quads * quads * 6);
	for (let q = 0; q < quads * quads; q++) {
		const a = Math.floor(q / quads) * row + (q % quads);
		indices.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], q * 6);
	}
	return { positions, colors, uvs, indices, computeNormals: true };
}

/**
 * A rough rock: a sphere of `detail` subdivisions of an icosahedron, pushed in and out by noise,
 * squashed to `[x, y, z]`, with a flatter base. Its texture coordinates wrap around it.
 */
export function rock(
	seed: number,
	detail: number,
	squash: readonly [number, number, number],
): MeshArrays {
	const t = (1 + Math.sqrt(5)) / 2;
	const points: number[][] = [
		[-1, t, 0],
		[1, t, 0],
		[-1, -t, 0],
		[1, -t, 0],
		[0, -1, t],
		[0, 1, t],
		[0, -1, -t],
		[0, 1, -t],
		[t, 0, -1],
		[t, 0, 1],
		[-t, 0, -1],
		[-t, 0, 1],
	].map(([x, y, z]) => {
		const l = Math.hypot(x as number, y as number, z as number);
		return [(x as number) / l, (y as number) / l, (z as number) / l];
	});
	let faces = [
		0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1,
		8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
	];
	for (let level = 0; level < detail; level++) {
		const middles = new Map<number, number>();
		const middle = (a: number, b: number) => {
			const key = Math.min(a, b) * 65536 + Math.max(a, b);
			let index = middles.get(key);
			if (index === undefined) {
				const [pa, pb] = [points[a] as number[], points[b] as number[]];
				const m = [0, 1, 2].map((c) => ((pa[c] as number) + (pb[c] as number)) / 2);
				const l = Math.hypot(m[0] as number, m[1] as number, m[2] as number);
				index = points.push(m.map((c) => c / l)) - 1;
				middles.set(key, index);
			}
			return index;
		};
		const next: number[] = [];
		for (let f = 0; f < faces.length; f += 3) {
			const [a, b, c] = [faces[f] as number, faces[f + 1] as number, faces[f + 2] as number];
			const [ab, bc, ca] = [middle(a, b), middle(b, c), middle(c, a)];
			next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
		}
		faces = next;
	}
	const noise = new Noise(seed);
	const positions = new Float32Array(points.length * 3);
	const uvs = new Float32Array(points.length * 2);
	points.forEach(([x, y, z], i) => {
		const [px, py, pz] = [x as number, y as number, z as number];
		const bumps = 1 + 0.35 * noise.fbm3(px * 1.6, py * 1.6, pz * 1.6, 4);
		// Facets: the larger noise pushes broad planes, as a broken stone has.
		const facets = 1 + 0.12 * Math.sign(noise.value3(px * 3, py * 3, pz * 3));
		const r = bumps * facets;
		const base = py < -0.3 ? 0.55 + 0.45 * ((py + 1) / 0.7) : 1;
		positions.set([px * r * squash[0], py * r * squash[1] * base, pz * r * squash[2]], i * 3);
		uvs.set([Math.atan2(pz, px) / Math.PI + 1, py + 1], i * 2);
	});
	return { positions, uvs, indices: new Uint32Array(faces), computeNormals: true };
}
