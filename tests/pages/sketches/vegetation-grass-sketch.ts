// The first GPU grass picture: a hill of tufts grown by the vegetation add-on. The grass stands on
// a height function, turns and tints itself by integer hash, and bends in the wind add-on's field,
// which this picture holds still. The camera and the light are fixed, so two runs draw the same
// frame.
import { defineSketch, type MeshArrays } from '@null3d/engine';
import { createGrass, type GrassOptions } from '@null3d/vegetation';
import { createWind } from '@null3d/wind';

/** The hill's width and depth, in meters. */
const SIZE = 34;
/** The tufts at the High preset. */
const COUNT = 20_000;
/** The height of the hill at a point, in meters. */
const hill = (x: number, z: number) => 4.5 * Math.exp(-(x * x + z * z) / 220);

/**
 * The grass that this page grows. The measurement page reads it to report the hill's bands, their
 * tufts, triangles and rows, without reaching into the sketch's own frame.
 */
export const GRASS: GrassOptions = {
	height: hill,
	area: { x: 0, z: 0, size: SIZE },
	count: COUNT,
	seed: 7,
};

/** The hill's ground as a grid of vertices, with its normals from the height's slope. */
function ground(size: number, segments: number): MeshArrays {
	const n = segments + 1;
	const positions = new Float32Array(n * n * 3);
	const normals = new Float32Array(n * n * 3);
	const uvs = new Float32Array(n * n * 2);
	const indices: number[] = [];
	const step = size / segments;
	const e = 0.25;
	for (let r = 0; r < n; r++)
		for (let c = 0; c < n; c++) {
			const x = -size / 2 + c * step;
			const z = -size / 2 + r * step;
			const y = hill(x, z);
			const at = (r * n + c) * 3;
			positions.set([x, y, z], at);
			const dx = (hill(x + e, z) - hill(x - e, z)) / (2 * e);
			const dz = (hill(x, z + e) - hill(x, z - e)) / (2 * e);
			const length = Math.hypot(dx, 1, dz);
			normals.set([-dx / length, 1 / length, -dz / length], at);
			uvs.set([c / segments, r / segments], (r * n + c) * 2);
		}
	for (let r = 0; r < segments; r++)
		for (let c = 0; c < segments; c++) {
			const a = r * n + c;
			// Rows run up the hill, so this winding faces the ground's upper side.
			indices.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
		}
	return { positions, normals, uvs, indices };
}

export default defineSketch((ctx) => {
	const { scene, geometry, materials } = ctx;
	scene.setBackground('#a9c7e6');
	scene.createAmbientLight({ intensity: 0.55, color: '#cfe0ff' });
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.3], intensity: 2.3, color: '#ffe9c8' });
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.1,
		far: 200,
		position: [0, 7, 22],
	});
	camera.lookAt(0, 2, 0);
	scene.setActiveCamera(camera);
	const groundMaterial = materials.standard({ color: '#6f7f45', roughness: 0.95 });
	scene.createMesh({
		mesh: geometry.fromArrays(ground(SIZE, 48)),
		material: groundMaterial,
		receiveShadows: true,
	});
	// The same field that the leaf material reads, held still for this first picture: the grass
	// samples it in every frame, so a later slice switches the air on instead of rewriting the
	// shader.
	const wind = createWind(ctx, {
		camera,
		box: 128,
		grid: 64,
		air: { speed: 0, gustStrength: 0, swirl: 0 },
	});
	const grass = createGrass(ctx, { ...GRASS, wind: wind.field });
	// The preset's share draws from the first frame; a change of preset takes its share then.
	ctx.quality.onChange(() => grass.fit(ctx.quality.preset));
	return {
		onUpdate() {
			wind.update();
			grass.setWindLayer(wind.field);
		},
	};
});
