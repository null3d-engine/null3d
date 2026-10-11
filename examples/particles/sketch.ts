// Particles: a campfire in an autumn glade at dusk, with flames, embers, smoke, falling leaves and
// fireflies. Each effect is one particle system of @null3d/particles, with a texture made in code:
// the GPU moves every particle in closed form, and the sketch writes only each frame's births.
import { defineSketch, math, timeOfDay } from '@null3d/engine';
import { createParticles, particleTextures as maps } from '@null3d/particles';
import { interact } from '../lib/interact';

/** The birch's canopy, where the leaves start. */
const CANOPY = [-3.2, 4.2, -2.6] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	const dusk = timeOfDay('blueHour', { heading: 1.2 });
	const sky = { intensity: dusk.skyIntensity * 1.4 };
	scene.setBackground({ sky: { ...dusk.sky, cloudCoverage: 0.25 } }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), sky);
	scene.setFog({ color: dusk.fog.color, density: 0.035 });
	scene.createDirectionalLight({ ...dusk.light, castShadows: true, shadow: { distance: 25 } });
	post.set({ exposure: 1.6, bloom: { intensity: 0.45, threshold: 1 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({ fov: 45, far: 400, position: [4.3, 2.2, 5.5] });
	scene.setActiveCamera(camera);
	const bounds = [-6, 0, -6, 6, 0, 6] as const;
	const view = interact(ctx, camera, { target: [-0.6, 1.2, 0], groundY: 0, bounds });

	// The glade: grass, a ring of stones around leaning logs, and a birch in autumn.
	const flat = { rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const, receiveShadows: true };
	const look = (color: string, roughness = 0.9) => materials.standard({ color, roughness });
	const ground = geometry.circle({ radius: 120, segments: 64 });
	scene.createMesh({ mesh: ground, material: look('#3f4a2a'), ...flat });
	const solid = { castShadows: true, receiveShadows: true };
	const pebble = geometry.sphere({ radius: 0.2, widthSegments: 10, heightSegments: 8 });
	const stone = look('#6b6660', 0.8);
	for (let k = 0; k < 11; k++) {
		const [a, s] = [(k / 11) * Math.PI * 2, 0.8 + ((k * 7) % 11) * 0.04];
		const position = [Math.cos(a) * 0.85, 0.06, Math.sin(a) * 0.85] as const;
		scene.createMesh({ mesh: pebble, material: stone, position, scale: [s, 0.6 * s, s], ...solid });
	}
	const log = geometry.cylinder({ radiusTop: 0.09, radiusBottom: 0.09, height: 1.1 });
	const wood = look('#4a3424');
	for (const t of [0.4, -0.5, 1.6]) {
		const rotation = [0.58 * Math.cos(t), 0, 0.58 * Math.sin(t), 0.81] as const;
		scene.createMesh({ mesh: log, material: wood, position: [0, 0.22, 0], rotation, ...solid });
	}
	const trunk = geometry.cylinder({ radiusTop: 0.14, radiusBottom: 0.22, height: 4.4 });
	const foot = [CANOPY[0], 2.2, CANOPY[2]] as const;
	scene.createMesh({ mesh: trunk, material: look('#d8d2c4', 0.7), position: foot, ...solid });
	const crown = geometry.sphere({ radius: 1, widthSegments: 16, heightSegments: 12 });
	const autumn = { mesh: crown, material: look('#b5651d'), ...solid };
	for (const x of [0, 0.9, -0.9]) {
		const position = [CANOPY[0] + x, CANOPY[1] - Math.abs(x) * 0.3, CANOPY[2]] as const;
		const r = 1.5 - x * x;
		scene.createMesh({ ...autumn, position, scale: [r, r * 0.85, r] });
	}
	const firelight = { color: '#ff8a3a', intensity: 6, range: 9, position: [0, 0.8, 0] as const };
	const glow = scene.createPointLight(firelight);
	// The effects. Flames fade where they meet the ground; embers rise and wander; smoke billows in
	// the wind; leaves tumble down and settle; fireflies blink over the meadow.
	const fire = await createParticles(scene, {
		...maps.flame(textures),
		rate: 70,
		lifetime: [0.55, 0.85],
		shape: { type: 'cone', radius: 0.28, angle: 0.15 },
		size: [0.55, 0.8],
		sizeOverLife: [0.9, 1, 0.5, 0.15],
		colors: ['#ffb35c', '#ff7a2a'],
		intensity: 4.5,
		alphaOverLife: [0, 1, 0.7, 0],
		softness: 0.25,
	});
	const embers = await createParticles(scene, {
		...maps.spark(textures),
		position: [0, 0.3, 0],
		rate: 26,
		lifetime: [1.6, 2.6],
		shape: { type: 'cone', radius: 0.25, angle: 0.35 },
		speed: [1.2, 2.2],
		drag: 0.6,
		turbulence: 0.35,
		facing: 'velocity',
		size: [0.018, 0.03],
		colors: ['#ffb347', '#ff8c30'],
		intensity: 7,
		alphaOverLife: [1, 1, 0],
	});
	const smoke = await createParticles(scene, {
		...maps.smoke(textures),
		blending: 'normal',
		position: [0, 1.1, 0],
		rate: 9,
		lifetime: 6,
		shape: { type: 'disc', radius: 0.2 },
		drag: 0.35,
		wind: [0.5, 0.45, 0],
		turbulence: 0.5,
		size: [0.7, 0.9],
		sizeOverLife: [0.5, 1.6, 3.2],
		colors: ['#3a3a40', '#2c2c30'],
		alphaOverLife: [0, 0.45, 0.25, 0],
		softness: 0.4,
	});
	const leaves = await createParticles(scene, {
		...maps.leaves(textures),
		blending: 'normal',
		position: CANOPY,
		rate: 3,
		lifetime: 9,
		prewarm: true,
		shape: { type: 'sphere', radius: 1.4 },
		gravity: [0, -1.6, 0],
		drag: 1.4,
		wind: [0.8, 0, 0.3],
		turbulence: 0.6,
		groundHeight: 0.02 - CANOPY[1],
		groundMode: 'stick',
		facing: 'tumble',
		size: [0.16, 0.22],
		spin: [-2.5, 2.5],
		colors: ['#e8701a', '#d9a520'],
		alphaOverLife: [0, 1, 1, 0],
	});
	const fireflies = await createParticles(scene, {
		...maps.glow(textures),
		position: [-1, 0.9, -1.5],
		rate: 6,
		lifetime: [5, 8],
		shape: { type: 'box', size: [8, 1.2, 5] },
		speed: 0.1,
		turbulence: 0.9,
		turbulenceSpeed: 0.15,
		size: [0.07, 0.1],
		colors: ['#c8ff70', '#a8f050'],
		intensity: 3,
		alphaOverLife: [0, 1, 0.1, 1, 0.2, 1, 0],
	});
	const systems = [fire, embers, smoke, leaves, fireflies];
	return {
		onUpdate(dt) {
			// The fire's light flickers. The pointer's side of the fire sets the wind on the smoke.
			const t = time.now;
			glow.setIntensity(6 + Math.sin(t * 13) * 0.8 + Math.sin(t * 7.3) * 1.1);
			view.update(dt);
			const blow = math.lerp(0.5, math.clamp(view.point[0] * 0.4, -1.2, 1.2), view.steering);
			smoke.set({ wind: [blow, 0.45, 0] });
		},
		onLateUpdate(dt) {
			for (const system of systems) system.update(dt);
		},
	};
});
