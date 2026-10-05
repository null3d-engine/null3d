// A scene in real units, for the real-units image tests: a sun of 100,000 lux and a lamp of
// 1,000,000 lumens, seen by a camera at EV100 15 with bloom. A smooth metal floor mirrors the sun
// toward the camera, a rough white box stands in the sun, a rough sphere stands under the lamp, and
// a small sphere gives off 1,000,000 nits. The engine multiplies the exposure into each light, so
// the scene color holds values near 1 and the highlight stays white on every GPU; with the exposure
// at the end, the highlight passed the largest 16-bit float and lost its glow.
//
// With ?exposure the sketch sets the same picture in three.js's units: the lamp in candela, and
// the camera's exposure through `exposure` in place of `ev100`. tests/image/real-units.spec.ts
// checks the pixels that the fault changes.
import { defineSketch } from '@null3d/engine';

const THREE_UNITS = new URL(import.meta.url).searchParams.has('exposure');

/** The camera's exposure value at ISO 100: a sunny day. */
const EV100 = 15;
/** The sun's illuminance in lux. */
const SUN_LUX = 100_000;
/** The lamp's output in lumens. */
const LAMP_LUMENS = 1_000_000;
/** The small sphere's luminance in nits. */
const GLOW_NITS = 1_000_000;
/** The luminance from which a pixel glows, in nits: about white at EV100 15. */
const BLOOM_THRESHOLD = 40_000;

export default defineSketch(({ scene, materials, geometry, post }) => {
	const bloom = { intensity: 0.02, threshold: BLOOM_THRESHOLD, blend: 'add' as const };
	if (THREE_UNITS) post.set({ exposure: 1 / (1.2 * 2 ** EV100), bloom });
	else post.set({ ev100: EV100, bloom });
	scene.setBackground('#000000');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 100,
		position: [0, 2, 4],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: [0, -1, 2],
		intensity: SUN_LUX,
		...(THREE_UNITS ? {} : { intensityUnit: 'lux' as const }),
	});
	scene.createPointLight({
		position: [-0.9, 1.2, 1],
		range: 10,
		...(THREE_UNITS
			? { intensity: LAMP_LUMENS / (4 * Math.PI) }
			: { intensity: LAMP_LUMENS, intensityUnit: 'lumen' as const }),
	});
	scene.createMesh({
		mesh: geometry.box({ width: 20, height: 0.2, depth: 20 }),
		material: materials.standard({ color: '#ffffff', roughness: 0, metalness: 1 }),
		position: [0, -0.1, 0],
	});
	const rough = materials.standard({ color: '#ffffff', roughness: 1, metalness: 0 });
	scene.createMesh({
		mesh: geometry.box({ width: 0.6, height: 0.6, depth: 0.6 }),
		material: rough,
		position: [1.2, 0.3, 0.6],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.3, widthSegments: 24, heightSegments: 12 }),
		material: rough,
		position: [-0.9, 0.3, 1],
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.05, widthSegments: 16, heightSegments: 8 }),
		material: materials.standard({
			color: '#000000',
			emissive: '#ffffff',
			emissiveIntensity: GLOW_NITS,
		}),
		position: [-1.2, 1, 0],
	});
});
