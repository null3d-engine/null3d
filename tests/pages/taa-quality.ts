// Measures the temporal resolve against D-129's quality bar, and its cost. ?mode=quality captures 16
// consecutive frames of a scene at 960 x 540 for each preset and camera, with the resolve off and on,
// and compares each frame with a 64-sample reference: the same 16 frames drawn at 3840 x 2160 with
// MSAA 4x and shrunk by averaging 4 x 4 blocks in linear light. It reports shimmer, smear, error,
// sharpness and the still scene's frame-to-frame change. ?mode=cost plays the scene at 1920 x 1080
// with the resolve off and on in turns and reports the medians of GPU time per frame. ?scene= names
// the thin-geometry scene or the grass bank, ?presets= and ?cameras= list the cases. Run the page with
// ?fps= low enough that every capture finishes before the next frame. The page needs the engine's own
// ?gpu= switch to pick the path, which every engine that it starts then uses.
import { createEngine, type Engine } from '@null3d/engine';
import { featureCost } from './lib/feature-cost';
import { run } from './lib/result';

/** A sequence of frames, each the luma of the displayed color in 8-bit levels. */
interface Sequence {
	width: number;
	height: number;
	luma: Float32Array[];
}

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'thin';
const mode = params.get('mode') ?? 'quality';
const preset = params.get('preset') ?? 'high';
const presets = (params.get('presets') ?? 'low,medium,high,ultra').split(',');
const cameras = (params.get('cameras') ?? 'still,slow,brisk').split(',');
const start = Number(params.get('start') ?? '12');
const count = Number(params.get('count') ?? '16');
const size = (params.get('size') ?? '960x540').split('x').map(Number) as [number, number];
const referenceSize = (params.get('ref') ?? '3840x2160').split('x').map(Number) as [number, number];
const down = Number(params.get('down') ?? '4');
const jitter = params.get('jitter') !== '0';
/** Radians per second that each camera name turns at. */
const ORBITS: Record<string, number> = { still: 0, slow: 0.1, brisk: 0.3 };
const SKETCHES: Record<string, string> = {
	thin: './sketches/taa-thin-sketch.ts',
	grass: './sketches/taa-grass-sketch.ts',
};
/** The engine failures that the page's engines reported, across every run. */
const failures: string[] = [];

/** sRGB 8-bit to linear, by table. */
const LINEAR = Float32Array.from({ length: 256 }, (_, v) => {
	const c = v / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** Linear to sRGB 8-bit. */
function encode(linear: number): number {
	const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
	return Math.max(0, Math.min(255, Math.round(c * 255)));
}

/** A capture shrunk by `factor` each way, averaging in linear light. */
function shrink(pixels: Uint8Array, w: number, h: number, factor: number): Uint8Array {
	const ow = Math.floor(w / factor);
	const oh = Math.floor(h / factor);
	const out = new Uint8Array(ow * oh * 4);
	const area = factor * factor;
	for (let y = 0; y < oh; y++) {
		for (let x = 0; x < ow; x++) {
			let r = 0;
			let g = 0;
			let b = 0;
			for (let dy = 0; dy < factor; dy++) {
				let at = ((y * factor + dy) * w + x * factor) * 4;
				for (let dx = 0; dx < factor; dx++, at += 4) {
					r += LINEAR[pixels[at] as number] as number;
					g += LINEAR[pixels[at + 1] as number] as number;
					b += LINEAR[pixels[at + 2] as number] as number;
				}
			}
			const o = (y * ow + x) * 4;
			out[o] = encode(r / area);
			out[o + 1] = encode(g / area);
			out[o + 2] = encode(b / area);
			out[o + 3] = 255;
		}
	}
	return out;
}

/** The luma of an RGBA8 image, in 8-bit levels of the displayed color. */
function luma(pixels: Uint8Array, width: number, height: number): Float32Array {
	const out = new Float32Array(width * height);
	for (let i = 0, at = 0; i < out.length; i++, at += 4)
		out[i] =
			0.2126 * (pixels[at] as number) +
			0.7152 * (pixels[at + 1] as number) +
			0.0722 * (pixels[at + 2] as number);
	return out;
}

/** The mean magnitude of the image's central-difference gradients, over its interior. */
function gradients(lumaValues: Float32Array, width: number, height: number): number {
	let sum = 0;
	let pixels = 0;
	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const at = y * width + x;
			const dx = (lumaValues[at + 1] as number) - (lumaValues[at - 1] as number);
			const dy = (lumaValues[at + width] as number) - (lumaValues[at - width] as number);
			sum += Math.hypot(dx, dy);
			pixels++;
		}
	}
	return sum / Math.max(1, pixels);
}

