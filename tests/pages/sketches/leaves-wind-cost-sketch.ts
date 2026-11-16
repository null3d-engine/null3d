// Two ways for leaves to ride the air, for their cost: the offset form pushes a closed-form fall by
// the field where each leaf passes, and the state form gives each leaf a place and a speed of its own
// that a pass steps through the field. ?ride= and ?count= pick one side; the page measures its frame.
// The camera holds still and the leaves fill one box, so the frame's work is the leaves' alone.
import { defineSketch, type SketchContext } from '@null3d/engine';
import {
	createFloatingLeaves,
	type FloatingLeaves,
	type FloatingLeavesRide,
} from '@null3d/vegetation';
import { createWind } from '@null3d/wind';

const params = new URL(import.meta.url).searchParams;
/** The form that the page draws. */
const RIDE: FloatingLeavesRide = params.get('ride') === 'offset' ? 'offset' : 'state';
/** The leaves that the page asks for. */
const REQUESTED = Math.max(1, Math.floor(Number(params.get('count') ?? 500)));
/** The box that the leaves fill, in meters: its middle, its width and its heights. */
const AREA = { x: 0, z: 0, size: 32, high: 14, low: 0 };

export default defineSketch((ctx: SketchContext) => {
	const { scene, geometry, materials, page } = ctx;
	scene.setBackground({ sky: { sunPosition: [0.4, 0.5, -0.6], cloudCoverage: 0.2 } });
	const camera = scene.createPerspectiveCamera({
		fov: 42,
		near: 0.5,
		far: 400,
		position: [0, 7, 24],
		target: [0, 4, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-0.5, -1, -0.3], intensity: 3, castShadows: true });
	scene.createAmbientLight({ intensity: 0.45 });
	scene.createMesh({
		mesh: geometry.plane({ width: 200, height: 200 }),
		material: materials.standard({ color: '#5f6b4a', roughness: 1 }),
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});
	const wind = createWind(ctx, { camera, box: 64, grid: 64 });
	// A phone's instance limit counts the scene's own objects too, so the load keeps room for them.
	const count = Math.max(1, Math.min(REQUESTED, ctx.engine.capabilities.maxInstances - 2048));
	let leaves: FloatingLeaves | undefined = createFloatingLeaves(ctx, {
		wind: wind.field,
		camera,
		count,
		area: AREA,
		ride: RIDE,
		seed: 21,
		size: 0.16,
	});

	page.onMessage((name) => {
		if (name === 'read') {
			page.post('state', { ride: RIDE, count, requested: REQUESTED });
		}
	});

	return {
		onUpdate(dt: number) {
			wind.update();
			leaves?.update(dt);
		},
		onDestroy() {
			leaves?.destroy();
			leaves = undefined;
		},
	};
});
