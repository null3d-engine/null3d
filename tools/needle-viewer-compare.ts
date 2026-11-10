// Draws the reduced Needle light map scene in both engines and compares the two pictures, for the
// done clause of M3-F4. The viewer is a static Needle build of the sample project
// madjin/lightmap-tests, which this tool pins by its bundle's SHA-256. The page gives the viewer the
// scene through the element's `src` attribute, so both sides draw the same glTF file, with the
// camera that the file's own `Capture Camera` node carries. The engine draws the same file through
// tests/pages/sketches/needle-viewer-sketch.ts at 1280 by 720, the viewer's canvas size.
//
// Run this only when no gate build is running: it starts a browser and compares images. The dev
// server, whose shaders and engine build must be current, runs on the address that --dev gives, or
// this tool starts it. The viewer's files come from --viewer.
//
//   bun tools/needle-viewer-compare.ts --viewer /path/to/lightmap-tests --out target/needle-viewer
//
// It writes each picture, a diff picture and a JSON record, and prints the share of pixels that
// differ at the image tests' threshold.
import { createHash } from 'node:crypto';
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { launchChromium } from '../packages/cli/src/browser.js';
import { compareImages, percent, TOLERANCE } from '../packages/cli/src/compare.js';
import { decodePngRgba, writePng } from '../packages/cli/src/png.js';
import { chromeForTesting } from '../tests/lib/chrome-for-testing.ts';

/** The browser and page types that Playwright gives, without importing its module here. */
type Browser = Awaited<ReturnType<typeof launchChromium>>;
type Page = Awaited<ReturnType<Browser['newPage']>>;

/** The viewer commit that the page load is pinned to, and its bundle's bytes. */
const VIEWER_COMMIT = '26b002870c43dde7ab8763f16ed965742969716f';
const VIEWER_BUNDLE = 'assets/index.1c388c0b.js';
const VIEWER_BUNDLE_SHA256 = '2d2c2b45b1a107c70ee69c17c71814e44c63e69aeeaec992116d9506b9047ce8';

/** The size of both pictures, the viewer's canvas and the engine page's canvas. */
const WIDTH = 1280;
const HEIGHT = 720;

/** The model folder that both sides load, from the repository root. */
const MODEL_FOLDER = 'tests/pages/assets/models/needle-lightmap';
const MODEL_FILES = [
	'scene.gltf',
	'scene.bin',
	'plaster_col.jpg',
	'plaster_nrm.jpg',
	'wood_disp.jpg',
	'wood_nrm.jpg',
	'lightmap.png',
];

/** The image page and sketch that draw the engine side. */
const IMAGE_PAGE = '/tests/pages/image.html';
const SKETCH = '/tests/pages/sketches/needle-viewer-sketch.ts';
const HOLD_SECONDS = 0.2;

/** Where the dev server answers unless --dev or NULL3D_PORT says another place. */
const DEFAULT_DEV_PORT = 5199;

/** What the image page publishes: the held frame's pixels, as base64 RGBA8. */
interface ImageResult {
	ok: boolean;
	error?: { code?: string; message?: string } | string;
	width: number;
	height: number;
	pixels: string;
	tier: string;
}

interface Options {
	viewer: string;
	out: string;
	dev?: string;
	gpus: string[];
}

function usage(): never {
	throw new Error(
		'usage: bun tools/needle-viewer-compare.ts --viewer <lightmap-tests checkout> --out <folder> [--dev <url>] [--gpu webgpu,compat,webgl2]',
	);
}

