// Color grading's scene (bench/scenes/grading.ts), which the parity test also draws with three.js's
// LUTPass and VignetteShader: boxes in seven hues over a row of grays on a light ground. ?lut=warm
// loads the warm table from its .cube file, and ?lut=cool the cool one from its .3dl file.
// ?lut=warm-numbers makes the warm table from the numbers of its .cube file instead. With ?mix,
// the table draws at the tests' intensity, and ?vignette turns the vignette on. ?scale= draws at
// that render scale, with a range that reaches down to it.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import {
	GRADING_AMBIENT,
	GRADING_BACKGROUND,
	GRADING_BOXES,
	GRADING_CAMERA,
	GRADING_INTENSITY,
	GRADING_LUTS,
	GRADING_SUN,
	GRADING_VIGNETTE,
	gradingWarmNumbers,
} from '../../../bench/scenes/grading';

const params = new URL(import.meta.url).searchParams;
const name = params.get('lut');
const LUT = name === 'warm' || name === 'cool' ? GRADING_LUTS[name] : undefined;
const NUMBERS = name === 'warm-numbers';
const MIX = params.has('mix');
const VIGNETTE = params.has('vignette');
const SCALE = params.get('scale');

export default defineSketch(async ({ scene, materials, geometry, post, quality, assets }) => {
	if (LUT || NUMBERS) {
		const lut = LUT
			? await assets.loadLut(LUT)
			: await assets.lutFromData({ size: 33, data: gradingWarmNumbers() });
		post.set({ lut, lutIntensity: MIX ? GRADING_INTENSITY : 1 });
	}
	if (VIGNETTE) post.set({ vignette: GRADING_VIGNETTE });
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({ minRenderScale: scale, maxRenderScale: scale, governor: false });
	}
	scene.setBackground(GRADING_BACKGROUND);
	const camera = scene.createPerspectiveCamera({
		fov: GRADING_CAMERA.fov,
		near: GRADING_CAMERA.near,
		far: GRADING_CAMERA.far,
		position: [...GRADING_CAMERA.position],
		target: [...GRADING_CAMERA.target],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: [...GRADING_SUN.direction],
		color: GRADING_SUN.color,
		intensity: GRADING_SUN.intensity,
	});
	scene.createAmbientLight({ color: GRADING_AMBIENT.color, intensity: GRADING_AMBIENT.intensity });
	for (const box of GRADING_BOXES) {
		const [width, height, depth] = box.size;
		scene.createMesh({
			mesh: geometry.box({ width, height, depth }),
			material: materials.standard({ color: box.color, roughness: 0.8, metalness: 0 }),
			position: [...box.position],
		});
	}
	return {};
});
