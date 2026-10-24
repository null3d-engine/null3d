// A screen that follows an OffscreenCanvas drawn in the sketch. The canvas holds a grid with a
// colored square in each corner, which shows whether its rows stand the right way up, and a marker
// that moves in every frame. The screen refreshes the rectangle of the marker at most 30 times a
// second, so only that rectangle uploads, well within the frame's upload budget. A measurement at
// the start times a refresh of the marker's rectangle and one of the whole canvas, so a run can
// report what a megabyte of changed rectangle costs. On `stop` the sketch draws the marker at a
// fixed place and refreshes the whole canvas, so the captured frame is the same in every run.
import { defineSketch, type MeshArrays, type Texture } from '@null3d/engine';

/** Texels along each side of the canvas. */
const SIZE = 1024;
/** Texels along each side of the marker's rectangle. */
const MARKER = 256;
/** How often the screen reads the canvas, in hertz. */
const REFRESH_HZ = 30;
/** Refreshes of the marker's rectangle and of the whole canvas that the cost measurement times. */
const RECT_RUNS = 20;
const WHOLE_RUNS = 4;

const SQUARE: MeshArrays = {
	positions: [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
	normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
	uvs: [0, 0, 1, 0, 1, 1, 0, 1],
	indices: [0, 1, 2, 0, 2, 3],
};

/** The corners of the canvas, each with its own color. */
const CORNERS = [
	['#e04040', 0, 0],
	['#40c060', SIZE - MARKER / 2, 0],
	['#4060e0', 0, SIZE - MARKER / 2],
	['#e0c040', SIZE - MARKER / 2, SIZE - MARKER / 2],
] as const;

/** Draws the grid and the corner squares that make up the canvas's picture. */
function paintBase(context: OffscreenCanvasRenderingContext2D): void {
	context.fillStyle = '#101820';
	context.fillRect(0, 0, SIZE, SIZE);
	context.strokeStyle = '#243040';
	context.lineWidth = 2;
	for (let at = 0; at <= SIZE; at += 64) {
		context.beginPath();
		context.moveTo(at, 0);
		context.lineTo(at, SIZE);
		context.moveTo(0, at);
		context.lineTo(SIZE, at);
		context.stroke();
	}
	for (const [color, x, y] of CORNERS) {
		context.fillStyle = color;
		context.fillRect(x, y, MARKER / 2, MARKER / 2);
	}
}

/** How far along `range` the place `at` is, counting up and then back down. */
function backAndForth(at: number, range: number): number {
	const span = 2 * range;
	const turn = at % span;
	return turn <= range ? turn : span - turn;
}

/** The middle of some times: the mean of the two middle ones when their count is even. */
function median(times: Float64Array): number {
	const sorted = Float64Array.from(times).sort();
	const middle = sorted.length >> 1;
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Draws the marker's rectangle, as a solid color that changes with `step`. */
function paintMarker(
	context: OffscreenCanvasRenderingContext2D,
	x: number,
	y: number,
	step: number,
) {
	const green = 96 + (step % 4) * 32;
	context.fillStyle = `rgb(240, ${green}, 80)`;
	context.fillRect(x, y, MARKER, MARKER);
}

export default defineSketch(({ scene, geometry, materials, textures, page, time, quality }) => {
	scene.setBackground('#202830');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.1,
		far: 20,
		position: [0, 0, 2.6],
	});
	scene.setActiveCamera(camera);
	const canvas = new OffscreenCanvas(SIZE, SIZE);
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('the canvas has no 2D context');
	paintBase(context);

	// The screen that the frame shows, limited to 30 refreshes a second, and a second texture over
	// the same canvas for the cost measurement, which reads the canvas at every call.
	const screen: Texture = textures.fromCanvas(canvas, { refreshHz: REFRESH_HZ });
	scene.createMesh({
		mesh: geometry.fromArrays(SQUARE),
		material: materials.unlit({ map: screen }),
	});

	const probe = textures.fromCanvas(canvas);
	let rectMs = 0;
	let wholeMs = 0;
	let step = 0;
	{
		// A refresh is timed on its own, and the middle time stands for the rectangle.
		const times = new Float64Array(RECT_RUNS);
		for (let k = 0; k < RECT_RUNS; k++) {
			const x = (k * 37) % (SIZE - MARKER);
			const y = (k * 61) % (SIZE - MARKER);
			paintMarker(context, x, y, k);
			const before = performance.now();
			probe.refresh({ x, y, width: MARKER, height: MARKER });
			times[k] = performance.now() - before;
		}
		rectMs = median(times);
		const whole = new Float64Array(WHOLE_RUNS);
		for (let k = 0; k < WHOLE_RUNS; k++) {
			const before = performance.now();
			probe.refresh();
			whole[k] = performance.now() - before;
		}
		wholeMs = median(whole);
		probe.destroy();
	}
	// The cost measurement left the canvas with stray markers. The screen shows the base again.
	paintBase(context);
	screen.refresh();

	let running = false;
	let stopping = false;
	let started = false;
	let reported = false;
	let ready = false;
	let refreshes = 0;
	let markerX = 0;
	let markerY = 0;
	page.onMessage((name) => {
		if (name === 'start') {
			running = true;
			started = true;
		}
		if (name === 'stop') {
			running = false;
			stopping = true;
			// The test compares each thread mode's picture with the first mode's. The frame-budget
			// governor lowers the render scale on a slow machine, and a frame drawn below the
			// canvas's size differs from one drawn at it, so the captured frame draws at the full
			// size whatever the machine's speed. The measured frames keep the governor's scale,
			// which is what keeps a slow machine's frames quick.
			quality.set({ minRenderScale: 1, maxRenderScale: 1 });
		}
	});

	return {
		onUpdate() {
			// The setup's whole-canvas uploads must be behind the measurement: a frame that still
			// records one would read as a refresh of the whole canvas rather than of a rectangle.
			if (!ready && textures.uploads().waiting === 0 && textures.uploads().lastFrameBytes === 0) {
				ready = true;
				page.post('ready');
			}
			if (running) {
				step++;
				// The marker moves a few texels each frame, back and forth, so a read that the
				// refresh rate skipped covers a rectangle a little larger than the marker rather
				// than a jump across the canvas. The screen then stays within its byte budget at
				// the display's frame rate, whatever that is.
				markerX = backAndForth(step * 11, SIZE - MARKER);
				markerY = backAndForth(step * 7, SIZE - MARKER);
				paintMarker(context, markerX, markerY, step);
				// The engine reads the canvas only when the refresh rate allows it, and the
				// rectangle then covers every change since the last read.
				if (screen.refresh({ x: markerX, y: markerY, width: MARKER, height: MARKER })) refreshes++;
				return;
			}
			if (stopping) {
				paintBase(context);
				context.fillStyle = '#f0f0f0';
				context.fillRect((SIZE - MARKER) / 2, (SIZE - MARKER) / 2, MARKER, MARKER);
				// The refresh rate may still hold this read back: try again in the next frame.
				if (screen.refresh()) stopping = false;
				return;
			}
			if (started && !reported && textures.uploads().waiting === 0) {
				reported = true;
				page.post('done', {
					budget: textures.uploadBudget,
					refreshes,
					rectMs,
					wholeMs,
					rectMiB: (MARKER * MARKER * 4) / (1024 * 1024),
					wholeMiB: (SIZE * SIZE * 4) / (1024 * 1024),
					largestFrameBytes: textures.uploads().largestFrameBytes,
					frames: time.frame,
					size: SIZE,
					marker: MARKER,
					renderScale: quality.renderScale,
				});
			}
		},
	};
});