function readOptions(argv: string[]): Options {
	let viewer = '';
	let out = '';
	let dev: string | undefined;
	let gpus = ['webgpu', 'compat', 'webgl2'];
	for (let k = 0; k < argv.length; k++) {
		const arg = argv[k];
		const value = argv[k + 1];
		if (arg === '--viewer' && value) {
			viewer = value;
			k++;
		} else if (arg === '--out' && value) {
			out = value;
			k++;
		} else if (arg === '--dev' && value) {
			dev = value.replace(/\/$/, '');
			k++;
		} else if (arg === '--gpu' && value) {
			gpus = value.split(',');
			k++;
		} else {
			usage();
		}
	}
	if (!viewer || !out) usage();
	return { viewer: resolve(viewer), out: resolve(out), dev, gpus };
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Checks that the checkout is the pinned viewer build. */
function checkViewer(folder: string): void {
	const bundle = join(folder, VIEWER_BUNDLE);
	if (!existsSync(bundle))
		throw new Error(`${bundle} is missing; point --viewer at the lightmap-tests checkout`);
	const hash = sha256(readFileSync(bundle));
	if (hash !== VIEWER_BUNDLE_SHA256)
		throw new Error(
			`${bundle} has the SHA-256 ${hash}, not ${VIEWER_BUNDLE_SHA256} of commit ${VIEWER_COMMIT}; check out that commit`,
		);
}

/** Copies the viewer's static files and the shared model into a folder that one server answers. */
function stageViewer(viewer: string, model: string, stage: string): void {
	cpSync(join(viewer, 'assets'), join(stage, 'assets'), { recursive: true });
	cpSync(join(viewer, 'include'), join(stage, 'include'), { recursive: true });
	// The stylesheet asks for a web font that only the loading view uses. Its request is left out,
	// so the capture waits on the scene alone.
	const css = readFileSync(join(stage, 'assets/index.ba4d5d10.css'), 'utf8');
	writeFileSync(join(stage, 'assets/index.ba4d5d10.css'), css.replace(/@import"[^"]+";/, ''));
	mkdirSync(join(stage, 'model'), { recursive: true });
	for (const file of MODEL_FILES) cpSync(join(model, file), join(stage, 'model', file));
	writeFileSync(
		join(stage, 'index.html'),
		`<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="viewport" content="width=device-width, user-scalable=no" />
		<title>Needle light map comparison</title>
		<script type="module" crossorigin src="./assets/index.1c388c0b.js"></script>
		<link rel="stylesheet" href="./assets/index.ba4d5d10.css" />
		<style>html, body { margin: 0; overflow: hidden; background: #000; }</style>
	</head>
	<body>
		<script>window.global = window; var parcelRequire;</script>
		<needle-engine src="./model/scene.gltf"></needle-engine>
	</body>
</html>
`,
	);
}

const TYPES: Readonly<Record<string, string>> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.gltf': 'model/gltf+json',
	'.bin': 'application/octet-stream',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.wasm': 'application/wasm',
};

/** Serves the staged viewer on every interface, as a demo server does. */
function serveViewer(stage: string) {
	const server = Bun.serve({
		hostname: '0.0.0.0',
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			const file = resolve(stage, `.${path === '/' ? '/index.html' : path}`);
			const inside = file === stage || file.startsWith(`${stage}${sep}`);
			if (!inside || !existsSync(file)) return new Response('not found', { status: 404 });
			return new Response(Bun.file(file), {
				headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' },
			});
		},
	});
	return server;
}

/** Starts the dev server when the caller gave no address, and stops it when the run ends. */
async function startDev(port: number): Promise<{ url: string; stop: () => void }> {
	// The Vite program in this process's own runtime, so that stopping this process frees the port
	// for the next run.
	const root = resolve(import.meta.dirname, '..');
	const server = Bun.spawn([process.execPath, join(root, 'node_modules/vite/bin/vite.js')], {
		cwd: root,
		// This tool reaches its server over the loopback, which is a secure origin already, and its
		// readiness poll and page loads use plain HTTP, so it opts out of the HTTPS default.
		env: { ...Bun.env, NULL3D_PORT: String(port), NULL3D_HTTPS: '0' },
		stdout: 'ignore',
		stderr: 'inherit',
	});
	const url = `http://127.0.0.1:${port}`;
	const end = Date.now() + 180_000;
	for (;;) {
		try {
			const response = await fetch(`${url}${IMAGE_PAGE}`);
			if (response.ok) break;
		} catch {
			// The server is still starting.
		}
		if (Date.now() >= end) {
			server.kill();
			throw new Error(`the dev server did not answer at ${url} within 180 seconds`);
		}
		await Bun.sleep(500);
	}
	return {
		url,
		stop: () => {
			server.kill();
		},
	};
}

