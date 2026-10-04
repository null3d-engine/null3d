// Prototype P2's three.js twin of bloom's scene (bench/scenes/bloom.ts), at any size, with one of
// three blooms: ?effect=unreal draws UnrealBloomPass with the settings that ?bloom=soft or
// ?bloom=strong names, as bloom.html does; ?effect=pmndrs draws pmndrs's BloomEffect with its
// defaults, or with the settings in ?pmndrs=<base64url JSON>; ?effect=none draws no bloom. ?width=
// and ?height= set the image's size, 1280 x 720 by default. Each composer has half-float targets
// and ends with ACES, as null3D draws by default, and no MSAA, so null3D's page draws with
// ?antialias=none. The page reads the canvas back at once and publishes it.
import {
	BloomEffect,
	EffectPass,
	EffectComposer as PmndrsComposer,
	RenderPass as PmndrsRenderPass,
	ToneMappingEffect,
	ToneMappingMode,
} from 'postprocessing';
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
	BLOOM_SETTINGS,
	BLOOM_SHAPES,
	BLOOM_SUN,
	type BloomName,
} from '../../scenes/bloom';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { packRows } from '../lib/pixels';

const SUN_DISTANCE = 10;

const params = new URLSearchParams(location.search);
showPageName();

/** The settings in a base64url JSON switch, or an empty object without it. */
function readJson(name: string): Record<string, unknown> {
	const text = params.get(name);
	if (!text) return {};
	return JSON.parse(atob(text.replaceAll('-', '+').replaceAll('_', '/')));
}

run('hold', async () => {
	const effect = readChoice(params, 'effect', ['unreal', 'pmndrs', 'none'] as const);
	const width = Number(params.get('width') ?? 1280);
	const height = Number(params.get('height') ?? 720);
	const renderer = new three.WebGLRenderer({ preserveDrawingBuffer: true, antialias: false });
	renderer.setPixelRatio(1);
	renderer.setSize(width, height);

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
	document.body.append(renderer.domElement);

	if (effect === 'pmndrs') {
		// pmndrs's composer draws into half-float targets and its last pass tone maps with ACES and
		// encodes sRGB, as the renderer's output color space asks.
		renderer.toneMapping = three.NoToneMapping;
		const composer = new PmndrsComposer(renderer, { frameBufferType: three.HalfFloatType });
		composer.setSize(width, height);
		composer.addPass(new PmndrsRenderPass(scene, camera));
		const bloom = new BloomEffect({ mipmapBlur: true, ...readJson('pmndrs') });
		const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
		composer.addPass(new EffectPass(camera, bloom, tone));
		composer.render();
	} else {
		renderer.toneMapping = three.ACESFilmicToneMapping;
		const composer = new EffectComposer(renderer);
		composer.setPixelRatio(1);
		composer.setSize(width, height);
		composer.addPass(new RenderPass(scene, camera));
		if (effect === 'unreal') {
			const name = readChoice(params, 'bloom', Object.keys(BLOOM_SETTINGS) as BloomName[]);
			const { strength, radius, threshold } = BLOOM_SETTINGS[name];
			composer.addPass(
				new UnrealBloomPass(new three.Vector2(width, height), strength, radius, threshold),
			);
		}
		composer.addPass(new OutputPass());
		composer.render();
	}
	const gl = renderer.getContext();
	const bottomFirst = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomFirst);
	const pixels = packRows(bottomFirst, width, height, width * 4, true);
	return {
		scene: `bloom-p2-${effect}`,
		renderer: 'webgl',
		n: BLOOM_SHAPES.length,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
