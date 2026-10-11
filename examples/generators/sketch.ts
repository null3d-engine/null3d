// Geometry generators: the nine shapes that geometry makes, with the parameters of three.js's
// geometry classes, over a stone terrace at sundown. Each shape turns back and forth, or toward the
// pointer while it points. Three shapes wear a tile texture made in code with textures.fromData,
// whose joints show the texture coordinates that each generator builds. The others run from rough
// plastic to polished metal, which reflects the built-in room environment, and the ring glows bright
// enough to bloom. The flat shapes, the last three, draw both faces, so they stay in view when the
// camera orbits behind them.
import { defineSketch, math, type Vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** A point toward the sun: low, ahead of the camera and to its left. */
const SUN = [-0.8, 0.12, -0.58] as const;
/** Texels along each side of the tile texture, and along each side of one tile. */
const SIZE = 64;
const TILE = 16;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	const sky = {
		sky: { sunPosition: SUN, turbidity: 8, rayleigh: 2, cloudCoverage: 0.35, time: 0 },
	};
	scene.setBackground(sky);
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.5 });
	scene.setFog({ color: '#bdb1b3', density: 0.02, height: -3.4, heightFalloff: 0.4, sunGlow: 1.5 });
	post.set({ bloom: { intensity: 0.2, threshold: 1 }, ao: { radius: 0.5 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		far: 5000,
		position: [0, 1, 10],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	// The pointer points at an upright plane in front of the shapes.
	const view = interact(ctx, camera, { target: [0, 0, 0], planeZ: 3 });
	scene.createDirectionalLight({
		direction: [-SUN[0], -SUN[1], -SUN[2]],
		color: '#ffc896',
		intensity: 3,
		castShadows: true,
		shadow: { distance: 40 },
	});
	scene.createAmbientLight({ color: '#9db4ff', intensity: 0.3 });

	// Stone tiles with dark joints: each tile takes a shade from the seeded generator, and each texel
	// a little grain.
	math.seed(3);
	const shades = Array.from({ length: (SIZE / TILE) ** 2 }, () => math.randFloat(0.7, 1));
	const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const tile = shades[Math.floor(y / TILE) * (SIZE / TILE) + Math.floor(x / TILE)];
			const shade = x % TILE === 0 || y % TILE === 0 ? 0.3 : tile * math.randFloat(0.9, 1);
			data.fill(shade * 255, (y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3);
		}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const tiles = textures.fromData({ width: SIZE, height: SIZE, data, ...look });
	scene.createMesh({
		mesh: geometry.plane({ width: 1e4, height: 1e4 }),
		material: materials.standard({
			map: tiles,
			color: '#a09080',
			roughness: 0.85,
			doubleSided: true,
			uvTransform: { repeat: [2500, 2500] },
		}),
		position: [0, -3.4, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// In reading order: the solids, then the round solids, then the flat shapes.
	const shapes = [
		geometry.box({ width: 1.2, height: 1.2, depth: 1.2 }),
		geometry.sphere({ radius: 0.75 }),
		geometry.torus({ radius: 0.55, tube: 0.22 }),
		geometry.cylinder({ radiusTop: 0.5, radiusBottom: 0.6, height: 1.4 }),
		geometry.cone({ radius: 0.7, height: 1.5 }),
		geometry.capsule({ radius: 0.4, height: 0.8 }),
		geometry.plane({ width: 1.4, height: 1.4 }),
		geometry.circle({ radius: 0.75 }),
		geometry.ring({ innerRadius: 0.35, outerRadius: 0.75 }),
	];
	// Each shape's surface: tiles, plastic, or metal from polished to brushed. The ring glows.
	const looks = [
		{ map: tiles, color: '#e8554e', roughness: 0.7 },
		{ color: '#f0f0f0', metalness: 1, roughness: 0.05 },
		{ color: '#f2c14e', metalness: 1, roughness: 0.3 },
		{ color: '#5bc27a', roughness: 0.25 },
		{ color: '#d98a5f', metalness: 1, roughness: 0.5 },
		{ map: tiles, color: '#4a8cff', roughness: 0.6 },
		{ map: tiles, color: '#9c8cff', roughness: 0.7 },
		{ color: '#c77dff', roughness: 0.15 },
		{ color: '#000000', emissive: '#ff2d8a', emissiveIntensity: 4 },
	];
	const places = shapes.map(
		(_, i): Vec3 => [((i % 3) - 1) * 2.6, (1 - Math.floor(i / 3)) * 2.2, 0],
	);
	const meshes = shapes.map((mesh, i) =>
		scene.createMesh({
			mesh,
			material: materials.standard({ ...looks[i], doubleSided: i >= 6 }),
			position: places[i],
			dynamic: true,
			castShadows: true,
			receiveShadows: true,
		}),
	);

	return {
		onUpdate(dt) {
			view.update(dt);
			const { point, steering } = view;
			for (let i = 0; i < meshes.length; i++) {
				// From the shape's place to the pointed point: the turns that face its front there.
				const dx = point[0] - places[i][0];
				const dy = point[1] - places[i][1];
				const tilt = math.lerp(0.35, -Math.atan2(dy, Math.hypot(dx, point[2])), steering);
				const turn = math.lerp(Math.sin(time.now + i * 0.7), Math.atan2(dx, point[2]), steering);
				meshes[i].setRotationEuler(tilt, turn, 0);
			}
			// The clouds drift with the sketch's time.
			sky.sky.time = time.now;
			scene.setBackground(sky);
		},
	};
});
