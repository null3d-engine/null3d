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

/** Waits until the sketch has recorded frame `target` or a later one. */
async function waitFrame(heard: number[], target: number): Promise<void> {
	const deadline = performance.now() + 60_000;
	while ((heard.at(-1) ?? 0) < target) {
		if (performance.now() > deadline) throw new Error(`the sketch never reached frame ${target}`);
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

/** One run's captured frames, the sketch frame of each, and whether each capture held one frame. */
interface Run {
	frames: Frame[];
	numbers: number[];
	consecutive: boolean;
}

/**
 * Captures `count` frames, with the sketch frame number of each, and says whether every capture
 * advanced the sketch. A software GPU draws slower than the page asks, so a capture there takes a
 * frame that is one or more ahead; what the run must not do is take a frame that did not advance,
 * or one that came back out of order, since the figures compare each pair of frames it holds.
 */
async function sequence(engine: Engine, heard: number[], count: number): Promise<Run> {
	const frames: Frame[] = [];
	const numbers: number[] = [];
	let consecutive = true;
	for (let k = 0; k < count; k++) {
		const before = heard.at(-1) ?? 0;
		frames.push(await capture(engine));
		const after = heard.at(-1) ?? 0;
		if (after - before < 1) consecutive = false;
		numbers.push(before);
	}
	return { frames, numbers, consecutive };
}

/** The mean distance of two runs' frames that hold the same sketch frame, and how many there are. */
function compare(a: Run, b: Run): { mean: number; overlap: number } {
	const other = new Map<number, Frame>();
	b.numbers.forEach((number, index) => {
		other.set(number, b.frames[index] as Frame);
	});
	let sum = 0;
	let overlap = 0;
	a.numbers.forEach((number, index) => {
		const frame = other.get(number);
		if (!frame) return;
		sum += distance(a.frames[index] as Frame, frame);
		overlap++;
	});
	return { mean: sum / Math.max(1, overlap), overlap };
}

/**
 * The mean frame-to-frame change over a run's consecutive frames. A scene that moves with the real
 * clock differs between runs at the same frame number, so the two sides of an effect are compared
 * by this statistic, which is stable over the sequence.
 */
function change(run: Run): number {
	let sum = 0;
	let steps = 0;
	for (let k = 1; k < run.frames.length; k++) {
		if ((run.numbers[k] as number) - (run.numbers[k - 1] as number) !== 1) continue;
		sum += distance(run.frames[k] as Frame, run.frames[k - 1] as Frame);
		steps++;
	}
	return sum / Math.max(1, steps);
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
		// The history settles at an exposure of 1 and the sketch doubles it at a frame of the
		// sequence, so every run draws the step at the same frame. The same scene without the resolve
		// is the reference: a history that keeps the old exposure draws darker than it. The ratio
		// switch runs the scene again with the history held at its own exposure.
		const step = Number(params.get('step') ?? '8');
		const run = (taa: boolean, ratio: boolean) =>
			scene(
				`case=exposure&gpu=${GPU}&taa=${taa ? 1 : 0}&jitter=0&ratio=${ratio ? 1 : 0}&step=${step}`,
				async (engine, heard) => {
					await waitFrame(heard, step);
					return sequence(engine, heard, 12);
				},
			);
		const reference = await run(false, true);
		const on = await run(true, true);
		const off = await run(true, false);
		const onError = compare(on, reference);
		const offError = compare(off, reference);
		return {
			case: CASE,
			gpu: GPU,
			resolved: mean(on.frames[0] as Frame),
			reference: mean(reference.frames[0] as Frame),
			error: onError.mean,
			offResolved: mean(off.frames[0] as Frame),
			offReference: mean(reference.frames[0] as Frame),
			offError: offError.mean,
			overlap: Math.min(onError.overlap, offError.overlap),
			consecutive: reference.consecutive && on.consecutive && off.consecutive,
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
		// A blended square slides across a transparent canvas, from the frame number, so every run
		// draws the same picture in the same frame. The scene's alpha lowers the full path's history;
		// the phone path reads no signal, so the same setting must not change its picture. The
		// signal's own figure shows that the scene would change if the path read it.
		const run = (phone: boolean, reactive: 'off' | 'alpha') =>
			scene(
				`case=phone&gpu=${GPU}&taa=1&jitter=1&phone=${phone ? 1 : 0}&reactive=${reactive}`,
				async (engine, heard) => {
					await waitFrame(heard, 12);
					return sequence(engine, heard, 16);
				},
				{ transparent: true },
			);
		const fullOff = await run(false, 'off');
		const fullAlpha = await run(false, 'alpha');
		const phoneOff = await run(true, 'off');
		const phoneAlpha = await run(true, 'alpha');
		const signal = compare(fullAlpha, fullOff);
		const skip = compare(phoneAlpha, phoneOff);
		const path = compare(fullOff, phoneOff);
		return {
			case: CASE,
			gpu: GPU,
			distance: path.mean,
			signal: signal.mean,
			skip: skip.mean,
			mean: mean(phoneOff.frames[0] as Frame),
			overlap: Math.min(signal.overlap, skip.overlap, path.overlap),
			consecutive:
				fullOff.consecutive &&
				fullAlpha.consecutive &&
				phoneOff.consecutive &&
				phoneAlpha.consecutive,
		};
	}

	// The jittered effects: the same scene with the resolve off and on, and the frame-to-frame
	// change of each, which is what a temporal resolve is meant to lower. The resolve off draws
	// the scene with and without the offset request, which the frame applies only while the
	// resolve draws, so the two says whether the offsets alone change the picture.
	const measure = (query: string) =>
		scene(query, async (engine, heard) => {
			await waitFrame(heard, 12);
			return sequence(engine, heard, 16);
		});
	const off = await measure(`case=${CASE}&gpu=${GPU}&taa=0&jitter=0`);
	const offJitter = await measure(`case=${CASE}&gpu=${GPU}&taa=0&jitter=1`);
	const on = await measure(`case=${CASE}&gpu=${GPU}&taa=1&jitter=1`);
	// The same resolve with both transparency signals off, so a difference that stays is the
	// history's place rather than a mask dropping it.
	const onNoMask = await measure(`case=${CASE}&gpu=${GPU}&taa=1&jitter=1&reactive=off`);
	const offChange = change(off);
	return {
		case: CASE,
		gpu: GPU,
		off: offChange,
		on: change(on),
		onNoMask: change(onNoMask),
		jitter: Math.abs(change(offJitter) - offChange),
		offMean: mean(off.frames[0] as Frame),
		onMean: mean(on.frames[0] as Frame),
		onNoMaskMean: mean(onNoMask.frames[0] as Frame),
		steps: off.frames.length - 1,
		consecutive: off.consecutive && offJitter.consecutive && on.consecutive && onNoMask.consecutive,
	};
});
