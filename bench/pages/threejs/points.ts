// The three.js twin of the points' scene (bench/scenes/points.ts), which null3D's image tests draw.
// Each cloud is one `Points` with a `PointsMaterial` and vertex colors. A point sized in world units
// takes three.js's size from `threePointSize`, as three.js's size attenuation leaves out the
// projection's scale. three.js sizes its points from the renderer's own size and pixel ratio, so
// the page gives the renderer the image's size at a ratio of 1 before it draws. It draws the scene
// once into an offscreen target of the image's size, and publishes the pixels as the hold pages do.
// Only `?renderer=webgl` draws it: WebGPURenderer draws the points of `Points` one pixel wide.
import { pictureUrl } from '../../../tests/pages/lib/picture';
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	discRows,
	POINT_BOXES,
	POINT_CAMERA,
	POINT_CLOUDS,
	POINT_COUNT,
	POINT_IMAGE,
	threePointSize,
} from '../../scenes/points';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	if (rendererName !== 'webgl')
		throw new Error('WebGPURenderer draws points one pixel wide; use ?renderer=webgl.');
	const { three, renderer, readFrame } = await startThree(rendererName);
	const { width, height } = POINT_IMAGE;
	renderer.setPixelRatio(1);
	renderer.setSize(width, height, false);
	const scene = new three.Scene();
	lightScene(three, scene);

	for (const { size, position, color } of POINT_BOXES) {
		const box = new three.Mesh(
			new three.BoxGeometry(...size),
			new three.MeshStandardMaterial({ color }),
		);
		box.position.set(...position);
		scene.add(box);
	}

	const url = await pictureUrl(discRows());
	const disc = await new three.TextureLoader().loadAsync(url);
	URL.revokeObjectURL(url);
	disc.colorSpace = three.SRGBColorSpace;
	const { fov, near, far, position, target } = POINT_CAMERA;
	for (const cloud of POINT_CLOUDS) {
		const geometry = new three.BufferGeometry();
		geometry.setAttribute('position', new three.Float32BufferAttribute(cloud.positions.flat(), 3));
		// three.js converts each sRGB color to its linear working space, as null3D's color helper does.
		const linear = cloud.colors.flatMap((hex) => new three.Color(hex).toArray());
		geometry.setAttribute('color', new three.Float32BufferAttribute(linear, 3));
		const material = new three.PointsMaterial({
			size: cloud.pixels ? cloud.size : threePointSize(cloud.size, fov),
			sizeAttenuation: !cloud.pixels,
			vertexColors: true,
			map: cloud.map ? disc : null,
			transparent: cloud.alphaMode === 'blend',
			alphaTest: cloud.alphaMode === 'mask' ? 0.5 : 0,
			// null3D's masks fade their cut edges into MSAA coverage by default (D-82).
			alphaToCoverage: cloud.alphaMode === 'mask',
			opacity: cloud.opacity,
		});
		scene.add(new three.Points(geometry, material));
	}

	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: 'points',
		renderer: rendererName,
		n: POINT_COUNT,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
