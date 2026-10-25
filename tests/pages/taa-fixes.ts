// Measures the temporal resolve's study fixes (task M3-A11, D-206) and the effects that need it:
// an exposure change between frames, the transparency mask over a transparent canvas and over an
// opaque surface, the phone path against the full one, and the frame-to-frame change of thin rain
// and of the volumetric fog. ?case= names the measurement. Each figure is in 8-bit levels of the
// displayed color's luma. The page runs the same scenes with the resolve off and on, or with each
// setting, so each figure compares with its own baseline.
import { createEngine, type Engine } from '@null3d/engine';
import { run } from './lib/result';

const params = new URLSearchParams(location.search);
const CASE = params.get('case') ?? 'exposure';
const GPU = params.get('gpu') ?? 'webgpu';
const REACTIVE = params.get('reactive') ?? 'both';
/** The measurement's size in pixels. */
const SIZE = [320, 180] as const;
/** The square's place after it jumped, in pixels from the top left, inside its 40 pixel edge. */
const ARRIVED = { x: 45, y: 85, width: 30, height: 10 };
/** The same patch at the square's first place, on the other side of the view. */
const OLD = { x: 245, y: 85, width: 30, height: 10 };
const LEFT = OLD;
const RIGHT = ARRIVED;

interface Frame {
	width: number;
	height: number;
	luma: Float32Array;
}

/** A frame's luma in 8-bit levels of the displayed color. */
function luma(pixels: Uint8Array, width: number, height: number): Frame {
	const values = new Float32Array(width * height);
	for (let i = 0, at = 0; i < values.length; i++, at += 4)
		values[i] =
			0.2126 * (pixels[at] as number) +
			0.7152 * (pixels[at + 1] as number) +
			0.0722 * (pixels[at + 2] as number);
	return { width, height, luma: values };
}

/** The mean luma of a frame, or of a region of it. */
function mean(
	frame: Frame,
	region?: { x: number; y: number; width: number; height: number },
): number {
	const { x = 0, y = 0, width = frame.width, height = frame.height } = region ?? {};
	let sum = 0;
	for (let row = y; row < y + height; row++)
		for (let column = x; column < x + width; column++)
			sum += frame.luma[row * frame.width + column] as number;
	return sum / (width * height);
}

/** The mean distance of two frames' luma over a region. */
function distance(
	a: Frame,
	b: Frame,
	region?: { x: number; y: number; width: number; height: number },
): number {
	const { x = 0, y = 0, width = a.width, height = a.height } = region ?? {};
	let sum = 0;
	for (let row = y; row < y + height; row++)
		for (let column = x; column < x + width; column++)
			sum += Math.abs(
				(a.luma[row * a.width + column] as number) - (b.luma[row * b.width + column] as number),
			);
	return sum / (width * height);
}

/** The mean frame-to-frame change over a sequence. */
function change(frames: Frame[]): number {
	let sum = 0;
	let steps = 0;
	for (let t = 1; t < frames.length; t++) {
		sum += distance(frames[t] as Frame, frames[t - 1] as Frame);
		steps++;
	}
	return sum / Math.max(1, steps);
}

/** Starts one engine that draws the sketch with `query`, and waits for its first frame. */
async function start(
	query: string,
	options: { transparent?: boolean } = {},
): Promise<{ engine: Engine; canvas: HTMLCanvasElement; heard: number[]; applied: number[] }> {
	const canvas = document.createElement('canvas');
	canvas.width = SIZE[0];
	canvas.height = SIZE[1];
	canvas.style.width = `${SIZE[0]}px`;
	canvas.style.height = `${SIZE[1]}px`;
	document.body.append(canvas);
	const heard: number[] = [];
	const applied: number[] = [];
	// A template literal inside `new URL` is rewritten to a fixed address, so the query is set on
	// the URL instead, as the guide for the image tests says.
	const sketch = new URL('./sketches/taa-fixes-sketch.ts', import.meta.url);
	sketch.search = `?${query}&frames`;
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		preset: 'high',
		transparent: options.transparent === true,
		onSketchMessage: (name, data) => {
			if (name === 'frame') heard.push(data as number);
			else if (name === 'applied') applied.push(1);
		},
	});
	await engine.firstFrame;
	return { engine, canvas, heard, applied };
}

