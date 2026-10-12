// A dense forest for the page that measures what levels of detail save (tests/pages/lod-cost.ts):
// ?count= pines, 40,000 by default, each with four levels (examples/lib/pines.ts), over hills
// under the sun's shadows, seen from a fixed place above the canopy. The page turns the levels off
// and on with messages; off draws every tree's base mesh. With ?shadows=off the sun casts none.
import { defineSketch } from '@null3d/engine';
import { ground, hills, pineWithLevels, plantPines } from '../../../examples/lib/pines';

const params = new URL(import.meta.url).searchParams;
const count = Number(params.get('count') ?? '40000');
const shadows = params.get('shadows') !== 'off';
const SIDE = 1200;

export default defineSketch(({ scene, geometry, materials, quality, page, time }) => {
	scene.setBackground('#9aa8b8');
	const camera = scene.createPerspectiveCamera({ fov: 50, near: 0.5, far: 3000 });
	camera.setPosition(0, ground(0, 0) + 26, 0);
	camera.lookAt(260, 8, 150);
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: [-0.5, -0.6, -0.4],
		color: '#fff1dc',
		intensity: 2.5,
		castShadows: shadows,
		shadow: { distance: 160 },
	});
	scene.createAmbientLight({ color: '#b8c8ff', intensity: 0.5 });
	const lit = (roughness: number) =>
		materials.standard({ color: '#ffffff', roughness, vertexColors: true });
	scene.createMesh({
		mesh: hills(geometry, SIDE * 1.6),
		material: lit(0.95),
		receiveShadows: true,
	});
	const forest = scene.createInstances(pineWithLevels(geometry), count, {
		material: lit(0.85),
		castShadows: shadows,
		receiveShadows: shadows,
	});
	plantPines(forest, count, SIDE);
	const threshold = quality.settings.lodThreshold;
	page.onMessage((message) => {
		if (message !== 'levels' && message !== 'levels-off') return;
		quality.set({ lodThreshold: message === 'levels' ? threshold : 0 });
		const frame = time.frame;
		void scene.warmUp().then(() => page.post('settled', { frames: time.frame - frame }));
	});
});
