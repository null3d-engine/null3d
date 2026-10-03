// A grid of boxes that moves in two bursts and then stays still, for the test of how the WebGL2
// path writes its data textures again. The boxes are static nodes, so a frame writes only the rows
// of the boxes it moved. Each frame of a burst moves one of several blocks of boxes made one after
// another, so it writes rows that the frames before it did not. The second burst starts long after
// the first and skips frames. Once both end, every box rests where its last move put it, whatever
// the thread that draws did with the writes in between. With ?settled, the sketch makes each box
// where the bursts leave it and never moves it. On the message `frame`, the sketch sends its frame
// number. The governor is off, so slow frames change nothing that the frame draws.
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

const settled = new URL(import.meta.url).searchParams.has('settled');

/** Whether a frame moves a block of boxes. */
function moves(frame: number): boolean {
	return frame <= FIRST_BURST || (frame >= SECOND_FROM && frame <= SECOND_TO && frame % 3 === 0);
}

/** Where a frame that moves a box puts it, or where the box starts when no frame has moved it. */
function place(i: number, frame: number | null): [number, number, number] {
	const x = (i % COLUMNS) - COLUMNS / 2 + 0.5;
	const y = Math.floor(i / COLUMNS) - ROWS / 2 + 0.5;
	const lift = frame === null ? 0 : Math.sin(frame * 0.37 + i) * 0.3;
	return [x + lift, y - lift, 0];
}

/** For each box, the last frame of the bursts that moves it. */
function lastMoves(): number[] {
	const last = new Array<number>(COLUMNS * ROWS);
	for (let frame = 0; frame <= SECOND_TO; frame++) {
		if (!moves(frame)) continue;
		const first = (frame % BLOCKS) * BLOCK;
		for (let i = first; i < first + BLOCK; i++) last[i] = frame;
	}
	return last;
}

export default defineSketch(({ scene, materials, geometry, page, time, quality }) => {
	quality.set({ governor: false });
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
	const last = settled ? lastMoves() : null;
	const boxes = Array.from({ length: COLUMNS * ROWS }, (_, i) =>
		scene.createMesh({
			mesh: box,
			material: colors[Math.floor(i / BLOCK)] as (typeof colors)[number],
			position: place(i, last?.[i] ?? null),
			scale: [0.5, 0.5, 0.5],
		}),
	);

	page.onMessage((name) => {
		if (name === 'frame') page.post('frame', time.frame);
	});
	return {
		onUpdate() {
			const frame = time.frame;
			if (settled || !moves(frame)) return;
			const first = (frame % BLOCKS) * BLOCK;
			for (let i = first; i < first + BLOCK; i++) boxes[i]?.setPosition(...place(i, frame));
		},
	};
});
