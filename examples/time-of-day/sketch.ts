// Time of day: a day passes over a lighthouse in 40 seconds. timeOfDay(hour) gives each hour's sky,
// sun or moon, fog, sky intensity and exposure. The sky's environment follows the sky, so every
// surface takes the hour's light. At dusk the windows and lamp light up and its beams sweep the sea.
// timeOfDay makes a new object, so the sketch calls it only when the hour moves on a few minutes.
import { defineSketch, type Material, type MeshOptions, math, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';

// Seconds per day, the share of the day at time 0 (about 15:00), how much dawn and dusk slow the
// clock (0 for an even clock), and the hours between calls of timeOfDay.
const [DAY, START, LINGER, STEP] = [40, 14 / 24, 0.7, 1 / 20];
/** The sun's path turned about +Y, so that it sets ahead of the camera, well right of the island. */
const HEADING = -1.45;
/** The lighthouse's place, each cottage's place and turn, and each pine's place. */
const TOWER = [1.5, 0, -1] as const;
const HOUSES = [-3.2, 1.2, 0.3, -1.2, 3.6, -0.2];
const PINES = [-5, -2, -4.2, -3.4, 3.6, 3, 4.6, 1.6, -5.4, 2.4];
/** What the camera looks at, and the box that the pointed point stays in. */
const TARGET = [0, 4.5, 0] as const;
const BOUNDS = [-10, -100, -1, 10, 100, 1] as const;

// The lamp's beams: light added to what lies behind, fading from the lamp and toward the edges.
const ADDED = { alphaMode: 'blend', blending: 'additive', depthWrite: false, fog: false } as const;
const beam = /* wgsl */ `
struct Uniforms { strength: f32 }
fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    s.baseColor = vec3f(0.0);
    s.reflection = vec4f(0.0, 0.0, 0.0, 1.0);
    let facing = abs(dot(input.normal, input.viewDirection));
    s.emissive = vec3f(1.0, 0.85, 0.55) * material.strength * input.uv.y * input.uv.y * facing;
    return s;
}
`;

/** The hour at a sketch time: the day's share, slowed near 6 and 18 by a sine of twice the day. */
function clock(seconds: number): number {
	const share = math.euclideanModulo(START + seconds / DAY, 1);
	return 24 * (share + (LINGER * Math.sin(4 * Math.PI * share)) / (4 * Math.PI));
}

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	const sky = { ...timeOfDay(15).sky, cloudCoverage: 0.3 };
	const environment = await assets.skyEnvironment();
	post.set({ bloom: { intensity: 0.25, threshold: 1 }, ao: { radius: 0.6 }, vignette: {} });
	const sun = scene.createDirectionalLight({ castShadows: true, shadow: { distance: 60 } });
	// A fill light in the horizon's color that grows at dusk, so the island keeps its mid-tones.
	const fill = scene.createAmbientLight();
	const camera = scene.createPerspectiveCamera({ fov: 40, far: 5000, position: [22, 8, 30] });
	camera.lookAt(...TARGET);
	scene.setActiveCamera(camera);
	// The pointer points at an upright plane through the lighthouse: left is morning, right evening.
	const view = interact(ctx, camera, { target: TARGET, planeZ: 0, bounds: BOUNDS });

	const box = geometry.box();
	const part = (material: Material, options: Partial<MeshOptions>) =>
		scene.createMesh({ mesh: box, material, castShadows: true, receiveShadows: true, ...options });
	const paint = (color: string, roughness = 0.6, flatShading = false) =>
		materials.standard({ color, roughness, flatShading });
	const rough = (color: string) => paint(color, 0.9, true);
	const glow = (color: string) => materials.standard({ color: '#202020', emissive: color });
	const [red, white] = [paint('#c23a2e'), paint('#f2efe8')];
	const [windows, lantern, needles] = [glow('#ffb35c'), glow('#ffc66b'), paint('#2c5532')];

	// A calm sea that mirrors the sky's light, and a headland of rock and grass, with boulders.
	const sea = materials.standard({ color: '#134456', roughness: 0.3, doubleSided: true });
	const plane = geometry.plane({ width: 1e4, height: 1e4 });
	part(sea, { mesh: plane, rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], castShadows: false });
	const cliff = { radiusTop: 7, radiusBottom: 9, height: 4, radialSegments: 11 };
	part(rough('#958572'), { mesh: geometry.cylinder(cliff), position: [0, 1, 0] });
	const cap = geometry.cylinder({ ...cliff, radiusBottom: 7, height: 0.4 });
	part(rough('#5f8a3a'), { mesh: cap, position: [0, 3.2, 0] });
	math.seed(7);
	const rock = geometry.sphere({ radius: 1, widthSegments: 7, heightSegments: 5 });
	const boulder = rough('#7a6e62');
	for (let k = 0; k < 28; k++) {
		const a = (k / 28) * Math.PI * 2 + math.randFloat(-0.2, 0.2);
		const [r, size] = [math.randFloat(8.6, 9.6), math.randFloat(0.4, 1.1)];
		const position = [Math.cos(a) * r, 0.2, Math.sin(a) * r] as const;
		part(boulder, { mesh: rock, position, scale: [size * 1.4, size * 0.8, size] });
	}

	// The lighthouse: five tapering bands of red and white, a gallery, the lantern and its cap.
	const at = (y: number) => [TOWER[0], y, TOWER[2]] as const;
	for (let b = 0; b < 5; b++) {
		const [top, bottom] = [0.79 - 0.06 * b, 0.85 - 0.06 * b];
		const band = geometry.cylinder({ radiusTop: top, radiusBottom: bottom, height: 1.1 });
		part(b % 2 ? white : red, { mesh: band, position: at(3.95 + b * 1.1) });
	}
	const drum = geometry.cylinder();
	part(paint('#2b2b2e'), { mesh: drum, position: at(9), scale: [0.8, 0.12, 0.8] });
	part(lantern, { mesh: drum, position: at(9.36), scale: [0.38, 0.6, 0.38] });
	part(red, { mesh: geometry.cone({ radius: 0.5, height: 0.5 }), position: at(9.91) });
	const beams = scene.createGroup({ position: at(9.36), dynamic: true });
	const light = materials.shader({ wgsl: beam, uniforms: { strength: 0 }, ...ADDED });
	const cone = geometry.cone({ radius: 1.8, height: 16, openEnded: true, radialSegments: 24 });
	for (const side of [-1, 1]) {
		const rotation = [0, 0, side * Math.SQRT1_2, Math.SQRT1_2] as const;
		const position = [side * 8, 0, 0] as const;
		part(light, { mesh: cone, parent: beams, position, rotation, castShadows: false });
	}

	// Two cottages with pitched roofs and windows that light at dusk, and a few pines.
	for (let h = 0; h < HOUSES.length; h += 3) {
		const parent = scene.createGroup({ position: [HOUSES[h], 3.4, HOUSES[h + 1]] });
		parent.setRotationEuler(0, HOUSES[h + 2], 0);
		part(white, { parent, position: [0, 0.55, 0], scale: [1.8, 1.1, 1.3] });
		for (const side of [-1, 1]) {
			const rotation = [side * 0.32, 0, 0, 0.947] as const;
			part(red, { parent, position: [0, 1.38, side * 0.38], rotation, scale: [2, 0.08, 0.95] });
			part(windows, { parent, position: [side * 0.5, 0.6, 0.66], scale: [0.32, 0.36, 0.04] });
		}
	}
	const low = geometry.cone({ radius: 0.75, height: 1.8 });
	const high = geometry.cone({ radius: 0.5 });
	for (let p = 0; p < PINES.length; p += 2) {
		part(needles, { mesh: low, position: [PINES[p], 4.3, PINES[p + 1]] });
		part(needles, { mesh: high, position: [PINES[p], 5.1, PINES[p + 1]], scale: [1, 1.25, 1] });
	}

	let shown = -1;
	return {
		onUpdate(dt) {
			view.update(dt);
			// The pointer picks an hour from 4:00 at the left to 20:00 at the right. Lamps light at dusk.
			const hour = math.lerp(clock(time.now), 12 + view.point[0] * 0.8, view.steering);
			const night = hour > 12 ? math.smoothstep(hour, 17.2, 19) : 1 - math.smoothstep(hour, 5.2, 7);
			lantern.set({ emissiveIntensity: 0.3 + 12 * night });
			windows.set({ emissiveIntensity: 6 * night });
			light.set({ strength: 0.35 * night });
			beams.setRotationEuler(0, time.now * 0.9, 0);
			const step = Math.round(hour / STEP);
			if (step !== shown) {
				shown = step;
				const day = timeOfDay(step * STEP, { heading: HEADING });
				Object.assign(sky, day.sky);
				sun.setDirection(...day.light.direction);
				sun.setColor(day.light.color);
				sun.setIntensity(day.light.intensity);
				fill.setColor(day.fog.color);
				fill.setIntensity(day.skyIntensity + Math.min(0.75, 1.5 * (day.exposure - 1)));
				scene.setEnvironment(environment, { intensity: day.skyIntensity });
				scene.setFog({ ...day.fog, density: 0.003, height: 0, heightFalloff: 0.1 });
				post.set({ exposure: day.exposure });
				scene.setBackground({ sky }, { intensity: day.skyIntensity });
			}
		},
	};
});
