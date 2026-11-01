// Screen-space bounce light in a room open at the front: a red wall at the left and a green wall at
// the right over a neutral floor, lit by a main light from the front top and a little ambient
// light, so the walls throw light onto the floor. The light draws on ambient occlusion's grid at
// half the render size, so the cost follows the render scale.
//
// The effect cost page passes ?fixed and ?scale=: the scene then draws at that render scale alone,
// with the governor off, and starts with the bounce light off. On the page's 'bounce' message it
// turns the light on with ?rays= rays each way, 8 by default, waits until its pipelines are built,
// and posts 'settled'. The 'bounce-off' message turns it off again.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const FIXED = params.has('fixed');
const SCALE = Number(params.get('scale') ?? 1);
const RAYS = Number(params.get('rays') ?? 8);

export default defineSketch(({ scene, materials, geometry, quality, page }) => {
	// The preset's own count, unless the page asks for another, so a case times the light that the
	// preset draws.
	const preset = quality.settings.bounceRays;
	const rays = params.has('rays') ? (RAYS === 4 ? 4 : RAYS === 16 ? 16 : 8) : preset;
	quality.set({ governor: false, aoScale: 0.5, bounceRays: 0 });
	if (FIXED) quality.set({ minRenderScale: SCALE, maxRenderScale: SCALE });
	page.onMessage((message) => {
		if (message === 'bounce-off') quality.set({ bounceRays: 0 });
		if (message !== 'bounce') return;
		quality.set({ bounceRays: rays });
		void scene.warmUp().then(() => page.post('settled', null));
	});
	scene.setBackground('#22262e');
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 55, position: [0, 2.2, 6], target: [0, 1, -0.5] }),
	);
	scene.createDirectionalLight({
		direction: [0.3, -0.7, -0.65],
		color: '#fff4e2',
		intensity: 3,
	});
	scene.createAmbientLight({ color: '#c8d8ff', intensity: 0.2 });
	const surface = (
		color: string,
		size: [number, number, number],
		position: [number, number, number],
	) =>
		scene.createMesh({
			mesh: geometry.box({ width: size[0], height: size[1], depth: size[2] }),
			material: materials.standard({ color, roughness: 0.9 }),
			position,
		});
	surface('#cccccc', [6, 0.2, 6], [0, -0.1, 0]);
	surface('#cccccc', [6, 3, 0.2], [0, 1.5, -3.1]);
	surface('#d9160e', [0.2, 3, 6], [-3.1, 1.5, 0]);
	surface('#14b81a', [0.2, 3, 6], [3.1, 1.5, 0]);
});