/** Waits for the image page's published result, then returns it. */
async function imageResult(page: Page, what: string): Promise<ImageResult> {
	await page.waitForFunction(
		() => {
			const result = (globalThis as { __null3dResult?: ImageResult }).__null3dResult;
			return result !== undefined && (result.ok === true || result.error !== undefined);
		},
		undefined,
		{ timeout: 120_000 },
	);
	const result = await page.evaluate(
		() => (globalThis as { __null3dResult?: ImageResult }).__null3dResult,
	);
	if (!result) throw new Error(`${what} published no result`);
	if (result.error !== undefined)
		throw new Error(`${what} failed: ${JSON.stringify(result.error)}`);
	return result;
}

/** The engine's held frame at the viewer's size, as RGBA8 pixels. */
async function captureEngine(
	browser: Browser,
	dev: string,
	gpu: string,
): Promise<{ width: number; height: number; data: Uint8Array; tier: string; url: string }> {
	const page = await browser.newPage({
		viewport: { width: WIDTH, height: HEIGHT },
		deviceScaleFactor: 1,
	});
	try {
		const url =
			`${dev}${IMAGE_PAGE}?gpu=${gpu}&preset=high&hold=${HOLD_SECONDS}` +
			`&size=${WIDTH}x${HEIGHT}&sketch=${encodeURIComponent(SKETCH)}`;
		await page.goto(url);
		const result = await imageResult(page, `the engine's ${gpu} frame`);
		if (result.width !== WIDTH || result.height !== HEIGHT)
			throw new Error(
				`the engine drew ${result.width} x ${result.height}, not ${WIDTH} x ${HEIGHT}`,
			);
		return {
			width: result.width,
			height: result.height,
			data: new Uint8Array(Buffer.from(result.pixels, 'base64')),
			tier: result.tier,
			url,
		};
	} finally {
		await page.close();
	}
}

/** A picture of the viewer's canvas, taken once two reads in a row match and the canvas is not blank. */
async function captureViewer(
	browser: Browser,
	url: string,
): Promise<{ width: number; height: number; data: Uint8Array; steps: string[] }> {
	const page = await browser.newPage({
		viewport: { width: WIDTH, height: HEIGHT },
		deviceScaleFactor: 1,
	});
	const steps: string[] = [
		`opened ${url} in headless Chrome at ${WIDTH} x ${HEIGHT}, pixel ratio 1`,
	];
	try {
		await page.goto(url);
		await page.waitForSelector('canvas', { timeout: 120_000 });
		await page.waitForFunction(
			() => {
				// The page's document, typed here because this project's libraries hold no DOM types.
				const root = globalThis as unknown as {
					document?: {
						querySelector(
							selector: string,
						): { classList: { contains(name: string): boolean } } | null;
					};
				};
				return (
					root.document?.querySelector('needle-engine')?.classList.contains('loading-finished') ??
					false
				);
			},
			undefined,
			{ timeout: 120_000 },
		);
		steps.push(
			'waited for the scene to finish loading, then read the canvas until two reads in a row matched',
		);
		const end = Date.now() + 120_000;
		let before: Uint8Array | undefined;
		let identical = 0;
		for (;;) {
			await Bun.sleep(500);
			const shot = await page.screenshot({ type: 'png' });
			const read = decodePngRgba(new Uint8Array(shot), 'the viewer screenshot');
			const uniform = isUniform(read.data);
			if (before && !uniform && sameBytes(before, read.data)) identical++;
			else identical = 0;
			before = read.data;
			if (identical >= 2) {
				if (read.width !== WIDTH || read.height !== HEIGHT)
					throw new Error(
						`the viewer's picture is ${read.width} x ${read.height}, not ${WIDTH} x ${HEIGHT}`,
					);
				steps.push(`took the picture after ${identical + 1} matching reads, with no uniform frame`);
				return { width: read.width, height: read.height, data: read.data, steps };
			}
			if (Date.now() >= end)
				throw new Error('the viewer drew no settled picture within 120 seconds');
		}
	} finally {
		await page.close();
	}
}

