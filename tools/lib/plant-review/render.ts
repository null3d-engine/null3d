// Draws the plant review page headless on this computer's GPU. One shot is one page load: a single
// view, or a sheet of turns of one view that the page draws into a grid of cells with one camera
// each, which this cuts into one picture per turn. A shot can be drawn twice, once as the picture
// and once as a matte (the plant black on white from the same cameras), which gives the comparison
// the plant's exact outline. One browser draws every shot, one page at a time; a shot that fails is
// recorded with its error and the run carries on.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultEnvironment } from '../../../packages/cli/src/browser.js';
import { writePng } from '../../../packages/cli/src/png.js';
import { launchRepoBrowser } from '../../../tests/lib/chrome-for-testing.ts';
import { startServer } from '../../../tests/lib/server.ts';
import {
	type PlantReviewQuery,
	plantReviewQuery,
} from '../../../tests/pages/lib/plant-review/query.ts';
import type { Rgba } from './image.ts';

/** The page that draws one held frame of a sketch. */
const IMAGE_PAGE = '/tests/pages/image.html';
/** The review page's sketch, from the server's root. */
const SKETCH = '/tests/pages/sketches/plant-review-sketch.ts';
/** How long one page may take, in milliseconds: the first page builds its shaders. */
const PAGE_TIMEOUT = 600_000;
/**
 * How many times the tool asks a page for the result it published. A browser that cannot return a
 * large result by value answers with nothing rather than an error, and the page keeps its result, so
 * a later ask reads it.
 */
const RESULT_READS = 4;
/** How long the tool waits before asking a page again for the result it published, in milliseconds. */
const RESULT_RETRY_MS = 750;
/** How many characters of a page's pixels one read returns, which keeps that return small. */
const PIXEL_SLICE = 4_000_000;
/** The most cells one sheet holds, which keeps a sheet's canvas inside the GPU's limits. */
export const SHEET_CELLS = 24;
/** The most columns a sheet has. */
const SHEET_COLUMNS = 6;
/**
 * The most pixels one sheet's canvas holds, so a sheet of cells at a video's own frame size stays
 * inside the GPU's memory: fewer cells to a sheet as each grows.
 */
const SHEET_PIXELS = 8_000_000;

/** One picture a shot gives: its file in the run folder and the turn it shows. */
export interface ShotCell {
	readonly file: string;
	readonly turn: number;
}

/** One page load: the query, the sheet's cells and whether a matte follows. */
export interface Shot {
	/** The group of the run the shot belongs to, such as `turn-oak-turntable` or `stills`. */
	readonly group: string;
	readonly query: PlantReviewQuery;
	/** The sketch time the frame holds at, in seconds. */
	readonly hold: number;
	/** The size of one cell, in pixels. */
	readonly cell: readonly [number, number];
	readonly cells: readonly ShotCell[];
	readonly matte: boolean;
	/** The reference the shot is compared with, for a still. */
	readonly reference?: string;
}

/** One picture the run drew, as the run's manifest records it. */
export interface RunFrame {
	readonly group: string;
	readonly file: string;
	readonly turn: number;
	readonly query: PlantReviewQuery;
	readonly hold: number;
	readonly matte?: string;
	/** Why the matte failed, when the picture drew and its matte did not. */
	readonly matteError?: string;
	readonly reference?: string;
	readonly sha256?: string;
	/** What the page posted for this cell: its camera and, when asked, its measures. */
	readonly cell?: unknown;
	/** What the page posted for the whole shot, less the cells. */
	readonly facts?: unknown;
	readonly error?: string;
	readonly ms: number;
}

/**
 * The grid of a sheet of `n` cells: as few rows as the columns allow, each as full as the cells
 * allow, so the canvas holds few empty cells.
 */
export function sheetGrid(n: number): { readonly columns: number; readonly rows: number } {
	const rows = Math.ceil(n / SHEET_COLUMNS);
	return { columns: Math.ceil(n / rows), rows };
}

/**
 * The shots of a full or partial turn: `count` turns from `first` degrees at `step` degrees, in
 * sheets of at most `most` cells, each sheet's canvas within the pixels a sheet holds.
 */
export function turnShots(
	group: string,
	query: PlantReviewQuery,
	cell: readonly [number, number],
	first: number,
	step: number,
	count: number,
	matte: boolean,
	hold = 1,
	most = SHEET_CELLS,
): Shot[] {
	const shots: Shot[] = [];
	// The most cells a sheet takes whose canvas, empty cells and all, stays within its pixels.
	let perSheet = Math.max(1, Math.min(SHEET_CELLS, most));
	const canvas = (n: number) => {
		const { columns, rows } = sheetGrid(n);
		return columns * rows * cell[0] * cell[1];
	};
	while (perSheet > 1 && canvas(perSheet) > SHEET_PIXELS) perSheet--;
	for (let start = 0; start < count; start += perSheet) {
		const n = Math.min(perSheet, count - start);
		const cells = Array.from({ length: n }, (_, k) => {
			const index = start + k;
			const turn = first + index * step;
			return {
				file: join(
					group,
					`${group}-${String(index).padStart(3, '0')}-${turn.toFixed(1).padStart(5, '0')}.png`,
				),
				turn,
			};
		});
		shots.push({
			group,
			query: {
				...query,
				turn: first + start * step,
				turns: n,
				step,
				columns: sheetGrid(n).columns,
			},
			hold,
			cell,
			cells,
			matte,
		});
	}
	return shots;
}

