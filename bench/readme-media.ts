// Renders the README's animation: benchmark scene S1, drawn by null3d on WebGPU in Chrome. Each
// frame is a hold page at a later scene time, read back through the engine, shrunk with an area
// filter, and written into a GIF that shares one palette, so colors do not flicker between frames.
// From the repository root:
//   bun run readme-media
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Page } from '@playwright/test';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { launchInWindow, newParkedPage } from '../tests/lib/app-window.ts';
import { pageResult } from '../tests/lib/page-result.ts';
import { REPO_ROOT, startServer } from '../tests/lib/server.ts';
import { pagePath } from './lib/parity';

/** Where the README takes the animation from. */
const OUTPUT = '.github/assets/s1.gif';
/** Boxes in the scene, as in the benchmark. */
const COUNT = 100_000;
/** The scene time of the first frame, in seconds. */
const START_SECONDS = 7.5;
const FRAMES = 48;
/** Time between frames, both in the scene and when the GIF plays. */
const FRAME_MS = 80;
/** The GIF's width in pixels; its height keeps the frame's shape. */
const WIDTH = 480;
/** Frames that the shared palette samples, one in this many. */
const PALETTE_SAMPLE_EVERY = 6;

interface Frame {
	width: number;
	height: number;
	pixels: Uint8Array;
}

/** Draws S1 at scene time `t` in hold mode and reads the frame back as RGBA rows, top row first. */
async function renderAt(page: Page, baseUrl: string, t: number): Promise<Frame> {
	const url = `${baseUrl}${pagePath('s1', 'null3d-webgpu', `hold=${t}&n=${COUNT}`)}`;
	await page.goto(url);
	const result = await pageResult<{
		ok: boolean;
		error?: string;
		width: number;
		height: number;
		pixels: string;
	}>(page, 60_000);
	if (!result.ok) throw new Error(`the hold page at ${t} s failed: ${result.error}`);
	return {
		width: result.width,
		height: result.height,
		pixels: new Uint8Array(Buffer.from(result.pixels, 'base64')),
	};
}

/**
 * The weights of an area filter along one axis: for each output pixel, the source pixels it covers
 * and how much of each.
 */
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
	for (let y = 0; y < frame.height; y++) {
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
	}
	const pixels = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const { start, weights } = rows[y] as { start: number; weights: number[] };
		for (let x = 0; x < width; x++) {
			for (let c = 0; c < 4; c++) {
				let sum = 0;
				for (let k = 0; k < weights.length; k++)
					sum += (weights[k] as number) * (across[((start + k) * width + x) * 4 + c] as number);
				pixels[(y * width + x) * 4 + c] = Math.round(sum);
			}
		}
	}
	return { width, height, pixels };
}

async function main(): Promise<void> {
	const server = await startServer();
	const browser = await launchInWindow({ channel: 'chrome' });
	const frames: Frame[] = [];
	try {
		const page = await newParkedPage(browser);
		for (let i = 0; i < FRAMES; i++) {
			const t = START_SECONDS + (i * FRAME_MS) / 1000;
			frames.push(shrink(await renderAt(page, server.url, t), WIDTH));
			process.stdout.write(`\rframe ${i + 1} of ${FRAMES}`);
		}
		process.stdout.write('\n');
	} finally {
		await browser.close();
		server.stop();
	}
	const { width, height } = frames[0] as Frame;
	const sampled = frames.filter((_, i) => i % PALETTE_SAMPLE_EVERY === 0);
	const joined = new Uint8Array(sampled.length * width * height * 4);
	for (const [i, frame] of sampled.entries()) joined.set(frame.pixels, i * width * height * 4);
	const palette = quantize(joined, 256);
	const gif = GIFEncoder();
	for (const [i, frame] of frames.entries()) {
		const index = applyPalette(frame.pixels, palette);
		// The first frame's palette becomes the GIF's global palette, which later frames use.
		gif.writeFrame(index, width, height, {
			palette: i === 0 ? palette : undefined,
			delay: FRAME_MS,
		});
	}
	gif.finish();
	const file = join(REPO_ROOT, OUTPUT);
	writeFileSync(file, gif.bytes());
	console.log(
		`${relative(REPO_ROOT, file)}: ${width}x${height}, ${FRAMES} frames, ${(gif.bytes().length / 1e6).toFixed(2)} MB`,
	);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
