// The three.js twin of the fog's scene (bench/scenes/fog.ts), which null3D's image tests draw. It
// draws the scene once, in three.js's `Fog` with `?fog=linear` or its `FogExp2` with `?fog=exp2`,
// into an offscreen target of the image's size, and publishes the pixels as the hold pages do.
// `?renderer=webgl` draws with WebGLRenderer, and `?renderer=webgpu` with WebGPURenderer.
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	FOG_BOXES,
	FOG_CAMERA,
	FOG_COLOR,
	FOG_COUNT,
	FOG_IMAGE,
	FOG_SETTINGS,
	type FogName,
} from '../../scenes/fog';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const fogName = readChoice(params, 'fog', Object.keys(FOG_SETTINGS) as FogName[]);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	lightScene(three, scene);
	scene.background = new three.Color(FOG_COLOR);
	const fog = FOG_SETTINGS[fogName];
	scene.fog =
		fog.type === 'linear'
			? new three.Fog(fog.color, fog.near, fog.far)
			: new three.FogExp2(fog.color, fog.density);

	for (const { size, position, color, lit, fog: takesFog } of FOG_BOXES) {
		const options = { color, fog: takesFog };
		const material = lit
			? new three.MeshStandardMaterial(options)
			: new three.MeshBasicMaterial(options);
		const box = new three.Mesh(new three.BoxGeometry(...size), material);
		box.position.set(...position);
		scene.add(box);
	}

	const { width, height } = FOG_IMAGE;
	const { position, target, fov, near, far } = FOG_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: `fog-${fogName}`,
		renderer: rendererName,
		n: FOG_COUNT,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