/** Whether every pixel of an image holds one color, as a blank canvas does. */
function isUniform(pixels: Uint8Array): boolean {
	const r = pixels[0];
	const g = pixels[1];
	const b = pixels[2];
	for (let at = 4; at < pixels.length; at += 4)
		if (pixels[at] !== r || pixels[at + 1] !== g || pixels[at + 2] !== b) return false;
	return true;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
	return true;
}

async function main(): Promise<void> {
	const options = readOptions(Bun.argv.slice(2));
	checkViewer(options.viewer);
	const model = resolve(import.meta.dirname, '..', MODEL_FOLDER);
	for (const file of MODEL_FILES)
		if (!existsSync(join(model, file))) throw new Error(`${join(model, file)} is missing`);

	const stage = mkdtempSync(join(tmpdir(), 'null3d-needle-viewer-'));
	stageViewer(options.viewer, model, stage);
	const viewerServer = serveViewer(stage);
	const viewerPort = viewerServer.port;
	let dev: { url: string; stop: () => void } | undefined;
	let browser: Browser | undefined;
	try {
		dev = options.dev
			? { url: options.dev, stop: () => undefined }
			: await startDev(DEFAULT_DEV_PORT);
		browser = await launchChromium({ headless: true, ...chromeForTesting() });
		mkdirSync(options.out, { recursive: true });
		const viewerUrl = `http://127.0.0.1:${viewerPort}/index.html`;
		const viewer = await captureViewer(browser, viewerUrl);
		writePng(join(options.out, 'needle-viewer-viewer.png'), viewer);

		const rows = [];
		for (const gpu of options.gpus) {
			const engine = await captureEngine(browser, dev.url, gpu);
			writePng(join(options.out, `needle-viewer-engine-${gpu}.png`), engine);
			const { share, diff } = compareImages(viewer, engine, TOLERANCE.threshold);
			const close = compareImages(viewer, engine, 1 / 255);
			writePng(join(options.out, `needle-viewer-diff-${gpu}.png`), diff);
			rows.push({
				gpu,
				tier: engine.tier,
				engineUrl: engine.url,
				share,
				sharePercent: percent(share),
				closeShare: close.share,
				closeSharePercent: percent(close.share),
			});
		}

		const record = {
			repositoryCommit: Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim(),
			browserVersion: browser.version(),
			viewer: {
				commit: VIEWER_COMMIT,
				bundleSha256: VIEWER_BUNDLE_SHA256,
				url: viewerUrl,
				width: viewer.width,
				height: viewer.height,
				deviceScaleFactor: 1,
				steps: viewer.steps,
			},
			engine: {
				sketch: SKETCH,
				size: [WIDTH, HEIGHT],
				holdSeconds: HOLD_SECONDS,
			},
			threshold: TOLERANCE.threshold,
			rows,
		};
		writeFileSync(
			join(options.out, 'needle-viewer-comparison.json'),
			`${JSON.stringify(record, null, 2)}\n`,
		);
		for (const row of rows)
			console.log(
				`needle-viewer ${row.gpu} (${row.tier}): ${row.sharePercent} of pixels differ at the image tests' threshold, ${row.closeSharePercent} at 1/255`,
			);
	} finally {
		if (browser) await browser.close();
		dev?.stop();
		viewerServer.stop(true);
		rmSync(stage, { recursive: true, force: true });
	}
}

await main();
