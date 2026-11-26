// Draws the documentation's pictures: every shot of docs/images/shots.json that the image test
// manifest can draw, at about 1,600 pixels wide. The image test's own references are 320 x 180, too
// small for a page, so each shot is drawn again from the same sketch, hold time and switches that
// the reference uses. A shot whose source files and reference image have not changed since the last
// run is skipped. Run from the repository root:
//   bun tools/docs-screenshots.ts            draw every changed shot
//   bun tools/docs-screenshots.ts --list     print each shot's plan, and why a shot is left out
//   bun tools/docs-screenshots.ts --force    draw every shot again
//   bun tools/docs-screenshots.ts --only instances   draw the shots whose ID holds "instances"
// Run `bun run build` and `bun run shaders` first, and `bun run chrome:install` once per computer.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { heldImage } from '../packages/cli/src/page.js';
import { encodePng } from '../packages/cli/src/png.js';
import { holdPage, startRunner } from '../packages/cli/src/runner.js';
import { IMAGE_TESTS } from '../tests/image/manifest.ts';
import { type ImageRun, imageRuns } from '../tests/lib/images.ts';

/** The file that lists every shot. */
export const SHOTS_FILE = 'docs/images/shots.json';
/** Where each shot's picture goes. */
export const SHOTS_DIR = 'docs/images';
/** The record of each shot's sources at its last draw, which git ignores. */
const STATE_FILE = 'target/docs-screenshots.json';
/** The width that `--width` gives every shot, in pixels. */
export const DEFAULT_WIDTH = 1600;
/**
 * Bumped when the way a shot is drawn changes, so every shot is drawn again even though its sources
 * did not move.
 */
const CAPTURE_VERSION = 1;

/** One entry of shots.json, as the docs check and this tool read it. */
export interface Shot {
	/** The path under docs/images, without its .webp suffix. */
	id: string;
	/** Each page that shows the shot, with the place on the page after `#`. */
	pages: readonly string[];
	/** `reference`, `scripted` or `manual`. */
	source: string;
	/** The reference images under tests/image/references/chrome-real-gpu/ that the shot uses. */
	images?: readonly string[];
	/** How the shot is captured or composed. */
	steps?: string;
	alt: string;
	caption: string;
	/** The source files that decide what the picture shows. */
	files: readonly string[];
	verdict: string;
	note?: string;
}

/** How one shot is drawn: the image test's run whose sketch, switches and hold give its picture. */
interface Plan {
	test: string;
	tier: string;
	/** The image page with its switches, which this tool resizes. */
	path: string;
	/** The test's own picture size, whose aspect the larger picture keeps. */
	size: readonly [number, number];
	hold?: number;
	timeoutSeconds: number;
}

/** A shot's plan, or the reason that this tool leaves it out. */
export type Resolution = { ok: true; plan: Plan } | { ok: false; reason: string };

const REFERENCE = /^(webgpu|compat|webgl2)\/(.+)\.png$/;

/**
 * The plan for a shot: the image test whose reference it names, where the shot has one image that
 * names a test. A shot that joins several pictures or that a person takes with the browser's tools
 * has no plan here.
 */
export function resolveShot(shot: Shot, runs: readonly ImageRun[]): Resolution {
	const images = shot.images ?? [];
	if (images.length === 0)
		return {
			ok: false,
			reason:
				shot.source === 'manual'
					? 'taken by hand with the browser tools (source: manual)'
					: 'no reference image; the steps name no page that the tool can open',
		};
	if (images.length > 1)
		return {
			ok: false,
			reason: `joins ${images.length} pictures, which needs composition by hand`,
		};
	const match = REFERENCE.exec(images[0] as string);
	if (!match) return { ok: false, reason: `reference ${images[0]} is not a test picture` };
	const [, tier = '', test = ''] = match;
	const run = runs.find((one) => one.test === test && one.tier === tier);
	if (run === undefined)
		return { ok: false, reason: `the image test manifest has no ${tier} run of ${test}` };
	return {
		ok: true,
		plan: {
			test,
			tier,
			path: run.path,
			size: run.size,
			...(run.hold !== undefined && { hold: run.hold }),
			timeoutSeconds: run.timeoutSeconds,
		},
	};
}

