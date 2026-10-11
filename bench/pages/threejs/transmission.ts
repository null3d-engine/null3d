// The three.js twin of the glass scene (bench/scenes/transmission.ts), which null3D's image tests
// draw. Each ball has a `MeshPhysicalMaterial` with `transmission: 1`, its thickness, and its
// volume's absorption where the scene gives one. It draws the scene once into an offscreen target
// of the image's size, and publishes the pixels as the hold pages do. `?renderer=webgl` draws with
// WebGLRenderer, and `?renderer=webgpu` with WebGPURenderer.
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	BALL_IOR,
	BALL_RADIUS,
	BALL_SEGMENTS,
	TRANSMISSION_BALLS,
	TRANSMISSION_BOXES,
	TRANSMISSION_CAMERA,
	TRANSMISSION_COUNT,
	TRANSMISSION_IMAGE,
} from '../../scenes/transmission';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	lightScene(three, scene);

	for (const { size, position, color } of TRANSMISSION_BOXES) {
		const box = new three.Mesh(
			new three.BoxGeometry(...size),
			new three.MeshStandardMaterial({ color }),
		);
		box.position.set(...position);
		scene.add(box);
	}
	const ball = new three.SphereGeometry(BALL_RADIUS, ...BALL_SEGMENTS);
	for (const { position, roughness, thickness, attenuation } of TRANSMISSION_BALLS) {
		const material = new three.MeshPhysicalMaterial({
			color: '#ffffff',
			metalness: 0,
			roughness,
			ior: BALL_IOR,
			transmission: 1,
			thickness,
			...(attenuation && {
				attenuationColor: new three.Color(attenuation.color),
				attenuationDistance: attenuation.distance,
			}),
		});
		const mesh = new three.Mesh(ball, material);
		mesh.position.set(...position);
		scene.add(mesh);
	}

	const { width, height } = TRANSMISSION_IMAGE;
	const { fov, near, far, position, target } = TRANSMISSION_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'transmission',
		renderer: rendererName,
		n: TRANSMISSION_COUNT,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
