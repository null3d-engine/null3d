// The three.js twin of the shadow-catcher scene (bench/scenes/shadow-catcher.ts), which null3D's
// image tests draw. A flat plane has three.js's `ShadowMaterial`, so it shows the directional
// light's shadow where it falls and nothing where the light reaches it. The boxes, post and ball
// above it cast the shadows. It draws the scene once into an offscreen target of the image's size,
// and publishes the pixels as the hold pages do. `?renderer=webgl` draws with WebGLRenderer, and
// `?renderer=webgpu` with WebGPURenderer.
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	SHADOW_CATCHER,
	SHADOW_CATCHER_AMBIENT,
	SHADOW_CATCHER_BACKGROUND,
	SHADOW_CATCHER_CAMERA,
	SHADOW_CATCHER_CASTERS,
	SHADOW_CATCHER_COUNT,
	SHADOW_CATCHER_IMAGE,
	SHADOW_CATCHER_SUN,
	THREE_SHADOW_CATCHER_CAMERA,
} from '../../scenes/shadow-catcher';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	const sun = lightScene(
		three,
		scene,
		{ sun: SHADOW_CATCHER_SUN, ambient: SHADOW_CATCHER_AMBIENT },
		SHADOW_CATCHER_BACKGROUND,
	);
	renderer.shadowMap.enabled = true;
	sun.castShadow = true;
	sun.shadow.mapSize.set(SHADOW_CATCHER_SUN.mapSize, SHADOW_CATCHER_SUN.mapSize);
	const box = sun.shadow.camera;
	const half = THREE_SHADOW_CATCHER_CAMERA.halfSize;
	[box.left, box.right, box.top, box.bottom] = [-half, half, half, -half];
	[box.near, box.far] = [0.1, 2 * sun.position.length()];
	box.updateProjectionMatrix();

	const [width, depth] = SHADOW_CATCHER.size;
	const ground = new three.Mesh(
		new three.BoxGeometry(width, 0.2, depth),
		new three.ShadowMaterial({
			color: SHADOW_CATCHER.color,
			opacity: SHADOW_CATCHER.opacity,
		}),
	);
	ground.position.set(...SHADOW_CATCHER.position);
	ground.receiveShadow = true;
	scene.add(ground);

	for (const caster of SHADOW_CATCHER_CASTERS) {
		const mesh =
			caster.kind === 'ball'
				? new three.Mesh(
						new three.SphereGeometry(caster.radius, 24, 16),
						new three.MeshStandardMaterial({ color: '#8d94a0', roughness: 0.7 }),
					)
				: new three.Mesh(
						new three.BoxGeometry(...caster.size),
						new three.MeshStandardMaterial({ color: '#8d94a0', roughness: 0.7 }),
					);
		mesh.position.set(caster.position[0], caster.position[1], caster.position[2]);
		mesh.castShadow = true;
		scene.add(mesh);
	}

	const { fov, near, far, position, target } = SHADOW_CATCHER_CAMERA;
	const camera = new three.PerspectiveCamera(
		fov,
		SHADOW_CATCHER_IMAGE.width / SHADOW_CATCHER_IMAGE.height,
		near,
		far,
	);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(SHADOW_CATCHER_IMAGE.width, SHADOW_CATCHER_IMAGE.height, () =>
		renderer.render(scene, camera),
	);
	return {
		scene: 'shadow-catcher',
		renderer: rendererName,
		n: SHADOW_CATCHER_COUNT,
		width: SHADOW_CATCHER_IMAGE.width,
		height: SHADOW_CATCHER_IMAGE.height,
		pixels: toBase64(pixels),
	};
});
