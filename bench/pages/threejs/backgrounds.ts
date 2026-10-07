// The three.js twin of the backgrounds' scenes (bench/scenes/backgrounds.ts), which null3D's image
// tests draw. `?bg=sky` draws three.js's sky addon, Sky on WebGLRenderer and SkyMesh on
// WebGPURenderer, as large as its example makes it. `?bg=environment` prefilters the HDR file with
// PMREMGenerator and shows it as `scene.background` with `backgroundBlurriness`,
// `backgroundIntensity` and `backgroundRotation`, and as `scene.environment`. `?bg=cubemap` loads
// the six pictures with CubeTextureLoader. It draws the scene once into an offscreen target of the
// image's size and publishes the pixels, as the hold pages do. `?renderer=webgl` draws with
// WebGLRenderer, and `?renderer=webgpu` with WebGPURenderer.
import type * as ThreeModule from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { pictureUrl } from '../../../tests/pages/lib/picture';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	BACKGROUND_HDR,
	BACKGROUND_SCENES,
	BACKGROUNDS_IMAGE,
	type BackgroundCamera,
	CUBEMAP_CAMERA,
	CUBEMAP_FACES,
	ENVIRONMENT_BACKGROUND,
	ENVIRONMENT_CAMERA,
	ENVIRONMENT_COLOR,
	ENVIRONMENT_SPHERE,
	ENVIRONMENT_SPHERES,
	SKY,
	SKY_BOX,
	SKY_CAMERA,
} from '../../scenes/backgrounds';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { RENDERERS, startThree } from './harness';

/** The sky's size, as three.js's sky example scales it, so the camera stays inside it. */
const SKY_SCALE = 450000;

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const bg = readChoice(params, 'bg', BACKGROUND_SCENES);
	const { three, renderer, readFrame } = await startThree(rendererName);
	// Each renderer takes its addons' classes from its own build, which the harness loaded already.
	const build = (
		rendererName === 'webgpu' ? await import('three/webgpu') : await import('three')
	) as typeof ThreeModule;
	const scene = new three.Scene();
	scene.background = new three.Color('#20242a');
	let view: BackgroundCamera;
	if (bg === 'sky') {
		view = SKY_CAMERA;
		const sky = await makeSky(rendererName);
		sky.scale.setScalar(SKY_SCALE);
		scene.add(sky);
		const { size, position, color } = SKY_BOX;
		const box = new three.Mesh(
			new three.BoxGeometry(size, size, size),
			new three.MeshBasicMaterial({ color }),
		);
		box.position.set(...position);
		scene.add(box);
	} else if (bg === 'environment') {
		view = ENVIRONMENT_CAMERA;
		const pmrem = new build.PMREMGenerator(renderer as unknown as ThreeModule.WebGLRenderer);
		const hdr = await new HDRLoader().setDataType(build.FloatType).loadAsync(BACKGROUND_HDR);
		const env = pmrem.fromEquirectangular(hdr).texture;
		scene.environment = env;
		scene.background = env;
		scene.backgroundBlurriness = ENVIRONMENT_BACKGROUND.blur;
		scene.backgroundIntensity = ENVIRONMENT_BACKGROUND.intensity;
		scene.backgroundRotation.set(...ENVIRONMENT_BACKGROUND.rotation);
		const { radius, widthSegments, heightSegments } = ENVIRONMENT_SPHERE;
		const sphere = new three.SphereGeometry(radius, widthSegments, heightSegments);
		for (const { position, metalness, roughness } of ENVIRONMENT_SPHERES) {
			const material = new three.MeshStandardMaterial({
				color: ENVIRONMENT_COLOR,
				metalness,
				roughness,
			});
			const mesh = new three.Mesh(sphere, material);
			mesh.position.set(position[0], position[1], position[2]);
			scene.add(mesh);
		}
	} else {
		view = CUBEMAP_CAMERA;
		const urls = await Promise.all(CUBEMAP_FACES.map(pictureUrl));
		const cube = await new build.CubeTextureLoader().loadAsync(urls);
		for (const url of urls) URL.revokeObjectURL(url);
		cube.colorSpace = three.SRGBColorSpace;
		scene.background = cube;
	}

	const { width, height } = BACKGROUNDS_IMAGE;
	const { fov, near, far, position, target } = view;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: `background-${bg}`,
		renderer: rendererName,
		n: 1,
		width,
		height,
		pixels: toBase64(pixels),
	};
});

/** three.js's sky for the renderer, with the scene's settings. */
async function makeSky(rendererName: (typeof RENDERERS)[number]): Promise<ThreeModule.Mesh> {
	const settings = {
		turbidity: SKY.turbidity,
		rayleigh: SKY.rayleigh,
		mieCoefficient: SKY.mieCoefficient,
		mieDirectionalG: SKY.mieDirectionalG,
		cloudCoverage: SKY.cloudCoverage,
		cloudDensity: SKY.cloudDensity,
		cloudElevation: SKY.cloudElevation,
		cloudSpeed: SKY.cloudSpeed,
	};
	if (rendererName === 'webgpu') {
		const { SkyMesh } = await import('three/addons/objects/SkyMesh.js');
		const sky = new SkyMesh();
		for (const [name, value] of Object.entries(settings))
			(sky[name as keyof typeof settings] as { value: number }).value = value;
		sky.sunPosition.value.set(...SKY.sunPosition);
		return sky as unknown as ThreeModule.Mesh;
	}
	const { Sky } = await import('three/addons/objects/Sky.js');
	const sky = new Sky();
	const uniforms = (sky.material as ThreeModule.ShaderMaterial).uniforms;
	for (const [name, value] of Object.entries(settings))
		(uniforms[name] as { value: number }).value = value;
	(uniforms.sunPosition as { value: ThreeModule.Vector3 }).value.set(...SKY.sunPosition);
	return sky;
}
