// The standard and unlit materials, for their image tests. `?scene=grid` draws the grid of
// bench/scenes/standard-grid.ts: spheres over metalness (rows, from 0 at the top to 1) and roughness
// (columns, from 0 to 1), lit by a sun and an ambient light. `?scene=grid&env=room` or `&env=venice`
// lights the grid with an environment alone (bench/scenes/standard-grid.ts), and `&rotate` turns
// the environment a quarter turn. ?tone=none turns off the engine's
// default of AgX, as the parity test asks: the grid's three.js twin draws with no tone mapping,
// three.js's default. `?scene=features` draws what a material fixes when it is created, in
// pairs: an emissive sphere beside a plain one, a flat-shaded sphere beside a smooth one, a
// double-sided plane seen from behind beside a single-sided one that draws nothing, and a quad of
// vertex colors with the standard material, with the unlit material, and with a material that
// ignores them.
import { defineSketch } from '@null3d/engine';
import {
	GRID_AMBIENT,
	GRID_BACKGROUND,
	GRID_CAMERA,
	GRID_CELLS,
	GRID_COLOR,
	GRID_ENVIRONMENT_ROTATION,
	GRID_ENVIRONMENTS,
	GRID_SPHERE,
	GRID_SUN,
	type GridEnvironmentName,
} from '../../../bench/scenes/standard-grid';
import { sampleEnvironment } from '../../../tools/lib/sample-url';

const params = new URL(import.meta.url).searchParams;
const scene = params.get('scene') ?? 'grid';
const environment = params.get('env') as GridEnvironmentName | null;

/** A quad in the XY plane, facing +Z, with a linear color at each corner. */
const QUAD = {
	positions: [-0.6, -0.6, 0, 0.6, -0.6, 0, 0.6, 0.6, 0, -0.6, 0.6, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	colors: [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

export default defineSketch(async (ctx) => {
	const { scene: world, post, assets } = ctx;
	if (params.get('tone') === 'none') post.set({ toneMapping: 'none' });
	world.setBackground(GRID_BACKGROUND);
	world.setActiveCamera(world.createPerspectiveCamera(GRID_CAMERA));
	if (environment) {
		const source = GRID_ENVIRONMENTS[environment];
		const env =
			'builtin' in source
				? await assets.builtinEnvironment(source.builtin)
				: await assets.loadEnvironment(sampleEnvironment(source.hdr));
		const rotation = params.has('rotate') ? GRID_ENVIRONMENT_ROTATION : undefined;
		world.setEnvironment(env, { rotation });
	} else {
		world.createDirectionalLight(GRID_SUN);
		world.createAmbientLight(GRID_AMBIENT);
	}
	if (scene === 'grid') grid(ctx);
	else features(ctx);
});

type Context = Parameters<Parameters<typeof defineSketch>[0]>[0];

/** Five columns of roughness by three rows of metalness. */
function grid({ scene, materials, geometry }: Context): void {
	const sphere = geometry.sphere(GRID_SPHERE);
	for (const { position, metalness, roughness } of GRID_CELLS) {
		const material = materials.standard({ color: GRID_COLOR, metalness, roughness });
		scene.createMesh({ mesh: sphere, material, position: [...position] });
	}
}

/** The fixed options, each beside the look without it. */
function features({ scene, materials, geometry }: Context): void {
	const smooth = geometry.sphere({ radius: 0.6, widthSegments: 12, heightSegments: 8 });
	const plain = materials.standard({ color: '#303440' });
	const glowing = materials.standard({
		color: '#303440',
		emissive: '#ff6a20',
		emissiveIntensity: 1.5,
	});
	scene.createMesh({ mesh: smooth, material: glowing, position: [-4.2, 1.5, 0] });
	scene.createMesh({ mesh: smooth, material: plain, position: [-2.8, 1.5, 0] });

	const blue = materials.standard({ color: '#8098d0', roughness: 0.4 });
	const faceted = materials.standard({ color: '#8098d0', roughness: 0.4, flatShading: true });
	scene.createMesh({ mesh: smooth, material: faceted, position: [-0.7, 1.5, 0] });
	scene.createMesh({ mesh: smooth, material: blue, position: [0.7, 1.5, 0] });

	// Both planes face away from the camera: only the double-sided one draws.
	const plane = geometry.plane({ width: 1.2, height: 1.2 });
	const both = materials.standard({ color: '#d0d8a0', doubleSided: true });
	const front = materials.standard({ color: '#d0d8a0' });
	for (const [x, material] of [
		[2.8, both],
		[4.2, front],
	] as const) {
		const back = scene.createMesh({ mesh: plane, material, position: [x, 1.5, 0] });
		back.setRotationEuler(0.3, Math.PI - 0.4, 0);
	}

	const quad = geometry.fromArrays(QUAD);
	const lit = materials.standard({ vertexColors: true, roughness: 0.6 });
	const unlit = materials.unlit({ vertexColors: true });
	const ignored = materials.standard({ roughness: 0.6 });
	for (const [x, material] of [
		[-2.4, lit],
		[0, unlit],
		[2.4, ignored],
	] as const) {
		scene.createMesh({ mesh: quad, material, position: [x, -1.4, 0] });
	}
}