/** The wider picture's size: the asked width, and the test picture's height at that width. */
export function pictureSize(
	testSize: readonly [number, number],
	width: number = DEFAULT_WIDTH,
): [number, number] {
	const [testWidth, testHeight] = testSize;
	return [width, Math.max(1, Math.round((width * testHeight) / testWidth))];
}

/** The image page's address with its picture at the wider size. */
export function widerPath(path: string, size: readonly [number, number]): string {
	const wanted = `${size[0]}x${size[1]}`;
	const existing = /([?&])size=[^&]*/;
	return existing.test(path)
		? path.replace(existing, `$1size=${wanted}`)
		: `${path}${path.includes('?') ? '&' : '?'}size=${wanted}`;
}

/** Every file below a path, sorted, when the path is a folder; the path itself otherwise. */
function sourceFiles(path: string, root: string): string[] {
	const full = join(root, path);
	if (!existsSync(full)) return [];
	if (!statSync(full).isDirectory()) return [path];
	const found: string[] = [];
	const walk = (folder: string) => {
		for (const entry of readdirSync(folder, { withFileTypes: true })) {
			const next = join(folder, entry.name);
			if (entry.isDirectory()) walk(next);
			else if (entry.isFile()) found.push(relative(root, next));
		}
	};
	walk(full);
	return found.sort();
}

/**
 * A digest of everything that decides a shot's picture: its source files, its reference image, the
 * address that the tool opens, the size, and the capture version.
 */
export function shotDigest(
	shot: Shot,
	plan: Plan,
	size: readonly [number, number],
	root: string = process.cwd(),
): string {
	const hash = createHash('sha256');
	hash.update(`v${CAPTURE_VERSION}\n`);
	hash.update(`${widerPath(plan.path, size)}\n`);
	for (const path of shot.files) {
		for (const file of sourceFiles(path, root)) {
			hash.update(`${file}\n`);
			hash.update(readFileSync(join(root, file)));
			hash.update('\n');
		}
	}
	return hash.digest('hex');
}

/** The last run's digests, by shot ID. */
type State = Record<string, string>;

function readState(root: string): State {
	try {
		return JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8'));
	} catch {
		return {};
	}
}

function writeState(root: string, state: State): void {
	mkdirSync(join(root, 'target'), { recursive: true });
	writeFileSync(join(root, STATE_FILE), `${JSON.stringify(state, null, '\t')}\n`);
}

/** The PNG of a held frame, encoded as a WebP picture at a good quality for a page. */
export async function webpBytes(image: {
	width: number;
	height: number;
	data: Uint8Array;
}): Promise<Uint8Array> {
	const png = encodePng(image);
	return new Bun.Image(png).webp({ quality: 82 }).bytes();
}

export interface Options {
	force: boolean;
	list: boolean;
	only?: string;
	width: number;
}

/** The command line's options. */
export function readOptions(args: readonly string[]): Options {
	let force = false;
	let list = false;
	let only: string | undefined;
	let width = DEFAULT_WIDTH;
	for (let at = 0; at < args.length; at++) {
		const arg = args[at] as string;
		if (arg === '--force') force = true;
		else if (arg === '--list') list = true;
		else if (arg === '--only') {
			only = args[++at];
			if (only === undefined) throw new Error('--only needs a part of a shot ID');
		} else if (arg === '--width') {
			const value = Number(args[++at]);
			if (!Number.isSafeInteger(value) || value <= 0)
				throw new Error('--width needs a whole number of pixels');
			width = value;
		} else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
	}
	return { force, list, ...(only !== undefined && { only }), width };
}

