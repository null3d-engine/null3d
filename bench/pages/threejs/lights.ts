// The three.js twin of the point, spot and hemisphere light scenes (bench/scenes/lights.ts), which
// null3D's image tests draw. ?lights=N lights the floor with N point lights in a square grid,
// ?scene=spot with three spot lights instead, and ?scene=hemisphere with a hemisphere light. A
// null3D light's range is a three.js light's distance. It draws the scene once into an offscreen
// target of the image's size, and publishes the pixels as the hold pages do. `?renderer=webgl`
// draws with WebGLRenderer, and `?renderer=webgpu` with WebGPURenderer.
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	HEMISPHERE_LIGHT,
	LIGHTS_AMBIENT,
	LIGHTS_BACKGROUND,
	LIGHTS_CAMERA,
	LIGHTS_FLOOR,
	LIGHTS_IMAGE,
	LIGHTS_SHAPES,
	LIGHTS_SPHERE,
	pointLightGrid,
	SPOT_LIGHTS,
} from '../../scenes/lights';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	scene.background = new three.Color(LIGHTS_BACKGROUND);
	scene.add(new three.AmbientLight(LIGHTS_AMBIENT.color, LIGHTS_AMBIENT.intensity));

	const floor = new three.Mesh(
		new three.PlaneGeometry(LIGHTS_FLOOR.size, LIGHTS_FLOOR.size),
		new three.MeshStandardMaterial({
			color: LIGHTS_FLOOR.color,
			roughness: LIGHTS_FLOOR.roughness,
		}),
	);
	floor.rotation.x = -Math.PI / 2;
	scene.add(floor);
	const sphere = new three.SphereGeometry(
		1,
		LIGHTS_SPHERE.widthSegments,
		LIGHTS_SPHERE.heightSegments,
	);
	const box = new three.BoxGeometry(1, 1, 1);
	for (const { shape, position, size, color, roughness, metalness } of LIGHTS_SHAPES) {
		const mesh = new three.Mesh(
			shape === 'sphere' ? sphere : box,
			new three.MeshStandardMaterial({ color, roughness, metalness }),
		);
		mesh.position.set(...position);
		mesh.scale.setScalar(size);
		scene.add(mesh);
	}

	const lights = params.get('scene');
	if (lights === 'spot') {
		for (const {
			position,
			target,
			color,
			intensity,
			range,
			angle,
			penumbra,
			decay,
		} of SPOT_LIGHTS) {
			const light = new three.SpotLight(color, intensity, range, angle, penumbra, decay);
			light.position.set(...position);
			light.target.position.set(...target);
			scene.add(light, light.target);
		}
	} else if (lights === 'hemisphere') {
		const { skyColor, groundColor, intensity } = HEMISPHERE_LIGHT;
		scene.add(new three.HemisphereLight(skyColor, groundColor, intensity));
	} else {
		for (const { position, color, intensity, range, decay } of pointLightGrid(
			Number(params.get('lights') ?? '16'),
		)) {
			const light = new three.PointLight(color, intensity, range, decay);
			light.position.set(...position);
			scene.add(light);
		}
	}

	const { width, height } = LIGHTS_IMAGE;
	const { fov, near, far, position, target } = LIGHTS_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'lights',
		renderer: rendererName,
		n: LIGHTS_SHAPES.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
