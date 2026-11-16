// The street beyond the studio: a short wet road between dark buildings, lit by hanging lamps and
// two neon signs. The asphalt is rough where it is dry and smooth in the puddles, and its custom
// surface carries the scene's planar reflection, so the lamps, the signs and the windows streak down
// it. The road runs along z from the studio's opening at 0 to the far end, and its buildings stand
// back from the pavements.
import { math, type SketchContext, type Texture } from '@null3d/engine';
import { WET_ROAD } from './floor';

/** The road's width and length, its far end, and the width of each pavement. */
const ROAD = 13;
const LENGTH = 56;
const FAR = -LENGTH;
const PAVEMENT = 2.4;
/** The z of each street lamp, and the side it stands on: the same posts both sides. */
const LAMP_Z = [-8, -20, -32, -44] as const;

/** A quarter turn about X that lays a plane flat. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
/** The normal a plane that faces the street's centre from the left or the right side has. */
const FACE_PLUS_X = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;
const FACE_MINUS_X = [0, -Math.SQRT1_2, 0, Math.SQRT1_2] as const;

/**
 * A facade of dark brick with a grid of windows, some lit, and a brighter shop front along the
 * bottom. The same picture serves as the color map and the emissive map, so the dark windows stay
 * dark and only the lit ones glow.
 */
function facade(textures: SketchContext['textures'], seed: number, lit: string): Texture {
	const SIZE = 96;
	const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
	math.seed(seed);
	const colour = [
		Number.parseInt(lit.slice(1, 3), 16),
		Number.parseInt(lit.slice(3, 5), 16),
		Number.parseInt(lit.slice(5, 7), 16),
	];
	const shade = Array.from({ length: 32 }, () => math.randFloat(0.75, 1.1));
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const at = (y * SIZE + x) * 4;
			// Ten windows across and thirteen up, each inset from its cell by a frame.
			const [cx, cy] = [(x / SIZE) * 10, (y / SIZE) * 13];
			const [fx, fy] = [cx - Math.floor(cx), cy - Math.floor(cy)];
			const shop = y > SIZE * 0.84;
			const window = !shop && fx > 0.18 && fx < 0.82 && fy > 0.28 && fy < 0.78;
			if (window) {
				const lamp = shade[(Math.floor(cy) * 10 + Math.floor(cx)) % shade.length] as number;
				const bright = lamp > 0.9 ? 1 : 0.06;
				data.set(
					[
						bright * (colour[0] as number) + (bright < 1 ? 6 : 0),
						bright * (colour[1] as number) + (bright < 1 ? 8 : 0),
						bright * (colour[2] as number) + (bright < 1 ? 12 : 0),
						255,
					],
					at,
				);
			} else if (shop) {
				// The ground floor: a lit shop window in each bay, with a dark frame between them.
				const bay = (x / SIZE) * 5;
				const lit = bay - Math.floor(bay) > 0.08 && bay - Math.floor(bay) < 0.92;
				const warm = shade[Math.floor(bay) % shade.length] as number;
				const glow = lit ? (y > SIZE * 0.9 ? 0.8 : 0.45) * warm : 0.12;
				data.set([120 * glow, 130 * glow, 150 * glow, 255], at);
			} else {
				// Brick courses, each a shade of its own.
				const course = Math.floor(y / 6);
				const brick = shade[course % shade.length] as number;
				const mortar = y % 6 === 0 || (x + (course % 2) * 6) % 12 === 0;
				const value = mortar ? 0.11 : 0.15 * brick;
				data.set([value * 255, value * 225, value * 205, 255], at);
			}
		}
	return textures.fromData({
		width: SIZE,
		height: SIZE,
		data,
		colorSpace: 'srgb',
		wrap: 'repeat',
		mipmaps: true,
		anisotropy: 8,
	});
}