interface Result {
	written: string[];
	skipped: string[];
	failed: string[];
	leftOut: { id: string; reason: string }[];
}

/** Draws the shots that the options ask for, and returns what it wrote, skipped, failed and left out. */
export async function capture(options: Options, root: string = process.cwd()): Promise<Result> {
	const shots = JSON.parse(readFileSync(join(root, SHOTS_FILE), 'utf8')) as Shot[];
	const runs = imageRuns(IMAGE_TESTS);
	const state = readState(root);
	const result: Result = { written: [], skipped: [], failed: [], leftOut: [] };
	const work: { shot: Shot; plan: Plan; size: readonly [number, number]; digest: string }[] = [];
	for (const shot of shots) {
		if (options.only !== undefined && !shot.id.includes(options.only)) continue;
		const resolved = resolveShot(shot, runs);
		if (!resolved.ok) {
			result.leftOut.push({ id: shot.id, reason: resolved.reason });
			continue;
		}
		const size = pictureSize(resolved.plan.size, options.width);
		const digest = shotDigest(shot, resolved.plan, size, root);
		const out = join(root, SHOTS_DIR, `${shot.id}.webp`);
		if (!options.force && state[shot.id] === digest && existsSync(out)) {
			result.skipped.push(shot.id);
			continue;
		}
		work.push({ shot, plan: resolved.plan, size, digest });
	}
	if (work.length === 0) return result;

	const runner = await startRunner();
	try {
		for (const item of work) {
			const path = widerPath(item.plan.path, item.size);
			try {
				const held = await holdPage(runner, {
					path,
					size: item.size,
					timeoutMs: (item.plan.timeoutSeconds + 60) * 1000,
				});
				if (!held.result.ok) throw new Error(held.result.error || 'the engine drew no frame');
				const image = heldImage(held.result);
				const bytes = await webpBytes(image);
				const out = join(root, SHOTS_DIR, `${item.shot.id}.webp`);
				mkdirSync(dirname(out), { recursive: true });
				writeFileSync(out, bytes);
				state[item.shot.id] = item.digest;
				result.written.push(item.shot.id);
				console.log(
					`wrote ${SHOTS_DIR}/${item.shot.id}.webp: ${image.width} x ${image.height} pixels, ${bytes.length} bytes`,
				);
			} catch (error) {
				result.failed.push(item.shot.id);
				console.error(`failed ${item.shot.id}: ${error instanceof Error ? error.message : error}`);
			}
		}
	} finally {
		await runner.close();
	}
	await writeState(root, state);
	return result;
}

async function main(): Promise<void> {
	const options = readOptions(process.argv.slice(2));
	const root = process.cwd();
	// A tool drives the page on the loopback, where plain HTTP needs no certificate of its own.
	process.env.NULL3D_HTTPS ??= '0';
	if (options.list) {
		const shots = JSON.parse(readFileSync(join(root, SHOTS_FILE), 'utf8')) as Shot[];
		const runs = imageRuns(IMAGE_TESTS);
		for (const shot of shots) {
			const resolved = resolveShot(shot, runs);
			const size = resolved.ok ? pictureSize(resolved.plan.size, options.width) : undefined;
			console.log(
				resolved.ok
					? `${shot.id}\t${size?.[0]}x${size?.[1]}\t${resolved.plan.test} on ${resolved.plan.tier}`
					: `${shot.id}\tSKIP\t${resolved.reason}`,
			);
		}
		return;
	}
	const result = await capture(options, root);
	const left = result.leftOut.length + result.skipped.length;
	console.log(
		`\ndrew ${result.written.length} shot(s), skipped ${left} unchanged or left out, failed ${result.failed.length}`,
	);
	for (const item of result.leftOut) console.log(`  left out ${item.id}: ${item.reason}`);
	if (result.failed.length > 0) process.exit(1);
}

if (import.meta.main) await main();
