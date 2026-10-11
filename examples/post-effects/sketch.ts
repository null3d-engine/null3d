// Post effects: crates at the dead end of a neon alley at night, on wet ground, and the camera
// sways in front of them. Bloom spreads the neon past its edges, ambient occlusion darkens the
// corner, an outline marks one crate, depth of field focuses on that crate, and a vignette darkens
// the edges. A custom effect splits red from blue toward the edges, as a cheap lens does. Every 3
// seconds the grading table changes: none, warm, then cool, each made in code from a few numbers.
// The pointer moves the pink lamp, and the bloom, the shading and the shine of the puddles follow.
import { type Assets, defineSketch, type Vec3, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Seconds that each color grading table shows. */
const STEP = 3;

type Rgb = readonly [number, number, number];

/** A grade: contrast and saturation, then lift, gamma and gain per channel, as a colorist sets them. */
interface Look {
	contrast?: number;
	saturation?: number;
	lift?: Rgb;
	gamma?: Rgb;
	/** Gain per channel, which sets the white balance too. */
	gain: Rgb;
}

/** Warmer whites and lifted shadows. */
const WARM: Look = { lift: [0.02, 0.01, 0], gamma: [0.95, 1, 1.05], gain: [1.04, 1.01, 0.9] };
/** More contrast, less saturation and a blue cast. */
const COOL: Look = { contrast: 1.15, saturation: 0.85, gain: [0.94, 0.99, 1.06] };

/** A table of 33 texels a side that grades each color by `look`, red fastest as in a .cube file. */
function grade(assets: Assets, look: Look) {
	const { contrast = 1, saturation = 1, lift = [0, 0, 0], gamma = [1, 1, 1], gain } = look;
	const size = 33;
	const data = new Float32Array(size ** 3 * 3);
	const contrasted = (v: number) =>
		Math.min(Math.max((v / (size - 1) - 0.5) * contrast + 0.5, 0), 1);
	const channel = (value: number, luma: number, i: 0 | 1 | 2) =>
		lift[i] + Math.max(luma + (value - luma) * saturation, 0) ** gamma[i] * gain[i];
	let at = 0;
	for (let b = 0; b < size; b++)
		for (let g = 0; g < size; g++)
			for (let r = 0; r < size; r++) {
				const [red, green, blue] = [contrasted(r), contrasted(g), contrasted(b)];
				const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
				data[at++] = channel(red, luma, 0);
				data[at++] = channel(green, luma, 1);
				data[at++] = channel(blue, luma, 2);
			}
	return assets.lutFromData({ size, data });
}

// Moves red out and blue in, by up to `shift` pixels at the corners.
const fringe = /* wgsl */ `
struct Uniforms { shift: f32 }

fn effect(input: EffectInput) -> vec4f {
    let toward = (input.uv - vec2f(0.5)) * uniforms.shift / input.size;
    let red = effectColor(input.uv + toward).r;
    let blue = effectColor(input.uv - toward).b;
    return vec4f(red, input.color.g, blue, input.color.a);
}
`;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, quality, time } = ctx;
	const [warm, cool] = await Promise.all([grade(assets, WARM), grade(assets, COOL)]);
	// Ambient occlusion draws on every preset, at half the canvas's resolution.
	quality.set({ aoScale: 0.5 });
	post.set({
		bloom: { intensity: 0.3, threshold: 1 },
		ao: { radius: 0.6, intensity: 1 },
		outline: { color: '#ffd166', width: 2 },
		vignette: { intensity: 0.9, size: 1.1 },
		dof: { aperture: 1.4, focusPoint: [-0.3, 0.35, -1.45] },
	});
	post.addEffect({ wgsl: fringe, uniforms: { shift: 6 } });
	scene.setBackground('#05060a');
	scene.setFog({ color: '#0a0c14', density: 0.03 });
	const camera = scene.createPerspectiveCamera({ fov: 45 });
	scene.setActiveCamera(camera);
	// The pointer points at the lamp's height, inside the alley.
	const alley = [-1.7, 0, -1.7, 2.6, 4, 5] as const;
	const view = interact(ctx, camera, { target: [-0.6, 0.8, -0.6], groundY: 2.2, bounds: alley });
	scene.createAmbientLight({ color: '#5a68a8', intensity: 1 });
	const pink = [0.6, 2.2, -1] as const;
	const lamp = { range: 9, intensity: 14, dynamic: true };
	const pinkLamp = scene.createPointLight({ ...lamp, position: pink, color: '#ff4fa3' });
	const lampAt = vec3.create();
	scene.createPointLight({ ...lamp, position: [-1.2, 1.8, 1.2], color: '#36d6ff' });
	scene.createPointLight({ ...lamp, position: [2.4, 2.6, 2], color: '#ffa53a' });

	// Wet asphalt: smooth where a few crossed waves add up to a puddle, rougher elsewhere.
	const finish = new Uint8Array(64 * 64 * 4);
	for (let i = 0; i < 64 * 64; i++) {
		const [u, v] = [((i % 64) / 32) * Math.PI, ((i >> 6) / 32) * Math.PI];
		const wet = Math.sin(u * 2) + Math.sin(v * 3 + u) + Math.sin((u - v) * 2) > 0.5;
		finish.set([255, wet ? 76 : 140, 0, 255], i * 4);
	}
	const box = geometry.box();
	const wall = materials.standard({ color: '#857a72', roughness: 0.9 });
	const tiled = { width: 64, height: 64, data: finish, wrap: 'repeat', mipmaps: true } as const;
	const wet = materials.standard({
		color: '#34353a',
		metalnessRoughnessMap: textures.fromData(tiled),
		uvTransform: { repeat: [3, 6] },
	});
	const block = (material: typeof wall, position: Vec3, scale: Vec3) =>
		scene.createMesh({ mesh: box, material, position, scale });
	block(wet, [0.6, -0.05, 3], [5.4, 0.1, 10]);
	block(wall, [0.6, 2.5, -2.05], [5.2, 5, 0.1]);
	block(wall, [-2.05, 2.5, 3], [0.1, 5, 10]);
	block(wall, [3.25, 2.5, 3], [0.1, 5, 10]);

	const wood = materials.standard({ color: '#c4c8d4', roughness: 0.8 });
	block(wood, [-1.4, 0.5, -1.4], [1, 1, 1]);
	block(wood, [-0.3, 0.35, -1.45], [0.7, 0.7, 0.7]).setOutlined(true);
	block(wood, [-1.45, 0.3, -0.3], [0.6, 0.6, 0.6]);
	block(wood, [-1.35, 1.35, -1.35], [0.7, 0.7, 0.7]);

	// Neon, bright enough to bloom: a ring on the end wall, a tube on the left wall, a bar on the right.
	const neon = (emissive: string) =>
		materials.standard({ color: '#000000', emissive, emissiveIntensity: 6 });
	const ring = geometry.torus({ radius: 0.55, tube: 0.05, tubularSegments: 64 });
	scene.createMesh({ mesh: ring, material: neon('#ff4fa3'), position: [0.6, 2.4, -1.95] });
	block(neon('#36d6ff'), [-1.95, 2, 1.2], [0.08, 2.4, 0.08]);
	block(neon('#ffa53a'), [3.15, 2.6, 2], [0.08, 0.08, 1.6]);

	const tables = [false, warm, cool] as const;
	const grading = { lut: tables[0] as (typeof tables)[number], lutIntensity: 1 };
	let shown = 0;
	return {
		onUpdate(dt) {
			// The camera sways from side to side in the alley, in front of the corner.
			const angle = 0.2 + 0.2 * Math.sin(time.now * 0.4);
			if (!view.userCamera) {
				camera.setPosition(Math.sin(angle) * 6, 2.4, Math.cos(angle) * 6);
				camera.lookAt(-0.6, 0.8, -0.6);
			}
			view.update(dt);
			view.steer(vec3.copy(lampAt, pink));
			pinkLamp.setPosition(lampAt[0], lampAt[1], lampAt[2]);
			const next = Math.floor(time.now / STEP) % tables.length;
			if (next === shown) return;
			shown = next;
			grading.lut = tables[next];
			post.set(grading);
		},
	};
});
