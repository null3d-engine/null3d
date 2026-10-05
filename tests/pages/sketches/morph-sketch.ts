// The morph target scene (bench/scenes/morph.ts), which the parity test also draws with three.js's
// morphTargetInfluences. Each sphere is an object of one mesh with three targets, at its own
// weights. ?shadows stands the spheres on a ground under a sun, so the shadow passes must morph
// them too. ?capped draws the weights that WebGL2 keeps at a cap of two targets per object, which
// the cap's image test compares with. ?names sets the weights by the targets' names. ?closeup
// looks at the third sphere from close by, where a step of the deltas' half floats would show.
// ?late adds the spheres during play, on the page's 'spheres' message, and posts 'added' once
// their pipelines are built: the first morphed mesh needs its shader file. ?tone=none
// turns off the engine's default of AgX, as the parity test asks: the three.js twin draws with no
// tone mapping, three.js's default.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	cappedWeights,
	MORPH_CAMERA,
	MORPH_CLOSEUP_CAMERA,
	morphMesh,
	SPHERES,
	SUN,
	TARGET_NAMES,
} from '../../../bench/scenes/morph';

const params = new URL(import.meta.url).searchParams;
const SHADOWS = params.has('shadows');
const CAPPED = params.has('capped');
const NAMES = params.has('names');
const LATE = params.has('late');

export default defineSketch(({ scene, materials, geometry, post, page }) => {
	if (params.get('tone') === 'none') post.set({ toneMapping: 'none' });
	scene.setBackground(BACKGROUND);
	const camera = params.has('closeup') ? MORPH_CLOSEUP_CAMERA : MORPH_CAMERA;
	const { fov, position, target, near, far } = camera;
	scene.setActiveCamera(scene.createPerspectiveCamera({ fov, position, target, near, far }));
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
		castShadows: SHADOWS,
		shadow: { cascades: 2, mapSize: 2048, distance: 15 },
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });
	if (SHADOWS)
		scene.createMesh({
			mesh: geometry.box({ width: 8, height: 0.1, depth: 4 }),
			material: materials.standard({ color: '#8a8f99' }),
			position: [0, -0.85, 0],
			receiveShadows: true,
		});

	const { positions, normals, indices, positionDeltas, normalDeltas } = morphMesh();
	const mesh = geometry.fromArrays({
		positions,
		normals,
		indices,
		morphTargets: { positions: positionDeltas, normals: normalDeltas, names: [...TARGET_NAMES] },
	});
	const addSpheres = () => {
		for (const sphere of SPHERES) {
			const object = scene.createMesh({
				mesh,
				material: materials.standard({ color: sphere.color }),
				position: [...sphere.position],
				castShadows: SHADOWS,
				receiveShadows: SHADOWS,
			});
			const weights = CAPPED ? cappedWeights(sphere.weights, 2) : sphere.weights;
			weights.forEach((weight, k) => {
				object.setMorphWeight(NAMES ? (TARGET_NAMES[k] as string) : k, weight);
			});
		}
	};
	if (!LATE) {
		addSpheres();
		return;
	}
	page.onMessage((message) => {
		if (message !== 'spheres') return;
		addSpheres();
		void scene.warmUp().then(() => page.post('added', null));
	});
});
