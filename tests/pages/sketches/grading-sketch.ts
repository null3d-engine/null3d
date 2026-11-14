// Color grading's scene (bench/scenes/grading.ts), which the parity test also draws with three.js's
// LUTPass and VignetteShader: boxes in seven hues over a row of grays on a light ground. ?lut=warm
// loads the warm table from its .cube file, and ?lut=cool the cool one from its .3dl file.
// ?lut=warm-numbers makes the warm table from the numbers of its .cube file instead. With ?mix,
// the table draws at the tests' intensity, and ?vignette turns the vignette on. ?scale= draws at
// that render scale, with a range that reaches down to it. ?grade turns the grading controls on
// with their values still. On the page's 'grade' message the sketch changes a value in each frame,
// and on 'grade-fixed' it keeps them still, for the cost of a change. 'grade-step' changes one value
// once, for the frame that a single change lands in. The lift, gamma and gain tuples stay `as const`
// so that they fit the settings' types, and the scale test's dotted address loads them as written.
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
/** True for the switch page, whose measurements start with the grading controls on. */
const START_GRADE = params.has('grade');

/** The grade that the switch page drags a value of, while it measures the frames. */
const GRADE = {
	whiteBalance: { temperature: 5200 },
	lift: [0.02, 0.02, 0.03] as const,
	gamma: [0.9, 1, 1.1] as const,
	gain: [1.08, 1, 0.94] as const,
	saturation: 1.15,
	splitToning: { shadows: '#3050ff', highlights: '#ffb45a', balance: 0.2, strength: 0.3 },
};
/** The grade's settings, changed in place, so a change in each frame allocates nothing. */
const grade = {
	whiteBalance: GRADE.whiteBalance,
	lift: GRADE.lift,
	gamma: GRADE.gamma,
	gain: GRADE.gain,
	saturation: GRADE.saturation,
	splitToning: GRADE.splitToning,
};

export default defineSketch(async ({ scene, materials, geometry, post, quality, assets, page }) => {
	/** True while the page's 'grade' message asks for a new value in each frame. */
	let changing = false;
	/** The value that the change walks through, in radians. */
	let sweep = 0;
	/** Takes the next value of the change, for a page that measures one change on its own. */
	const step = (): void => {
		sweep += 0.05;
		grade.saturation = GRADE.saturation + 0.2 * Math.sin(sweep);
		post.set({ grading: grade });
	};
	page.onMessage((message) => {
		if (message === 'grade') changing = true;
		if (message === 'grade-fixed') changing = false;
		if (message === 'grade-step') step();
	});
	// The three.js twin draws with AgXToneMapping, which plain AgX matches.
	post.set({ toneMapping: 'agx' });
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
	// The switch page starts the controls on with the values still, so its first measurement already
	// draws the grade.
	if (START_GRADE) post.set({ grading: grade });
	return {
		onUpdate() {
			if (changing) step();
		},
	};
});
