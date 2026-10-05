// Shiny metal that flickers as the camera moves, for the specular shimmer page: rows of small
// spheres and thin rings, each a few pixels across, with roughness from 0.1 to 0.4, under a sun
// that grazes them. Their normals turn fast between pixels, so a highlight narrower than a pixel
// would come and go from frame to frame. The camera orbits slowly: the page sends a time in its
// 'at' message, and the sketch places the camera there and answers 'placed'. So the page steps the
// camera exactly, frame by frame.
import { defineSketch } from '@null3d/engine';

/** The camera's turn about the scene, in radians per second of sketch time. */
export const ORBIT_SPEED = 0.01;
/** Columns and rows of the grid of shapes. */
const COLUMNS = 16;
const ROWS = 6;

export default defineSketch(({ scene, materials, geometry, quality, page }) => {
	quality.set({ minRenderScale: 1, governor: false });
	scene.setBackground('#05070a');
	scene.createDirectionalLight({ direction: [-0.4, -0.35, -1], color: '#ffffff', intensity: 3 });
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.05 });
	const camera = scene.createPerspectiveCamera({ fov: 30, near: 0.5, far: 200 });
	scene.setActiveCamera(camera);
	const sphere = geometry.sphere({ radius: 0.3, widthSegments: 32, heightSegments: 16 });
	const ring = geometry.torus({
		radius: 0.28,
		tube: 0.05,
		radialSegments: 12,
		tubularSegments: 48,
	});
	for (let column = 0; column < COLUMNS; column++) {
		const roughness = 0.1 + (0.3 * column) / (COLUMNS - 1);
		const material = materials.standard({ color: '#d8c8a8', metalness: 1, roughness });
		for (let row = 0; row < ROWS; row++)
			scene
				.createMesh({
					mesh: row % 2 === 0 ? sphere : ring,
					material,
					position: [(column - (COLUMNS - 1) / 2) * 0.8, (row - (ROWS - 1) / 2) * 0.8, 0],
				})
				.setRotationEuler(0.7 * row, 0.3 * column, 0);
	}
	const orbit = (seconds: number) => {
		const angle = 0.2 + seconds * ORBIT_SPEED;
		camera.setPosition(Math.sin(angle) * 16, 1.2, Math.cos(angle) * 16);
		camera.lookAt(0, 0, 0);
	};
	orbit(0);
	page.onMessage((name, seconds) => {
		if (name !== 'at') return;
		orbit(seconds as number);
		page.post('placed');
	});
});
