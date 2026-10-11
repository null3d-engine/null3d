// Light shafts: a path through a pine wood as the sun sets. The fog is volumetric, so the low sun's
// light falls through the gaps between the trunks in rays, and the trunks' shadows cut dark lanes
// through the haze. As the light fades into the blue hour, the lanterns along the path light up,
// and each casts a glowing cone into the fog, with the shadow of the bench below it. The fog's
// density and height falloff say where the air holds haze; its volumetric option lights it.
import {
	defineSketch,
	type Material,
	type MeshOptions,
	math,
	type SpotLight,
	timeOfDay,
} from '@null3d/engine';
import { interact } from '../lib/interact';

// Seconds of each sunset and dusk, the hours that they span, and the hours between calls of
// timeOfDay, which makes a new object each time.
const [CYCLE, GOLDEN, BLUE, STEP] = [36, 17.1, 18.7, 1 / 30];
/** The lanterns along the path: x and z, each on a post that leans its light over the path. */
const LANTERNS = [1.6, 8, -1.6, 1, 1.6, -6, -1.6, -13];
/** What the camera looks at down the path, and the box that the pointed point stays in. */
const TARGET = [0, 3, -20] as const;
const BOUNDS = [-12, -100, -1, 12, 100, 1] as const;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, post, time } = ctx;
	// The sun's path turned about +Y so that it sets ahead of the camera, a little to the left.
	const ahead = timeOfDay(GOLDEN, { heading: -Math.PI / 2 }).light.direction[2] > 0;
	const heading = (ahead ? -Math.PI / 2 : Math.PI / 2) + 0.3;
	const sky = { ...timeOfDay(GOLDEN, { heading }).sky, cloudCoverage: 0.15 };
	post.set({ bloom: { intensity: 0.2, threshold: 1 }, vignette: {} });
	const sun = scene.createDirectionalLight({ castShadows: true, shadow: { distance: 70 } });
	const fill = scene.createAmbientLight();
	const camera = scene.createPerspectiveCamera({ fov: 55, far: 3000, position: [0, 1.7, 16] });
	camera.lookAt(...TARGET);
	scene.setActiveCamera(camera);
	// The pointer points at an upright plane down the path: left is golden hour, right is dusk.
	const view = interact(ctx, camera, { target: TARGET, planeZ: -10, bounds: BOUNDS });

	const box = geometry.box();
	const part = (material: Material, options: Partial<MeshOptions>) =>
		scene.createMesh({ mesh: box, material, castShadows: true, receiveShadows: true, ...options });
	const paint = (color: string, roughness = 0.85) => materials.standard({ color, roughness });
	const [moss, earth, bark] = [paint('#3e4a26', 1), paint('#6b5a40', 1), paint('#4a3426')];
	const [needles, iron] = [paint('#1f3a24'), paint('#24221f', 0.5)];
	const glow = materials.standard({ color: '#1a1410', emissive: '#ffc070' });

	// The forest floor, and an earthen path that winds down the middle of it.
	part(moss, { position: [0, -0.1, -20], scale: [160, 0.2, 160] });
	for (let k = 0; k < 24; k++) {
		const z = 18 - k * 2.2;
		part(earth, { position: [Math.sin(z * 0.15) * 0.6, 0.01, z], scale: [2.2, 0.02, 2.4] });
	}

	// Tall pines with bare trunks and their crowns high up, so the low sun shines between the trunks.
	math.seed(11);
	const trunk = geometry.cylinder({ radiusTop: 0.12, radiusBottom: 0.3, radialSegments: 10 });
	const crown = geometry.cone({ radius: 1, height: 1, radialSegments: 9 });
	for (let k = 0; k < 150; k++) {
		const x = math.randFloat(2.6, 26) * (k % 2 ? 1 : -1);
		const z = math.randFloat(-60, 14);
		const height = math.randFloat(11, 17);
		const spread = math.randFloat(1.4, 2.4);
		part(bark, { mesh: trunk, position: [x, height / 2, z], scale: [1, height, 1] });
		for (let c = 0; c < 3; c++) {
			const size = spread * (1 - c * 0.25);
			const y = height * 0.62 + c * spread * 0.9;
			part(needles, { mesh: crown, position: [x, y, z], scale: [size, spread * 1.6, size] });
		}
	}

	// Lanterns on iron posts, each with a bench below it whose shadow falls into the light's cone.
	const lamps: SpotLight[] = [];
	const bulb = geometry.sphere({ radius: 0.12 });
	for (let l = 0; l < LANTERNS.length; l += 2) {
		const [x, z] = [LANTERNS[l], LANTERNS[l + 1]];
		const side = Math.sign(x);
		part(iron, { position: [x, 1.6, z], scale: [0.08, 3.2, 0.08] });
		part(iron, { position: [x - side * 0.3, 3.15, z], scale: [0.65, 0.06, 0.06] });
		part(glow, { mesh: bulb, position: [x - side * 0.55, 3.0, z], castShadows: false });
		part(bark, { position: [x + side * 0.1, 0.45, z - 1.1], scale: [0.45, 0.08, 1.6] });
		lamps.push(
			scene.createSpotLight({
				position: [x - side * 0.55, 2.92, z],
				target: [x - side * 1.2, 0, z],
				range: 9,
				angle: 0.62,
				penumbra: 0.45,
				color: '#ffc68a',
				castShadows: true,
			}),
		);
	}

	let shown = -1;
	return {
		onUpdate(dt) {
			if (!view.userCamera) {
				// The camera walks slowly down the path and back.
				const walk = 16 - 9 * (0.5 - 0.5 * Math.cos(time.now * 0.08));
				camera.setPosition(Math.sin(walk * 0.15) * 0.6, 1.7, walk);
				camera.lookAt(...TARGET);
			}
			view.update(dt);
			// The hour runs from golden hour into the blue hour and back; the pointer picks one.
			const swing = 0.5 - 0.5 * Math.cos((2 * Math.PI * time.now) / CYCLE);
			const pointed = math.mapLinear(view.point[0], -12, 12, 0, 1);
			const share = math.lerp(swing, math.clamp(pointed, 0, 1), view.steering);
			const hour = math.lerp(GOLDEN, BLUE, share);
			const dusk = math.smoothstep(hour, 17.6, 18.4);
			glow.set({ emissiveIntensity: 0.2 + 14 * dusk });
			for (const lamp of lamps) lamp.setIntensity(26 * dusk);
			const step = Math.round(hour / STEP);
			if (step === shown) return;
			shown = step;
			const day = timeOfDay(step * STEP, { heading });
			Object.assign(sky, day.sky);
			sun.setDirection(...day.light.direction);
			sun.setColor(day.light.color);
			sun.setIntensity(day.light.intensity);
			fill.setColor(day.fog.color);
			fill.setIntensity(0.4 * day.skyIntensity + 0.05);
			scene.setFog({
				color: day.fog.color,
				sunGlow: day.fog.sunGlow,
				density: 0.03,
				height: 0,
				heightFalloff: 0.12,
				volumetric: { intensity: 2.5, anisotropy: 0.7, distance: 60 },
			});
			post.set({ exposure: day.exposure });
			scene.setBackground({ sky }, { intensity: day.skyIntensity });
		},
	};
});
