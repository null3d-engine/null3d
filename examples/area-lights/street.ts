// The neon street's scenery: a night sky, a low haze, wet asphalt with puddles made in code, brick
// walls on both sides with a dark kerb under each, and a far wall that closes the street. The
// street runs along Z, 8 m wide, and the walls' faces stand at x = -4 and x = 4.
import type { Material, SketchContext, Vec3 } from '@null3d/engine';
import { math } from '@null3d/engine';

/** A quarter turn about X, which lays a plane flat. */
const QUARTER_X = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;

/** Builds the street. */
export function street({ scene, geometry, materials, textures }: SketchContext): void {
	scene.setBackground('#04060c');
	scene.setFog({ color: '#060912', density: 0.05 });
	scene.createHemisphereLight({ skyColor: '#2a3a6a', groundColor: '#0c0c10', intensity: 1.2 });
	const box = geometry.box();
	const solid = (color: string, roughness = 0.8) => materials.standard({ color, roughness });
	const block = (material: Material, position: Vec3, scale: Vec3) =>
		scene.createMesh({ mesh: box, material, position, scale });

	// Wet asphalt: puddles where crossed waves add up, smooth and darker, the rest rough and gray.
	math.seed(7);
	const [albedo, finish] = [new Uint8Array(64 * 64 * 4), new Uint8Array(64 * 64 * 4)];
	for (let i = 0; i < 64 * 64; i++) {
		const [u, v] = [((i % 64) / 32) * Math.PI, ((i >> 6) / 32) * Math.PI];
		const wet = Math.sin(u * 2) + Math.sin(v * 3 + u) + Math.sin((u - v) * 2) > 0.3;
		const grain = math.randFloat(0.7, 1) * (wet ? 0.6 : 1);
		albedo.set([105 * grain, 108 * grain, 114 * grain, 255], i * 4);
		finish.set([255, wet ? 12 : 140, 0, 255], i * 4);
	}
	const tiled = { width: 64, height: 64, wrap: 'repeat', mipmaps: true } as const;
	const asphalt = materials.standard({
		map: textures.fromData({ ...tiled, data: albedo, colorSpace: 'srgb', anisotropy: 8 }),
		metalnessRoughnessMap: textures.fromData({ ...tiled, data: finish }),
		uvTransform: { repeat: [6, 24] },
	});
	const ground = geometry.plane({ width: 8, height: 40 });
	scene.createMesh({ mesh: ground, material: asphalt, position: [0, 0, -4], rotation: QUARTER_X });

	const brick = solid('#8a5a48');
	const kerb = solid('#1c1c20', 0.5);
	for (const side of [-1, 1]) {
		block(brick, [side * 4.2, 4, -4], [0.4, 8, 40]);
		block(kerb, [side * 3.7, 0.08, -4], [0.6, 0.16, 40]);
	}
	block(solid('#2a2a2e', 0.6), [0, 4, -20], [8, 8, 0.4]);
}
