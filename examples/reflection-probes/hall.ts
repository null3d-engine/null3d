// The reflection probes demo's scenery: a gallery of two rooms joined by a doorway, made in code.
// The west room is warm, with plaster walls, oak columns and amber light panels. The east room is
// cool, with deep teal walls, steel columns and cyan and magenta neon. Both share one floor of
// polished stone tiles, which a texture made in code veins and grains.
import { math, type SketchContext, type Vec3 } from '@null3d/engine';

/** The hall's extent: each room is `ROOM` meters along x, and both are `DEPTH` deep and `HEIGHT` tall. */
export const ROOM = 12;
export const DEPTH = 10;
export const HEIGHT = 5;
/** The doorway in the wall between the rooms: its half width along z, and its height. */
const DOOR = 1.6;
const DOOR_HEIGHT = 3.4;
/** Texels along each side of the floor's texture, and along each side of one tile in it. */
const SIZE = 128;
const TILE = 32;

/** Makes the hall's walls, floor, ceiling, columns, light panels and lamps. */
export function buildHall(ctx: SketchContext): void {
	const { scene, geometry, materials, textures } = ctx;
	// Stone tiles: each tile a shade of its own, with a soft vein across it and fine grain.
	math.seed(11);
	const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
	const tiles = (SIZE / TILE) ** 2;
	const shades = Array.from({ length: tiles }, () => math.randFloat(0.75, 1));
	const veins = Array.from({ length: tiles }, () => math.randFloat(0, Math.PI));
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const tile = Math.floor(y / TILE) * (SIZE / TILE) + Math.floor(x / TILE);
			const angle = veins[tile] as number;
			const across = Math.cos(angle) * x + Math.sin(angle) * y;
			const vein = 0.12 * Math.max(0, Math.sin(across * 0.35) ** 16);
			const joint = x % TILE === 0 || y % TILE === 0;
			const shade = joint ? 0.25 : (shades[tile] as number) * math.randFloat(0.94, 1) - vein;
			data.fill(Math.max(shade, 0) * 255, (y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3);
		}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const stone = textures.fromData({ width: SIZE, height: SIZE, data, ...look });
	const flat = (y: number, color: string, roughness: number, down: boolean) =>
		scene.createMesh({
			mesh: geometry.plane({ width: 2 * ROOM, height: DEPTH }),
			material: materials.standard({
				map: down ? undefined : stone,
				color,
				roughness,
				uvTransform: down ? undefined : { repeat: [6, 2.5] },
			}),
			position: [0, y, 0],
			rotation: down ? [Math.SQRT1_2, 0, 0, Math.SQRT1_2] : [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
			receiveShadows: true,
		});
	flat(0, '#cfc6bc', 0.06, false);
	flat(HEIGHT, '#2a2622', 0.9, true);

	const plaster = materials.standard({ color: '#c58f62', roughness: 0.85 });
	const teal = materials.standard({ color: '#2b5866', roughness: 0.7 });
	const block = (center: Vec3, size: Vec3, material: typeof plaster) =>
		scene.createMesh({
			mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
			material,
			position: center,
			castShadows: true,
			receiveShadows: true,
		});
	const half = DEPTH / 2;
	for (const [side, material] of [
		[-1, plaster],
		[1, teal],
	] as const) {
		const mid = (side * ROOM) / 2;
		block([mid, HEIGHT / 2, -half - 0.15], [ROOM, HEIGHT, 0.3], material);
		block([mid, HEIGHT / 2, half + 0.15], [ROOM, HEIGHT, 0.3], material);
		block([side * (ROOM + 0.15), HEIGHT / 2, 0], [0.3, HEIGHT, DEPTH], material);
		// The wall between the rooms, either side of the doorway and above it.
		const length = half - DOOR;
		const z = DOOR + length / 2;
		block([side * 0.08, HEIGHT / 2, z], [0.16, HEIGHT, length], material);
		block([side * 0.08, HEIGHT / 2, -z], [0.16, HEIGHT, length], material);
		block(
			[side * 0.08, (HEIGHT + DOOR_HEIGHT) / 2, 0],
			[0.16, HEIGHT - DOOR_HEIGHT, 2 * DOOR],
			material,
		);
	}

	// Columns down each room: oak in the west, brushed steel in the east.
	const column = geometry.cylinder({ radiusTop: 0.28, radiusBottom: 0.32, height: HEIGHT });
	const oak = materials.standard({ color: '#7a4a2a', roughness: 0.45 });
	const steel = materials.standard({ color: '#b8c4cc', metalness: 1, roughness: 0.3 });
	for (const x of [-8, -4, 4, 8])
		for (const z of [-3.6, 3.6])
			scene.createMesh({
				mesh: column,
				material: x < 0 ? oak : steel,
				position: [x, HEIGHT / 2, z],
				castShadows: true,
				receiveShadows: true,
			});

	// Light panels on the long walls, bright enough to bloom.
	const panel = geometry.box({ width: 2.2, height: 0.12, depth: 0.05 });
	const glow = (color: string, intensity: number) =>
		materials.standard({ color: '#000000', emissive: color, emissiveIntensity: intensity });
	const amber = glow('#ffb46b', 5);
	const cyan = glow('#33e6ff', 7);
	const magenta = glow('#ff2f9a', 7);
	for (const x of [-9, -3, 3, 9])
		for (const z of [-half + 0.04, half - 0.04]) {
			const material = x < 0 ? amber : z < 0 ? cyan : magenta;
			for (const y of [1.4, 3.6]) scene.createMesh({ mesh: panel, material, position: [x, y, z] });
		}
	// Neon strips down the east room's end wall.
	const strip = geometry.box({ width: 0.05, height: 3.2, depth: 0.12 });
	for (const z of [-3, -1.5, 1.5, 3])
		scene.createMesh({
			mesh: strip,
			material: z < 0 ? cyan : magenta,
			position: [ROOM - 0.04, 2, z],
		});
	// A soft hemisphere light fills both rooms, and a lamp in each tints its room. The probes
	// capture the fill light and the glowing panels.
	scene.createHemisphereLight({ skyColor: '#d8c8ff', groundColor: '#3a2a20', intensity: 0.6 });
	scene.createPointLight({ color: '#ffb46b', intensity: 40, range: 12, position: [-6, 4.4, 0] });
	scene.createPointLight({ color: '#7fd8ff', intensity: 40, range: 12, position: [6, 4.4, 0] });
}
