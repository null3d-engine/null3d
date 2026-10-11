// Captures consecutive frames of a sketch for the temporal anti-aliasing prototype (M2-EX18).
// ?sketch= names the sketch's path from the site's root and ?args= its own switches, which should
// hold `frames` and `step`, so the sketch posts each frame's number and steps 1/60 s per frame.
// ?antialias= sets the engine's mode. ?size=WxH sets the canvas in CSS pixels, drawn at a pixel ratio of 1. ?start= is the sketch
// frame to wait for, ?count= the captures, and ?down= a factor that shrinks each capture by
// averaging blocks of pixels in linear light, for references drawn larger. Run it with the
// engine's ?fps= switch low enough that a capture finishes before the next frame, so the captures
// are consecutive frames; each capture's record says which sketch frames the page heard of meanwhile.
import { createEngine } from '@null3d/engine';
import { run } from './lib/result';

declare global {
	interface Window {
		/** The captured frames, RGBA8 rows, top row first. */
		__taaFrames?: Uint8Array[];
	}
}

const params = new URLSearchParams(location.search);
const [width, height] = (params.get('size') ?? '960x540').split('x').map(Number) as [
	number,
	number,
];
const start = Number(params.get('start') ?? '120');
const count = Number(params.get('count') ?? '16');
const down = Number(params.get('down') ?? '1');

/** sRGB 8-bit to linear, by table. */
const LINEAR = Float32Array.from({ length: 256 }, (_, v) => {
	const c = v / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function encode(linear: number): number {
	const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
	return Math.max(0, Math.min(255, Math.round(c * 255)));
}

/** A capture of `w` x `h` pixels shrunk by `factor` each way, averaging in linear light. */
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

run('taa-sequence', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	const sketch = new URL(
		params.get('sketch') ?? '/examples/showcase/creek/sketch.ts',
		location.href,
	);
	sketch.search = params.get('args') ?? 'frames&step&fixed';
	const heard: number[] = [];
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
		// ?antialias= replaces the preset's mode, as for TAA with no MSAA under it.
		antialias: (params.get('antialias') as 'msaa' | 'fxaa' | 'none' | null) ?? undefined,
		onSketchMessage: (name, data) => {
			if (name === 'frame') heard.push(data as number);
		},
	});
	await engine.firstFrame;
	const deadline = performance.now() + 600_000;
	while ((heard.at(-1) ?? 0) < start) {
		if (performance.now() > deadline) throw new Error(`the sketch never reached frame ${start}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	// ?measure=<seconds> measures play instead of capturing: GPU time per frame and its passes.
	const measure = Number(params.get('measure') ?? '0');
	if (measure > 0) {
		const stats = await engine.measure(measure);
		const tier = engine.capabilities.tier;
		await engine.destroy();
		return {
			tier,
			measured: {
				frames: stats.frames,
				gpuMs: stats.gpuMs?.median ?? null,
				intervalMs: stats.intervalMs.median,
				passes: stats.gpuPassMs?.map((part) => [part.name, +part.ms.median.toFixed(3)]) ?? null,
			},
		};
	}
	const frames: Uint8Array[] = [];
	const records: { before: number | undefined; after: number | undefined; ms: number }[] = [];
	let size = [0, 0];
	for (let k = 0; k < count; k++) {
		const before = heard.at(-1);
		const began = performance.now();
		const { width: w, height: h, pixels } = await engine.captureFrame();
		records.push({ before, after: heard.at(-1), ms: Math.round(performance.now() - began) });
		const kept = down > 1 ? shrink(pixels, w, h, down) : pixels.slice();
		frames.push(kept);
		size = [Math.floor(w / down), Math.floor(h / down)];
	}
	window.__taaFrames = frames;
	const tier = engine.capabilities.tier;
	await engine.destroy();
	return { tier, width: size[0], height: size[1], count, records };
});
