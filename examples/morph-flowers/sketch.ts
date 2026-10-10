// Morph targets: a bed of tulips that open in a wave in the morning sun. Each head is a mesh made
// with geometry.fromArrays: six cupped petals, closed into a bud. One morph target, "Open", holds
// how each vertex moves, how its normal turns and how its color changes from a green-tinted bud to
// the full color. The tulips of a color share one mesh, and setMorphWeight sets each one's weight.
import { defineSketch, type MeshOptions, math, quat, timeOfDay, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Petals per head, the grid of each petal, and a petal's length and width, in metres. */
const [PETALS, ACROSS, ALONG, LENGTH, WIDTH] = [6, 6, 10, 0.085, 0.06];
/** The petals' colors as linear values, three at a time: red, yellow, white, purple and orange. */
const HUES = [0.8, 0.03, 0.06, 0.95, 0.65, 0.04, 0.9, 0.88, 0.82, 0.45, 0.05, 0.6, 1, 0.25, 0.02];
/** The bud's green, and the tulips along and across the bed. */
const [BUD, ROWS, COLUMNS] = [[0.1, 0.3, 0.05], 6, 12] as const;

/** The point of petal `p` at (u, v), with u across it from -1 to 1 and v from its base to its tip. */
function petal(out: number[], p: number, u: number, v: number, open: number): number[] {
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
	const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
	return vec3.set(out, r * cos - x * sin, y, r * sin + x * cos);
}

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	const day = timeOfDay(9, { heading: -2.5 });
	const sky = { ...day.sky, cloudCoverage: 0.35 };
	scene.setBackground({ sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.01, sunGlow: day.fog.sunGlow });
	const exposure = day.exposure * 1.3;
	post.set({ exposure, bloom: { threshold: 1.2 }, ao: { radius: 0.1 }, vignette: {} });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 6 } });
	const lens = { fov: 35, near: 0.05, far: 5000, position: [0.55, 0.8, 2.05] } as const;
	const camera = scene.createPerspectiveCamera(lens);
	camera.lookAt(0, 0.3, -0.2);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0.3, -0.2], groundY: 0.35 });

	// The head in the bud and in the open flower, with normals from each petal's nearby points.
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
	const [moved, bent] = [opened.map((v, i) => v - closed[i]), turned.map((v, i) => v - normals[i])];
	// One mesh per color: the bud is green at the base and tinted toward its color at the tip.
	const heads = [0, 3, 6, 9, 12].map((hue) => {
		const tip = (i: number) => closed[i - (i % 3) + 1] / LENGTH;
		const own = (i: number) => HUES[hue + (i % 3)];
		const colors = closed.map((_, i) => math.lerp(BUD[i % 3], own(i), 0.3 + 0.4 * tip(i)));
		const full = colors.map((value, i) => own(i) * (0.75 + 0.25 * tip(i)) - value);
		const morphTargets = { positions: [moved], normals: [bent], colors: [full], names: ['Open'] };
		return geometry.fromArrays({ positions: closed, normals, colors, indices, morphTargets });
	});

	// The raised bed: soil of crumbs, clods and pebbles made in code, in planks, on a lawn.
	const data = new Uint8Array(64 * 64 * 4).fill(255);
	for (let i = 0, w = Math.PI / 32; i < 64 * 64; i++) {
		const [x, y, r] = [i % 64, i >> 6, Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1)];
		const clod = (0.6 + 0.5 * r) * (0.85 + 0.2 * Math.sin(6 * w * x) * Math.sin(7 * w * y));
		data.set(r > 0.97 ? [140, 128, 112] : [92 * clod, 62 * clod, 42 * clod], i * 4);
	}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	const earth = textures.fromData({ width: 64, height: 64, data, ...look });
	const box = geometry.box();
	const part = (options: Partial<MeshOptions> & Pick<MeshOptions, 'material'>) =>
		scene.createMesh({ mesh: box, castShadows: true, receiveShadows: true, ...options });
	const lawn = materials.standard({ color: '#4c7a2e', roughness: 1, doubleSided: true });
	const flat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
	part({ mesh: geometry.plane({ width: 1e4, height: 1e4 }), material: lawn, rotation: flat });
	const soil = materials.standard({ map: earth, roughness: 1, uvTransform: { repeat: [13, 7] } });
	part({ material: soil, position: [0, 0.06, 0], scale: [2.6, 0.12, 1.4] });
	const plank = materials.standard({ color: '#8a6a48', roughness: 0.8 });
	for (const side of [-1, 1]) {
		part({ material: plank, position: [0, 0.09, side * 0.72], scale: [2.8, 0.18, 0.08] });
		part({ material: plank, position: [side * 1.36, 0.09, 0], scale: [0.08, 0.18, 1.36] });
	}

	// The tulips: a stem, two leaves and a head, in a group that sways in the breeze.
	const petals = materials.standard({ vertexColors: true, roughness: 0.55, doubleSided: true });
	const green = materials.standard({ color: '#3f7a2a', roughness: 0.6 });
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
	// A clipped hedge behind the bed: a dark core under leaves at random turns, in three greens.
	const greens = ['#1d3816', '#33612a', '#4f8034'].map((color) => materials.standard({ color }));
	part({ material: greens[0], position: [0, 0.2, -1.45], scale: [6, 0.4, 0.4] });
	const sprig = geometry.sphere({ widthSegments: 6, heightSegments: 4 });
	const leaves = greens.map((material) => scene.createInstances(sprig, 800, { material }));
	for (let k = 0, r = math.randFloat; k < 2400; k++) {
		const [x, y, z] = [r(-3, 3), r(0.01, 0.41), k % 4 ? -1.24 : r(-1.65, -1.25)];
		const [batch, row] = [leaves[k % 3], Math.floor(k / 3)];
		batch.positions.set([x, z < -1.24 ? 0.41 : y, z], row * 3);
		batch.scales.set([0.025, 0.004, 0.015], row * 3);
		batch.rotations.set(quat.fromEuler([0, 0, 0, 1], r(0, 6), r(0, 6), r(0, 6)), row * 4);
	}

	return {
		onUpdate(dt) {
			view.update(dt);
			const [{ point, steering }, now] = [view, time.now];
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
