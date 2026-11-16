// The lens kit's picture tests: a wall of small boxes under bloom, with bright bars at its top, so
// every look that the add-on gives has pixels to change. ?look= names the one part of the look that
// the test turns on: grade, vignette, sharpen, aberration, streak, grain or speed. Without it the
// scene is drawn as it is. The other parts stay off, so each picture shows its own look alone.
import { defineSketch } from '@null3d/engine';
import { createLensKit, type LensLook } from '../../../examples/addons/lens-kit/index';

const params = new URL(import.meta.url).searchParams;
const LOOK = params.get('look');
/** Boxes along the wall's height. The canvas is wider than it is tall, so more fill its width. */
const ROWS = 18;
/** The wall's height in world units, which the orthographic camera sees whole. */
const HEIGHT = 9;
/** The share of each step that a box fills, which leaves the background between the boxes. */
const FILL = 0.84;
/** A strong grade, so the colors move plainly against the picture without one. */
const GRADE = {
	whiteBalance: { temperature: 3600 },
	lift: [0.02, 0.02, 0.04] as const,
	gain: [1.12, 1.0, 0.9] as const,
	saturation: 1.7,
	splitToning: { shadows: '#2f4fff', highlights: '#ffb45a', strength: 0.5 },
};
/** One look per test, with the parts that the others leave at 0 or off. */
const LOOKS: Record<string, LensLook> = {
	grade: { grading: GRADE },
	vignette: { vignette: { intensity: 0.8, size: 1.0, falloff: 2 } },
	sharpen: { sharpen: 0.8 },
	aberration: { aberration: 8 },
	streak: { streak: 0.6, bloomLevel: 3 },
	grain: { grain: 0.25 },
	speed: { speedBlur: 0.5 },
};

export default defineSketch((ctx) => {
	const { scene, materials, geometry, post, quality } = ctx;
	// The sharpening and the marks read pixels that the render scale places, so the captured frame
	// draws at the whole canvas whatever the machine's speed.
	quality.set({ minRenderScale: 1, maxRenderScale: 1 });
	// The streak spreads bloom's own glow, so the bright bars light the chain on every tier.
	post.set({ bloom: { intensity: 0.5, threshold: 1 } });
	// An orthographic view keeps each box's edge on the same pixels at every device's canvas.
	const camera = scene.createOrthographicCamera({ height: HEIGHT, near: 0.1, far: 100 });
	camera.setPosition(0, 0, 10);
	scene.setActiveCamera(camera);
	scene.setBackground('#10141c');
	scene.createAmbientLight({ color: '#ffffff', intensity: 1.1 });
	scene.createDirectionalLight({ direction: [-0.4, -0.6, -1], color: '#ffffff', intensity: 2 });
	const light = materials.standard({ color: '#e8ddc4', roughness: 0.75, metalness: 0 });
	const dark = materials.standard({ color: '#232c3e', roughness: 0.75, metalness: 0 });
	// Saturated columns give the grade and the color fringes colors of their own to move.
	const red = materials.standard({ color: '#c83422', roughness: 0.75, metalness: 0 });
	const blue = materials.standard({ color: '#2f5ad0', roughness: 0.75, metalness: 0 });
	const mesh = geometry.box({ width: 1, height: 1, depth: 0.2 });
	const step = HEIGHT / ROWS;
	// The canvas is 16 by 9 for the image tests, and wider than that on other pages: both counts
	// reach past its edges either way.
	const columns = Math.ceil((HEIGHT * 2) / step) + 2;
	const rows = Math.ceil(HEIGHT / step) + 1;
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			const material =
				column % 13 === 4
					? red
					: column % 13 === 9
						? blue
						: (row + column) % 2 === 0
							? light
							: dark;
			scene.createMesh({
				mesh,
				material,
				position: [(column - (columns - 1) / 2) * step, (row - (rows - 1) / 2) * step, 0],
				scale: [step * FILL, step * FILL, step],
			});
		}
	}
	// Bars brighter than white, for bloom and for the streak that spreads bloom's own glow.
	const bar = geometry.box({ width: 0.14, height: 0.55, depth: 0.1 });
	const glow = materials.standard({
		color: '#000000',
		emissive: '#ffffff',
		emissiveIntensity: 6,
		roughness: 1,
		metalness: 0,
	});
	for (const x of [-1.5, 0, 1.5])
		scene.createMesh({ mesh: bar, material: glow, position: [x, HEIGHT / 2 - 0.9, 0.2] });
	const look = LOOK === null ? undefined : LOOKS[LOOK];
	if (LOOK !== null && look === undefined) throw new Error(`the scene has no look ${LOOK}`);
	createLensKit(ctx, look ?? {});
	return {};
});