/** Sends a message and waits for the sketch to apply it, so the next capture shows it. */
async function apply(
	engine: Engine,
	applied: number[],
	name: string,
	data: unknown,
): Promise<void> {
	const from = applied.length;
	engine.postToSketch(name, data);
	const deadline = performance.now() + 30_000;
	while (applied.length === from) {
		if (performance.now() > deadline) throw new Error(`the sketch never applied ${name}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** Waits until the sketch has drawn `count` frames beyond the last one it posted. */
async function advance(heard: number[], count: number): Promise<void> {
	const from = heard.at(-1) ?? 0;
	const deadline = performance.now() + 60_000;
	while ((heard.at(-1) ?? 0) < from + count) {
		if (performance.now() > deadline) throw new Error('the sketch stopped drawing frames');
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

/** Draws and captures the next frame, which holds every setting applied before the call. */
async function capture(engine: Engine): Promise<Frame> {
	const { width, height, pixels } = await engine.captureFrame();
	return luma(pixels, width, height);
}

/** Captures `count` consecutive frames. */
async function sequence(engine: Engine, count: number): Promise<Frame[]> {
	const frames: Frame[] = [];
	for (let k = 0; k < count; k++) frames.push(await capture(engine));
	return frames;
}

/** Runs one scene, and stops its engine. */
async function scene<T>(
	query: string,
	work: (engine: Engine, heard: number[], applied: number[]) => Promise<T>,
	options: { transparent?: boolean } = {},
): Promise<T> {
	const { engine, canvas, heard, applied } = await start(query, options);
	try {
		return await work(engine, heard, applied);
	} finally {
		await engine.destroy();
		canvas.remove();
	}
}

run('taa-fixes', async () => {
	if (CASE === 'exposure') {
		// The history settles at an exposure of 1, the page doubles it, and the next resolved frame
		// must hold the scene at the new exposure. The same scene without the resolve is the
		// reference: a history that keeps the old exposure darkens it by about a half. The ratio
		// switch runs the scene again with the history held at its own exposure.
		const run = async (ratio: number) => {
			const settled = await scene(
				`case=exposure&gpu=${GPU}&taa=1&jitter=1&ratio=${ratio}`,
				async (engine, heard, applied) => {
					await advance(heard, 8);
					await apply(engine, applied, 'exposure', 2);
					const frame = await capture(engine);
					engine.postToSketch('taa-off', null);
					await advance(heard, 4);
					const reference = await capture(engine);
					return { frame, reference };
				},
			);
			return {
				resolved: mean(settled.frame),
				reference: mean(settled.reference),
				error: mean(settled.frame) - mean(settled.reference),
			};
		};
		const on = await run(1);
		const off = await run(0);
		return {
			case: CASE,
			gpu: GPU,
			resolved: on.resolved,
			reference: on.reference,
			error: on.error,
			offResolved: off.resolved,
			offReference: off.reference,
			offError: off.error,
		};
	}

	if (CASE === 'alpha' || CASE === 'opaque') {
		// The square settles on the right and jumps to the left. Its new place's history holds the
		// background, so the frame after the jump shows how much of it stayed in the square.
		const result = await scene(
			`case=${CASE}&gpu=${GPU}&taa=1&jitter=0&reactive=${REACTIVE}`,
			async (engine, heard, applied) => {
				await apply(engine, applied, 'place', 0);
				await advance(heard, 8);
				await apply(engine, applied, 'place', 1);
				const frame = await capture(engine);
				engine.postToSketch('taa-off', null);
				await advance(heard, 4);
				await apply(engine, applied, 'place', 1);
				const reference = await capture(engine);
				return { frame, reference };
			},
			{ transparent: CASE === 'alpha' },
		);
		return {
			case: CASE,
			gpu: GPU,
			reactive: REACTIVE,
			// How far the square's new place strays from the same frame without the resolve.
			error: distance(result.frame, result.reference, ARRIVED),
			level: mean(result.reference, ARRIVED),
			frameArrived: mean(result.frame, ARRIVED),
			frameLeft: mean(result.frame, LEFT),
			frameRight: mean(result.frame, RIGHT),
			referenceArrived: mean(result.reference, ARRIVED),
			referenceRight: mean(result.reference, RIGHT),
		};
	}

	if (CASE === 'phone') {
		// Both paths settle on a still scene with no jitter: they hold the same picture, and the
		// phone path reads less of it. The phone path draws the same picture with the transparency
		// signals off and on, because it reads neither.
		const full = await scene(
			`case=phone&gpu=${GPU}&taa=1&jitter=0&phone=0`,
			async (engine, heard) => {
				await advance(heard, 8);
				return capture(engine);
			},
		);
		const phone = await scene(
			`case=phone&gpu=${GPU}&taa=1&jitter=0&phone=1&reactive=off`,
			async (engine, heard) => {
				await advance(heard, 8);
				return capture(engine);
			},
		);
		const masked = await scene(
			`case=phone&gpu=${GPU}&taa=1&jitter=0&phone=1&reactive=both`,
			async (engine, heard) => {
				await advance(heard, 8);
				return capture(engine);
			},
		);
		return {
			case: CASE,
			gpu: GPU,
			distance: distance(full, phone),
			skip: distance(phone, masked),
			mean: mean(phone),
		};
	}

	// The jittered effects: the same scene with the resolve off and on, and the frame-to-frame
	// change of each, which is what a temporal resolve is meant to lower. The resolve off draws
	// the scene with and without the offset request, which the frame applies only while the
	// resolve draws, so the two says whether the offsets alone change the picture.
	const off = await scene(`case=${CASE}&gpu=${GPU}&taa=0&jitter=0`, async (engine, heard) => {
		await advance(heard, 6);
		return sequence(engine, 16);
	});
	const offJitter = await scene(`case=${CASE}&gpu=${GPU}&taa=0&jitter=1`, async (engine, heard) => {
		await advance(heard, 6);
		return sequence(engine, 16);
	});
	const on = await scene(`case=${CASE}&gpu=${GPU}&taa=1&jitter=1`, async (engine, heard) => {
		await advance(heard, 8);
		return sequence(engine, 16);
	});
	return {
		case: CASE,
		gpu: GPU,
		off: change(off),
		offJitter: change(offJitter),
		on: change(on),
		offMean: mean(off[0] as Frame),
		onMean: mean(on[0] as Frame),
	};
});
