// The still life of the subsurface demo, made in code: pillar candles with a sunken pool of wax,
// teardrop flames, a dark room's walnut table and plaster wall, and a jade knot and a soap egg
// beside the candles. The sketch gives the candles their materials and lights.
import type { Geometry, SketchContext, Textures } from '@null3d/engine';
import { lathe, torusKnot } from '@null3d/geometry';

/** Each candle's place on the table, its height and its radius in metres, and whether it burns. */
export const CANDLES = [
	[-0.16, -0.05, 0.3, 0.06, true],
	[0.02, -0.16, 0.42, 0.07, true],
	[0.2, -0.02, 0.22, 0.055, true],
	[0.03, 0.02, 0.15, 0.05, false],
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
function woodTexture(textures: Textures) {
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

/** Fine grit for a pixel's place, from 0 to 1, in integer math so every machine draws it alike. */
function gritAt(x: number, y: number) {
	let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
	h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
	h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
	return ((h ^ (h >>> 15)) >>> 8) / 16777216;
}

/** A plaster wall's texture in sRGB: warm grey with soft blotches and fine grit. */
function plasterTexture(textures: Textures) {
	const size = 256;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const blotch = Math.sin(x * 0.05 + Math.sin(y * 0.04) * 2) * Math.sin(y * 0.06 + x * 0.01);
			const shade = 0.82 + 0.1 * blotch + 0.06 * gritAt(x, y);
			data.set([150 * shade, 124 * shade, 102 * shade, 255], (y * size + x) * 4);
		}
	return textures.fromData({
		width: size,
		height: size,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
	});
}

/** The room: a walnut table, and a plaster wall behind it that the flames light, fading with distance. */
export function room({ scene, geometry, materials, textures }: SketchContext) {
	scene.createMesh({
		mesh: geometry.plane({ width: 4, height: 4 }),
		material: materials.standard({ map: woodTexture(textures), roughness: 0.55 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	scene.createMesh({
		mesh: geometry.plane({ width: 4, height: 2 }),
		material: materials.standard({ map: plasterTexture(textures), roughness: 0.95 }),
		position: [0, 1, -0.45],
		receiveShadows: true,
	});
}

/** A jade knot and a soap egg in front of the candles, whose light spreads under their surfaces. */
export function ornaments({ scene, geometry, materials }: SketchContext) {
	const shadows = { castShadows: true, receiveShadows: true };
	// Jade: deep green, and its thin tube lets the flames' light through. Green spreads furthest.
	scene.createMesh({
		mesh: geometry.fromArrays(
			torusKnot({ radius: 0.045, tube: 0.014, tubularSegments: 200, radialSegments: 28 }),
		),
		material: materials.standard({
			color: '#0f4a2a',
			roughness: 0.12,
			subsurfaceRadius: 0.02,
			subsurfaceColor: [0.3, 1, 0.55],
			diffuseTransmission: 0.5,
			diffuseTransmissionColor: '#2f9a5a',
		}),
		position: [0.2, 0.062, 0.14],
		rotation: [0.38, 0.1, 0.05, 0.92],
		...shadows,
	});
	// Soap: a pale egg whose light spreads warm and wide, and wraps a little round to its dark side.
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.042, widthSegments: 48, heightSegments: 32 }),
		material: materials.standard({
			color: '#f6eee4',
			roughness: 0.35,
			subsurfaceRadius: 0.045,
			subsurfaceColor: [1, 0.78, 0.66],
			diffuseTransmission: 0.35,
			diffuseTransmissionColor: '#ffc89a',
		}),
		position: [-0.22, 0.054, 0.13],
		scale: [1, 1.3, 1],
		...shadows,
	});
}
