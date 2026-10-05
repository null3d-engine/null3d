// The three.js twin of ambient occlusion's scene (bench/scenes/ao.ts), which null3D's image tests
// draw. It draws one frame with an EffectComposer: a RenderPass, a GTAOPass with the settings that
// ?ao=default or ?ao=wide names, and an OutputPass, which applies the AgX tone mapping that null3D
// applies by default. GTAOPass multiplies the whole image by the occlusion, which equals null3D's
// darker ambient light in a scene that ambient light alone lights. The OutputPass draws into the
// canvas, which the page reads back at once and publishes. The composer's targets have no MSAA, so
// null3D's page draws with ?antialias=none. Only WebGLRenderer draws it: WebGPURenderer's ambient
// occlusion is a node of its own.
import * as three from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	AO_AMBIENT,
	AO_BACKGROUND,
	AO_CAMERA,
	AO_IMAGE,
	AO_SETTINGS,
	AO_SHAPES,
	type AoName,
} from '../../scenes/ao';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { packRows } from '../lib/pixels';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const name = readChoice(params, 'ao', Object.keys(AO_SETTINGS) as AoName[]);
	const { radius, thickness, distanceExponent, distanceFalloff, scale } = AO_SETTINGS[name];
	const { width, height } = AO_IMAGE;
	const renderer = new three.WebGLRenderer({ preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(width, height);
	renderer.toneMapping = three.AgXToneMapping;

	const scene = new three.Scene();
	scene.background = new three.Color(AO_BACKGROUND);
	scene.add(new three.AmbientLight(AO_AMBIENT.color, AO_AMBIENT.intensity));
	for (const shape of AO_SHAPES) {
		const [x, y, z] = shape.size;
		const geometry =
			shape.kind === 'box' ? new three.BoxGeometry(x, y, z) : new three.SphereGeometry(x, 32, 16);
		const material = new three.MeshStandardMaterial({
			color: shape.color,
			roughness: 1,
			metalness: 0,
		});
		const mesh = new three.Mesh(geometry, material);
		mesh.position.set(...shape.position);
		scene.add(mesh);
	}
	const { position, target, fov, near, far } = AO_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const composer = new EffectComposer(renderer);
	composer.setPixelRatio(1);
	composer.setSize(width, height);
	composer.addPass(new RenderPass(scene, camera));
	const ao = new GTAOPass(scene, camera, width, height);
	ao.updateGtaoMaterial({
		radius,
		thickness,
		distanceExponent,
		distanceFallOff: distanceFalloff,
		scale,
		samples: 16,
	});
	composer.addPass(ao);
	composer.addPass(new OutputPass());
	document.body.append(renderer.domElement);
	composer.render();
	const gl = renderer.getContext();
	const bottomFirst = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomFirst);
	const pixels = packRows(bottomFirst, width, height, width * 4, true);
	return {
		scene: `ao-${name}`,
		renderer: 'webgl',
		n: AO_SHAPES.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
