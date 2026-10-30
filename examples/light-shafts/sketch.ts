// Light shafts: a path through a pine wood as the sun sets. The fog is volumetric, so the low sun's
// light falls through the gaps between the trunks in rays, and the trunks' shadows cut dark lanes
// through the haze. As the light fades into the blue hour, the lanterns along the path light up,
// and each casts a glowing cone into the fog, with the shadow of the bench below it. The fog's
// density and height falloff say where the air holds haze; its volumetric option lights it. The
// wood itself, its floor, pines and rocks, is in wood.ts.
import {
	defineSketch,
	type Material,
	math,
	type SpotLight,
	timeOfDay,
	type Vec3,
} from '@null3d/engine';
import { interact } from '../lib/interact';
import { createWood } from './wood';

// Seconds of each sunset and dusk, the hours that they span, and the hours between calls of
// timeOfDay, which makes a new object each time.
const [CYCLE, GOLDEN, BLUE, STEP] = [36, 17.1, 18.7, 1 / 30];
/** The share of the sky's color that the haze keeps in shade, so the sunlit air stands out. */
const SHADE = 0.3;
// The wood stands in the sky's light, so its floor never falls to black. The sun's own light in the
// haze sits above the sky's, so the shafts stand out, and the sky itself stays below white.
const FILL = 1.8;
const SKY = 0.5;
const SHAFT = 2.2;
const EXPOSURE = 0.9;
/** The lanterns along the path: x and z, each on a post that leans its light over the path. */
const LANTERNS = [1.6, 8, -1.6, 1, 1.6, -6, -1.6, -13];
/** What the camera looks at down the path, and the box that the pointed point stays in. */
const TARGET = [0, 3, -20] as const;
const BOUNDS = [-12, -100, -1, 12, 100, 1] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	// The sun's path turned about +Y so that it sets ahead of the camera, a little to the left.
	const ahead = timeOfDay(GOLDEN, { heading: -Math.PI / 2 }).light.direction[2] > 0;
	const heading = (ahead ? -Math.PI / 2 : Math.PI / 2) + 0.3;
	const sky = { ...timeOfDay(GOLDEN, { heading }).sky, cloudCoverage: 0.15 };
	post.set({ bloom: { intensity: 0.2, threshold: 1 }, ao: { radius: 0.6 }, vignette: {} });
	const sun = scene.createDirectionalLight({ castShadows: true, shadow: { distance: 70 } });
	// The sky lights the wood too, through an environment map that follows it as the sun sinks.
	const skyLight = await assets.skyEnvironment();
	const camera = scene.createPerspectiveCamera({ fov: 55, far: 3000, position: [0, 1.7, 16] });
	camera.lookAt(...TARGET);
	scene.setActiveCamera(camera);
	// The pointer points at an upright plane down the path: left is golden hour, right is dusk.
	const view = interact(ctx, camera, { target: TARGET, planeZ: -10, bounds: BOUNDS });
	const trees = createWood(ctx, camera);

	// Lanterns on iron posts, each with a bench below it whose shadow falls into the light's cone.
	const box = geometry.box();
	const iron = materials.standard({ color: '#24221f', roughness: 0.45, metalness: 0.7 });
	const wood = materials.standard({ color: '#7a6250', roughness: 0.9, ...trees.bark });
	const glow = materials.standard({ color: '#1a1410', emissive: '#ffc070' });
	const bulb = geometry.sphere({ radius: 0.12 });
	const part = (material: Material, position: Vec3, scale: Vec3) =>
		scene.createMesh({
			mesh: box,
			material,
			position,
			scale,
			castShadows: true,
			receiveShadows: true,
		});
	const lamps: SpotLight[] = [];
	for (let l = 0; l < LANTERNS.length; l += 2) {
		const [x, z] = [LANTERNS[l] as number, LANTERNS[l + 1] as number];
		const side = Math.sign(x);
		part(iron, [x, 1.6, z], [0.08, 3.2, 0.08]);
		part(iron, [x - side * 0.3, 3.15, z], [0.65, 0.06, 0.06]);
		part(wood, [x + side * 0.1, 0.45, z - 1.1], [0.45, 0.08, 1.6]);
		for (const dz of [-0.6, 0.6])
			part(iron, [x + side * 0.1, 0.22, z - 1.1 + dz], [0.4, 0.44, 0.05]);
		scene.createMesh({ mesh: bulb, material: glow, position: [x - side * 0.55, 3.0, z] });
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
			trees.update();
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
			scene.setEnvironment(skyLight, { intensity: day.skyIntensity * FILL });
			const [r, g, b] = day.fog.color;
			scene.setFog({
				color: [r * SHADE, g * SHADE, b * SHADE],
				sunGlow: day.fog.sunGlow,
				density: 0.03,
				height: 0,
				heightFalloff: 0.12,
				volumetric: { intensity: SHAFT, anisotropy: 0.7, distance: 60 },
			});
			post.set({ exposure: day.exposure * EXPOSURE });
			scene.setBackground({ sky }, { intensity: day.skyIntensity * SKY });
		},
	};
});
