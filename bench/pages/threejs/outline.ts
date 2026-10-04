// The three.js twin of the outline's scene (bench/scenes/outline.ts), which null3D's image tests
// draw. It draws one frame with an EffectComposer: a RenderPass, an OutlinePass with the settings
// that ?outline=plain or ?outline=glow names and the scene's outlined shapes as its selected
// objects, and an OutputPass, which applies the ACES tone mapping that null3D applies by default.
// The OutputPass draws into the canvas, which the page reads back at once and publishes. The
// composer's targets have no MSAA, so null3D's page draws with ?antialias=none. Only WebGLRenderer
// draws it: WebGPURenderer's outline is a node of its own.
import * as three from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	OUTLINE_AMBIENT,
	OUTLINE_BACKGROUND,
	OUTLINE_CAMERA,
	OUTLINE_IMAGE,
	OUTLINE_SETTINGS,
	OUTLINE_SHAPES,
	OUTLINE_SUN,
	type OutlineName,
} from '../../scenes/outline';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { packRows } from '../lib/pixels';

/** The sun's distance from the origin. Its light travels from there toward the origin. */
const SUN_DISTANCE = 10;

/** A three.js color from a hex string, in sRGB, or from linear components. */
function colorOf(color: string | readonly [number, number, number]): three.Color {
	return typeof color === 'string' ? new three.Color(color) : new three.Color(...color);
}

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const name = readChoice(params, 'outline', Object.keys(OUTLINE_SETTINGS) as OutlineName[]);
	const settings = OUTLINE_SETTINGS[name];
	const { width, height } = OUTLINE_IMAGE;
	const renderer = new three.WebGLRenderer({ preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(width, height);
	renderer.toneMapping = three.ACESFilmicToneMapping;

	const scene = new three.Scene();
	scene.background = new three.Color(OUTLINE_BACKGROUND);
	const sun = new three.DirectionalLight(OUTLINE_SUN.color, OUTLINE_SUN.intensity);
	const [dx, dy, dz] = OUTLINE_SUN.direction;
	sun.position.set(-dx, -dy, -dz).normalize().multiplyScalar(SUN_DISTANCE);
	scene.add(sun);
	scene.add(new three.AmbientLight(OUTLINE_AMBIENT.color, OUTLINE_AMBIENT.intensity));
	const selected: three.Object3D[] = [];
	for (const shape of OUTLINE_SHAPES) {
		const [x, y, z] = shape.size;
		const geometry =
			shape.kind === 'box' ? new three.BoxGeometry(x, y, z) : new three.SphereGeometry(x, 32, 16);
		const material = new three.MeshStandardMaterial({
			color: shape.color,
			roughness: 0.7,
			metalness: 0,
		});
		const mesh = new three.Mesh(geometry, material);
		mesh.position.set(...shape.position);
		scene.add(mesh);
		if (shape.outlined) selected.push(mesh);
	}
	const { position, target, fov, near, far } = OUTLINE_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const composer = new EffectComposer(renderer);
	composer.setPixelRatio(1);
	composer.setSize(width, height);
	composer.addPass(new RenderPass(scene, camera));
	const outline = new OutlinePass(new three.Vector2(width, height), scene, camera, selected);
	outline.visibleEdgeColor = colorOf(settings.color);
	outline.hiddenEdgeColor = colorOf(settings.hiddenColor);
	outline.edgeStrength = settings.strength;
	outline.edgeThickness = settings.thickness;
	outline.edgeGlow = settings.glow;
	composer.addPass(outline);
	composer.addPass(new OutputPass());
	document.body.append(renderer.domElement);
	composer.render();
	const gl = renderer.getContext();
	const bottomFirst = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomFirst);
	const pixels = packRows(bottomFirst, width, height, width * 4, true);
	return {
		scene: `outline-${name}`,
		renderer: 'webgl',
		n: OUTLINE_SHAPES.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
