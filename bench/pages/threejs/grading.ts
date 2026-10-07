// The three.js twin of color grading's scene (bench/scenes/grading.ts), which null3D's image tests
// draw. It draws one frame with an EffectComposer: a RenderPass, an OutputPass, which applies the
// AgX tone mapping that null3D's page sets and encodes sRGB, then a LUTPass with the warm
// table from its .cube file through LUTCubeLoader, and with ?mix at the tests' intensity and a
// ShaderPass of VignetteShader. The last pass draws into the canvas, which the page reads back at
// once and publishes. The composer's targets have no MSAA, so null3D's page draws with
// ?antialias=none. Only WebGLRenderer draws it: WebGPURenderer grades with nodes of its own.
import * as three from 'three';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	GRADING_AMBIENT,
	GRADING_BACKGROUND,
	GRADING_BOXES,
	GRADING_CAMERA,
	GRADING_IMAGE,
	GRADING_INTENSITY,
	GRADING_LUTS,
	GRADING_SUN,
	GRADING_VIGNETTE_THREE,
} from '../../scenes/grading';
import { showPageName } from '../lib/fit';
import { packRows } from '../lib/pixels';

/** The sun's distance from the origin. Its light travels from there toward the origin. */
const SUN_DISTANCE = 10;

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const mix = params.has('mix');
	const { width, height } = GRADING_IMAGE;
	const renderer = new three.WebGLRenderer({ preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(width, height);
	renderer.toneMapping = three.AgXToneMapping;

	const scene = new three.Scene();
	scene.background = new three.Color(GRADING_BACKGROUND);
	const sun = new three.DirectionalLight(GRADING_SUN.color, GRADING_SUN.intensity);
	const [dx, dy, dz] = GRADING_SUN.direction;
	sun.position.set(-dx, -dy, -dz).normalize().multiplyScalar(SUN_DISTANCE);
	scene.add(sun);
	scene.add(new three.AmbientLight(GRADING_AMBIENT.color, GRADING_AMBIENT.intensity));
	for (const box of GRADING_BOXES) {
		const material = new three.MeshStandardMaterial({
			color: box.color,
			roughness: 0.8,
			metalness: 0,
		});
		const mesh = new three.Mesh(new three.BoxGeometry(...box.size), material);
		mesh.position.set(...box.position);
		scene.add(mesh);
	}
	const { position, target, fov, near, far } = GRADING_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const table = await new LUTCubeLoader().loadAsync(GRADING_LUTS.warm);
	const composer = new EffectComposer(renderer);
	composer.setPixelRatio(1);
	composer.setSize(width, height);
	composer.addPass(new RenderPass(scene, camera));
	composer.addPass(new OutputPass());
	composer.addPass(new LUTPass({ lut: table.texture3D, intensity: mix ? GRADING_INTENSITY : 1 }));
	if (mix) {
		const vignette = new ShaderPass(VignetteShader);
		const { offset, darkness } = vignette.uniforms;
		if (!offset || !darkness) throw new Error('VignetteShader has no offset or darkness uniform');
		offset.value = GRADING_VIGNETTE_THREE.offset;
		darkness.value = GRADING_VIGNETTE_THREE.darkness;
		composer.addPass(vignette);
	}
	document.body.append(renderer.domElement);
	composer.render();
	const gl = renderer.getContext();
	const bottomFirst = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomFirst);
	const pixels = packRows(bottomFirst, width, height, width * 4, true);
	return {
		scene: mix ? 'lut-vignette' : 'lut-cube',
		renderer: 'webgl',
		n: GRADING_BOXES.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
