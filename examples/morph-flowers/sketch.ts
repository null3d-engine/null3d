// Morph targets: a bed of tulips that open in a wave in the morning sun. Each tulip's head is a
// mesh made with geometry.fromArrays: six cupped petals, closed into a bud. One morph target,
// "Open", holds how far each vertex moves, how its normal turns, and how its color changes as the
// petals open and bend out, from a green-tinted bud to the full color. Every tulip of a color
// shares one mesh, and each has its own weight, which setMorphWeight sets in each frame.
import { defineSketch, type MeshOptions, math, timeOfDay, type Vec3, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Petals per head, the grid of each petal, and a petal's length and width, in metres. */
const [PETALS, ACROSS, ALONG, LENGTH, WIDTH] = [6, 6, 10, 0.085, 0.06];
/** The petals' colors as linear values, three at a time: red, yellow, white, purple and orange. */
const HUES = [0.8, 0.03, 0.06, 0.95, 0.65, 0.04, 0.9, 0.88, 0.82, 0.45, 0.05, 0.6, 1, 0.25, 0.02];
/** The bud's green, and the tulips along and across the bed. */
const BUD = [0.1, 0.3, 0.05];
const [ROWS, COLUMNS] = [6, 12];

/** The point of petal `p` at (u, v), with u across it from -1 to 1 and v from its base to its tip. */
function petal(out: Vec3, p: number, u: number, v: number, open: number): Vec3 {
	// The petal's spine leans out more as it rises, and far more when the tulip opens.
	let [r, y] = [0.006 - (p % 2) * 0.002, 0];
	for (let i = 0; i < 8; i++) {
		const lean = math.lerp(-0.3, 0.15, open) + math.lerp(0.6, 1.1, open) * ((i + 0.5) / 8) * v;
		r += (Math.sin(lean) * LENGTH * v) / 8;
		y += (Math.cos(lean) * LENGTH * v) / 8;
	}
	// The petal is widest past its middle, and cupped: its edges curl in toward the axis.
	const width = WIDTH * Math.sin(Math.PI * (0.1 + 0.82 * v)) ** 0.7;
	r += (1 - u * u) * width * math.lerp(0.25, 0.1, open);
	const [x, phi] = [u * width * 0.5, (p / PETALS) * 2 * Math.PI];
	return vec3.set(
		out,
		r * Math.cos(phi) - x * Math.sin(phi),
		y,
		r * Math.sin(phi) + x * Math.cos(phi),
	);
}

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	const day = timeOfDay(8.6, { heading: -2.2 });
	const sky = { ...day.sky, cloudCoverage: 0.3 };
	scene.setBackground({ sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.03, sunGlow: day.fog.sunGlow });
	post.set({
		exposure: day.exposure,
		bloom: { threshold: 1.2 },
		ao: { radius: 0.1 },
		vignette: {},
	});
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 6 } });
	const camera = scene.createPerspectiveCamera({ fov: 35, near: 0.05, far: 5000 });
	camera.setPosition(0.5, 1.15, 1.9);
	camera.lookAt(0, 0.2, -0.05);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0.2, -0.05], groundY: 0.35 });

	// The head: each vertex in the bud and in the open flower. Each normal comes from the petal's
	// slopes across and along, worked out from nearby points.
	const count = PETALS * (ACROSS + 1) * (ALONG + 1);
	const [closed, opened, normals, turned] = [0, 1, 2, 3].map(() => new Float32Array(count * 3));
	const [a, b, c, n] = [vec3.create(), vec3.create(), vec3.create(), vec3.create()];
	const indices: number[] = [];
	for (let p = 0, k = 0; p < PETALS; p++)
		for (let j = 0; j <= ALONG; j++)
			for (let i = 0; i <= ACROSS; i++, k++) {
				const [u, v] = [(2 * i) / ACROSS - 1, j / ALONG];
				const [up, down] = [Math.min(1, v + 0.01), Math.max(0, v - 0.01)];
				for (const pose of [0, 1]) {
					(pose ? opened : closed).set(petal(a, p, u, v, pose), k * 3);
					vec3.sub(a, petal(a, p, u + 0.01, v, pose), petal(b, p, u - 0.01, v, pose));
					vec3.sub(b, petal(b, p, u, up, pose), petal(c, p, u, down, pose));
					(pose ? turned : normals).set(vec3.normalize(n, vec3.cross(n, b, a)), k * 3);
				}
				if (i < ACROSS && j < ALONG)
					indices.push(k, k + 1, k + ACROSS + 1, k + 1, k + ACROSS + 2, k + ACROSS + 1);
			}
	const moved = opened.map((value, i) => value - closed[i]);
	const bent = turned.map((value, i) => value - normals[i]);
	// One mesh per color: the bud is green at the base and tinted toward its color at the tip.
	const heads = [0, 3, 6, 9, 12].map((hue) => {
		const tip = (i: number) => closed[i - (i % 3) + 1] / LENGTH;
		const colors = closed.map((_, i) =>
			math.lerp(BUD[i % 3], HUES[hue + (i % 3)], 0.3 + 0.4 * tip(i)),
		);
		const full = colors.map((value, i) => HUES[hue + (i % 3)] * (0.75 + 0.25 * tip(i)) - value);
		const morphTargets = { positions: [moved], normals: [bent], colors: [full], names: ['Open'] };
		return geometry.fromArrays({ positions: closed, normals, colors, indices, morphTargets });
	});

	// The raised bed: dark soil inside a frame of planks, on a lawn.
	const box = geometry.box();
	const part = (options: Partial<MeshOptions> & Pick<MeshOptions, 'material'>) =>
		scene.createMesh({ mesh: box, castShadows: true, receiveShadows: true, ...options });
	const paint = (color: string, roughness = 0.8) => materials.standard({ color, roughness });
	const lawn = materials.standard({ color: '#4c7a2e', roughness: 1, doubleSided: true });
	const flat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
	part({ mesh: geometry.plane({ width: 1e4, height: 1e4 }), material: lawn, rotation: flat });
	part({ material: paint('#3a2618', 1), position: [0, 0.06, 0], scale: [2.6, 0.12, 1.4] });
	const plank = paint('#8a6a48');
	for (const side of [-1, 1]) {
		part({ material: plank, position: [0, 0.09, side * 0.72], scale: [2.8, 0.18, 0.08] });
		part({ material: plank, position: [side * 1.36, 0.09, 0], scale: [0.08, 0.18, 1.36] });
	}

	// The tulips: a stem, two leaves and a head, in a group that sways in the breeze.
	const petals = materials.standard({ vertexColors: true, roughness: 0.55, doubleSided: true });
	const green = paint('#3f7a2a', 0.6);
	const leaf = geometry.sphere({ radius: 1, widthSegments: 12, heightSegments: 8 });
	math.seed(9);
	const tulips = Array.from({ length: ROWS * COLUMNS }, (_, t) => {
		const x = ((t % COLUMNS) - (COLUMNS - 1) / 2) * 0.2 + math.randFloat(-0.04, 0.04);
		const z = (Math.floor(t / COLUMNS) - (ROWS - 1) / 2) * 0.2 + math.randFloat(-0.04, 0.04);
		const height = math.randFloat(0.2, 0.3);
		const parent = scene.createGroup({ position: [x, 0.12, z], dynamic: true });
		part({ material: green, parent, position: [0, height / 2, 0], scale: [0.008, height, 0.008] });
		for (const side of [-1, 1]) {
			const turn = side * 0.35 + math.randFloat(0, 3);
			const rotation = [0, Math.sin(turn / 2), side * 0.15, Math.cos(turn / 2)] as const;
			const blade = { mesh: leaf, material: green, parent, rotation };
			part({ ...blade, position: [side * 0.015, 0.05, 0], scale: [0.008, 0.07, 0.022] });
		}
		const head = part({ mesh: heads[t % 5], material: petals, parent, position: [0, height, 0] });
		return { parent, head, x, z };
	});

	return {
		onUpdate(dt) {
			view.update(dt);
			const { point, steering } = view;
			const now = time.now;
			for (let i = 0; i < tulips.length; i++) {
				const { parent, head, x, z } = tulips[i];
				// A wave of opening crosses the bed, and the tulips near the pointer open too.
				const wave = math.smoothstep(Math.sin(now * 0.5 - x * 1.6 - z * 0.8), -0.4, 0.5);
				const near = 1 - math.smoothstep(Math.hypot(point[0] - x, point[2] - z), 0.15, 0.5);
				head.setMorphWeight(0, Math.max(wave, near * steering));
				const sway = 0.04 * Math.sin(now * 1.3 + x * 3);
				parent.setRotationEuler(sway, 0, 0.04 * Math.sin(now * 1.1 + z * 4));
			}
		},
	};
});
