// Car paint for its image tests: a long rounded body in candy red under the built-in room's light
// and a sun. ?flakes=off leaves the metal flakes out, ?seams=off the panel seams, and ?weave=on
// gives the body a carbon weave whose tows stretch their highlight. The paint spec checks that
// each part changes the image.
import { defineSketch } from '@null3d/engine';
import { createCarPaint } from '../../../examples/addons/car-paint';

const params = new URL(import.meta.url).searchParams;

export default defineSketch(async (ctx) => {
	const { scene, geometry, assets } = ctx;
	scene.setBackground('#0a0c10');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.85 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 32,
			near: 0.1,
			far: 40,
			position: [2.2, 1.15, 3.3],
			target: [0, 0.55, 0],
		}),
	);
	scene.createDirectionalLight({
		direction: [-0.5, -0.7, -0.45],
		color: '#ffe6c8',
		intensity: 3.2,
	});
	scene.createPointLight({
		position: [1.6, 1.6, 1.6],
		color: '#bcd6ff',
		intensity: 12,
		range: 8,
	});
	const paint = createCarPaint(ctx, {
		color: '#9e0b16',
		metalness: 0.72,
		roughness: 0.34,
		flakes: params.get('flakes') === 'off' ? false : { cells: [110, 180], tilt: 0.28 },
		seams:
			params.get('seams') === 'off' ? false : { spacing: [0.34, 0], width: 0.0024, shade: 0.85 },
		weave: params.get('weave') === 'on' ? { cells: [70, 120], shine: 0.9 } : false,
	});
	// The body: a long rounded panel, so its flanks turn the light and the coat across the view.
	scene.createMesh({
		mesh: geometry.sphere({ radius: 1, widthSegments: 160, heightSegments: 96 }),
		material: paint,
		position: [0, 0.62, 0],
		scale: [1.55, 0.56, 0.72],
	});
});
