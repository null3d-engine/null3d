// The add-on's own page, which the listing check opens. A river runs into a lake, both from one
// material, over a bed that rises through the water at the banks, so the soft shore, the foam, the
// caustics and the reflection all draw. The camera circles slowly, because the engine rests a still
// view and the check's cost gate measures the frames that a running page draws.
import { defineSketch, math, type SketchContext } from '@null3d/engine';
import { createWater } from '../src/index.ts';

/** The lake's middle and its two radii, in meters. */
const LAKE = { x: 18, z: 0, rx: 16, rz: 12 } as const;

/** The z of the river's middle at x, and the half width of its water there. */
const middleZ = (x: number) => 1.4 * Math.sin(x * 0.12 + 0.3);
const halfWidth = (x: number) => 2.6 + 0.4 * Math.sin(x * 0.2);

/** How far a point lies from the lake's middle, in radii: 1 at its shore. */
const fromLake = (x: number, z: number) => Math.hypot((x - LAKE.x) / LAKE.rx, z / LAKE.rz);

/** The height of the bed at a point: a river channel that deepens into the lake. */
function bed(x: number, z: number): number {
	const across = Math.abs(z - middleZ(x)) / halfWidth(x);
	const river = 1 - math.smoothstep(across, 0.9, 1.4);
	const lake = 1 - math.smoothstep(fromLake(x, z), 0.92, 1.08);
	return -1.3 * Math.max(river, lake);
}

/** The river's shape and the lake's, from their descriptions. */
function shapes() {
	const middle: [number, number][] = [];
	for (let x = -60; x <= 6; x += 2) middle.push([x, middleZ(x)]);
	const shore = Array.from({ length: 48 }, (_, i) => {
		const angle = (i / 48) * Math.PI * 2;
		return [LAKE.x + Math.cos(angle) * LAKE.rx, Math.sin(angle) * LAKE.rz] as [number, number];
	});
	return [
		{
			kind: 'river' as const,
			middle,
			halfWidth: middle.map(([x]) => halfWidth(x)),
			depth: 1.3,
			speed: 0.5,
		},
		{ kind: 'lake' as const, shore, depth: 1.3, shoreWidth: 3 },
	];
}

export default defineSketch((ctx: SketchContext) => {
	const { scene, geometry, materials, time } = ctx;
	scene.setBackground({ sky: { sunPosition: [0.3, 0.2, -0.9], cloudCoverage: 0.3 } });
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.05,
		far: 600,
		position: [0, 8, 30],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.4, -1, -0.3], intensity: 3, castShadows: true });
	scene.createAmbientLight({ intensity: 0.4 });
	// A bed under the water that rises through it at the banks, which the shore reads.
	const height = 90;
	const cols = 64;
	const rows = 64;
	const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
	const uvs = new Float32Array((cols + 1) * (rows + 1) * 2);
	for (let j = 0; j <= rows; j++)
		for (let i = 0; i <= cols; i++) {
			const x = (i / cols - 0.5) * height;
			const z = (j / rows - 0.5) * height;
			const v = j * (cols + 1) + i;
			positions.set([x, bed(x, z), z], v * 3);
			uvs.set([x / 8, z / 8], v * 2);
		}
	const indices = new Uint32Array(cols * rows * 6);
	for (let j = 0, k = 0; j < rows; j++)
		for (let i = 0; i < cols; i++) {
			const a = j * (cols + 1) + i;
			indices.set([a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2], k);
			k += 6;
		}
	scene.createMesh({
		mesh: geometry.fromArrays({ positions, uvs, indices, computeNormals: true }),
		material: materials.standard({ color: '#6d675a', roughness: 1 }),
		receiveShadows: true,
	});
	// A few stones where the river breaks the water, which the foam map marks.
	const stones = [-40, -22, -8, 2].map((x, i) => ({
		x,
		z: middleZ(x) + (i % 2 ? 1.2 : -1.2),
		r: 0.6,
	}));
	for (const stone of stones)
		scene.createMesh({
			mesh: geometry.sphere({ radius: stone.r, widthSegments: 8, heightSegments: 6 }),
			material: materials.standard({ color: '#7a746a', roughness: 0.9 }),
			position: [stone.x, -stone.r * 0.3, stone.z],
		});
	const water = createWater(ctx, { shapes: shapes() });
	const caustics: [number, number, number] = [0.5, 0.45, 0.35];
	water.setCaustics(caustics);
	return {
		onUpdate() {
			// A slow circle over the river's mouth, so every frame submits a draw.
			const angle = time.now * 0.15;
			camera.setPosition(Math.sin(angle) * 34, 7, Math.cos(angle) * 34);
			camera.lookAt(4, 0, 0);
			water.update();
		},
	};
});
