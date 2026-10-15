// The scenery of the automatic exposure demo: a sunlit courtyard of stone tiles with a fountain,
// and a stone hall with a wide door. Inside, two rows of columns carry warm lamps, and a spotlight
// from the roof lights a golden sphere on a plinth. The hall's walls and roof keep the sun out, so
// its inside is about five stops darker than the courtyard. The sketch walks the camera between
// the two.
import { type MeshOptions, math, type SketchContext } from '@null3d/engine';

/** The hall's inside, from its door wall at z = -4 back to z = -20, 12 m wide and 6 m tall. */
export const HALL = { front: -4, back: -20, width: 12, height: 6, door: 3.4 } as const;

/** Texels along each side of the stone texture, and along each side of one stone. */
const SIZE = 128;
const STONE = 32;

/** Builds the courtyard and the hall into the sketch's scene. */
export function buildHall(ctx: SketchContext): void {
	const { scene, geometry, materials, textures } = ctx;
	// Stones with dark joints: each stone takes a shade from the seeded generator, and each texel a
	// little grain.
	math.seed(7);
	const shades = Array.from({ length: (SIZE / STONE) ** 2 }, () => math.randFloat(0.72, 1));
	const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const tile = shades[Math.floor(y / STONE) * (SIZE / STONE) + Math.floor(x / STONE)];
			const joint = x % STONE < 2 || y % STONE < 2;
			const shade = joint ? 0.35 : (tile ?? 1) * math.randFloat(0.88, 1);
			data.fill(shade * 255, (y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3);
		}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const stones = textures.fromData({ width: SIZE, height: SIZE, data, ...look });
	const paving = materials.standard({
		map: stones,
		color: '#c8b49a',
		roughness: 0.85,
		doubleSided: true,
		uvTransform: { repeat: [2500, 2500] },
	});
	const wall = materials.standard({
		map: stones,
		color: '#d8c4a6',
		roughness: 0.9,
		uvTransform: { repeat: [3, 2] },
	});
	const shade = { castShadows: true, receiveShadows: true } as const;
	const block = (size: readonly number[], position: MeshOptions['position'], material = wall) =>
		scene.createMesh({
			mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
			material,
			position,
			...shade,
		});
	scene.createMesh({
		mesh: geometry.plane({ width: 1e4, height: 1e4 }),
		material: paving,
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// The hall: the door wall in three parts around the door, two side walls, a back wall between
	// them and a roof over all, each 0.6 m thick.
	const { front, back, width, height, door } = HALL;
	const depth = front - back;
	const side = (width - door) / 2;
	for (const x of [-1, 1]) {
		block([side, height, 0.6], [x * (door / 2 + side / 2), height / 2, front + 0.3]);
		block([0.6, height, depth], [x * (width / 2 + 0.3), height / 2, (front + back) / 2]);
	}
	block([door, height - 4, 0.6], [0, (height + 4) / 2, front + 0.3]);
	block([width, height, 0.6], [0, height / 2, back - 0.3]);
	block([width + 1.2, 0.6, depth + 1.2], [0, height + 0.3, (front + back) / 2]);

	// Inside: two rows of columns, each with a warm lamp that blooms, and a golden sphere on a
	// plinth under a spotlight from the roof.
	const stone = materials.standard({ color: '#b8a48c', roughness: 0.7 });
	const glow = materials.standard({ color: '#000000', emissive: '#ffb45a', emissiveIntensity: 9 });
	for (let row = 0; row < 3; row++)
		for (const x of [-1, 1]) {
			const z = front - 3.5 - row * 5;
			scene.createMesh({
				mesh: geometry.cylinder({ radiusTop: 0.35, radiusBottom: 0.42, height: height }),
				material: stone,
				position: [x * 3.6, height / 2, z],
				...shade,
			});
			scene.createMesh({
				mesh: geometry.sphere({ radius: 0.16 }),
				material: glow,
				position: [x * 2.98, 2.6, z],
			});
			scene.createPointLight({
				position: [x * 2.75, 2.6, z],
				color: '#ffb066',
				intensity: 1.2,
				range: 7,
			});
		}
	block([1.4, 1, 1.4], [0, 0.5, back + 4], stone);
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.6 }),
		material: materials.standard({ color: '#f2c14e', metalness: 1, roughness: 0.2 }),
		position: [0, 1.6, back + 4],
		...shade,
	});
	scene.createSpotLight({
		position: [0, height - 0.2, back + 4],
		target: [0, 0, back + 4],
		color: '#fff0d8',
		intensity: 8,
		range: 9,
		angle: 0.45,
		penumbra: 0.5,
		castShadows: true,
	});

	// The courtyard: a round fountain of stone with still water, and low planters along its sides.
	const water = materials.standard({ color: '#3a6e88', roughness: 0.05, metalness: 0.2 });
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 2.2, radiusBottom: 2.3, height: 0.6 }),
		material: stone,
		position: [0, 0.3, 14],
		...shade,
	});
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 1.95, radiusBottom: 1.95, height: 0.62 }),
		material: water,
		position: [0, 0.31, 14],
	});
	const leaves = materials.standard({ color: '#4f8a3c', roughness: 0.8 });
	for (let k = 0; k < 6; k++)
		for (const x of [-1, 1]) {
			const z = 2 + k * 4;
			block([1.2, 0.7, 1.2], [x * 7, 0.35, z], stone);
			scene.createMesh({
				mesh: geometry.sphere({ radius: 0.75 }),
				material: leaves,
				position: [x * 7, 1.3, z],
				...shade,
			});
		}
}