/** D-129's figures: shimmer, smear, error, sharpness and the still change, in 8-bit luma levels. */
function figures(frames: Sequence, reference: Sequence) {
	const { width, height } = frames;
	const steps = frames.luma.length - 1;
	const pixels = width * height;
	let shimmer = 0;
	let smear = 0;
	let error = 0;
	let move = 0;
	let referenceMove = 0;
	let sharpness = 0;
	for (let t = 0; t < frames.luma.length; t++) {
		const frame = frames.luma[t] as Float32Array;
		const truth = reference.luma[t] as Float32Array;
		for (let i = 0; i < pixels; i++) error += Math.abs((frame[i] as number) - (truth[i] as number));
		const frameGradient = gradients(frame, width, height);
		const truthGradient = gradients(truth, width, height);
		sharpness += frameGradient / Math.max(1e-6, truthGradient);
		if (t === 0) continue;
		const last = frames.luma[t - 1] as Float32Array;
		const lastTruth = reference.luma[t - 1] as Float32Array;
		for (let i = 0; i < pixels; i++) {
			const moved = Math.abs((frame[i] as number) - (last[i] as number));
			const trueMoved = Math.abs((truth[i] as number) - (lastTruth[i] as number));
			shimmer += Math.max(moved - trueMoved, 0);
			smear += Math.max(trueMoved - moved, 0);
			move += moved;
			referenceMove += trueMoved;
		}
	}
	const perPixelStep = pixels * Math.max(1, steps);
	return {
		shimmer: shimmer / perPixelStep,
		smear: smear / perPixelStep,
		error: error / pixels / frames.luma.length,
		sharpness: sharpness / frames.luma.length,
		still: move / perPixelStep,
		referenceStill: referenceMove / perPixelStep,
	};
}

/** The sketch's address for a camera pose and a resolve setting. */
function sketchURL(camera: string, taa: boolean, moving: boolean): URL {
	const url = new URL(SKETCHES[scene] as string, import.meta.url);
	const orbit = ORBITS[camera] as number;
	url.search = `?orbit=${orbit}&taa=${taa ? 1 : 0}&jitter=${jitter ? 1 : 0}&frames&fixed${moving ? '' : '&moving=0'}`;
	return url;
}

