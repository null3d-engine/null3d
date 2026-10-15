// The neon street's scenery: a night sky with the moon, a blue haze, wet asphalt with puddles,
// raised pavements, brick fronts with doors, an awning, the neon sign's board, upper windows, and a
// far wall that closes the street. The maps come from code. The street runs along Z, the fronts'
// faces stand at x = -4 and x = 4, and the far wall at z = -20.
import type { Material, SketchContext, Vec3 } from '@null3d/engine';
import { timeOfDay } from '@null3d/engine';
import { Noise, random, textureSet } from '../lib/procedural';

/** A quarter turn about X, which lays a plane flat, and quarter turns about Y, which stand a plane
 * that faces +Z to face +X or -X. */
const FLAT = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
const FACE_PLUS_X = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;
const FACE_MINUS_X = [0, -Math.SQRT1_2, 0, Math.SQRT1_2] as const;

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

/** Builds the street, and returns the night's exposure. */
export async function street(ctx: SketchContext): Promise<number> {
	const { scene, assets, geometry, materials, textures } = ctx;
	const night = timeOfDay('night', { heading: 2.6 });
	// The moonlit sky, a deep blue that the puddles mirror, brighter than the preset's dark navy.
	const sky = { intensity: night.skyIntensity * 8 };
	scene.setBackground({ sky: night.sky }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), sky);
	scene.setFog({ color: night.fog.color, density: 0.035 });
	scene.createAmbientLight({ color: night.ambient.color, intensity: night.ambient.intensity * 2 });
	scene.createDirectionalLight({
		direction: night.light.direction,
		color: night.light.color,
		intensity: night.light.intensity * 1.5,
		castShadows: true,
		shadow: { distance: 30 },
	});
	const noise = new Noise(11);
	const next = random(5);

	// Wet asphalt, 8 m to a tile: dark grit, damp everywhere, with smooth dark puddles where a broad
	// noise rises. The grit's bumps give the damp parts their streaks, and the puddles lie flat.
	const asphalt = textureSet(textures, 256, (u, v, out) => {
		const wet = smoothstep(0.1, 0.18, noise.fbm2(u * 5, v * 5, 3, 5));
		const grit = noise.value2(u * 220, v * 220, 220) * 0.5 + noise.value2(u * 60, v * 60, 60) * 0.5;
		const shade = (0.16 + 0.05 * grit) * (1 - 0.45 * wet);
		Object.assign(out, { r: shade, g: shade, b: shade * 1.06, occlusion: 1 });
		out.roughness = 0.42 + 0.12 * grit - 0.3 * wet;
		out.height = grit * 0.25 * (1 - wet);
	});
	const road = materials.standard({ ...asphalt, uvTransform: { repeat: [1, 5] } });
	scene.createMesh({
		mesh: geometry.plane({ width: 8, height: 40 }),
		material: road,
		position: [0, 0, -4],
		rotation: FLAT,
	});

	// Brick, 1.2 m to a tile: 16 courses of 6 bricks in running bond, each brick a shade of its
	// own, set in pale mortar that sits back from the faces.
	const shades = Array.from({ length: 16 * 6 }, () => 0.75 + 0.35 * next());
	const bricks = textureSet(textures, 256, (u, v, out) => {
		const course = Math.floor(v * 16);
		const along = u * 6 + (course % 2) * 0.5;
		const [fx, fy] = [along - Math.floor(along), v * 16 - course];
		const mortar = fx < 0.05 || fy < 0.12;
		const grain = noise.value2(u * 128, v * 128, 128);
		const s = (shades[course * 6 + (Math.floor(along) % 6)] as number) * (0.92 + 0.08 * grain);
		const [r, g, b] = mortar ? [0.32, 0.3, 0.28] : [0.38 * s, 0.17 * s, 0.12 * s];
		Object.assign(out, { r, g, b, occlusion: mortar ? 0.7 : 1, roughness: mortar ? 0.95 : 0.8 });
		out.height = mortar ? 0 : 2 + grain;
	});
	const front = (repeat: [number, number]) =>
		materials.standard({ ...bricks, uvTransform: { repeat } });
	const wall = geometry.plane({ width: 40, height: 9 });
	const sideBrick = front([33, 7.5]);
	scene.createMesh({
		mesh: wall,
		material: sideBrick,
		position: [-4, 4.5, -4],
		rotation: FACE_PLUS_X,
	});
	scene.createMesh({
		mesh: wall,
		material: sideBrick,
		position: [4, 4.5, -4],
		rotation: FACE_MINUS_X,
	});
	const end = geometry.plane({ width: 8, height: 9 });
	scene.createMesh({ mesh: end, material: front([6.5, 7.5]), position: [0, 4.5, -20] });

	const box = geometry.box();
	const solid = (color: string, roughness: number, metalness = 0) =>
		materials.standard({ color, roughness, metalness });
	const block = (material: Material, position: Vec3, scale: Vec3) =>
		scene.createMesh({ mesh: box, material, position, scale });

	// Raised pavements, damp and a little shiny, with a kerb of darker stone.
	const pavement = solid('#3b3c40', 0.3);
	const kerb = solid('#55565a', 0.5);
	for (const side of [-1, 1]) {
		block(pavement, [side * 3.4, 0.07, -4], [1.2, 0.14, 40]);
		block(kerb, [side * 2.76, 0.07, -4], [0.08, 0.15, 40]);
		// A drainpipe down each front.
		block(solid('#202326', 0.4, 0.6), [side * 3.93, 4.5, -7.2], [0.1, 9, 0.1]);
	}

	// Doors, each in a frame, a green awning over the near shop window, and a door under the strip
	// light at the far end.
	const wood = solid('#2a1a12', 0.6);
	const trim = solid('#121416', 0.35);
	for (const [x, z] of [
		[-3.98, -6.6],
		[3.98, -2.5],
		[3.98, -14],
	] as const) {
		block(trim, [x, 1.15, z], [0.08, 2.3, 1.3]);
		block(wood, [x - Math.sign(x) * 0.03, 1.1, z], [0.08, 2.1, 1.1]);
	}
	block(wood, [0, 1.1, -19.96], [1.4, 2.2, 0.08]);
	block(solid('#1f4a3a', 0.7), [-3.45, 2.75, -2], [1.1, 0.06, 2.8]).setRotationEuler(0, 0, -0.35);

	// The neon sign's board on its bracket, which hangs out over the right pavement.
	const board = solid('#0d0e12', 0.4, 0.5);
	block(board, [3.05, 3.4, -8], [1.5, 2.3, 0.12]);
	block(board, [3.5, 4.65, -8], [1, 0.06, 0.06]);

	// Upper floors: rows of dark glass that mirror the neon, a few lit from inside.
	const glass = solid('#06080b', 0.06);
	const rooms = ['#ffcf8a', '#ffe7c4', '#c8d8ff'].map((color) =>
		materials.standard({ color: '#000000', emissive: color, emissiveIntensity: 1.5 }),
	);
	for (const side of [-1, 1])
		for (const y of [4.4, 6.6])
			for (let z = 1; z > -19; z -= 3) {
				const lit = next() < 0.2 ? rooms[Math.floor(next() * rooms.length)] : glass;
				block(trim, [side * 3.98, y, z], [0.06, 1.5, 1.2]);
				block(lit as Material, [side * 3.94, y, z], [0.04, 1.3, 1]);
				// Glazing bars split each window into four panes.
				block(trim, [side * 3.92, y, z], [0.03, 1.3, 0.05]);
				block(trim, [side * 3.92, y, z], [0.03, 0.05, 1]);
			}
	return night.exposure;
}
