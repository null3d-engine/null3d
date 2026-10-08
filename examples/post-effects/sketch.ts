// Post effects: crates stand in the corner of a dark room under neon lights, and the camera sways in
// front of them. Bloom spreads the neon's light past its edges, ambient occlusion darkens the corner
// and the ground under the crates, an outline marks one crate, and a vignette darkens the edges. A
// custom effect splits red from blue toward the edges, as a cheap lens does. Every 3 seconds the
// color grading table changes: none, then a warm table, then a cool one, each from a .cube file.
import { defineSketch } from '@null3d/engine';

/** The address of a sample file on the dev server, as `sampleUrl` in tools/lib/samples.ts gives it. */
const sampleUrl = (path: string) => `/samples/${path}`;
/** Seconds that each color grading table shows. */
const STEP = 3;

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

export default defineSketch(async ({ scene, assets, geometry, materials, post, quality, time }) => {
	const [warm, cool] = await Promise.all([
		assets.loadLut(sampleUrl('sources/luts/warm.cube')),
		assets.loadLut(sampleUrl('sources/luts/cool.cube')),
	]);
	// Ambient occlusion draws on every preset, at half the canvas's resolution.
	quality.set({ aoScale: 0.5 });
	post.set({
		bloom: { intensity: 0.25, threshold: 1 },
		ao: { radius: 0.6, intensity: 1 },
		outline: { color: '#ffd166', width: 2 },
		vignette: { intensity: 0.8, size: 1.1 },
	});
	post.addEffect({ wgsl: fringe, uniforms: { shift: 6 } });

	scene.setBackground('#07080c');
	const camera = scene.createPerspectiveCamera({ fov: 45 });
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ color: '#aab4e0', intensity: 1.2 });
	scene.createPointLight({ position: [0.6, 2.2, -1], color: '#ff4fa3', intensity: 5, range: 8 });
	scene.createPointLight({ position: [-1.2, 1.8, 1.2], color: '#36d6ff', intensity: 4, range: 8 });

	const box = geometry.box();
	const concrete = materials.standard({ color: '#8a8b92', roughness: 0.9 });
	scene.createMesh({ mesh: box, material: concrete, position: [0, -0.05, 0], scale: [8, 0.1, 8] });
	scene.createMesh({ mesh: box, material: concrete, position: [0, 2, -2.05], scale: [8, 4, 0.1] });
	scene.createMesh({ mesh: box, material: concrete, position: [-2.05, 2, 0], scale: [0.1, 4, 8] });

	const wood = materials.standard({ color: '#c4c8d4', roughness: 0.8 });
	const crates = [
		{ position: [-1.4, 0.5, -1.4], size: 1 },
		{ position: [-0.3, 0.35, -1.45], size: 0.7 },
		{ position: [-1.45, 0.3, -0.3], size: 0.6 },
		{ position: [-1.35, 1.35, -1.35], size: 0.7 },
	] as const;
	const meshes = crates.map(({ position, size }) =>
		scene.createMesh({ mesh: box, material: wood, position, scale: [size, size, size] }),
	);
	meshes[1]?.setOutlined(true);

	// Neon: a ring on the back wall and a tube on the side wall, bright enough to bloom.
	scene.createMesh({
		mesh: geometry.torus({ radius: 0.55, tube: 0.05, radialSegments: 12, tubularSegments: 64 }),
		material: materials.standard({ color: '#000000', emissive: '#ff4fa3', emissiveIntensity: 6 }),
		position: [0.6, 2.4, -1.95],
	});
	scene.createMesh({
		mesh: geometry.cylinder({ radiusTop: 0.05, radiusBottom: 0.05, height: 2.4 }),
		material: materials.standard({ color: '#000000', emissive: '#36d6ff', emissiveIntensity: 5 }),
		position: [-1.95, 2, 1.2],
	});

	const tables = [false, warm, cool] as const;
	const grading = { lut: tables[0] as (typeof tables)[number], lutIntensity: 1 };
	let shown = 0;
	return {
		onUpdate() {
			// The camera sways along an arc in front of the corner.
			const angle = 0.75 + 0.25 * Math.sin(time.now * 0.4);
			camera.setPosition(Math.sin(angle) * 6, 2.4, Math.cos(angle) * 6);
			camera.lookAt(-0.6, 0.8, -0.6);
			const next = Math.floor(time.now / STEP) % tables.length;
			if (next === shown) return;
			shown = next;
			grading.lut = tables[next] ?? false;
			post.set(grading);
		},
	};
});
