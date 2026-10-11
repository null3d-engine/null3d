// Screen-space reflections: a street at night after the rain. The asphalt is rough where it is dry
// and smooth in the puddles, from a map made in code, so the lit windows, the neon signs and the
// street lamps streak down into the puddles, and the wet curbs and the chrome bollards shine.
// Where a reflected ray finds nothing on the screen, the faint night environment shows instead,
// with no hard edge. The camera walks slowly down the street, and the pointer moves a taxi's
// headlights along it.
import { defineSketch, type Material, math, type Vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Texels along each side of the puddle map and of the window map. */
const SIZE = 128;
const PANES = 32;
/** The street's length, and the half width of the road between the curbs. */
const LENGTH = 90;
const ROAD = 4.5;
/** The neon signs' colors. */
const NEON = ['#ff2d8a', '#29e0ff', '#ffb02e', '#8c5bff'];

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, quality, time } = ctx;
	// Phones start with the reflections off: this demo turns them on at a quarter of the size.
	const reflect = () => quality.settings.ssrScale === 0 && quality.set({ ssrScale: 0.25 });
	reflect();
	quality.onChange(reflect);
	post.set({
		ssr: { maxDistance: 120, thickness: 1.5 },
		bloom: { intensity: 0.25, threshold: 1 },
		vignette: { intensity: 0.7 },
	});
	scene.setBackground('#05070d');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.04 });
	scene.setFog({ color: '#0b1020', density: 0.022 });
	const camera = scene.createPerspectiveCamera({ fov: 55, far: 400, position: [0, 1.7, 30] });
	scene.setActiveCamera(camera);
	const target: [number, number, number] = [0, 1.5, 5];
	const view = interact(ctx, camera, { target, groundY: 0 });
	scene.createAmbientLight({ color: '#4060a0', intensity: 0.25 });
	scene.createDirectionalLight({ direction: [0.3, -1, 0.4], color: '#8090c0', intensity: 0.3 });

	// Puddles: smooth near a few blobs of the seeded generator, rough between them. Green holds the
	// roughness and blue the metalness, as glTF's metal-rough maps do.
	math.seed(11);
	const blobs = Array.from({ length: 40 }, () => [math.randFloat(0, 1), math.randFloat(0, 1)]);
	const wrap = (d: number) => Math.min(Math.abs(d), 1 - Math.abs(d));
	const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			let wet = 0;
			for (const [bx, by] of blobs)
				wet = Math.max(wet, 1 - Math.hypot(wrap(x / SIZE - bx) * 1.6, wrap(y / SIZE - by)) / 0.12);
			data.set(
				[255, math.lerp(0.75, 0.04, math.clamp(wet * 3, 0, 1)) * 255, 0],
				(y * SIZE + x) * 4,
			);
		}
	const look = { width: SIZE, height: SIZE, wrap: 'repeat', mipmaps: true } as const;
	const road = scene.createMesh({
		mesh: geometry.plane({ width: ROAD * 2, height: LENGTH }),
		material: materials.standard({
			color: '#1b1d21',
			metalnessRoughnessMap: textures.fromData({ ...look, data }),
			uvTransform: { repeat: [1, LENGTH / (ROAD * 2)] },
		}),
	});
	road.setRotationEuler(-Math.PI / 2, 0, 0);

	// Lit windows for the building fronts: a grid of panes, some warm, some cool, the rest dark.
	const lit = new Uint8Array(PANES * PANES * 4).fill(255);
	for (let i = 0; i < PANES * PANES; i++) {
		const on = (i % PANES) % 4 !== 0 && Math.floor(i / PANES) % 4 !== 0 && math.random() < 0.45;
		const pane = math.random() < 0.7 ? [255, 190, 110] : [150, 200, 255];
		lit.set(on ? pane : [0, 0, 0], i * 4);
	}
	const panes = textures.fromData({ width: PANES, height: PANES, data: lit, colorSpace: 'srgb' });
	const box = geometry.box({ width: 1, height: 1, depth: 1 });
	const bollard = geometry.cylinder({ radiusTop: 0.15, radiusBottom: 0.18, height: 0.9 });
	const curb = materials.standard({ color: '#3a3d42', roughness: 0.3 });
	const chrome = materials.standard({ color: '#f0f0f0', metalness: 1, roughness: 0.12 });
	const pole = materials.standard({ color: '#2b2f36', metalness: 1, roughness: 0.4 });
	const glow = (color: string, strength: number) =>
		materials.standard({ color: '#000000', emissive: color, emissiveIntensity: strength });
	const lamp = glow('#ffd59a', 12);
	const neon = NEON.map((color) => glow(color, 9));
	const shape = (material: Material, position: Vec3, scale: Vec3) =>
		scene.createMesh({ mesh: box, material, position, scale });
	for (const side of [-1, 1]) {
		const walk = side * (ROAD + 2);
		shape(curb, [walk, 0.08, 0], [4, 0.16, LENGTH]);
		for (let z = -LENGTH / 2 + 6; z < LENGTH / 2; z += 9) {
			const height = math.randFloat(7, 16);
			const front = materials.standard({
				color: '#15171c',
				emissiveMap: panes,
				emissive: '#ffffff',
				emissiveIntensity: 1.6,
				uvTransform: { repeat: [2, height / 4] },
			});
			shape(front, [walk + side * 6, height / 2, z], [8, height, 8.6]);
			// A neon sign over most shop fronts.
			if (math.random() < 0.7) {
				const sign = neon[Math.floor(math.random() * neon.length)];
				shape(sign, [walk + side * 1.95, math.randFloat(3, 4.5), z + 2], [0.12, 0.35, 2.4]);
			}
			// A street lamp at the curb, which lights the road below it, and a chrome bollard.
			const curbX = side * (ROAD + 0.4);
			shape(pole, [curbX, 2.5, z + 4.5], [0.14, 5, 0.14]);
			shape(lamp, [curbX - side * 0.6, 4.95, z + 4.5], [1.1, 0.12, 0.35]);
			scene.createPointLight({
				position: [curbX - side * 0.8, 4.6, z + 4.5],
				color: '#ffc98a',
				intensity: 30,
				range: 16,
			});
			scene.createMesh({ mesh: bollard, material: chrome, position: [curbX, 0.6, z] });
		}
	}

	// A taxi's headlights, which the pointer moves along the street, and the light they throw.
	const headlight = glow('#fff4e0', 20);
	const ball = geometry.sphere({ radius: 0.16 });
	const lights = [-1.4, -0.2].map((x) =>
		scene.createMesh({ mesh: ball, material: headlight, position: [x, 0.7, 0], dynamic: true }),
	);
	const beam = scene.createPointLight({
		position: [0, 1, 0],
		color: '#fff0d8',
		intensity: 40,
		range: 18,
	});

	return {
		onUpdate(dt) {
			// The camera walks down the street, swaying a little, its eyes on the far end.
			const walk = 30 - ((time.now * 1.2) % 40);
			if (!view.userCamera) {
				camera.setPosition(Math.sin(time.now * 0.3) * 0.8, 1.7, walk);
				target[2] = walk - 25;
				camera.lookAt(target[0], target[1], target[2]);
			}
			view.update(dt);
			const scripted = walk - 18 + Math.sin(time.now * 0.5) * 6;
			const z = math.lerp(scripted, view.point[2], view.steering);
			lights[0].setPosition(-1.4, 0.7, z);
			lights[1].setPosition(-0.2, 0.7, z);
			beam.setPosition(-0.8, 1, z - 2);
		},
	};
});
