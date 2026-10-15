// Particles of the particles add-on, in hold mode: a fountain of soft dots that bounce on the floor
// and fade over life, and smoke from a flipbook made in code that drifts in the wind, billows with
// turbulence and fades where it meets the floor. Sparks lie along their velocity, and leaves of
// four shapes tumble down. The emitters seed their random numbers, so the held frame is the same on
// every run.
import { defineSketch } from '@null3d/engine';
import { createParticles, particleTextures } from '@null3d/particles';

export default defineSketch(async (ctx) => {
	const { scene, materials, geometry, textures } = ctx;
	scene.setBackground('#1d2330');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 50, position: [0, 2.4, 7], target: [0, 1.2, 0] }),
	);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.3], intensity: 2.5 });
	scene.createAmbientLight({ intensity: 0.4 });
	scene.createMesh({
		mesh: geometry.plane({ width: 12, height: 8 }),
		material: materials.standard({ color: '#3a4250', roughness: 0.9 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});
	scene.createMesh({
		mesh: geometry.box({ width: 0.8, height: 0.8, depth: 0.8 }),
		material: materials.standard({ color: '#8a6a4a' }),
		position: [1.6, 0.4, -0.8],
	});

	const fountain = await createParticles(ctx, {
		position: [-2.2, 0.05, 0],
		rate: 160,
		lifetime: [1.4, 2],
		shape: { type: 'cone', radius: 0.05, angle: 0.25 },
		speed: [3.5, 4.5],
		gravity: [0, -9.8, 0],
		groundHeight: 0,
		restitution: 0.45,
		size: [0.06, 0.1],
		colors: ['#4aa8ff', '#9ad4ff'],
		intensity: 2,
		colorOverLife: ['#ffffff', '#ffffff', '#ffa070'],
		alphaOverLife: [1, 0.8, 0],
		seed: 1,
	});
	const smoke = await createParticles(ctx, {
		...particleTextures.smoke(textures),
		blending: 'normal',
		position: [0, 0.1, -1],
		rate: 14,
		lifetime: 3.5,
		shape: { type: 'disc', radius: 0.2 },
		speed: [0.5, 0.8],
		drag: 0.6,
		wind: [0.5, 0.6, 0],
		turbulence: 0.25,
		size: [0.6, 0.9],
		sizeOverLife: [0.6, 1.4, 2.2],
		spin: [-0.4, 0.4],
		colors: ['#c4c4ca', '#a8a8b0'],
		alphaOverLife: [0, 0.7, 0],
		softness: 0.3,
		seed: 2,
	});
	const sparks = await createParticles(ctx, {
		...particleTextures.spark(textures),
		position: [1.6, 0.85, -0.8],
		rate: 90,
		lifetime: [0.5, 0.9],
		shape: { type: 'sphere', radius: 0.05 },
		speed: [2, 3.5],
		gravity: [0, -6, 0],
		facing: 'velocity',
		stretch: 0.05,
		size: [0.03, 0.05],
		colors: ['#ffb060', '#ffd090'],
		intensity: 4,
		colorOverLife: ['#ffffff', '#ff7030'],
		alphaOverLife: [1, 0],
		seed: 3,
	});
	const leaves = await createParticles(ctx, {
		...particleTextures.leaves(textures),
		blending: 'normal',
		position: [2.8, 3.2, 0.5],
		rate: 6,
		lifetime: 4,
		shape: { type: 'box', size: [2, 0.2, 1.5] },
		speed: 0.2,
		drag: 1.2,
		gravity: [0, -2, 0],
		wind: [-0.6, 0, 0],
		turbulence: 0.4,
		facing: 'tumble',
		size: [0.18, 0.26],
		spin: [-3, 3],
		colors: ['#ee9f4f', '#e2cb5f'],
		alphaOverLife: [0, 1, 1, 0],
		seed: 4,
	});
	const systems = [fountain, smoke, sparks, leaves];
	return {
		onLateUpdate() {
			for (const system of systems) system.update();
		},
	};
});
