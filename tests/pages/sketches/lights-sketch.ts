// The point and spot light scenes of clustered lighting (bench/scenes/lights.ts). ?lights=N lights
// the floor with N point lights in a square grid, and ?scene=spot with three spot lights instead.
// ?camera=ortho draws through an orthographic camera.
import { defineSketch } from '@null3d/engine';
import {
	LIGHTS_AMBIENT,
	LIGHTS_BACKGROUND,
	LIGHTS_CAMERA,
	LIGHTS_FLOOR,
	LIGHTS_ORTHO_CAMERA,
	LIGHTS_SHAPES,
	pointLightGrid,
	SPOT_LIGHTS,
} from '../../../bench/scenes/lights';

const params = new URL(import.meta.url).searchParams;

export default defineSketch(({ scene, materials, geometry }) => {
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
	const sphere = geometry.sphere({ radius: 1, widthSegments: 32, heightSegments: 16 });
	const box = geometry.box({ width: 1, height: 1, depth: 1 });
	for (const { shape, position, size, color, roughness, metalness } of LIGHTS_SHAPES) {
		const shaped = scene.createMesh({
			mesh: shape === 'sphere' ? sphere : box,
			material: materials.standard({ color, roughness, metalness }),
			position: [...position],
		});
		shaped.setScale(size, size, size);
	}

	if (params.get('scene') === 'spot') {
		for (const { position, target, ...light } of SPOT_LIGHTS)
			scene.createSpotLight({ ...light, position: [...position], target: [...target] });
		return;
	}
	const count = Number(params.get('lights') ?? '16');
	for (const { position, ...light } of pointLightGrid(count))
		scene.createPointLight({ ...light, position: [...position] });
});
