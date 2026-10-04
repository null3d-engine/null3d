// The three.js twin of the standard material's grid in an environment (bench/scenes/standard-grid.ts),
// which null3D's environment image tests draw: MeshStandardMaterial spheres over metalness and
// roughness, lit by `scene.environment` alone, a texture of PMREMGenerator. `?env=room` prefilters
// three.js's RoomEnvironment as its examples do, with `fromScene(room, 0.04)`. `?env=venice` loads
// the HDR file with HDRLoader and prefilters it with `fromEquirectangular`. `&rotate` sets
// `scene.environmentRotation`. It draws the scene once into an offscreen target of the image's size
// and publishes the pixels, as the hold pages do. `?renderer=webgl` draws with WebGLRenderer, and
// `?renderer=webgpu` with WebGPURenderer.
import type * as ThreeModule from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	GRID_BACKGROUND,
	GRID_CAMERA,
	GRID_CELLS,
	GRID_COLOR,
	GRID_ENVIRONMENT_ROTATION,
	GRID_ENVIRONMENTS,
	GRID_IMAGE,
	GRID_SPHERE,
	type GridEnvironmentName,
} from '../../scenes/standard-grid';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { RENDERERS, startThree } from './harness';

/** The blur of RoomEnvironment's prefilter in three.js's examples, as PMREMGenerator's sigma. */
const ROOM_SIGMA = 0.04;

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const name = readChoice(params, 'env', Object.keys(GRID_ENVIRONMENTS) as GridEnvironmentName[]);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	scene.background = new three.Color(GRID_BACKGROUND);
	// Each renderer takes PMREMGenerator from its own build, which the harness loaded already.
	const build = (
		rendererName === 'webgpu' ? await import('three/webgpu') : await import('three')
	) as typeof ThreeModule;
	const pmrem = new build.PMREMGenerator(renderer as unknown as ThreeModule.WebGLRenderer);
	const source = GRID_ENVIRONMENTS[name];
	if ('builtin' in source) {
		scene.environment = pmrem.fromScene(new RoomEnvironment(), ROOM_SIGMA).texture;
	} else {
		const hdr = await new HDRLoader().setDataType(build.FloatType).loadAsync(source.hdr);
		scene.environment = pmrem.fromEquirectangular(hdr).texture;
	}
	if (params.has('rotate')) scene.environmentRotation.set(...GRID_ENVIRONMENT_ROTATION);

	const { radius, widthSegments, heightSegments } = GRID_SPHERE;
	const sphere = new three.SphereGeometry(radius, widthSegments, heightSegments);
	for (const { position, metalness, roughness } of GRID_CELLS) {
		const material = new three.MeshStandardMaterial({ color: GRID_COLOR, metalness, roughness });
		const mesh = new three.Mesh(sphere, material);
		mesh.position.set(...position);
		scene.add(mesh);
	}

	const { width, height } = GRID_IMAGE;
	const { fov, near, far, position, target } = GRID_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: `environment-${name}${params.has('rotate') ? '-rotated' : ''}`,
		renderer: rendererName,
		n: GRID_CELLS.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
