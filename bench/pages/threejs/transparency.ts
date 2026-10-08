// The three.js twin of the transparent planes' scene (bench/scenes/transparency.ts), which
// null3D's image tests draw. Each see-through material has `transparent: true` and three.js's
// default normal blending. `?solids` draws the double-sided solids' scene instead, whose materials
// have `side: DoubleSide`, and `forceSinglePass` where the scene says. It draws the scene once into
// an offscreen target of the image's size, and publishes the pixels as the hold pages do.
// `?renderer=webgl` draws with WebGLRenderer, and `?renderer=webgpu` with WebGPURenderer.
import { run, toBase64 } from '../../../tests/pages/lib/result';
import {
	GLASS_BOXES,
	GLASS_CAMERA,
	GLASS_COUNT,
	GLASS_IMAGE,
	GLASS_PLANES,
	GLASS_SOLID_COUNT,
	GLASS_SOLID_SEGMENTS,
	GLASS_SOLIDS,
	GLASS_SPHERE,
	GLASS_SPHERE_SEGMENTS,
	type GlassSolid,
} from '../../scenes/transparency';
import { showPageName } from '../lib/fit';
import { readChoice } from '../lib/options';
import { lightScene, RENDERERS, startThree } from './harness';

const params = new URLSearchParams(location.search);
/** True for the double-sided solids' scene. */
const SOLIDS = params.has('solids');
showPageName();
run('hold', async () => {
	const rendererName = readChoice(params, 'renderer', RENDERERS);
	const { three, renderer, readFrame } = await startThree(rendererName);
	const scene = new three.Scene();
	lightScene(three, scene);

	for (const { size, position, color } of GLASS_BOXES) {
		const box = new three.Mesh(
			new three.BoxGeometry(...size),
			new three.MeshStandardMaterial({ color }),
		);
		box.position.set(...position);
		scene.add(box);
	}
	const [around, along] = GLASS_SOLID_SEGMENTS;
	const shapeOf = ({ shape, size }: GlassSolid) => {
		if (shape === 'box') return new three.BoxGeometry(...size);
		if (shape === 'sphere') return new three.SphereGeometry(size[0], around, along);
		return new three.CylinderGeometry(size[0], size[0], size[1], around, 1, true);
	};
	for (const solid of SOLIDS ? GLASS_SOLIDS : []) {
		const { lit, color, opacity, position, turn, singlePass } = solid;
		const options = {
			color,
			opacity,
			transparent: true,
			side: three.DoubleSide,
			forceSinglePass: singlePass,
		};
		const material = lit
			? new three.MeshStandardMaterial(options)
			: new three.MeshBasicMaterial(options);
		const mesh = new three.Mesh(shapeOf(solid), material);
		mesh.position.set(...position);
		mesh.rotation.set(0, turn, 0);
		scene.add(mesh);
	}
	for (const { size, lit, color, opacity, position, turn } of SOLIDS ? [] : GLASS_PLANES) {
		const options = { color, opacity, transparent: true, side: three.DoubleSide };
		const material = lit
			? new three.MeshStandardMaterial(options)
			: new three.MeshBasicMaterial(options);
		const plane = new three.Mesh(new three.PlaneGeometry(...size), material);
		plane.position.set(...position);
		plane.rotation.set(0, turn, 0);
		scene.add(plane);
	}
	if (!SOLIDS) {
		const sphere = new three.Mesh(
			new three.SphereGeometry(GLASS_SPHERE.radius, ...GLASS_SPHERE_SEGMENTS),
			new three.MeshStandardMaterial({
				color: GLASS_SPHERE.color,
				opacity: GLASS_SPHERE.opacity,
				transparent: true,
			}),
		);
		sphere.position.set(...GLASS_SPHERE.position);
		scene.add(sphere);
	}

	const { width, height } = GLASS_IMAGE;
	const { fov, near, far, position, target } = GLASS_CAMERA;
	const camera = new three.PerspectiveCamera(fov, width / height, near, far);
	camera.position.set(...position);
	camera.lookAt(...target);

	const pixels = await readFrame(width, height, () => renderer.render(scene, camera));
	return {
		scene: SOLIDS ? 'transparency-solids' : 'transparency',
		renderer: rendererName,
		n: SOLIDS ? GLASS_SOLID_COUNT : GLASS_COUNT,
		width,
		height,
		pixels: toBase64(pixels),
	};
});
