// The three.js twin of bloom's scene (bench/scenes/bloom.ts), which null3D's image tests draw. It
// draws one frame with an EffectComposer: a RenderPass, an UnrealBloomPass with the settings that
// ?bloom=soft or ?bloom=strong names, and an OutputPass, which applies the AgX tone mapping that
// null3D applies by default. The OutputPass draws into the canvas, which the page reads back at once
// and publishes. The composer's targets have no MSAA, so null3D's page draws with ?antialias=none.
// Only WebGLRenderer draws it: WebGPURenderer's bloom is a node of its own.
import * as three from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	BLOOM_AMBIENT,
	BLOOM_BACKGROUND,
	BLOOM_CAMERA,
	BLOOM_IMAGE,
	BLOOM_SETTINGS,
	BLOOM_SHAPES,
	BLOOM_SUN,
	type BloomName,
} from '../../scenes/bloom';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { packRows } from '../lib/pixels';

/** The sun's distance from the origin. Its light travels from there toward the origin. */
const SUN_DISTANCE = 10;

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const name = readChoice(params, 'bloom', Object.keys(BLOOM_SETTINGS) as BloomName[]);
	const { strength, radius, threshold } = BLOOM_SETTINGS[name];
	const { width, height } = BLOOM_IMAGE;
	const renderer = new three.WebGLRenderer({ preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(width, height);
	renderer.toneMapping = three.AgXToneMapping;

	const scene = new three.Scene();
	scene.background = new three.Color(BLOOM_BACKGROUND);
	const sun = new three.DirectionalLight(BLOOM_SUN.color, BLOOM_SUN.intensity);
	const [dx, dy, dz] = BLOOM_SUN.direction;
	sun.position.set(-dx, -dy, -dz).normalize().multiplyScalar(SUN_DISTANCE);
	scene.add(sun);
	scene.add(new three.AmbientLight(BLOOM_AMBIENT.color, BLOOM_AMBIENT.intensity));
	for (const shape of BLOOM_SHAPES) {
		const [x, y, z] = shape.size;
		const geometry =
			shape.kind === 'box' ? new three.BoxGeometry(x, y, z) : new three.SphereGeometry(x, 32, 16);
		const material = new three.MeshStandardMaterial({
			color: shape.color,
			roughness: shape.roughness,
			metalness: 0,
			emissive: shape.emissive,
			emissiveIntensity: shape.emissiveIntensity,
		});
		const mesh = new three.Mesh(geometry, material);
		mesh.position.set(...shape.position);
		scene.add(mesh);
	}
	const { position, target, fov, near, far } = BLOOM_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const composer = new EffectComposer(renderer);
	composer.setPixelRatio(1);
	composer.setSize(width, height);
	composer.addPass(new RenderPass(scene, camera));
	composer.addPass(
		new UnrealBloomPass(new three.Vector2(width, height), strength, radius, threshold),
	);
	composer.addPass(new OutputPass());
	document.body.append(renderer.domElement);
	composer.render();
	const gl = renderer.getContext();
	const bottomFirst = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomFirst);
	const pixels = packRows(bottomFirst, width, height, width * 4, true);
	return {
		scene: `bloom-${name}`,
		renderer: 'webgl',
		n: BLOOM_SHAPES.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
