// Light far brighter than a 16-bit float holds, for the HDR limit's image tests. A small emissive
// sphere gives off more than 65,504, the largest 16-bit float, and a smooth metal floor mirrors the
// sun toward the camera, where the highlight's center passes it too. Some GPUs store such a value
// as infinity, which the tone mapping turns into black, and bloom then spreads it. Both must draw
// white, and with ?bloom the sphere must glow, as tests/image/hdr-limit.spec.ts checks.
import { defineSketch } from '@null3d/engine';

const BLOOM = new URL(import.meta.url).searchParams.has('bloom');

/** The sphere's emissive intensity: a white emissive this bright passes the largest 16-bit float. */
const GLOW = 100_000;
/** The sun's intensity: the highlight's center reflects tens of thousands of times as much. */
const SUN = 30;

export default defineSketch(({ scene, materials, geometry, post }) => {
	if (BLOOM) post.set({ bloom: { intensity: 0.02, threshold: 1, blend: 'add' } });
	scene.setBackground('#000000');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 100,
		position: [0, 2, 4],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	if (!BLOOM)
		scene.createDirectionalLight({ direction: [0, -1, 2], color: '#ffffff', intensity: SUN });
	scene.createMesh({
		mesh: geometry.box({ width: 20, height: 0.2, depth: 20 }),
		material: materials.standard({ color: '#ffffff', roughness: 0, metalness: 1 }),
		position: [0, -0.1, 0],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.05, widthSegments: 16, heightSegments: 8 }),
		material: materials.standard({
			color: '#000000',
			emissive: '#ffffff',
			emissiveIntensity: GLOW,
		}),
		position: [-1.2, 1, 0],
	});
});
