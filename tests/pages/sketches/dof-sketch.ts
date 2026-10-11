// Depth of field's scene (bench/scenes/dof.ts): a white post near the camera, an orange box and a
// teal sphere at the focus, bright lights far behind, and a ground between them, through an 85 mm
// lens at f/1.4. ?dof=near focuses on the post, so the far field blurs, ?dof=far on the lights, so
// the near field blurs, and ?dof=both on the box, so both blur. Without it, depth of field stays
// off. ?blades= sets the aperture's blades. ?point focuses on a point at the box in place of its
// distance, which must draw ?dof=both's image. With ?later, the sketch turns depth of field on
// during play, half a second in, rather than in its setup. ?taps= sets the quality setting
// dofSamples. ?scale= draws at that render scale, with a range that reaches down to 0.5; with
// ?fixed the range holds that scale alone, and the governor is off, for timing. With ?moving, the
// focus point sweeps between the post and the lights in every frame.
//
// On the page's 'dof' message it turns depth of field on at the box, waits until its pipelines are
// built, and posts the frames and milliseconds that took as 'settled'. The 'dof-off' message turns
// it off.
//
// The module uses no type annotations: an address whose last value holds a dot, such as scale=0.5,
// makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';
import {
	DOF_AMBIENT,
	DOF_BACKGROUND,
	DOF_BOX_POINT,
	DOF_CAMERA,
	DOF_DISTANCES,
	DOF_LENS,
	DOF_SHAPES,
	DOF_SUN,
	DOF_TAPS,
} from '../../../bench/scenes/dof';

const params = new URL(import.meta.url).searchParams;
const name = params.get('dof');
const FOCUSED =
	name === 'near' || name === 'both' || name === 'far' ? DOF_DISTANCES[name] : undefined;
const LENS = { ...DOF_LENS, blades: Number(params.get('blades') ?? 0) };
const POINT = params.has('point');
const LATER = params.has('later');
const MOVING = params.has('moving');
const TAPS = params.get('taps');
const SCALE = params.get('scale');
const FIXED = params.has('fixed');

/** The settings of the tests: a focus at the test's distance, or at the box's point with ?point. */
const SETTINGS = POINT
	? { ...LENS, focusPoint: DOF_BOX_POINT }
	: { ...LENS, focusDistance: FOCUSED ?? DOF_DISTANCES.both };

export default defineSketch(({ scene, materials, geometry, post, quality, time, page }) => {
	if (TAPS !== null)
		quality.set({ dofSamples: DOF_TAPS.find((taps) => taps === Number(TAPS)) ?? 22 });
	if (FOCUSED !== undefined && !LATER) post.set({ dof: SETTINGS });
	if (SCALE !== null) {
		const scale = Number(SCALE);
		quality.set({
			minRenderScale: FIXED ? scale : Math.min(scale, 0.5),
			maxRenderScale: scale,
			governor: !FIXED,
		});
	}
	scene.setBackground(DOF_BACKGROUND);
	const camera = scene.createPerspectiveCamera({
		near: DOF_CAMERA.near,
		far: DOF_CAMERA.far,
		position: [...DOF_CAMERA.position],
		target: [...DOF_CAMERA.target],
	});
	camera.setFocalLength(DOF_CAMERA.focalLength);
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({
		direction: [...DOF_SUN.direction],
		color: DOF_SUN.color,
		intensity: DOF_SUN.intensity,
	});
	scene.createAmbientLight({ color: DOF_AMBIENT.color, intensity: DOF_AMBIENT.intensity });
	for (const shape of DOF_SHAPES) {
		const [x, y, z] = shape.size;
		const mesh =
			shape.kind === 'box'
				? geometry.box({ width: x, height: y, depth: z })
				: geometry.sphere({ radius: x });
		const material = materials.standard({
			color: shape.color,
			roughness: shape.roughness,
			metalness: 0,
			emissive: shape.emissiveIntensity > 0 ? shape.color : '#000000',
			emissiveIntensity: shape.emissiveIntensity,
		});
		scene.createMesh({ mesh, material, position: [...shape.position] });
	}
	page.onMessage((message) => {
		if (message === 'dof-off') post.set({ dof: false });
		if (message !== 'dof') return;
		const frame = time.frame;
		const start = performance.now();
		post.set({ dof: SETTINGS });
		void scene
			.warmUp()
			.then(() =>
				page.post('settled', { frames: time.frame - frame, ms: performance.now() - start }),
			);
	});
	// The point that ?moving sweeps, changed in place, and the settings that carry it, made once.
	const point = [...DOF_BOX_POINT];
	const moving = { focusPoint: point };
	if (MOVING) post.set({ dof: { ...LENS, focusPoint: point } });
	let turnedOn = false;
	return {
		onUpdate() {
			if (MOVING) {
				// From the post, 2 m away, to the lights, 16 m away, and back, every 4 seconds.
				point[2] = DOF_CAMERA.position[2] - 9 - 7 * Math.cos(time.now * 1.5707963);
				post.set({ dof: moving });
			}
			if (FOCUSED === undefined || !LATER || turnedOn || time.now < 0.5) return;
			turnedOn = true;
			post.set({ dof: SETTINGS });
		},
	};
});
