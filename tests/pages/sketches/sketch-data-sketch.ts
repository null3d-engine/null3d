// Paints the background with the color that the page's start data names, and posts the data that
// the setup read, so a test sees that the data reached the setup before the first frame.
import { defineSketch } from '@null3d/engine';

/** The start data that the page passes. */
export interface StartData {
	color: string;
	level: number;
}

export default defineSketch<StartData>(({ data, scene, page }) => {
	const camera = scene.createPerspectiveCamera({ position: [0, 0, 5], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	scene.setBackground(data?.color ?? '#000000');
	page.post('data', data);
});
