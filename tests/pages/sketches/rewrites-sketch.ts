// A grid of boxes that moves in two bursts and then stays still, for the test of how the WebGL2
// path writes its data textures again. The boxes are static nodes, so a frame writes only the rows
// of the boxes it moved. Each frame of a burst moves one of several blocks of boxes made one after
// another, so it writes rows that the frames before it did not. The second burst starts long after
// the first and skips frames. Once both end, every box rests where its last move put it, whatever
// the thread that draws did with the writes in between. On the message `frame`, the sketch sends
// its frame number.
import { defineSketch } from '@null3d/engine';

const COLUMNS = 50;
const ROWS = 40;
/** The blocks of boxes that frames move in turn, each most of a data texture row. */
const BLOCKS = 5;
const BLOCK = (COLUMNS * ROWS) / BLOCKS;
/** The frames of the first burst, which moves a block every frame. */
const FIRST_BURST = 60;
/** The frames of the second burst, which moves a block every third frame. */
const SECOND_FROM = 100;
const SECOND_TO = 130;

export default defineSketch(({ scene, materials, geometry, page, time }) => {
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 50,
		near: 0.1,
		far: 100,
		position: [0, 0, 48],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createAmbientLight({ color: '#ffffff', intensity: 1 });
	const box = geometry.box();
	const colors = ['#e8554e', '#4a8cff', '#5bc27a', '#f2c14e', '#b06ad9'].map((color) =>
		materials.unlit({ color }),
	);
	const boxes = Array.from({ length: COLUMNS * ROWS }, (_, i) =>
		scene.createMesh({
			mesh: box,
			material: colors[Math.floor(i / BLOCK)] as (typeof colors)[number],
			position: [(i % COLUMNS) - COLUMNS / 2 + 0.5, Math.floor(i / COLUMNS) - ROWS / 2 + 0.5, 0],
			scale: [0.5, 0.5, 0.5],
		}),
	);

	page.onMessage((name) => {
		if (name === 'frame') page.post('frame', time.frame);
	});
	return {
		onUpdate() {
			const frame = time.frame;
			const moves =
				frame <= FIRST_BURST || (frame >= SECOND_FROM && frame <= SECOND_TO && frame % 3 === 0);
			if (!moves) return;
			const first = (frame % BLOCKS) * BLOCK;
			for (let i = first; i < first + BLOCK; i++) {
				const x = (i % COLUMNS) - COLUMNS / 2 + 0.5;
				const y = Math.floor(i / COLUMNS) - ROWS / 2 + 0.5;
				const lift = Math.sin(frame * 0.37 + i) * 0.3;
				boxes[i]?.setPosition(x + lift, y - lift, 0);
			}
		},
	};
});