/** A shot of one picture. */
export function singleShot(
	group: string,
	file: string,
	query: PlantReviewQuery,
	cell: readonly [number, number],
	matte: boolean,
	reference?: string,
	hold = 1,
): Shot {
	return {
		group,
		query,
		hold,
		cell,
		cells: [{ file: join(group, file), turn: query.turn ?? 0 }],
		matte,
		...(reference && { reference }),
	};
}

/** What the image page published for one page. */
export interface PageResult {
	ok?: boolean;
	error?: string;
	width?: number;
	height?: number;
	pixels?: string;
	sketch?: Record<string, unknown>;
}

/** The browser that the shots are drawn in. */
type Browser = Awaited<ReturnType<typeof launchRepoBrowser>>;

/** One page of the browser. */
type Page = Awaited<ReturnType<Browser['newPage']>>;

/**
 * Reads the result a page published, asking again while the browser hands back nothing. The page
 * keeps its result after it publishes, so a result that a loaded browser could not pass back whole
 * is read by a later ask, or in pieces.
 */
export async function readPublished(page: Page): Promise<PageResult> {
	for (let read = 1; read <= RESULT_READS; read++) {
		const result = (await page.evaluate(
			() => (globalThis as { __null3dResult?: unknown }).__null3dResult,
		)) as PageResult | undefined;
		if (result !== undefined) return result;
		if (read < RESULT_READS) await new Promise((settle) => setTimeout(settle, RESULT_RETRY_MS));
	}
	const pieces = await readInPieces(page);
	if (pieces !== undefined) return pieces;
	throw new Error(
		`the page published a result, and the browser returned none of it in ${RESULT_READS} reads`,
	);
}

/** A page's result with its pixels replaced by their length, as the piecewise read first asks. */
type ResultWithoutPixels = Omit<PageResult, 'pixels'> & { readonly pixels: number | null };

/**
 * Reads a result that the browser would not pass back whole, in pieces: the small fields first, then
 * the pixels in slices. The page keeps its result, so every piece comes from the one held object.
 */
async function readInPieces(page: Page): Promise<PageResult | undefined> {
	const whole = (await page.evaluate(() => {
		const held = (globalThis as { __null3dResult?: unknown }).__null3dResult;
		if (held === undefined || held === null) return undefined;
		const { pixels, ...rest } = held as Record<string, unknown>;
		return { ...rest, pixels: typeof pixels === 'string' ? pixels.length : null };
	})) as ResultWithoutPixels | undefined;
	if (whole === undefined) return undefined;
	const length = whole.pixels;
	if (typeof length !== 'number') {
		const { pixels: _length, ...rest } = whole;
		return rest;
	}
	const slices: string[] = [];
	for (let at = 0; at < length; at += PIXEL_SLICE) {
		slices.push(
			(await page.evaluate(
				([from, size]: readonly [number, number]) =>
					(
						(globalThis as { __null3dResult?: { pixels?: string } }).__null3dResult?.pixels ?? ''
					).slice(from, from + size),
				[at, PIXEL_SLICE] as const,
			)) as string,
		);
	}
	const { pixels: _length, ...rest } = whole;
	return { ...rest, pixels: slices.join('') };
}

/** The canvas size of a shot: its cells in its grid. */
function canvasOf(shot: Shot): [number, number] {
	const columns = shot.query.columns ?? 1;
	const rows = Math.ceil(shot.cells.length / columns);
	return [shot.cell[0] * columns, shot.cell[1] * rows];
}