/** Builds the street, its lamp posts and its signs, over the planar reflection's picture. */
export function createStreet(
	ctx: SketchContext,
	mirror: Texture,
	without: ReadonlySet<string> = new Set(),
): void {
	const { scene, geometry, materials, textures } = ctx;

	// The asphalt reads the scene's planar reflection pass: rough dry stone between smooth puddles
	// whose water carries the lamps, the signs and the windows.
	const road = materials.shader({
		wgsl: WET_ROAD,
		textures: { mirror },
		color: '#1b1d21',
		roughness: 0.6,
	});
	scene.createMesh({
		mesh: geometry.plane({ width: ROAD, height: LENGTH }),
		material: road,
		position: [0, 0, FAR / 2],
		rotation: [...FLAT],
	});

	// The pavements and their dark kerbs.
	const pavement = materials.standard({ color: '#25272b', roughness: 0.55, metalness: 0.1 });
	for (const side of [-1, 1])
		scene.createMesh({
			mesh: geometry.box({ width: PAVEMENT, height: 0.16, depth: LENGTH }),
			material: pavement,
			position: [side * (ROAD / 2 + PAVEMENT / 2), 0.08, FAR / 2],
			receiveShadows: true,
		});

	// The buildings: a row down each side, each with its own facade and height.
	const facades = [
		facade(textures, 3, '#ffca8a'),
		facade(textures, 5, '#ffe0b0'),
		facade(textures, 9, '#cfe0ff'),
	];
	const blocks = [
		[-4, 14, 0],
		[-13.5, 10, 1],
		[-23, 12, 2],
		[-34, 9, 0],
		[-45, 15, 1],
	] as const;
	const walls = blocks.map(([, , look]) => {
		const facadeMap = facades[look % facades.length];
		return materials.standard({
			map: facadeMap,
			emissiveMap: facadeMap,
			emissive: '#ffffff',
			emissiveIntensity: 1.15,
			roughness: 0.88,
		});
	});
	for (const [index, [z, height]] of blocks.entries())
		for (const side of [-1, 1]) {
			const depth = 8;
			scene.createMesh({
				mesh: geometry.box({ width: depth, height, depth }),
				material: walls[index] as (typeof walls)[number],
				position: [side * (ROAD / 2 + PAVEMENT + depth / 2), height / 2, z],
				castShadows: true,
				receiveShadows: true,
			});
		}

	// A wall across the far end, so the street closes in the fog rather than running on to the sky.
	scene.createMesh({
		mesh: geometry.box({ width: ROAD + PAVEMENT * 2 + 2, height: 16, depth: 1 }),
		material: materials.standard({ color: '#0b0c0f', roughness: 0.9 }),
		position: [0, 8, FAR - 0.5],
	});

	// The lamps: a slim post and arm, a glowing head, and a spot light that throws the pool of light
	// and shows as a cone through the lit fog.
	const metal = materials.standard({ color: '#1c1e22', metalness: 0.8, roughness: 0.35 });
	const bulb = materials.standard({
		color: '#000000',
		emissive: '#ffe2b8',
		emissiveIntensity: 7,
	});
	for (const side of [-1, 1])
		for (const [index, z] of LAMP_Z.entries()) {
			const x = side * (ROAD / 2 + 0.5);
			scene.createMesh({
				mesh: geometry.cylinder({ radiusTop: 0.05, radiusBottom: 0.07, height: 4.6 }),
				material: metal,
				position: [x, 2.3, z],
				castShadows: true,
			});
			scene.createMesh({
				mesh: geometry.box({ width: 0.9, height: 0.06, depth: 0.06 }),
				material: metal,
				position: [x - side * 0.42, 4.55, z],
			});
			scene.createMesh({
				mesh: geometry.sphere({ radius: 0.16, widthSegments: 20, heightSegments: 10 }),
				material: bulb,
				position: [x - side * 0.8, 4.52, z],
			});
			scene.createSpotLight({
				position: [x - side * 0.8, 4.45, z],
				direction: [-side * 0.45, -1, 0],
				angle: 1.05,
				penumbra: 0.5,
				range: 24,
				color: '#ffd9a8',
				intensity: 130,
			});
		}

	// Two neon signs, one down each side, with a point light that tints the wet road beneath them.
	const signs = [
		[-1, -12, '#ff3fa4'],
		[1, -27, '#3fe0ff'],
	] as const;
	for (const [side, z, color] of signs) {
		const x = side * (ROAD / 2 + PAVEMENT - 0.55);
		scene.createMesh({
			mesh: geometry.plane({ width: 1.1, height: 3.4 }),
			material: materials.standard({ color: '#000000', emissive: color, emissiveIntensity: 7 }),
			position: [x, 4.2, z],
			rotation: side < 0 ? [...FACE_PLUS_X] : [...FACE_MINUS_X],
		});
		if (!without.has('lamps'))
			scene.createPointLight({
				position: [x - side * 0.9, 4.1, z],
				range: 16,
				color,
				intensity: 34,
			});
	}
}
