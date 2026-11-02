// Renders a review plant in the wind as a short animated GIF, so the motion of a render can be
// watched beside the clip in the species' reference folder rather than described in prose.
// Each frame is a hold page at a later scene time, read back through the engine and shrunk; the
// frames share one palette, so colors do not flicker between them.
//
// From the repository root, with the pictures drawn by `target/tree-render/render.ts`:
//   bun tools/tree-clip.ts --species review-aspen --out .internal/coordination/tree-renders/aspen-wind
//     [--seconds 3] [--fps 10] [--width 360] [--turn 0] [--seed 11] [--variant 0] [--view whole]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { defaultEnvironment, launchBrowser } from '../packages/cli/src/browser.js';

/** The page type of the browser that the pictures are drawn in. */
type BrowserPage = Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>['newPage']>>;

/** Where the plant pictures and clips are written. */
const DEFAULT_OUT = '.internal/coordination/tree-renders';

interface Frame {
	width: number;
	height: number;
	pixels: Uint8Array;
}

/** One named option from the command line, or its default. */
function option(name: string, fallback?: string): string {
	const at = process.argv.indexOf(`--${name}`);
	const value = at >= 0 ? process.argv[at + 1] : undefined;
	if (value === undefined) {
		if (fallback !== undefined) return fallback;
		throw new Error(`--${name} is required.`);
	}
	return value;
}

/** The weights of an area filter along one axis: for each output pixel, the source pixels it covers. */
function areaWeights(from: number, to: number): { start: number; weights: number[] }[] {
	const scale = from / to;
	return Array.from({ length: to }, (_, i) => {
		const left = i * scale;
		const right = left + scale;
		const start = Math.floor(left);
		const weights: number[] = [];
		for (let s = start; s < Math.min(from, Math.ceil(right)); s++)
			weights.push((Math.min(right, s + 1) - Math.max(left, s)) / scale);
		return { start, weights };
	});
}

/** Shrinks an RGBA image to `width` wide, keeping its shape, by averaging the pixels each covers. */
function shrink(frame: Frame, width: number): Frame {
	const height = Math.round((frame.height * width) / frame.width);
	const columns = areaWeights(frame.width, width);
	const rows = areaWeights(frame.height, height);
	const across = new Float32Array(width * frame.height * 4);
	for (let y = 0; y < frame.height; y++)
		for (let x = 0; x < width; x++) {
			const { start, weights } = columns[x] as { start: number; weights: number[] };
			for (let c = 0; c < 4; c++) {
				let sum = 0;
				for (let k = 0; k < weights.length; k++)
					sum +=
						(weights[k] as number) *
						(frame.pixels[(y * frame.width + start + k) * 4 + c] as number);
				across[(y * width + x) * 4 + c] = sum;
			}
		}
	const pixels = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const { start, weights } = rows[y] as { start: number; weights: number[] };
		for (let x = 0; x < width; x++)
			for (let c = 0; c < 4; c++) {
				let sum = 0;
				for (let k = 0; k < weights.length; k++)
					sum += (weights[k] as number) * (across[((start + k) * width + x) * 4 + c] as number);
				pixels[(y * width + x) * 4 + c] = Math.round(sum);
			}
	}
	return { width, height, pixels };
}

/** Draws the review plant at a scene time in the wind and reads the frame back, top row first. */
async function renderAt(
	page: BrowserPage,
	base: string,
	sketch: string,
	t: number,
): Promise<Frame> {
	const query = new URLSearchParams({
		sketch,
		hold: t.toFixed(3),
		size: '768x1024',
	});
	await page.goto(`${base}/tests/pages/image.html?${query}`, { waitUntil: 'domcontentloaded' });
	await page.waitForFunction(
		() => (globalThis as { __null3dResult?: unknown }).__null3dResult !== undefined,
		undefined,
		{ timeout: 240_000 },
	);
	const result = (await page.evaluate(
		() => (globalThis as { __null3dResult?: unknown }).__null3dResult,
	)) as { ok?: boolean; error?: string; width?: number; height?: number; pixels?: string };
	if (result.ok !== true)
		throw new Error(`the frame at ${t} s failed: ${result.error ?? 'no result'}`);
	return {
		width: result.width as number,
		height: result.height as number,
		pixels: new Uint8Array(Buffer.from(result.pixels as string, 'base64')),
	};
}

async function main(): Promise<void> {
	const species = option('species', 'review-aspen');
	const out = option('out', join(DEFAULT_OUT, `${species.replace('review-', '')}-wind`));
	const seconds = Number(option('seconds', '3'));
	const fps = Number(option('fps', '10'));
	const width = Number(option('width', '360'));
	const turn = option('turn', '0');
	const seed = option('seed', '11');
	const variant = option('variant', '0');
	const view = option('view', 'whole');
	const frames = Math.max(1, Math.round(seconds * fps));
	const delay = Math.round(1000 / fps);
	// The sketch's own query: the same framing as the stills, with the wind switched on.
	const sketch =
		`/tests/pages/sketches/tree-review-sketch.ts?species=${species}` +
		`&view=${view}&seed=${seed}&variant=${variant}&turn=${turn}&wind=1`;
	const base = `http://localhost:${process.env.NULL3D_PORT ?? '6173'}`;
	const browser = await launchBrowser(defaultEnvironment());
	const captured: Frame[] = [];
	try {
		const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
		for (let i = 0; i < frames; i++) {
			// The wind starts after a second, so its first gusts have formed by the first frame.
			const t = 1 + i / fps;
			captured.push(shrink(await renderAt(page, base, sketch, t), width));
			process.stdout.write(`\rframe ${i + 1} of ${frames}`);
		}
		process.stdout.write('\n');
		await page.close();
	} finally {
		await browser.close();
	}
	const { width: gifWidth, height: gifHeight } = captured[0] as Frame;
	const palette = quantize(joinFrames(captured, gifWidth, gifHeight), 256);
	const gif = GIFEncoder();
	for (const [i, frame] of captured.entries()) {
		const index = applyPalette(frame.pixels, palette);
		// The first frame's palette becomes the GIF's global palette, which later frames use.
		gif.writeFrame(index, gifWidth, gifHeight, {
			palette: i === 0 ? palette : undefined,
			delay,
		});
	}
	gif.finish();
	const file = `${out}.gif`;
	writeFileSync(file, gif.bytes());
	console.log(
		`${file}: ${gifWidth}x${gifHeight}, ${frames} frames at ${fps} fps, ` +
			`${((gif.bytes().length as number) / 1e6).toFixed(2)} MB`,
	);
}

/** Every frame's pixels in one buffer, which the palette is sampled from. */
function joinFrames(frames: readonly Frame[], width: number, height: number): Uint8Array {
	const joined = new Uint8Array(frames.length * width * height * 4);
	for (const [i, frame] of frames.entries()) joined.set(frame.pixels, i * width * height * 4);
	return joined;
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`error: ${(error as Error).message}`);
		process.exit(1);
	});
}
