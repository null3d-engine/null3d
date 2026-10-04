// A sketch for the failure tests: meshes that move each frame, 200 or ?meshes= of them. Thousands
// make the core's transform and culling steps run as parallel loops on the job workers, and a few
// hundred keep the frames quick on a software GPU. With ?fault=step in the sketch's
// address, the engine's own frame step throws once, after some frames, from outside the sketch's
// callbacks. On the page's thread it leaves its context on the page, so the page can call the
// engine after it stopped, and counts its onDestroy calls there.
import { defineSketch, type SketchContext } from '@null3d/engine';

const params = new URL(import.meta.url).searchParams;
const FAULT = params.get('fault');
/** The frame after which the frame step throws, with ?fault=step. */
const FAULT_FRAME = 10;
const MESHES = Number(params.get('meshes') ?? 200);
const COLUMNS = 60;

/** What a sketch on the page's thread leaves on the page. */
export interface FailuresSketch {
	context: SketchContext;
	destroyed: number;
}

export default defineSketch((context) => {
	const { scene, materials, geometry, time } = context;
	const camera = scene.createPerspectiveCamera({ position: [0, 0, 60], target: [0, 0, 0] });
	scene.setActiveCamera(camera);
	const material = materials.unlit({ color: '#80a0ff' });
	const box = geometry.box({ width: 0.2, height: 0.2, depth: 0.2 });
	const place = (k: number, offset: number) =>
		[(k % COLUMNS) - COLUMNS / 2 + offset, Math.floor(k / COLUMNS) - 25, 0] as const;
	const meshes = Array.from({ length: MESHES }, (_, k) =>
		scene.createMesh({ mesh: box, material, position: [...place(k, 0)] }),
	);
	const shared: FailuresSketch = { context, destroyed: 0 };
	if (typeof document !== 'undefined')
		(globalThis as { __failuresSketch?: FailuresSketch }).__failuresSketch = shared;
	return {
		onUpdate() {
			const offset = Math.sin(time.now) * 0.5;
			for (let k = 0; k < meshes.length; k++) {
				const [x, y, z] = place(k, offset);
				meshes[k]?.setPosition(x, y, z);
			}
			if (FAULT === 'step' && time.frame === FAULT_FRAME) {
				// The engine reads the clock right after this update, outside the sketch's callbacks.
				const now = performance.now;
				performance.now = () => {
					performance.now = now;
					throw new Error('the frame step failed on purpose');
				};
			}
		},
		onDestroy() {
			shared.destroyed++;
		},
	};
});
