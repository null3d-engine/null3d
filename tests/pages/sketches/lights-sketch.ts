// The point, spot, directional, hemisphere, rectangle and tube light scenes
// (bench/scenes/lights.ts). ?lights=N lights the floor with N point lights in a square grid,
// ?scene=spot with three spot lights instead, ?scene=fills with three directional lights,
// ?scene=hemisphere with a hemisphere light, ?scene=rect with three rectangle lights,
// ?scene=rect-image with the same lights showing an image of colored bands, and ?scene=tube with
// three tube lights. ?areaLights=N caps the area lights of each frame.
// ?scene=hemisphere-split gives the same light as two lights that the frame sums. ?camera=ortho
// draws through an orthographic camera.
// ?tone=none turns off the engine's default curve, as the parity test asks: the three.js twin
// draws with no tone mapping, three.js's default.
import { defineSketch } from '@null3d/engine';
import {
	FILL_LIGHTS,
	HEMISPHERE_LIGHT,
	LIGHTS_AMBIENT,
	LIGHTS_BACKGROUND,
	LIGHTS_CAMERA,
	LIGHTS_FLOOR,
	LIGHTS_ORTHO_CAMERA,
	LIGHTS_SHAPES,
	LIGHTS_SPHERE,
	pointLightGrid,
	RECT_LIGHTS,
	SPOT_LIGHTS,
	TUBE_LIGHTS,
} from '../../../bench/scenes/lights';

const params = new URL(import.meta.url).searchParams;

export default defineSketch(({ scene, materials, geometry, post, quality }) => {
	if (params.get('tone') === 'none') post.set({ toneMapping: 'none' });
	const cap = params.get('areaLights');
	if (cap !== null) quality.set({ areaLights: Number(cap) });
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
	if (lights === 'fills') {
		for (const { direction, ...light } of FILL_LIGHTS)
			scene.createDirectionalLight({ ...light, direction: [...direction] });
		return;
	}
	if (lights === 'spot') {
		for (const { position, target, ...light } of SPOT_LIGHTS)
			scene.createSpotLight({ ...light, position: [...position], target: [...target] });
		return;
	}
	if (lights === 'rect' || lights === 'rect-image') {
		const image = lights === 'rect-image' ? bands() : undefined;
		for (const { position, target, ...light } of RECT_LIGHTS)
			scene.createRectAreaLight({
				...light,
				position: [...position],
				target: [...target],
				image,
			});
		return;
	}
	if (lights === 'tube') {
		for (const { from, to, ...light } of TUBE_LIGHTS) {
			const position: [number, number, number] = [
				(from[0] + to[0]) / 2,
				(from[1] + to[1]) / 2,
				(from[2] + to[2]) / 2,
			];
			const direction: [number, number, number] = [
				to[0] - from[0],
				to[1] - from[1],
				to[2] - from[2],
			];
			const length = Math.hypot(...direction);
			scene.createTubeLight({ ...light, position, direction, length });
		}
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

/**
 * An image of 16 x 16 pixels: red, white and blue bands from left to right, under a dark bar
 * across the top quarter. Shiny shapes show the bands sharp, and the rough floor shows them blurred.
 */
function bands() {
	const data = new Uint8Array(16 * 16 * 4);
	for (let i = 0; i < 16 * 16; i++) {
		const [x, y] = [i % 16, i >> 4];
		const [r, g, b] = x < 5 ? [255, 60, 40] : x < 11 ? [255, 255, 255] : [40, 90, 255];
		const shade = y < 4 ? 0.1 : 1;
		data.set([r * shade, g * shade, b * shade, 255], i * 4);
	}
	return { width: 16, height: 16, data };
}