/** Starts one engine at `width` x `height` and waits for the sketch's frame `start`. */
async function startEngine(
	width: number,
	height: number,
	enginePreset: string,
	antialias: 'none' | 'fxaa' | 'msaa' | undefined,
	camera: string,
	taa: boolean,
	moving: boolean,
): Promise<{ engine: Engine; heard: number[]; canvas: HTMLCanvasElement }> {
	// A canvas goes to the engine's thread for good, so each engine takes a fresh one.
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	document.body.append(canvas);
	const heard: number[] = [];
	const engine = await createEngine({
		canvas,
		sketch: sketchURL(camera, taa, moving),
		maxPixelRatio: 1,
		preset: enginePreset as 'low' | 'medium' | 'high' | 'ultra',
		antialias,
		onSketchMessage: (name, data) => {
			if (name === 'frame') heard.push(data as number);
		},
	});
	await engine.firstFrame;
	engine.onFailure(({ code }) => failures.push(code));
	const deadline = performance.now() + 120_000;
	while ((heard.at(-1) ?? 0) < start) {
		if (performance.now() > deadline) throw new Error(`the sketch never reached frame ${start}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return { engine, heard, canvas };
}

/** Captures `count` consecutive frames, each shrunk by `factor`, and records the sketch frames heard. */
async function capture(
	engine: Engine,
	heard: number[],
	factor: number,
): Promise<{
	frames: Sequence;
	records: { before?: number; after?: number }[];
	consecutive: boolean;
}> {
	const records: { before?: number; after?: number }[] = [];
	const lumaValues: Float32Array[] = [];
	let width = 0;
	let height = 0;
	for (let k = 0; k < count; k++) {
		const before = heard.at(-1);
		const { width: w, height: h, pixels } = await engine.captureFrame();
		records.push({ before, after: heard.at(-1) });
		const kept = factor > 1 ? shrink(pixels, w, h, factor) : pixels.slice();
		width = Math.floor(w / factor);
		height = Math.floor(h / factor);
		lumaValues.push(luma(kept, width, height));
	}
	const consecutive = records.every(
		(record) =>
			record.before !== undefined &&
			record.after !== undefined &&
			record.after - record.before === 1,
	);
	return { frames: { width, height, luma: lumaValues }, records, consecutive };
}

/** Runs one sequence, retrying once when a capture skipped a frame. */
async function sequence(
	width: number,
	height: number,
	enginePreset: string,
	antialias: 'none' | 'fxaa' | 'msaa' | undefined,
	camera: string,
	taa: boolean,
	moving: boolean,
	factor: number,
): Promise<{
	frames: Sequence;
	records: { before?: number; after?: number }[];
	consecutive: boolean;
	tier: string;
	preset: string;
}> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const { engine, heard, canvas } = await startEngine(
			width,
			height,
			enginePreset,
			antialias,
			camera,
			taa,
			moving,
		);
		const captured = await capture(engine, heard, factor);
		const tier = engine.capabilities.tier as string;
		const effective = engine.mode.preset as string;
		await engine.destroy();
		canvas.remove();
		if (captured.consecutive) return { ...captured, tier, preset: effective };
		console.warn(`a capture skipped a frame on ${camera} ${enginePreset} taa ${taa}; retrying`);
	}
	throw new Error(`no consecutive sequence for ${camera} ${enginePreset} taa ${taa}`);
}

run('taa-quality', async () => {
	if (mode === 'cost') {
		const { engine, canvas } = await startEngine(
			size[0],
			size[1],
			preset,
			undefined,
			'still',
			false,
			true,
		);
		const settled = () =>
			new Promise<void>((resolve) => {
				let stop: () => void = () => {};
				stop = engine.onSketchMessage((name) => {
					if (name !== 'settled') return;
					stop();
					resolve();
				});
			});
		const { off, on } = await featureCost(engine, async (drawn) => {
			if (!drawn) {
				engine.postToSketch('taa-off', null);
				return;
			}
			const built = settled();
			engine.postToSketch('taa', null);
			await built;
		});
		const tier = engine.capabilities.tier;
		const effective = engine.mode.preset;
		await engine.destroy();
		canvas.remove();
		return { mode, scene, tier, preset: effective, off, on, failures };
	}

	const cases: {
		preset: string;
		camera: string;
		taa: boolean;
		effective: string;
		shimmer: number;
		smear: number;
		error: number;
		sharpness: number;
		still: number;
		referenceStill: number;
	}[] = [];
	const references: Record<string, { records: unknown; consecutive: boolean }> = {};
	for (const camera of cameras) {
		const moving = !(camera === 'still' && scene === 'thin');
		// Each preset's own settings give its ground truth: the same frames at 4x with MSAA, which
		// is 64 samples per pixel, so a preset's shadow or texture quality is not counted as error.
		for (const enginePreset of presets) {
			const reference = await sequence(
				referenceSize[0],
				referenceSize[1],
				enginePreset,
				'msaa',
				camera,
				false,
				moving,
				down,
			);
			references[`${camera}:${reference.preset}`] = {
				records: reference.records,
				consecutive: reference.consecutive,
			};
			for (const taa of [false, true]) {
				const measured = await sequence(
					size[0],
					size[1],
					enginePreset,
					undefined,
					camera,
					taa,
					moving,
					1,
				);
				const result = figures(measured.frames, reference.frames);
				cases.push({
					preset: enginePreset,
					camera,
					taa,
					effective: measured.preset,
					...result,
				});
			}
		}
	}
	return { mode, scene, size, referenceSize, down, records: references, cases, failures };
});
