// Particles: a campfire in an autumn glade at dusk, with flames, embers, smoke, falling leaves and
// fireflies. Each effect is one particle system of @null3d/particles, with a texture made in code:
// the GPU moves every particle in closed form, and the sketch writes only each frame's births. The
// glade's ground, stones, logs and trees are in glade.ts.
import { defineSketch, math, timeOfDay } from '@null3d/engine';
import { createParticles, particleTextures as maps } from '@null3d/particles';
import { interact } from '../lib/interact';
import { glade } from './glade';

/** The crown of the birch by the fire, which sheds leaves. */
const CANOPY = [-3.2, 4.2, -2.6] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, textures, post, time } = ctx;
	const dusk = timeOfDay('goldenHour', { heading: 0.5 });
	const sky = { intensity: dusk.skyIntensity };
	scene.setBackground({ sky: { ...dusk.sky, cloudCoverage: 0.25 } }, sky);
	scene.setEnvironment(await assets.skyEnvironment(), sky);
	scene.setFog({ ...dusk.fog, density: 0.025, heightFalloff: 0.2 });
	scene.createDirectionalLight({ ...dusk.light, castShadows: true, shadow: { distance: 25 } });
	post.set({ exposure: dusk.exposure * 1.2, bloom: { intensity: 0.4, threshold: 1 } });
	const target = [-1.2, 1.8, -1.2] as const;
	const camera = scene.createPerspectiveCamera({ fov: 45, position: [4.4, 2.3, 5.8], target });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target, groundY: 0, bounds: [-6, 0, -6, 6, 0, 6] });
	glade(ctx, CANOPY);
	// The firelight fades slower than real light, so its warm glow reaches the stones, the ground
	// round the fire and the nearest birches.
	const firelight = { color: '#ff7428', intensity: 13, range: 16, decay: 1.2 };
	const glow = scene.createPointLight({ ...firelight, position: [0, 0.9, 0], castShadows: true });
	// Low flames fade at the ground, and embers wander up.
	const fire = await createParticles(ctx, {
		...maps.flame(textures),
		rate: 55,
		lifetime: [0.5, 0.75],
		shape: { type: 'cone', radius: 0.24, angle: 0.15 },
		size: [0.42, 0.6],
		sizeOverLife: [0.9, 1, 0.5, 0.15],
		colors: ['#ff9a48', '#e8601e'],
		intensity: 1.7,
		alphaOverLife: [0, 0.85, 0.55, 0],
		softness: 0.25,
	});
	const embers = await createParticles(ctx, {
		...maps.spark(textures),
		position: [0, 0.3, 0],
		rate: 26,
		lifetime: [1.6, 2.6],
		shape: { type: 'cone', radius: 0.25, angle: 0.35 },
		speed: [1.2, 2.2],
		turbulence: 0.35,
		facing: 'velocity',
		size: [0.018, 0.03],
		colors: ['#ffb347', '#ff8c30'],
		intensity: 6,
		alphaOverLife: [1, 1, 0],
	});
	// Thin smoke takes the fire's orange from below, and greys and spreads as it rises.
	const smoke = await createParticles(ctx, {
		...maps.smoke(textures),
		blending: 'normal',
		position: [0, 0.9, 0],
		rate: 7,
		lifetime: 6,
		shape: { type: 'disc', radius: 0.15 },
		drag: 0.35,
		wind: [0.5, 0.45, 0],
		turbulence: 0.5,
		size: [0.5, 0.7],
		sizeOverLife: [0.4, 1.4, 2.8],
		colors: ['#9a9aa2', '#84848c'],
		colorOverLife: ['#ffa266', '#c89c88', '#ffffff'],
		alphaOverLife: [0, 0.32, 0.16, 0],
	});
	// Leaves tumble from the birch and settle on the ground, and fireflies blink over the glade.
	const leaves = await createParticles(ctx, {
		...maps.leaves(textures),
		blending: 'normal',
		position: CANOPY,
		rate: 6,
		lifetime: 9,
		shape: { type: 'sphere', radius: 1.4 },
		gravity: [0, -1.6, 0],
		drag: 1.4,
		wind: [0.8, 0, 0.3],
		turbulence: 0.6,
		groundHeight: 0.02 - CANOPY[1],
		groundMode: 'stick',
		facing: 'tumble',
		size: [0.22, 0.3],
		spin: [-2.5, 2.5],
		colors: ['#e8701a', '#d9a520'],
		alphaOverLife: [0, 1, 1, 0],
	});
	const fireflies = await createParticles(ctx, {
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
			// The firelight flickers softly in three waves that never fall in step. The pointer's side
			// of the fire sets the wind on the smoke.
			const t = time.now;
			const flicker =
				Math.sin(t * 9.1) * 0.08 + Math.sin(t * 17.3) * 0.05 + Math.sin(t * 4.3) * 0.07;
			glow.setIntensity(firelight.intensity * (1 + flicker));
			view.update(dt);
			const blow = math.lerp(0.5, math.clamp(view.point[0] * 0.4, -1.2, 1.2), view.steering);
			smoke.set({ wind: [blow, 0.45, 0] });
		},
		onLateUpdate() {
			for (const system of systems) system.update();
		},
	};
});
