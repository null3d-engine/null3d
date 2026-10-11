// Hold mode: 400 balls drop from random places into a stone pen and bounce. Math.random picks where
// each ball starts and how it flies, so every live run differs. With ?hold=3 in the page's address,
// the engine seeds Math.random and runs the sketch in frames of 1/60 second up to 3 seconds. The
// balls move in onFixedUpdate, in steps of sketch time, so the held frame is the same on every run,
// which is what an image test needs. The balls come in five glossy finishes, and each casts its
// shadow. The pointer brings up a paddle that kicks balls up.
import type { Material, MeshGeometry, MeshOptions, Vec3 } from '@null3d/engine';
import { defineSketch, math, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';

const BALLS = 400;
const RADIUS = 0.25;
/** Half the width of the pen, in meters. */
const HALF = 4;
const GRAVITY = 9.8;
/** The share of a ball's speed that it keeps when it bounces. */
const BOUNCE = 0.75;
/** The paddle's radius, and the upward speed that it gives a ball on it. */
const PADDLE = 0.8;
const KICK = 6;
/** Fixed steps per second: as many as a fast display draws, so the balls move in every frame. */
const OPTIONS = { fixedRate: 120 };

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post } = ctx;
	const day = timeOfDay(15.5, { heading: 0.6 });
	const sky = { ...day.sky, cloudCoverage: 0.3 };
	scene.setBackground({ sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.004, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure, bloom: { threshold: 1 }, ao: {}, vignette: {} });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 30 } });
	const target: Vec3 = [0, 1.5, 0];
	const camera = scene.createPerspectiveCamera({ fov: 50, far: 1e3, position: [0, 9, 13], target });
	scene.setActiveCamera(camera);
	const edge = HALF - PADDLE;
	const bounds = [-edge, 0, -edge, edge, 0, edge] as const;
	const view = interact(ctx, camera, { target, groundY: 0, bounds });

	// Stone tiles with pale joints, each tile a shade of its own.
	math.seed(2);
	const data = new Uint8Array(64 * 64 * 4).fill(255);
	const shades = Array.from({ length: 16 }, () => math.randFloat(0.75, 1));
	for (let i = 0; i < 64 * 64; i++) {
		const [x, y] = [i % 64, i >> 6];
		const tile = shades[(y >> 4) * 4 + (x >> 4)];
		const shade = x % 16 === 0 || y % 16 === 0 ? 1 : tile * math.randFloat(0.9, 1);
		data.fill(shade * 230, i * 4, i * 4 + 3);
	}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const map = textures.fromData({ width: 64, height: 64, data, ...look });
	const stone = (color: string, repeat: [number, number], doubleSided = false) =>
		materials.standard({ map, color, roughness: 0.8, uvTransform: { repeat }, doubleSided });
	const solid = { castShadows: true, receiveShadows: true };
	const put = (mesh: MeshGeometry, material: Material, at: Vec3, more?: Partial<MeshOptions>) =>
		scene.createMesh({ mesh, material, position: at, ...solid, ...more });
	// A paved yard, and the pen's sandy floor on it.
	const flat = { rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] } as const;
	const yard = geometry.plane({ width: 2000, height: 2000 });
	put(yard, stone('#8f8576', [500, 500], true), [0, -0.01, 0], flat);
	const floor = geometry.box({ width: 2 * HALF, height: 0.2, depth: 2 * HALF });
	put(floor, stone('#e3cfa4', [2, 2]), [0, -0.1, 0]);
	// Four low walls, each turned a quarter turn from the one before, with a post at each corner,
	// so no two walls overlap and share a face.
	const wall = geometry.box({ width: 2 * HALF, height: 0.6, depth: 0.2 });
	const pillar = geometry.box({ width: 0.32, height: 0.8, depth: 0.32 });
	const blocks = stone('#a39684', [4, 1]);
	for (let side = 0; side < 4; side++) {
		const angle = (side * Math.PI) / 2;
		const [s, c] = [Math.sin(angle) * (HALF + 0.1), Math.cos(angle) * (HALF + 0.1)];
		const turn = [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)] as const;
		put(wall, blocks, [s, 0.3, c], { rotation: turn });
		put(pillar, blocks, [s + c, 0.4, c - s]);
	}

	// Five finishes: chrome, gold, and glossy red, blue and pearl.
	const finishes = [
		{ color: '#e8e8e8', metalness: 1, roughness: 0.05 },
		{ color: '#f2c14e', metalness: 1, roughness: 0.2 },
		{ color: '#d7263d', roughness: 0.15 },
		{ color: '#1b98e0', roughness: 0.1 },
		{ color: '#f4f1ea', roughness: 0.3 },
	].map((finish) => materials.standard(finish));
	const sphere = geometry.sphere({ radius: RADIUS, widthSegments: 16, heightSegments: 12 });
	const positions = new Float32Array(BALLS * 3);
	const velocities = new Float32Array(BALLS * 3);
	const balls = Array.from({ length: BALLS }, (_, b) => {
		const i = b * 3;
		positions[i] = (Math.random() * 2 - 1) * (HALF - RADIUS);
		positions[i + 1] = 2 + Math.random() * 8;
		positions[i + 2] = (Math.random() * 2 - 1) * (HALF - RADIUS);
		velocities[i] = (Math.random() * 2 - 1) * 3;
		velocities[i + 2] = (Math.random() * 2 - 1) * 3;
		const position: Vec3 = [positions[i], positions[i + 1], positions[i + 2]];
		return put(sphere, finishes[b % finishes.length], position, { dynamic: true });
	});
	// The paddle glows, and shows only while the pointer steers it.
	const paddle = scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: PADDLE, radiusBottom: PADDLE, height: 0.06 }),
		material: materials.standard({ color: '#000000', emissive: '#4ad8ff', emissiveIntensity: 3 }),
		dynamic: true,
	});
	paddle.setVisible(false);
	let shown = false;

	return {
		onFixedUpdate(step) {
			const { point, steering } = view;
			for (let b = 0; b < BALLS; b++) {
				const i = b * 3;
				velocities[i + 1] -= GRAVITY * step;
				// The paddle kicks a ball on it up, and away from its middle.
				const dx = positions[i] - point[0];
				const dz = positions[i + 2] - point[2];
				if (steering > 0.5 && positions[i + 1] < 2 * RADIUS && dx * dx + dz * dz < PADDLE ** 2) {
					velocities[i] += dx * 3;
					velocities[i + 1] = KICK;
					velocities[i + 2] += dz * 3;
				}
				for (let axis = 0; axis < 3; axis++) {
					// The floor stops a ball from below, and the walls keep it in the pen.
					const low = axis === 1 ? RADIUS : RADIUS - HALF;
					const high = axis === 1 ? Number.POSITIVE_INFINITY : HALF - RADIUS;
					const at = positions[i + axis] + velocities[i + axis] * step;
					if (at < low || at > high) velocities[i + axis] *= -BOUNCE;
					positions[i + axis] = Math.min(Math.max(at, low), high);
				}
				balls[b].setPosition(positions[i], positions[i + 1], positions[i + 2]);
			}
		},
		onUpdate(dt) {
			view.update(dt);
			const { point, steering } = view;
			if (shown !== steering > 0) {
				shown = steering > 0;
				paddle.setVisible(shown);
			}
			if (shown) {
				paddle.setPosition(point[0], 0.03, point[2]);
				paddle.setScale(steering, 1, steering);
			}
		},
	};
}, OPTIONS);
