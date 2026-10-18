// The garden of the translucency demo, made in code: a leaf mesh that cups across and droops along
// its length, a leaf texture with a midrib and side veins, and the places of the plants. The sketch
// gives them their materials and lights.
import {
	type Geometry,
	type Material,
	type MeshGeometry,
	math,
	type SketchContext,
	type Textures,
} from '@null3d/engine';

/** Steps along a leaf, and across it. */
const ALONG = 14;
const ACROSS = 8;

/**
 * A leaf one unit long from its stalk at the origin, along +Y, with its face toward +Z. It is widest
 * a third of the way out, cups by `cup` across and droops by `droop` toward its tip.
 */
export function leafMesh(geometry: Geometry, cup: number, droop: number) {
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	for (let i = 0; i <= ALONG; i++) {
		const t = i / ALONG;
		const half = 0.36 * Math.sin(Math.PI * t ** 0.75) * (1 - 0.25 * t);
		for (let j = 0; j <= ACROSS; j++) {
			const s = (j / ACROSS) * 2 - 1;
			positions.push(s * half, t * Math.cos(droop * t), -cup * s * s * half - droop * t * t);
			uvs.push(j / ACROSS, t);
		}
	}
	for (let i = 0; i < ALONG; i++)
		for (let j = 0; j < ACROSS; j++) {
			const a = i * (ACROSS + 1) + j;
			const b = a + ACROSS + 1;
			indices.push(a, b, a + 1, a + 1, b, b + 1);
		}
	return geometry.fromArrays({ positions, uvs, indices, computeNormals: true });
}

/**
 * A leaf's texture: a green face with a pale midrib and side veins in sRGB, and in alpha how much
 * light each texel lets through, less along the veins, which are thicker.
 */
export function leafTexture(textures: Textures) {
	const size = 128;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const [u, v] = [(x + 0.5) / size, (y + 0.5) / size];
			const across = Math.abs(u - 0.5);
			const rib = Math.max(0, 1 - across / 0.02);
			// Side veins run from the midrib toward the tip, eight to a side.
			const wave = Math.abs((((v - across * 1.4) * 8) % 1) - 0.5);
			const vein = across > 0.03 ? Math.max(0, 1 - wave / 0.08) : 0;
			const line = Math.max(rib, vein * 0.7);
			const grain = 0.92 + 0.08 * Math.sin(x * 1.7 + y * 0.9) * Math.sin(y * 2.3);
			const at = (y * size + x) * 4;
			data[at] = (70 + 90 * line) * grain;
			data[at + 1] = (150 + 70 * line) * grain;
			data[at + 2] = (60 + 60 * line) * grain;
			data[at + 3] = 255 - 150 * line;
		}
	return textures.fromData({ width: size, height: size, data, colorSpace: 'srgb', mipmaps: true });
}

/** A leaf's place: its stalk's position, its turn about the vertical, its lean out and its size. */
export interface LeafPlace {
	position: readonly [number, number, number];
	rotation: readonly [number, number, number, number];
	scale: number;
}

/**
 * A quaternion that turns by `yaw` about the vertical, then by `lean` about the turned X axis, which
 * tips a leaf's length toward its back for a negative lean, so its face stays up.
 */
function turned(yaw: number, lean: number): [number, number, number, number] {
	const [cy, sy] = [Math.cos(yaw / 2), Math.sin(yaw / 2)];
	const [cl, sl] = [Math.cos(lean / 2), Math.sin(lean / 2)];
	return [cy * sl, sy * cl, -sy * sl, cy * cl];
}

/**
 * The leaves of a clump at `x`, `z`: `count` leaves fanned around the stalk, each leaning out from
 * the vertical by up to `most` radians, from the seeded generator. A small `most` makes a cup.
 */
export function clump(x: number, z: number, count: number, size: number, most = 1.05): LeafPlace[] {
	const leaves: LeafPlace[] = [];
	for (let k = 0; k < count; k++) {
		const yaw = (k / count) * Math.PI * 2 + math.randFloat(-0.3, 0.3);
		const lean = math.randFloat(most / 3, most);
		leaves.push({
			position: [x, 0, z],
			rotation: turned(yaw, -lean),
			scale: size * math.randFloat(0.8, 1.15),
		});
	}
	return leaves;
}

/**
 * Places the leaves or petals of `places` with `mesh` and `material`, raised by `height`. Each casts
 * shadows on the others, which show through them.
 */
export function plant(
	{ scene }: SketchContext,
	mesh: MeshGeometry,
	material: Material,
	places: readonly LeafPlace[],
	height = 0,
) {
	for (const { position, rotation, scale } of places)
		scene.createMesh({
			mesh,
			material,
			position: [position[0], position[1] + height, position[2]],
			rotation,
			scale: [scale, scale, scale],
			castShadows: true,
			receiveShadows: true,
		});
}

/** The ground: moss and soil in small patches, from a seeded texture, to the horizon. */
export function ground({ scene, geometry, materials, textures }: SketchContext) {
	math.seed(7);
	const soil = new Uint8Array(64 * 64 * 4).fill(255);
	for (let i = 0; i < 64 * 64; i++) {
		const moss = Math.sin(i * 0.37) * Math.sin(i * 0.011) > 0 ? 1 : 0.6;
		const shade = math.randFloat(0.75, 1) * moss;
		soil.set([96 * shade, 110 * shade, 58 * shade], i * 4);
	}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	scene.createMesh({
		mesh: geometry.plane({ width: 1e4, height: 1e4 }),
		material: materials.standard({
			map: textures.fromData({ width: 64, height: 64, data: soil, ...look }),
			roughness: 0.95,
			doubleSided: true,
			uvTransform: { repeat: [4000, 4000] },
		}),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
}

/**
 * The clumps of the garden, as x, z, leaves and size: tall ones beyond the lantern's clearing,
 * whose leaves arch above the low camera against the sky, and lower ones in front.
 */
export const CLUMPS = [
	[-2.4, -3.2, 9, 2.0],
	[-0.4, -4.4, 10, 2.4],
	[1.8, -3.4, 9, 2.1],
	[3.6, -2.2, 8, 1.7],
	[-3.9, -1.6, 8, 1.6],
	[0.9, -6.0, 9, 2.2],
	[-2.2, -6.4, 8, 2.0],
	[3.4, -5.8, 8, 2.0],
	[-2.0, 0.6, 7, 1.1],
	[2.3, 0.2, 7, 1.0],
	[-0.6, 1.6, 7, 0.8],
	[1.0, 1.2, 6, 0.7],
] as const;

/** The flowers: each a stem's top, where five petals open like a cup. */
export const FLOWERS = [
	[-1.3, 1.05, -1.7],
	[-0.2, 0.85, -2.3],
	[1.0, 1.15, -1.5],
	[2.2, 0.9, -2.1],
	[-2.6, 0.8, -0.8],
	[0.5, 0.7, -0.6],
] as const;
