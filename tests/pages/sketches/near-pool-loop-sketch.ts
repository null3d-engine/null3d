// The vegetation add-on's near pool over a grown oak, for the test that checks that the pool's
// per-frame call allocates nothing. The engine runs this sketch on the page's own thread, so the
// loop is a function on the page's global object that the test calls. Each iteration is a frame's
// call while the camera stands: the pool reads the camera and finds that nothing moved.
import { defineSketch } from '@null3d/engine';
import {
	createNearPool,
	growPlant,
	placePlants,
	plantMaterials,
	prepareSpecies,
} from '@null3d/vegetation';
import { nearOak } from '../../../packages/vegetation/src/render/near-oak.fixture';

/** The page's global object, which holds the loop once the pool has settled. */
const scope = globalThis as { __null3dNearPoolLoop?: (iterations: number) => void };

export default defineSketch(async (ctx) => {
	const { scene } = ctx;
	const camera = scene.createPerspectiveCamera({
		fov: 60,
		near: 0.1,
		far: 500,
		position: [3, 1.7, 4],
		target: [0, 8, 0],
	});
	scene.setActiveCamera(camera);
	const kit = await prepareSpecies(ctx, nearOak());
	const asset = await growPlant(kit, { seed: 11, variant: 0, near: true });
	const pool = createNearPool(ctx, { camera });
	placePlants(
		ctx,
		kit,
		[asset],
		{
			count: 1,
			position: new Float32Array(3),
			turn: new Float32Array(1),
			scale: new Float32Array([1]),
			variant: new Uint8Array(1),
		},
		{ materials: plantMaterials(ctx, kit), near: pool, view: { height: 1080, fov: 60 } },
	);
	return {
		onUpdate() {
			pool.update();
			// Once the pool has answered for the standing camera, the test may sample its calls.
			if (!scope.__null3dNearPoolLoop && pool.copies > 0)
				scope.__null3dNearPoolLoop = (iterations) => {
					for (let i = 0; i < iterations; i++) pool.update();
				};
		},
	};
});
