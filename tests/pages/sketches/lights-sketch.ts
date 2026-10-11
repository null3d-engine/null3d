// The point, spot and hemisphere light scenes (bench/scenes/lights.ts). ?lights=N lights the floor
// with N point lights in a square grid, ?scene=spot with three spot lights instead, and
// ?scene=hemisphere with a hemisphere light. ?scene=hemisphere-split gives the same light as two
// lights that the frame sums. ?camera=ortho draws through an orthographic camera.
// ?tone=none turns off the engine's default of ACES, as the parity test asks: the three.js twin
// draws with no tone mapping, three.js's default.
import { defineSketch } from '@null3d/engine';
import {
	HEMISPHERE_LIGHT,
	LIGHTS_AMBIENT,
	LIGHTS_BACKGROUND,
	LIGHTS_CAMERA,
	LIGHTS_FLOOR,
	LIGHTS_ORTHO_CAMERA,
	LIGHTS_SHAPES,
	LIGHTS_SPHERE,
	pointLightGrid,
	SPOT_LIGHTS,
} from '../../../bench/scenes/lights';

const params = new URL(import.meta.url).searchParams;

export default defineSketch(({ scene, materials, geometry, post }) => {
	if (params.get('tone') === 'none') post.set({ toneMapping: 'none' });
	scene.setBackground(LIGHTS_BACKGROUND);
	const camera =
		params.get('camera') === 'ortho'
			? scene.createOrthographicCamera(LIGHTS_ORTHO_CAMERA)
			: scene.createPerspectiveCamera(LIGHTS_CAMERA);
	scene.setActiveCamera(camera);
	scene.createAmbientLight(LIGHTS_AMBIENT);

	const floor = scene.createMesh({
		mesh: geometry.plane({ width: LIGHTS_FLOOR.size, height: LIGHTS_FLOOR.size }),
		material: materials.standard({
			color: LIGHTS_FLOOR.color,
			roughness: LIGHTS_FLOOR.roughness,
		}),
	});
	floor.setRotationEuler(-Math.PI / 2, 0, 0);
	const sphere = geometry.sphere({ radius: 1, ...LIGHTS_SPHERE });
	const box = geometry.box({ width: 1, height: 1, depth: 1 });
	for (const { shape, position, size, color, roughness, metalness } of LIGHTS_SHAPES) {
		const shaped = scene.createMesh({
			mesh: shape === 'sphere' ? sphere : box,
			material: materials.standard({ color, roughness, metalness }),
			position: [...position],
		});
		shaped.setScale(size, size, size);
	}

	const lights = params.get('scene');
	if (lights === 'spot') {
		for (const { position, target, ...light } of SPOT_LIGHTS)
			scene.createSpotLight({ ...light, position: [...position], target: [...target] });
		return;
	}
	if (lights === 'hemisphere') {
		scene.createHemisphereLight(HEMISPHERE_LIGHT);
		return;
	}
	if (lights === 'hemisphere-split') {
		// Two halves of the hemisphere light: one upright, and one turned upside down with its colors
		// swapped. Both start dark and take their intensities and colors in every frame, so the image
		// matches the single light's only when the frame sums both and sees each change.
		const { skyColor, groundColor, intensity } = HEMISPHERE_LIGHT;
		const upright = scene.createHemisphereLight({ skyColor, groundColor, intensity: 0 });
		const flipped = scene.createHemisphereLight({
			skyColor: '#000000',
			groundColor: '#000000',
			rotation: [1, 0, 0, 0],
		});
		return {
			onUpdate() {
				upright.setIntensity(intensity / 2);
				flipped.setIntensity(intensity / 2);
				flipped.setColor(groundColor);
				flipped.setGroundColor(skyColor);
			},
		};
	}
	const count = Number(params.get('lights') ?? '16');
	for (const { position, ...light } of pointLightGrid(count))
		scene.createPointLight({ ...light, position: [...position] });
});
