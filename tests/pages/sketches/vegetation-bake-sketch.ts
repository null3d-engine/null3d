// The cost of one atlas bake each frame, measured inside the sketch: the same leaf cards drawn for
// half a second through the atlas material, then through a plain unlit material that samples
// nothing. The atlas paints in every frame that a plant shows it, so the difference between the two
// medians is what a page pays for its plants' textures.
import { defineSketch, type Mesh } from '@null3d/engine';
import { bakePlantAtlases, plantMaterial } from '@null3d/vegetation';

/** The frames measured on each side, after the frames that the engine spends building pipelines. */
const WARM_UP = 30;
const MEASURED = 90;

export default defineSketch((ctx) => {
	const { scene } = ctx;
	scene.setBackground('#000000');
	scene.createAmbientLight({ intensity: 1 });
	const atlases = bakePlantAtlases(ctx);
	const withAtlas = plantMaterial(ctx, {
		atlases,
		part: 'leaves',
		cell: 'cluster-a',
		color: [0.2, 0.4, 0.1],
	});
	const plain = ctx.materials.unlit({ color: '#3a6a1e' });
	const meshes: Mesh[] = [];
	for (let i = 0; i < 24; i++) {
		// A wall of cards fills the picture, so the atlas's fragment work is the frame's work.
		const x = (i % 6) * 1.6 - 4;
		const y = Math.floor(i / 6) * 1.6 - 2.4;
		meshes.push(
			scene.createMesh({
				mesh: ctx.geometry.plane({ width: 1.5, height: 1.5 }),
				material: withAtlas,
				position: [x, y, 0],
			}),
		);
	}
	const camera = scene.createPerspectiveCamera({
		fov: 40,
		near: 0.1,
		far: 100,
		position: [0, 0, 10],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);

	const withFrames: number[] = [];
	const withoutFrames: number[] = [];
	let frames = 0;
	let plainShown = false;
	return {
		onUpdate(dt: number) {
			frames++;
			if (dt <= 0) return;
			if (!plainShown) {
				if (frames > WARM_UP) withFrames.push(dt);
				if (withFrames.length >= MEASURED) {
					for (const mesh of meshes) mesh.setMaterial(plain);
					plainShown = true;
					frames = 0;
				}
			} else if (frames > WARM_UP && withoutFrames.length < MEASURED) {
				withoutFrames.push(dt);
			}
			if (plainShown && withoutFrames.length >= MEASURED) {
				ctx.page.post('bake-cost', {
					withAtlas: median(withFrames),
					plain: median(withoutFrames),
				});
				plainShown = false;
				frames = -1_000_000;
			}
		},
	};
});

/** The middle value of a list of numbers, in milliseconds. */
function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return (sorted[middle] ?? 0) * 1000;
}
