// Fine detail for the sharpening image tests: a wall of small boxes in two colors fills the view, so
// the image holds hundreds of short, hard edges. ?sharpen= sets the sharpening's strength, from 0 to
// 1, and without it the wall draws as it is. The wall covers the whole canvas at its own size, so
// the sharpening runs at the whole canvas's render scale.
//
// The module uses no type annotations: an address whose last value holds a dot, such as
// sharpen=0.6, makes the dev server read the module as JavaScript.
import { defineSketch } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const SHARPEN = params.get('sharpen');
/** Boxes along the wall's height. The canvas is wider than it is tall, so more fill its width. */
const ROWS = 20;
/** The wall's height in world units, which the orthographic camera sees whole. */
const HEIGHT = 9;
/** The share of each step that a box fills, which leaves the background between the boxes. */
const FILL = 0.82;

export default defineSketch(({ scene, materials, geometry, post, quality }) => {
	if (SHARPEN !== null) post.set({ sharpen: Number(SHARPEN) });
	// The sharpening draws in the second step of the two-step pass, which exists only below the
	// canvas's scale, and its edge vote reads the texels the upscale made. The frame-budget
	// governor lowers the render scale on a slow machine, so a loaded Mac drew this wall through a
	// different path from the one the references hold. The captured frame draws at full size
	// whatever the machine's speed.
	quality.set({ minRenderScale: 0.75, maxRenderScale: 0.75 });
	// An orthographic view keeps each box's edge on the same pixels at every device's canvas.
	const camera = scene.createOrthographicCamera({ height: HEIGHT, near: 0.1, far: 100 });
	camera.setPosition(0, 0, 10);
	scene.setActiveCamera(camera);
	scene.setBackground('#101218');
	scene.createAmbientLight({ color: '#ffffff', intensity: 1.2 });
	scene.createDirectionalLight({ direction: [-0.4, -0.6, -1], color: '#ffffff', intensity: 2 });
	const light = materials.standard({ color: '#f2ede0', roughness: 0.8, metalness: 0 });
	const dark = materials.standard({ color: '#2c3a52', roughness: 0.8, metalness: 0 });
	const mesh = geometry.box({ width: 1, height: 1, depth: 0.2 });
	const step = HEIGHT / ROWS;
	// The canvas is 16 by 9 for the image tests, and wider than that on other pages: both counts
	// reach past its edges either way.
	const columns = Math.ceil((HEIGHT * 2) / step) + 2;
	const rows = Math.ceil(HEIGHT / step) + 1;
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			scene.createMesh({
				mesh,
				material: (row + column) % 2 === 0 ? light : dark,
				position: [(column - (columns - 1) / 2) * step, (row - (rows - 1) / 2) * step, 0],
				scale: [step * FILL, step * FILL, step],
			});
		}
	}
	return {};
});
