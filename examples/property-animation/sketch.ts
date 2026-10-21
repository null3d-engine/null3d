// Property animation: one value of a lamp, a material and a camera, each moved by keyframes that
// scene.animateProperty plays. The lamp over the plinths breathes. The plinths share one material
// whose color and glow cycle through the spectrum, and the camera's field of view widens and
// narrows, so the wall of light behind them swells. Each orb floats on a track of its own position.
// A glTF file moves the same kinds of value with its KHR_animation_pointer channels, at its clip's
// time.
import { color, defineSketch } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The pillars, their spacing, and the point that the camera looks at. */
const PILLARS = 7;
const SPACING = 1.2;
const AIM = [0, 1.1, 0] as const;

/** The material's keys: seven hues, a slow walk around the spectrum, and the seconds between them. */
const STEP = 1.4;
const SCRATCH = new Float32Array(3);
const hueTimes = Array.from({ length: 7 }, (_, k) => k * STEP);
const hues = hueTimes.flatMap((_, k) => [...color.fromHsl(SCRATCH, k / 7, 0.9, 0.55)]);

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post } = ctx;
	scene.setBackground('#05070d');
	scene.setFog({ color: '#05070d', curve: 'exp2', density: 0.04 });
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.35 });
	post.set({ bloom: { intensity: 0.6, threshold: 0.8 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({ fov: 36, position: [0, 2.6, 9.5], target: AIM });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: AIM, maxPolarAngle: Math.PI * 0.49 });

	// The lamp breathes between a dim amber and a bright white, and its cone with it.
	const lamp = scene.createSpotLight({
		position: [0, 8, 3],
		target: AIM,
		angle: 0.6,
		penumbra: 0.75,
		range: 40,
		color: '#ffe6c4',
		castShadows: true,
	});
	// A cubic key holds its in-tangent, its value and its out-tangent: the lamp eases between them.
	scene.animateProperty(lamp, 'light.intensity', {
		times: [0, 2.4, 4.8],
		values: [0, 320, 0, 0, 1100, 0, 0, 320, 0],
		interpolation: 'cubic',
	});
	// Two cool rims pick the plinths' edges out of the dark.
	for (const side of [-1, 1])
		scene.createSpotLight({
			position: [side * 7, 3.5, -4.5],
			target: [side * 1.5, 1.2, 0],
			angle: 0.55,
			penumbra: 0.9,
			range: 25,
			intensity: 180,
			color: '#8fb6ff',
		});

	// A wall of light behind the plinths, which the camera's field of view swells.
	scene.createMesh({
		mesh: geometry.plane({ width: 30, height: 12 }),
		material: materials.standard({
			color: '#0a1526',
			emissive: '#1d4f8c',
			emissiveIntensity: 2.2,
			roughness: 1,
		}),
		position: [0, 4.5, -6],
		receiveShadows: false,
	});
	scene.animateProperty(camera, 'camera.fov', {
		times: [0, 3.2, 6.4],
		values: [30, 42, 30],
	});

	// One material, two animations: every plinth changes color and glow with it.
	const stone = materials.standard({ roughness: 0.22, metalness: 0.15, emissiveIntensity: 0.8 });
	for (const name of ['color', 'emissive'] as const)
		scene.animateProperty(stone, `material.${name}`, { times: hueTimes, values: hues });
	const plinth = geometry.cylinder({
		radiusTop: 0.34,
		radiusBottom: 0.44,
		height: 1.5,
		radialSegments: 48,
	});
	const orb = geometry.sphere({ radius: 0.3, widthSegments: 32, heightSegments: 20 });
	for (let k = 0; k < PILLARS; k++) {
		const x = (k - (PILLARS - 1) / 2) * SPACING;
		scene.createMesh({ mesh: plinth, material: stone, position: [x, 0.75, 0] });
		const cap = scene.createMesh({ mesh: orb, material: stone, position: [x, 1.8, 0] });
		// Each orb floats on a track of its own position, a little behind the one before it.
		scene.animateProperty(cap, 'position', {
			times: [0, 1.6, 3.2],
			values: [x, 1.8, 0, x, 2.06, 0, x, 1.8, 0],
			time: k * 0.23,
		});
	}
	// A polished floor that returns the room's light, and the plinths' shadows.
	scene.createMesh({
		mesh: geometry.plane({ width: 60, height: 60 }),
		material: materials.standard({ color: '#0b0e16', roughness: 0.14, metalness: 0.7 }),
		position: [0, 0, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	return {
		onUpdate(dt) {
			view.update(dt);
		},
	};
});
