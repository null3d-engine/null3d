// Car paint for its image tests: a long rounded body in candy red under the built-in room's light
// and a sun. ?flakes=off leaves the metal flakes out, ?seams=off the panel seams, and ?weave=on
// gives the body a carbon weave whose tows stretch their highlight. ?sun=off draws without the
// main light, and ?lamp=spot or ?lamp=eye moves the clustered light: a cone onto the body, or a
// bare bulb at the camera, whose light returns along the view. The paint spec checks that each part
// changes the image, and that the flakes glint under each light.
import { defineSketch } from '@null3d/engine';
import { createCarPaint } from '../../../examples/addons/car-paint';

const params = new URL(import.meta.url).searchParams;
/** Where the camera stands, which is also where the eye lamp sits. */
const EYE = [2.2, 1.15, 3.3] as const;

export default defineSketch(async (ctx) => {
	const { scene, geometry, assets } = ctx;
	scene.setBackground('#0a0c10');
	scene.setEnvironment(await assets.builtinEnvironment('room'), { intensity: 0.85 });
	scene.setActiveCamera(
		scene.createPerspectiveCamera({
			fov: 32,
			near: 0.1,
			far: 40,
			position: [...EYE] as [number, number, number],
			target: [0, 0.55, 0],
		}),
	);
	const sun = params.get('sun') !== 'off';
	const lamp = params.get('lamp') ?? 'point';
	if (sun) {
		scene.createDirectionalLight({
			direction: [-0.5, -0.7, -0.45],
			color: '#ffe6c8',
			intensity: 3.2,
		});
	}
	// The clustered light: a bare bulb, a cone from the bulb onto the body, or a bulb at the camera.
	const bulb = {
		position: [1.6, 1.6, 1.6] as [number, number, number],
		color: '#bcd6ff',
		intensity: 12,
		range: 8,
	};
	if (lamp === 'spot') {
		scene.createSpotLight({ ...bulb, target: [0, 0.55, 0], angle: 0.5, penumbra: 0.25 });
	} else if (lamp === 'eye') {
		scene.createPointLight({ ...bulb, position: [...EYE] as [number, number, number] });
	} else if (lamp === 'point') {
		scene.createPointLight(bulb);
	}
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