/** Draws one page and returns its pixels and what the sketch posted. */
async function drawPage(
	browser: Browser,
	base: string,
	query: PlantReviewQuery,
	size: readonly [number, number],
	hold: number,
	gpu: string | undefined,
): Promise<{ image: Rgba; facts: Record<string, unknown> | undefined }> {
	// The dev server serves the local certificate, which this browser has not been told to trust.
	const page = await browser.newPage({
		viewport: { width: size[0], height: size[1] },
		ignoreHTTPSErrors: true,
	});
	try {
		const params = new URLSearchParams({
			sketch: `${SKETCH}?${plantReviewQuery({ ...query, size })}`,
			hold: String(hold),
			size: `${size[0]}x${size[1]}`,
			preset: query.preset ?? 'high',
			...(gpu && { gpu }),
		});
		await page.goto(`${base}${IMAGE_PAGE}?${params}`, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(
			() => (globalThis as { __null3dResult?: unknown }).__null3dResult !== undefined,
			undefined,
			{ timeout: PAGE_TIMEOUT },
		);
		const result = await readPublished(page);
		if (result.ok !== true) throw new Error(result.error ?? 'the page published no result');
		return {
			image: {
				width: result.width as number,
				height: result.height as number,
				data: new Uint8Array(Buffer.from(result.pixels as string, 'base64')),
			},
			facts: result.sketch?.['plant-review'] as Record<string, unknown> | undefined,
		};
	} finally {
		await page.close();
	}
}

/** One cell cut from a sheet. */
function crop(image: Rgba, x: number, y: number, width: number, height: number): Rgba {
	const data = new Uint8Array(width * height * 4);
	for (let row = 0; row < height; row++) {
		const from = ((y + row) * image.width + x) * 4;
		data.set(image.data.subarray(from, from + width * 4), row * width * 4);
	}
	return { width, height, data };
}

/** Writes each cell of a drawn sheet to its file, and returns the files' hashes. */
function writeCells(dir: string, shot: Shot, image: Rgba, suffix: string): string[] {
	const columns = shot.query.columns ?? 1;
	const [w, h] = shot.cell;
	return shot.cells.map((cell, k) => {
		const path = join(dir, cell.file.replace(/\.png$/, `${suffix}.png`));
		mkdirSync(dirname(path), { recursive: true });
		writePng(path, crop(image, (k % columns) * w, Math.floor(k / columns) * h, w, h));
		return createHash('sha256').update(readFileSync(path)).digest('hex');
	});
}

/**
 * Draws every shot into the run folder and returns one frame record per cell. The dev server must
 * serve this copy of the repository on the port that NULL3D_PORT names; one is started when none
 * answers there.
 */
export async function drawShots(
	dir: string,
	shots: readonly Shot[],
	options: { readonly gpu?: string; readonly log?: (line: string) => void } = {},
): Promise<RunFrame[]> {
	const log = options.log ?? console.log;
	// A checkout without a development certificate draws over plain HTTP on the loopback, as the
	// server asks: the environment's choice reaches the server instead of being forced to HTTPS.
	const server = await startServer(process.env.NULL3D_HTTPS !== '0');
	const browser = await launchRepoBrowser(defaultEnvironment());
	const frames: RunFrame[] = [];
	try {
		for (const [i, shot] of shots.entries()) {
			const begun = Date.now();
			const size = canvasOf(shot);
			const records = shot.cells.map((cell) => ({
				group: shot.group,
				file: cell.file,
				turn: cell.turn,
				query: {
					...shot.query,
					turn: cell.turn,
					turns: undefined,
					step: undefined,
					columns: undefined,
				},
				hold: shot.hold,
				...(shot.reference && { reference: shot.reference }),
			}));
			try {
				const { image, facts } = await drawPage(
					browser,
					server.url,
					shot.query,
					size,
					shot.hold,
					options.gpu,
				);
				const hashes = writeCells(dir, shot, image, '');
				const cells = (facts?.cells as unknown[] | undefined) ?? [];
				const { cells: _cells, ...shared } = facts ?? {};
				let mattes: string[] | undefined;
				let matteError: string | undefined;
				if (shot.matte) {
					// A matte that fails leaves the pictures; their outlines then come from colour.
					try {
						const matte = await drawPage(
							browser,
							server.url,
							{ ...shot.query, matte: true },
							size,
							shot.hold,
							options.gpu,
						);
						writeCells(dir, shot, matte.image, '-matte');
						mattes = shot.cells.map((cell) => cell.file.replace(/\.png$/, '-matte.png'));
					} catch (error) {
						matteError = (error as Error).message.split('\n')[0] ?? 'failed';
						log(`      the matte failed: ${matteError}`);
					}
				}
				const ms = Date.now() - begun;
				for (const [k, record] of records.entries())
					frames.push({
						...record,
						sha256: hashes[k],
						...(mattes && { matte: mattes[k] }),
						...(matteError && { matteError }),
						cell: cells[k],
						facts: shared,
						ms: ms / records.length,
					});
				log(
					`  ${String(i + 1).padStart(3)}/${shots.length} ${shot.cells[0]?.file}${shot.cells.length > 1 ? ` and ${shot.cells.length - 1} more` : ''}: ${(ms / 1000).toFixed(1)} s`,
				);
			} catch (error) {
				const message = (error as Error).message.split('\n')[0] ?? 'failed';
				for (const record of records) frames.push({ ...record, error: message, ms: 0 });
				log(
					`  ${String(i + 1).padStart(3)}/${shots.length} ${shot.cells[0]?.file}: failed: ${message}`,
				);
			}
		}
	} finally {
		await browser.close();
		server.stop();
	}
	return frames;
}
