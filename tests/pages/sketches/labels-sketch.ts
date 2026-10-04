// A label on a box while the camera turns fast: the camera rolls a fixed step about its view in every
// frame, so the box circles the canvas's center and has a place of its own in each frame, without
// leaving the view. The sketch tracks a label on the box, and keeps the box's place in each frame,
// from `worldToScreen` in `onLateUpdate`. It answers the page's 'places' message with them, by the
// engine's frame numbers, which the label tables use. `?still` holds the camera, for the comparison
// with the drawn pixels in hold mode. `?far` moves the camera and the box out to the Earth's radius,
// for an engine in large-world mode.
import { defineSketch } from '@null3d/engine';

/** The camera's roll per frame, in radians: about 6 CSS pixels of the box's circle. */
const STEP = 0.1;
/**
 * The box's center relative to the camera: off the view's center, so the roll moves it. Its x is
 * no whole number of half meters, so at the Earth's radius a 32-bit float would move it.
 */
const BOX: [number, number, number] = [2.2, 1, -6];
/** The camera's distance from the origin with `?far`: the Earth's radius, in meters. */
const FAR = 6_371_000;

export default defineSketch(({ scene, geometry, materials, ui, page }) => {
	const params = new URL(import.meta.url).searchParams;
	const still = params.has('still');
	const x = params.has('far') ? FAR : 0;
	const at: [number, number, number] = [x + BOX[0], BOX[1], BOX[2]];
	const camera = scene.createPerspectiveCamera({ fov: 60, position: [x, 0, 0] });
	scene.setActiveCamera(camera);
	scene.setBackground('#000000');
	const box = scene.createMesh({
		mesh: geometry.box({ width: 0.4, height: 0.4, depth: 0.4 }),
		material: materials.unlit({ color: '#ff0000' }),
		position: at,
	});
	ui.trackLabel(box, 'box');
	/** The engine's frame number, then the box's x and y in CSS pixels, for each frame. */
	const places: number[] = [];
	const out = [0, 0, 0];
	let turns = 0;
	page.onMessage((name) => {
		if (name === 'places') page.post('places', places);
	});
	return {
		onUpdate() {
			if (!still) camera.setRotationEuler(0, 0, ++turns * STEP);
		},
		onLateUpdate() {
			camera.worldToScreen(at, out);
			// The frame being recorded follows the one whose labels were placed last.
			const frame = (ui as unknown as { frame: number }).frame + 1;
			places.push(frame, out[0] as number, out[1] as number);
		},
	};
});
