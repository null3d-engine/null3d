// The bright scene of the tone mapping tests (tests/pages/lib/bright-scene.ts) in three.js, under
// the tone mapping and the exposure in stops that ?tone= and ?stops= name. WebGLRenderer tone maps
// only what it draws into the canvas, so the page draws one frame there, reads the canvas back at
// once, and publishes the pixels. The tone mapping spec compares them with null3D's frame.
import * as three from 'three';
import {
	ACESFilmicToneMapping,
	AgXToneMapping,
	LinearToneMapping,
	NeutralToneMapping,
	type ToneMapping,
} from 'three';
import {
	BACKGROUND,
	type BrightToneMapping,
	CAMERA,
	exposureOf,
	SIZE,
	SUN,
	tiles,
} from '../../../tests/pages/lib/bright-scene';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import { packRows } from '../lib/pixels';

/** The sun's distance from the origin. Its light travels from there toward the origin. */
const SUN_DISTANCE = 10;

/** three.js's tone mapping for each of null3D's. */
const THREE_TONE_MAPPINGS: Readonly<Record<BrightToneMapping, ToneMapping>> = {
	aces: ACESFilmicToneMapping,
	agx: AgXToneMapping,
	neutral: NeutralToneMapping,
	none: LinearToneMapping,
};

const params = new URLSearchParams(location.search);

run('tone-mapping', async () => {
	const tone = (params.get('tone') ?? 'aces') as BrightToneMapping;
	if (!Object.hasOwn(THREE_TONE_MAPPINGS, tone))
		throw new Error(`?tone=${tone} is not a tone mapping`);
	const exposure = exposureOf(Number(params.get('stops') ?? '0'));
	const [width, height] = SIZE;
	const renderer = new three.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(width, height);
	renderer.toneMapping = THREE_TONE_MAPPINGS[tone];
	renderer.toneMappingExposure = exposure;

	const scene = new three.Scene();
	scene.background = new three.Color(BACKGROUND);
	const sun = new three.DirectionalLight(0xffffff, SUN.intensity);
	const [dx, dy, dz] = SUN.direction;
	sun.position.set(-dx, -dy, -dz).multiplyScalar(SUN_DISTANCE);
	scene.add(sun);
	const all = tiles();
	const [first] = all;
	if (!first) throw new Error('the bright scene has no tiles');
	const box = new three.BoxGeometry(...first.size);
	for (const tile of all) {
		// Color.setRGB reads linear components, as null3D's color arrays are.
		const color = new three.Color().setRGB(...tile.color);
		const mesh = new three.Mesh(box, new three.MeshLambertMaterial({ color }));
		mesh.position.set(...tile.position);
		scene.add(mesh);
	}
	const camera = new three.PerspectiveCamera(CAMERA.fov, width / height, CAMERA.near, CAMERA.far);
	camera.position.set(...CAMERA.position);
	camera.lookAt(0, 0, 0);

	document.body.append(renderer.domElement);
	renderer.render(scene, camera);
	const gl = renderer.getContext();
	const bottomFirst = new Uint8Array(width * height * 4);
	gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomFirst);
	const pixels = packRows(bottomFirst, width, height, width * 4, true);
	return { tone, exposure, width, height, pixels: toBase64(pixels) };
});
