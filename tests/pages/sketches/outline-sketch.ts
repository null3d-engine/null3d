// The outline's scene (bench/scenes/outline.ts), which the parity test also draws from the mask of
// three.js's OutlinePass: a sphere half behind a wall and a box in the open take the outline, beside
// a wall and a box without one. ?outline=plain or ?outline=hidden names its settings, and without it
// the outline stays off. ?scale= draws at that render scale, with a range that reaches down to it.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import {
	OUTLINE_AMBIENT,
	OUTLINE_BACKGROUND,
	OUTLINE_CAMERA,
	OUTLINE_SETTINGS,
	OUTLINE_SHAPES,
	OUTLINE_SUN,
} from '../../../bench/scenes/outline';

const params = new URL(import.meta.url).searchParams;
const name = params.get('outline');
const OUTLINE =
	name === 'plain'
		? OUTLINE_SETTINGS.plain
		: name === 'hidden'
			? OUTLINE_SETTINGS.hidden
			: undefined;
const SCALE = params.get('scale');

export default defineSketch(({ scene, materials, geometry, post, quality }) => {
	// The three.js twin draws with AgXToneMapping, which plain AgX matches.
	post.set({ toneMapping: 'agx' });
	if (OUTLINE) post.set({ outline: OUTLINE });
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({ minRenderScale: scale, maxRenderScale: scale, governor: false });
	}
	scene.setBackground(OUTLINE_BACKGROUND);
	const camera = scene.createPerspectiveCamera({
		fov: OUTLINE_CAMERA.fov,
		near: OUTLINE_CAMERA.near,
		far: OUTLINE_CAMERA.far,
		position: [...OUTLINE_CAMERA.position],
		target: [...OUTLINE_CAMERA.target],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: [...OUTLINE_SUN.direction],
		color: OUTLINE_SUN.color,
		intensity: OUTLINE_SUN.intensity,
	});
	scene.createAmbientLight({ color: OUTLINE_AMBIENT.color, intensity: OUTLINE_AMBIENT.intensity });
	for (const shape of OUTLINE_SHAPES) {
		const [x, y, z] = shape.size;
		const mesh =
			shape.kind === 'box'
				? geometry.box({ width: x, height: y, depth: z })
				: geometry.sphere({ radius: x });
		const material = materials.standard({ color: shape.color, roughness: 0.7, metalness: 0 });
		const object = scene.createMesh({ mesh, material, position: [...shape.position] });
		if (shape.outlined) object.setOutlined(true);
	}
	return {};
});
