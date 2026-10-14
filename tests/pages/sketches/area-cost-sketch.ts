// The floor of the light scenes (bench/scenes/lights.ts), which the effect cost page lights with
// ?count= lights, 4 by default, over the floor's middle: rectangle lights, or ?kind=point point
// lights or ?kind=tube tube lights of the same ranges, so their costs compare. ?image gives the
// rectangle lights a picture. The lights start hidden. On the page's 'area' message they show,
// and the sketch posts 'settled' a frame later; 'area-off' hides them. ?scale= fixes the render
// scale, with the governor off, for timing. The area lights' tables load with the first light,
// before the sketch's setup ends.
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
const KIND = params.get('kind') ?? 'rect';
const SCALE = params.get('scale');

export default defineSketch(({ scene, materials, geometry, quality, time, page }) => {
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({ minRenderScale: scale, maxRenderScale: scale, governor: false });
	}
	quality.set({ areaLights: 64 });
	scene.setBackground(LIGHTS_BACKGROUND);
	scene.setActiveCamera(scene.createPerspectiveCamera(LIGHTS_CAMERA));
	scene.createAmbientLight(LIGHTS_AMBIENT);
	const floor = materials.standard({ color: LIGHTS_FLOOR.color, roughness: 0.3 });
	const plane = geometry.plane({ width: LIGHTS_FLOOR.size, height: LIGHTS_FLOOR.size });
	scene.createMesh({ mesh: plane, material: floor, rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] });
	const sphere = geometry.sphere({ radius: 1, ...LIGHTS_SPHERE });
	const box = geometry.box();
	for (const { shape, position, size, color, roughness, metalness } of LIGHTS_SHAPES) {
		const material = materials.standard({ color, roughness, metalness });
		const mesh = shape === 'sphere' ? sphere : box;
		scene.createMesh({ mesh, material, position: [...position], scale: [size, size, size] });
	}
	const side = Math.ceil(Math.sqrt(COUNT));
	const image = { width: 8, height: 8, data: new Uint8Array(256).map((_, i) => (i % 12) * 20) };
	const lights = Array.from({ length: COUNT }, (_, k) => {
		const x = ((k % side) - (side - 1) / 2) * (12 / side);
		const z = (Math.floor(k / side) - (side - 1) / 2) * (12 / side);
		const common = { range: 10, color: '#ffe0c0' };
		if (KIND === 'point')
			return scene.createPointLight({ ...common, position: [x, 3, z], intensity: 30 });
		if (KIND === 'tube')
			return scene.createTubeLight({
				...common,
				position: [x, 3, z],
				target: [x, 0, z + 0.5],
				length: 2,
				intensity: 60,
			});
		return scene.createRectAreaLight({
			...common,
			position: [x, 3, z],
			target: [x, 0, z + 0.5],
			width: 2,
			height: 1,
			intensity: 4,
			...(params.has('image') ? { image } : {}),
		});
	});
	for (const light of lights) light.setVisible(false);
	page.onMessage((message) => {
		if (message !== 'area' && message !== 'area-off') return;
		for (const light of lights) light.setVisible(message === 'area');
		const frame = time.frame;
		if (message === 'area')
			void scene.warmUp().then(() => page.post('settled', { frames: time.frame - frame }));
	});
});
