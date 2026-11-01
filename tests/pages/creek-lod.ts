// Drives the Creek oak's level switch with the camera held still, so the only change between two
// frames is the hand-over. The page finds the bias where the switch first shows, by bisection, and
// then sweeps the bias across the band that follows it, and publishes how much each step changed
// the picture and the largest block of changed pixels. A switch that pops changes a whole crown in
// one step; one that fades spreads the change across the band as a dither. `?lod=0` draws the base
// mesh at every bias, which gives no change at all.
import { createEngine } from '@null3d/engine';
import { run, toBase64 } from './lib/result';

/** A pixel changes when any of its channels differs by more than this. */
const CHANGE = 24;
/** The share of changed pixels that counts as a change at all. */
const VISIBLE = 0.001;
/** The bisection's first and last bias, and its steps. */
const LO = 0.25;
const HI = 32;
const BISECTIONS = 12;

const params = new URLSearchParams(location.search);
const steps = Number(params.get('steps') ?? 24);
const width = Number(params.get('width') ?? 640);
const height = Number(params.get('height') ?? 360);

interface SketchLevels {
	errors: number[];
	fades: (boolean | undefined)[];
	switches: number[];
}

/** The share of the pixels that differ between two frames, and the largest block of them. */
function compare(
	one: Uint8Array,
	two: Uint8Array,
	width: number,
): { share: number; block: number } {
	const pixels = one.length / 4;
	let changed = 0;
	const mask = new Uint8Array(pixels);
	for (let i = 0; i < pixels; i++) {
		const at = i * 4;
		if (
			Math.abs((one[at] as number) - (two[at] as number)) > CHANGE ||
			Math.abs((one[at + 1] as number) - (two[at + 1] as number)) > CHANGE ||
			Math.abs((one[at + 2] as number) - (two[at + 2] as number)) > CHANGE
		) {
			mask[i] = 1;
			changed++;
		}
	}
	// The largest 4-neighbour block, counted with a stack of indices, so it needs no recursion.
	let block = 0;
	const stack: number[] = [];
	for (let i = 0; i < pixels; i++) {
		if (mask[i] !== 1) continue;
		mask[i] = 2;
		stack.push(i);
		let size = 0;
		while (stack.length > 0) {
			const at = stack.pop() as number;
			size++;
			const x = at % width;
			for (const next of [at - width, at + width, x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1])
				if (next >= 0 && next < pixels && mask[next] === 1) {
					mask[next] = 2;
					stack.push(next);
				}
		}
		if (size > block) block = size;
	}
	return { share: changed / pixels, block };
}

/** The share of the pixels that differ from the frame's own first pixel, which is the backdrop. */
function covered(pixels: Uint8Array): number {
	let drawn = 0;
	for (let i = 0; i < pixels.length; i += 4)
		if (
			Math.abs((pixels[i] as number) - (pixels[0] as number)) > 12 ||
			Math.abs((pixels[i + 1] as number) - (pixels[1] as number)) > 12 ||
			Math.abs((pixels[i + 2] as number) - (pixels[2] as number)) > 12
		)
			drawn++;
	return drawn / (pixels.length / 4);
}

interface Step {
	bias: number;
	share: number;
	block: number;
	drawn: number;
}

run('creek-lod', async () => {
	const canvas = document.querySelector('canvas');
	if (!canvas) throw new Error('the page has no canvas');
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	const lod = params.get('lod') ?? '1';
	// The sketch's address from the server's root: Vite reads the module's language from the last
	// dot, so the marker of the file's extension goes last.
	const sketch = new URL(`/tests/pages/sketches/creek-lod-sketch.ts?lod=${lod}`, location.origin);
	sketch.search += '&lang.ts';
	const engine = await createEngine({
		canvas,
		sketch,
		maxPixelRatio: 1,
	});
	const levels = await new Promise<SketchLevels>((resolve) => {
		engine.onSketchMessage((name, data) => {
			if (name === 'levels') resolve(data as SketchLevels);
		});
	});
	const placed = new Set<number>();
	engine.onSketchMessage((name, data) => {
		if (name === 'drawn') placed.add(data as number);
	});
	/** Posts a level bias and waits until the sketch has applied it. */
	const place = (bias: number): Promise<void> =>
		new Promise((resolve) => {
			placed.delete(bias);
			engine.postToSketch('bias', bias);
			const check = setInterval(() => {
				if (!placed.has(bias)) return;
				clearInterval(check);
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			}, 4);
		});
	await engine.firstFrame;
	// The frame at the base level, which every later frame is compared with.
	await place(LO);
	const base = (await engine.captureFrame()).pixels;
	const at = async (bias: number): Promise<Step> => {
		await place(bias);
		const { pixels, width: size } = await engine.captureFrame();
		return { bias, ...compare(base, pixels, size), drawn: covered(pixels) };
	};
	// The switch shows first where a frame stops matching the base level, so a bisection finds it.
	let low = LO;
	let high = HI;
	const found: Step[] = [];
	for (let k = 0; k < BISECTIONS; k++) {
		const bias = Math.sqrt(low * high);
		const step = await at(bias);
		found.push({ bias: step.bias, share: step.share, block: step.block, drawn: step.drawn });
		if (step.share > VISIBLE) high = bias;
		else low = bias;
	}
	// The band lies from the switch's bias to just past its end, 8 per cent of the switch
	// distance, which is 8 per cent of the bias here.
	const frames: { bias: number; pixels: Uint8Array }[] = [];
	const fine: Step[] = [];
	for (let k = 0; k <= steps; k++) {
		const bias = high * (0.998 + 0.102 * (k / steps));
		await place(bias);
		const { pixels, width: size } = await engine.captureFrame();
		frames.push({ bias, pixels });
		const cover = covered(pixels);
		if (k === 0) {
			fine.push({ bias, share: 0, block: 0, drawn: cover });
			continue;
		}
		const one = frames[k - 1] as { pixels: Uint8Array };
		fine.push({ bias, ...compare(one.pixels, pixels, size), drawn: cover });
	}
	let worst: { index: number } & Step = { index: 0, ...(fine[0] as Step) };
	for (const [k, row] of fine.entries()) if (row.share > worst.share) worst = { index: k, ...row };
	const image = async (index: number): Promise<string> => {
		await place((frames[index] as { bias: number }).bias);
		const blob = await engine.capture();
		return toBase64(new Uint8Array(await blob.arrayBuffer()));
	};
	const images =
		params.has('images') && worst.index > 0
			? [await image(worst.index - 1), await image(worst.index)]
			: [];
	await engine.destroy();
	return {
		tier: engine.capabilities.tier,
		levels,
		lod: Number(lod),
		switchBias: high,
		found,
		fine,
		worst,
		images,
	};
});
