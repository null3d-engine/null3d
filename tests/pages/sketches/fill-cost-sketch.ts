// The floor of the light scenes (bench/scenes/lights.ts), lit by ?count= directional lights, 4 by
// default, so that each run measures one more light than the one before. The lights start hidden.
// On the page's 'fills' message every light shows, and the sketch posts 'settled' a frame later;
// 'fills-off' leaves out the last one, so the two measured sides differ by one fill light. The
// first light holds the main slot and the others fill it, with no shadows. ?scale= fixes the
// render scale, with the governor off, for timing.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import {
	LIGHTS_AMBIENT,
	LIGHTS_BACKGROUND,
	LIGHTS_CAMERA,
	LIGHTS_FLOOR,
	LIGHTS_SHAPES,
	LIGHTS_SPHERE,
} from '../../../bench/scenes/lights';

const params = new URL(import.meta.url).searchParams;
const COUNT = Number(params.get('count') ?? '4');
const SCALE = params.get('scale');

export default defineSketch(({ scene, materials, geometry, quality, time, page }) => {
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({ minRenderScale: scale, maxRenderScale: scale, governor: false });
	}
	scene.setBackground(LIGHTS_BACKGROUND);
	scene.setActiveCamera(scene.createPerspectiveCamera(LIGHTS_CAMERA));
	scene.createAmbientLight(LIGHTS_AMBIENT);
	const floor = materials.standard({ color: LIGHTS_FLOOR.color, roughness: 0.4 });
	const plane = geometry.plane({ width: LIGHTS_FLOOR.size, height: LIGHTS_FLOOR.size });
	scene.createMesh({ mesh: plane, material: floor, rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] });
	const sphere = geometry.sphere({ radius: 1, ...LIGHTS_SPHERE });
	const box = geometry.box();
	for (const { shape, position, size, color, roughness, metalness } of LIGHTS_SHAPES) {
		const material = materials.standard({ color, roughness, metalness });
		const mesh = shape === 'sphere' ? sphere : box;
		scene.createMesh({ mesh, material, position: [...position], scale: [size, size, size] });
	}
	const colors = ['#ffffff', '#86b8ff', '#ffdcb4', '#ff5fa8'];
	const lights = Array.from({ length: COUNT }, (_, k) => {
		const angle = (k / COUNT) * Math.PI * 2;
		return scene.createDirectionalLight({
			direction: [Math.cos(angle) * 0.6, -1, Math.sin(angle) * 0.6],
			color: colors[k % colors.length] as string,
			intensity: 1.2,
		});
	});
	for (const light of lights) light.setVisible(false);
	page.onMessage((message) => {
		if (message !== 'fills' && message !== 'fills-off') return;
		const shown = message === 'fills' ? COUNT : COUNT - 1;
		lights.forEach((light, k) => {
			light.setVisible(k < shown);
		});
		const frame = time.frame;
		if (message === 'fills')
			void scene.warmUp().then(() => page.post('settled', { frames: time.frame - frame }));
	});
});
