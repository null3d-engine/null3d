// The standard and unlit materials, for their image tests. `?scene=grid` draws spheres over
// metalness (rows, from 0 at the top to 1) and roughness (columns, from 0 to 1), lit by a sun and
// an ambient light. `?scene=features` draws what a material fixes when it is created, in pairs:
// an emissive sphere beside a plain one, a flat-shaded sphere beside a smooth one, a double-sided
// plane seen from behind beside a single-sided one that draws nothing, and a quad of vertex colors
// with the standard material, with the unlit material, and with a material that ignores them.
import { defineSketch } from '@null3d/engine';

const scene = new URL(import.meta.url).searchParams.get('scene') ?? 'grid';

/** A quad in the XY plane, facing +Z, with a linear color at each corner. */
const QUAD = {
	positions: [-0.6, -0.6, 0, 0.6, -0.6, 0, 0.6, 0.6, 0, -0.6, 0.6, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	colors: [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

export default defineSketch((ctx) => {
	const { scene: world } = ctx;
	world.setBackground('#20242a');
	const camera = world.createPerspectiveCamera({
		fov: 35,
		near: 0.1,
		far: 50,
		position: [0, 0, 12],
		target: [0, 0, 0],
	});
	world.setActiveCamera(camera);
	world.createDirectionalLight({ direction: [-0.5, -0.7, -1], color: '#ffffff', intensity: 3 });
	world.createAmbientLight({ color: '#ffffff', intensity: 0.4 });
	if (scene === 'grid') grid(ctx);
	else features(ctx);
});

type Context = Parameters<Parameters<typeof defineSketch>[0]>[0];

/** Five columns of roughness by three rows of metalness. */
function grid({ scene, materials, geometry }: Context): void {
	const sphere = geometry.sphere({ radius: 0.62, widthSegments: 48, heightSegments: 24 });
	for (let row = 0; row < 3; row++) {
		for (let column = 0; column < 5; column++) {
			const material = materials.standard({
				color: '#d8a860',
				metalness: row / 2,
				roughness: column / 4,
			});
			scene.createMesh({
				mesh: sphere,
				material,
				position: [(column - 2) * 1.5, (1 - row) * 1.5, 0],
			});
		}
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
