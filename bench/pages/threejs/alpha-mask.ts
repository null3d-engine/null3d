// The three.js twin of the masked materials' scene (bench/scenes/alpha-mask.ts), which null3D's
// image tests draw. Each masked material is a three.js material with `alphaTest` and vertex colors
// with alpha. `?mode=coverage` adds `alphaToCoverage`, and `?mode=hash` draws with `alphaHash`
// instead of `alphaTest`. `?shadows` makes the sun cast shadows into one map over the scene, from
// two double-sided cards that their map's alpha cuts. It draws the scene once into an offscreen target of the image's size, and
// publishes the pixels as the hold pages do. `?renderer=webgl` draws with WebGLRenderer, and
// `?renderer=webgpu` with WebGPURenderer.
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	cardMesh,
	MASK_BOXES,
	MASK_CAMERA,
	MASK_CARDS,
	MASK_COUNT,
	MASK_IMAGE,
	MASK_MAP_CARDS,
	MASK_MODES,
	MASK_SHADOWS,
	MASK_TILE,
	STRIPE_SIZE,
	stripeTexels,
	turnAboutX,
} from '../../scenes/alpha-mask';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const mode = params.get('mode') ?? 'mask';
	if (!(MASK_MODES as readonly string[]).includes(mode)) throw new Error(`unknown mode ${mode}`);
	const alphaOptions = (cutoff: number) =>
		mode === 'hash'
			? { alphaHash: true }
			: { alphaTest: cutoff, alphaToCoverage: mode === 'coverage' };
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	const sun = lightScene(three, scene);
	const shadows = params.has('shadows');
	if (shadows) {
		// One map in a box around the light's line through the origin, which holds every shadow.
		renderer.shadowMap.enabled = true;
		sun.castShadow = true;
		const { halfSize, threeMapSize } = MASK_SHADOWS;
		sun.shadow.mapSize.set(threeMapSize, threeMapSize);
		const box = sun.shadow.camera;
		[box.left, box.right, box.top, box.bottom] = [-halfSize, halfSize, halfSize, -halfSize];
		[box.near, box.far] = [0, 2 * sun.position.length()];
		box.updateProjectionMatrix();
	}

	for (const { size, position, color } of MASK_BOXES) {
		const box = new three.Mesh(
			new three.BoxGeometry(...size),
			new three.MeshStandardMaterial({ color }),
		);
		box.position.set(...position);
		box.receiveShadow = shadows;
		scene.add(box);
	}

	const { positions, normals, uvs, colors, indices } = cardMesh();
	const card = new three.BufferGeometry();
	card.setAttribute('position', new three.BufferAttribute(positions, 3));
	card.setAttribute('normal', new three.BufferAttribute(normals, 3));
	card.setAttribute('uv', new three.BufferAttribute(uvs, 2));
	card.setAttribute('color', new three.BufferAttribute(colors, 4));
	card.setIndex(new three.BufferAttribute(indices, 1));
	for (const { lit, cutoff, position, rotation } of MASK_CARDS) {
		const options = {
			vertexColors: true,
			...(shadows && { side: three.DoubleSide }),
			...alphaOptions(cutoff),
		};
		const material = lit
			? new three.MeshStandardMaterial(options)
			: new three.MeshBasicMaterial(options);
		const mesh = new three.Mesh(card, material);
		mesh.position.set(...position);
		mesh.rotation.set(...rotation);
		// three.js's shadows ignore vertex alpha, so the ring cards cast none; the null3D sketch
		// leaves theirs out with ?ringShadows=off.
		scene.add(mesh);
	}

	// With shadows, two more cards whose map cuts their shape, and so their shadows.
	if (shadows) {
		const stripes = new three.DataTexture(stripeTexels(), STRIPE_SIZE, STRIPE_SIZE);
		stripes.colorSpace = three.SRGBColorSpace;
		stripes.magFilter = three.LinearFilter;
		stripes.minFilter = three.LinearMipmapLinearFilter;
		stripes.generateMipmaps = true;
		stripes.needsUpdate = true;
		for (const { lit, cutoff, position, rotation } of MASK_MAP_CARDS) {
			const options = { map: stripes, side: three.DoubleSide, ...alphaOptions(cutoff) };
			const material = lit
				? new three.MeshStandardMaterial(options)
				: new three.MeshBasicMaterial(options);
			const mesh = new three.Mesh(card, material);
			mesh.position.set(...position);
			mesh.rotation.set(...rotation);
			mesh.castShadow = true;
			scene.add(mesh);
		}
	}

	const tiles = new three.InstancedMesh(
		card,
		new three.MeshStandardMaterial({ vertexColors: true, ...alphaOptions(MASK_TILE.cutoff) }),
		MASK_TILE.positions.length,
	);
	const matrix = new three.Matrix4();
	const turn = new three.Quaternion(...turnAboutX(MASK_TILE.tilt));
	const scale = new three.Vector3(MASK_TILE.scale, MASK_TILE.scale, MASK_TILE.scale);
	const at = new three.Vector3();
	for (const [k, [x, y, z]] of MASK_TILE.positions.entries())
		tiles.setMatrixAt(k, matrix.compose(at.set(x, y, z), turn, scale));
	scene.add(tiles);

	const { width, height } = MASK_IMAGE;
	const { fov, near, far, position, target } = MASK_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: (mode === 'mask' ? 'alpha-mask' : `alpha-${mode}`) + (shadows ? '-shadows' : ''),
		renderer: rendererName,
		n: MASK_COUNT,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
