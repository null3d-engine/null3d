// Car paint for its image tests: a long rounded body in candy red under the built-in room's light,
// a sun and a point light. ?flakes=off leaves the metal flakes out, ?seams=off the panel seams,
// ?weave=on gives the body a carbon weave whose tows stretch their highlight, and ?sun=off leaves
// the sun out, so the point light alone lights the body. ?spot=on puts a spot light in the point
// light's place, aimed at the body, so the spot's own lobe lights the paint and its flakes. The
// paint spec checks that each part changes the image, and that the flakes glint under the point
// light and under the spot too.
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
	if (params.get('sun') !== 'off') {
		scene.createDirectionalLight({
			direction: [-0.5, -0.7, -0.45],
			color: '#ffe6c8',
			intensity: 3.2,
		});
	}
	const near = {
		position: [1.6, 1.6, 1.6] as const,
		color: '#bcd6ff',
		intensity: 12,
		range: 8,
	};
	// Both lights stand in the same place and reach the body whole: the spot's cone is wide enough
	// that its falloff plays no part, so its lobe alone differs.
	if (params.get('spot') === 'on')
		scene.createSpotLight({ ...near, target: [0, 0.55, 0], angle: 1, penumbra: 0 });
	else scene.createPointLight(near);
	const paint = createCarPaint(ctx, {
		color: '#9e0b16',
		metalness: 0.72,
		roughness: 0.34,
		flakes: params.get('flakes') === 'off' ? false : { cells: [330, 90], tilt: 0.28 },
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
