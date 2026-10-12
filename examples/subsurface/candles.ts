// The still life of the subsurface demo, made in code: pillar candles with a sunken pool of wax,
// teardrop flames, a wooden table's texture, where each candle stands, and a jade knot and a soap
// egg beside them. The sketch gives the candles their materials and lights.
import type { Geometry, SketchContext, Textures } from '@null3d/engine';
import { lathe, torusKnot } from '@null3d/geometry';

/** Each candle's place on the table, its height and its radius, in metres. */
export const CANDLES = [
	[-0.16, -0.05, 0.3, 0.06],
	[0.02, -0.16, 0.42, 0.07],
	[0.2, -0.02, 0.22, 0.055],
] as const;

/** A pillar candle of `height` and `radius`: a rounded lip around a pool of melted wax. */
export function candleMesh(geometry: Geometry, height: number, radius: number) {
	const lip = Math.min(0.012, radius * 0.2);
	const points: [number, number][] = [
		[0, 0],
		[radius * 0.97, 0],
		[radius, 0.004],
		[radius, height - lip],
		[radius - lip * 0.4, height - lip * 0.2],
		[radius - lip, height],
		[radius - lip * 1.6, height - lip * 0.7],
		[radius * 0.55, height - lip],
		[0, height - lip * 1.1],
	];
	return geometry.fromArrays(lathe({ points, segments: 64 }));
}

/** A flame from its base at the origin: a teardrop, widest a fifth of the way up. */
export function flameMesh(geometry: Geometry) {
	const points: [number, number][] = [
		[0, 0],
		[0.007, 0.004],
		[0.011, 0.014],
		[0.009, 0.03],
		[0.004, 0.046],
		[0, 0.058],
	];
	return geometry.fromArrays(lathe({ points, segments: 24 }));
}

/** The wick under each flame: a short dark thread. */
export function wickMesh(geometry: Geometry) {
	return geometry.cylinder({ radiusTop: 0.0012, radiusBottom: 0.0015, height: 0.014 });
}

/** A walnut table's grain in sRGB: dark bands that wander along the planks, and their joints. */
export function woodTexture(textures: Textures) {
	const size = 256;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const plank = Math.floor(x / 64);
			const along = y / size;
			const wave = Math.sin((x * 0.21 + plank * 7 + 3 * Math.sin(along * 9 + plank)) * 1.3);
			const grain = 0.75 + 0.18 * wave + 0.07 * Math.sin(y * 0.9 + x * 0.05);
			const joint = x % 64 < 1 ? 0.45 : 1;
			const at = (y * size + x) * 4;
			const shade = grain * joint;
			data.set([110 * shade, 70 * shade, 44 * shade, 255], at);
		}
	return textures.fromData({
		width: size,
		height: size,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
		anisotropy: 8,
	});
}

/** A jade knot and a soap egg in front of the candles, whose light spreads under their surfaces. */
export function ornaments({ scene, geometry, materials }: SketchContext) {
	const shadows = { castShadows: true, receiveShadows: true };
	// Jade: green light spreads furthest under its polished surface.
	scene.createMesh({
		mesh: geometry.fromArrays(
			torusKnot({ radius: 0.045, tube: 0.014, tubularSegments: 200, radialSegments: 28 }),
		),
		material: materials.standard({
			color: '#5aa57a',
			roughness: 0.15,
			subsurfaceRadius: 0.02,
			subsurfaceColor: [0.5, 1, 0.7],
		}),
		position: [0.2, 0.062, 0.14],
		rotation: [0.38, 0.1, 0.05, 0.92],
		...shadows,
	});
	// Soap: a pale egg whose light spreads warm and wide.
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.042, widthSegments: 48, heightSegments: 32 }),
		material: materials.standard({
			color: '#f6eee4',
			roughness: 0.35,
			subsurfaceRadius: 0.035,
			subsurfaceColor: [1, 0.78, 0.66],
		}),
		position: [-0.22, 0.054, 0.13],
		scale: [1, 1.3, 1],
		...shadows,
	});
}
