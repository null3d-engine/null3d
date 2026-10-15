// The orthographic camera's scene (bench/scenes/ortho-camera.ts), which the parity test also draws
// with three.js. ?x= moves the scene and the camera that many meters along x, and the image must
// not change. ?edges makes the camera from four edges twice the view's size, then halves them with
// setOrthoHeight, which must draw the same view as a height whose width follows the canvas. The
// three.js twin draws with no tone mapping, three.js's default, so the sketch turns off the engine's
// default curve.
import { defineSketch } from '@null3d/engine';
import {
	AMBIENT,
	BACKGROUND,
	ORTHO_BOXES,
	ORTHO_CAMERA,
	ORTHO_CUBE_COLOR,
	ORTHO_CUBE_SIZE,
	ORTHO_CUBES,
	ORTHO_IMAGE,
	SUN,
} from '../../../bench/scenes/ortho-camera';

const params = new URL(import.meta.url).searchParams;
/** How far along x the scene sits, from the ?x= switch. */
const X = Number(params.get('x') ?? '0');

/** A position of the scene, moved along x by the ?x= switch. */
const at = (p: readonly [number, number, number]): [number, number, number] => [
	X + p[0],
	p[1],
	p[2],
];

export default defineSketch(({ scene, materials, geometry, post }) => {
	if (!Number.isFinite(X)) throw new Error('?x= must be a number of meters');
	post.set({ toneMapping: 'none' });
	scene.setBackground(BACKGROUND);
	scene.createDirectionalLight({
		direction: SUN.direction,
		color: SUN.color,
		intensity: SUN.intensity,
	});
	scene.createAmbientLight({ color: AMBIENT.color, intensity: AMBIENT.intensity });

	const { position, target, height, near, far } = ORTHO_CAMERA;
	const place = { near, far, position: at(position), target: at(target) };
	const aspect = ORTHO_IMAGE.width / ORTHO_IMAGE.height;
	const camera = params.has('edges')
		? scene.createOrthographicCamera({
				...place,
				left: -height * aspect,
				right: height * aspect,
				top: height,
				bottom: -height,
			})
		: scene.createOrthographicCamera({ ...place, height });
	if (params.has('edges')) camera.setOrthoHeight(height);
	scene.setActiveCamera(camera);

	for (const { size, position: center, color, lit } of ORTHO_BOXES) {
		const [width, boxHeight, depth] = size;
		scene.createMesh({
			mesh: geometry.box({ width, height: boxHeight, depth }),
			material: lit ? materials.standard({ color }) : materials.unlit({ color }),
			position: at(center),
		});
	}

	const cube = geometry.box({
		width: ORTHO_CUBE_SIZE,
		height: ORTHO_CUBE_SIZE,
		depth: ORTHO_CUBE_SIZE,
	});
	const cubes = scene.createInstances(cube, ORTHO_CUBES.length, {
		material: materials.standard({ color: ORTHO_CUBE_COLOR }),
	});
	for (const [k, center] of ORTHO_CUBES.entries()) cubes.positions.set(at(center), k * 3);
	cubes.markDirty();
	return {};
});
