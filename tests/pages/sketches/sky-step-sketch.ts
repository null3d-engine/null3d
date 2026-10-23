// A mirror sphere and a rough white sphere, lit by the sky's environment, under a sky with no
// clouds and a sun high in the sky. The page's 'sweep' message starts the sun rising by a small
// step in every frame, as a slow time of day does. The map fills for the sun only at its steps, so
// the spheres' light moves in steps of its own; the page captures every frame and reports the
// spheres' colours, so a test can weigh each step as the viewers see it.
import { defineSketch } from '@null3d/engine';

/** The sun's height above the horizon where the sweep starts, in degrees, and where it ends. */
const START = 8;
const END = 4;
/** The frames of the sweep. The sun sinks slow enough that a fill of 20 frames fits inside each
 * half-degree step, so the light moves in steps of a half degree and not of a fill's lag. */
const FRAMES = ((START - END) / 0.5) * 30;

export default defineSketch(async ({ scene, assets, geometry, materials, post, page, quality }) => {
	quality.set({ minRenderScale: 1 });
	post.set({ toneMapping: 'none' });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({ fov: 40, position: [0, 0, 6], target: [0, 0, 0] }),
	);
	// The sun's place at a height, toward -Z, as the page's own colours lie in front of the sky.
	const place = (degrees: number): [number, number, number] => {
		const radians = (degrees * Math.PI) / 180;
		return [0, Math.sin(radians), -Math.cos(radians)];
	};
	const sky = { sunPosition: place(START), cloudCoverage: 0, showSunDisc: false };
	const background = { sky };
	scene.setBackground(background);
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: 0.2 });
	const sphere = geometry.sphere({ radius: 1, widthSegments: 64, heightSegments: 32 });
	const mirror = materials.standard({ color: '#ffffff', metalness: 1, roughness: 0 });
	const rough = materials.standard({ color: '#ffffff', metalness: 0, roughness: 1 });
	scene.createMesh({ mesh: sphere, material: mirror, position: [-1.2, 0, 0] });
	scene.createMesh({ mesh: sphere, material: rough, position: [1.2, 0, 0] });
	/** The sweep's frames drawn so far, or -1 before the page starts it. */
	let frame = -1;
	page.onMessage((name) => {
		if (name === 'sweep' && frame < 0) frame = 0;
	});
	return {
		onUpdate() {
			if (frame < 0 || frame >= FRAMES) return;
			sky.sunPosition = place(START - ((START - END) * (frame + 1)) / FRAMES);
			scene.setBackground(background);
			frame++;
		},
	};
});
