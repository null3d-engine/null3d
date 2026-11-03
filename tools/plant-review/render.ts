// Renders a review species' views through the plant review page, headless on this computer's GPU,
// into a run folder with a manifest.json: the commit, the species, every frame's query, the hash of
// every picture and how long each took. One browser draws every frame, one page at a time, and a
// frame that fails is recorded with its error while the run carries on.
//
// Modes, which combine in one run:
//   --turntable N   N frames evenly round the plant. With --refs, the frames are framed as the
//                   reference's turning video frames its plant (compare.ts estimates the framing).
//   --views a,b,c   one frame of each view, at --turn degrees.
//   --slots         one frame for each reference still, its camera chosen to match the still's view
//                   and, for a whole-plant still, the still's own framing. Needs --refs.
//   --close         the branch, sub-branch and leaf-cluster turns, of --turntable N frames or 8.
// Every frame of a turn, and every frame of a whole-plant view, is drawn twice: once as the picture
// and once as a matte, the plant black on white from the same camera, which gives compare.ts the
// plant's exact outline.
//
//   bun tools/plant-review/render.ts --species review-oak --refs <reference folder> --out <dir>
//     [--turntable 16] [--views whole,crown] [--slots] [--close] [--size 960x540] [--turn 0]
//     [--seed 11] [--variant 0] [--run <name>] [--no-matte]
// The dev server must serve this copy of the repository on NULL3D_PORT (5173 when unset); the tool
// starts one when none answers there, and stops it at the end.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defaultEnvironment, launchBrowser } from '../../packages/cli/src/browser.js';
import { writePng } from '../../packages/cli/src/png.js';
import { REPO_ROOT, startServer } from '../../tests/lib/server.ts';
import {
	PLANT_VIEWS,
	type PlantReviewQuery,
	type PlantView,
	plantReviewQuery,
	WHOLE_VIEWS,
} from '../../tests/pages/lib/plant-review.ts';
import { flag, option } from './cli.ts';
import { estimateFraming, framingQuery, type RunFrame } from './compare.ts';
import { probeVideo, type Rgba, readImage } from './image.ts';
import { measurePlant, plantMask, readReferenceSet, type Slot, turnFrames } from './references.ts';

/** The page that draws one held frame of a sketch. */
const IMAGE_PAGE = '/tests/pages/image.html';
/** The review page's sketch, from the server's root. */
const SKETCH = '/tests/pages/sketches/plant-review-sketch.ts';
/** The sketch time each frame holds at. A still has no wind, so any time draws the same frame. */
const HOLD = 1;
/** How long one frame may take, in milliseconds: the first page builds its shaders. */
const FRAME_TIMEOUT = 360_000;
/** The width of a frame when the run names no size. */
const DEFAULT_WIDTH = 960;

/** One frame to draw: where it goes, what the page is asked, and the reference it pairs with. */
interface Plan {
	readonly group: string;
	readonly name: string;
	readonly query: PlantReviewQuery;
	readonly size: readonly [number, number];
	readonly matte: boolean;
	readonly reference?: string;
}

/** A frame size of a shape, at a width. */
function sizeFor(aspect: number, width: number): [number, number] {
	return [width, Math.max(16, Math.round(width / aspect))];
}

/** The size the command line names, as width and height. */
function namedSize(): [number, number] | undefined {
	const text = process.argv.includes('--size') ? option('size') : undefined;
	if (!text) return undefined;
	const [width = 0, height = 0] = text.split('x').map(Number);
	if (!(width > 0 && height > 0))
		throw new Error(`--size ${text} is not a size: use one such as 960x540`);
	return [width, height];
}

/** The frames of a full turn of a view, at even angles. */
function turnPlans(
	group: string,
	count: number,
	base: PlantReviewQuery,
	size: readonly [number, number],
	matte: boolean,
): Plan[] {
	return Array.from({ length: count }, (_, k) => {
		const turn = (360 * k) / count;
		return {
			group,
			name: `${group}-${String(k).padStart(2, '0')}-${turn.toFixed(0).padStart(3, '0')}`,
			query: { ...base, turn },
			size,
			matte,
		};
	});
}

/** The page query that frames a still's view, measured from the still where it shows the whole plant. */
function slotQuery(slot: Slot, image: Rgba, base: PlantReviewQuery): PlantReviewQuery {
	const query: PlantReviewQuery = {
		...base,
		view: slot.view,
		background: slot.background,
		aspect: image.width / image.height,
		...(slot.turn !== undefined ? { turn: slot.turn } : {}),
		...(slot.elevation !== undefined ? { elevation: slot.elevation } : {}),
		...(slot.along !== undefined ? { along: slot.along } : {}),
	};
	const plant = plantMask(image);
	if (!plant.background.plain) return query;
	const measures = measurePlant(image, plant);
	// A plain background gives its own colour, which the render stands against.
	const colours = {
		sky: measures.sky,
		...(measures.ground && slot.background === 'sky-meadow' ? { ground: measures.ground } : {}),
	};
	if (!slot.framed || !measures.box)
		return slot.view === 'silhouette' ? query : { ...query, ...colours };
	const framing = framingQuery(estimateFraming([measures], [plant]));
	return { ...query, ...framing, ...(slot.view === 'silhouette' ? {} : colours) };
}

/** Everything the run draws, from the command line. */
function plans(
	species: string,
	refsFolder: string | undefined,
): { plans: Plan[]; framing?: unknown } {
	const base: PlantReviewQuery = {
		species,
		seed: Number(option('seed', '11')),
		variant: Number(option('variant', '0')),
	};
	const size = namedSize();
	const matte = !flag('no-matte');
	const set = refsFolder ? readReferenceSet(refsFolder) : undefined;
	const out: Plan[] = [];
	let framing: unknown;
	if (flag('turntable')) {
		const count = Number(option('turntable'));
		let query: PlantReviewQuery = { ...base, view: 'whole', background: 'sky-meadow' };
		let shape = 0.75;
		if (set?.turntable) {
			// The reference's own frames say where its camera stood; the render stands there too.
			const frames = turnFrames(set.turntable, 8);
			const masks = frames.map((frame) => plantMask(frame.image));
			const estimate = estimateFraming(
				masks.map((mask, i) => measurePlant((frames[i] as { image: Rgba }).image, mask)),
				masks,
			);
			framing = estimate;
			query = { ...query, ...framingQuery(estimate) };
			shape = estimate.aspect;
		}
		query = { ...query, aspect: size ? size[0] / size[1] : shape };
		out.push(...turnPlans('turntable', count, query, size ?? sizeFor(shape, DEFAULT_WIDTH), matte));
	}
	if (flag('views')) {
		const views = option('views').split(',') as PlantView[];
		for (const view of views)
			if (!PLANT_VIEWS.includes(view))
				throw new Error(
					`--views names ${view}, which is not a view: use ${PLANT_VIEWS.join(', ')}`,
				);
		const [width, height] = size ?? [768, 1024];
		for (const view of views)
			out.push({
				group: 'views',
				name: `view-${view}`,
				query: { ...base, view, turn: Number(option('turn', '0')), aspect: width / height },
				size: [width, height],
				matte: matte && WHOLE_VIEWS.includes(view) && view !== 'silhouette',
			});
	}
	if (flag('slots')) {
		if (!set || !refsFolder) throw new Error('--slots needs --refs <reference folder>');
		for (const slot of set.stills) {
			const image = readImage(join(refsFolder, slot.file));
			const query = slotQuery(slot, image, base);
			const width = size?.[0] ?? 768;
			out.push({
				group: 'slots',
				name: `slot-${slot.file.replace(/\.\w+$/, '')}`,
				query,
				size: sizeFor(query.aspect ?? 1, width),
				matte: matte && slot.framed,
				reference: slot.file,
			});
		}
	}
	if (flag('close')) {
		const count = flag('turntable') ? Number(option('turntable')) : 8;
		for (const piece of ['branch', 'subbranch', 'cluster'] as const) {
			const video = set?.close[piece];
			const facts = video ? probeVideo(video) : undefined;
			const shape = facts ? facts.width / facts.height : 16 / 9;
			let query: PlantReviewQuery = { ...base, view: piece, background: 'studio-grey' };
			if (video) {
				const first = turnFrames(video, 1)[0]?.image as Rgba;
				query = { ...query, sky: measurePlant(first, plantMask(first)).sky };
			}
			query = { ...query, aspect: size ? size[0] / size[1] : shape };
			out.push(
				...turnPlans(`close-${piece}`, count, query, size ?? sizeFor(shape, DEFAULT_WIDTH), matte),
			);
		}
	}
	if (out.length === 0)
		throw new Error('name what to draw: --turntable N, --views a,b,c, --slots or --close');
	return { plans: out, ...(framing ? { framing } : {}) };
}

/** What the page published for one frame. */
interface PageResult {
	ok?: boolean;
	error?: string;
	width?: number;
	height?: number;
	pixels?: string;
	sketch?: Record<string, unknown>;
}

/** The page type of the browser that the frames are drawn in. */
type Browser = Awaited<ReturnType<typeof launchBrowser>>;

/** Draws one frame on a page of its own, and returns its pixels and what the sketch posted. */
async function draw(
	browser: Browser,
	base: string,
	query: PlantReviewQuery,
	size: readonly [number, number],
): Promise<{ image: Rgba; facts: unknown }> {
	const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
	try {
		const params = new URLSearchParams({
			sketch: `${SKETCH}?${plantReviewQuery(query)}`,
			hold: String(HOLD),
			size: `${size[0]}x${size[1]}`,
			preset: 'high',
		});
		await page.goto(`${base}${IMAGE_PAGE}?${params}`, { waitUntil: 'domcontentloaded' });
		await page.waitForFunction(
			() => (globalThis as { __null3dResult?: unknown }).__null3dResult !== undefined,
			undefined,
			{ timeout: FRAME_TIMEOUT },
		);
		const result = (await page.evaluate(
			() => (globalThis as { __null3dResult?: unknown }).__null3dResult,
		)) as PageResult;
		if (result.ok !== true) throw new Error(result.error ?? 'the page published no result');
		return {
			image: {
				width: result.width as number,
				height: result.height as number,
				data: new Uint8Array(Buffer.from(result.pixels as string, 'base64')),
			},
			facts: result.sketch?.['plant-review'],
		};
	} finally {
		await page.close();
	}
}

/** The SHA-256 of a file's bytes. */
function hashOf(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The checkout's commit, with a mark when the working tree has changes. */
function commitOf(): { commit: string; dirty: boolean } {
	const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
	}).trim();
	const status = execFileSync('git', ['status', '--porcelain'], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
	});
	return { commit, dirty: status.trim().length > 0 };
}

async function main(): Promise<void> {
	const species = option('species');
	const refs = process.argv.includes('--refs') ? option('refs') : undefined;
	const { commit, dirty } = commitOf();
	const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
	const run = option('run', `${commit.slice(0, 8)}${dirty ? '-dirty' : ''}-${stamp}`);
	const outRoot = option('out', join(REPO_ROOT, '.internal/coordination/plant-renders'));
	const dir = join(outRoot, species, run);
	mkdirSync(dir, { recursive: true });
	const { plans: todo, framing } = plans(species, refs);
	console.log(`${species}: ${todo.length} frames into ${dir}`);
	const server = await startServer();
	const browser = await launchBrowser(defaultEnvironment());
	const frames: (RunFrame & { sha256?: string; matteSha256?: string; ms: number })[] = [];
	const started = Date.now();
	try {
		for (const [i, plan] of todo.entries()) {
			const begun = Date.now();
			const file = join(plan.group, `${plan.name}.png`);
			const record: RunFrame & { sha256?: string; matteSha256?: string; ms: number } = {
				group: plan.group,
				name: plan.name,
				file,
				query: plan.query,
				...(plan.reference ? { reference: plan.reference } : {}),
				ms: 0,
			};
			try {
				const { image, facts } = await draw(browser, server.url, plan.query, plan.size);
				writePng(join(dir, file), image);
				Object.assign(record, { facts, sha256: hashOf(join(dir, file)) });
				if (plan.matte) {
					const matteFile = join(plan.group, `${plan.name}-matte.png`);
					const matte = await draw(browser, server.url, { ...plan.query, matte: true }, plan.size);
					writePng(join(dir, matteFile), matte.image);
					Object.assign(record, { matte: matteFile, matteSha256: hashOf(join(dir, matteFile)) });
				}
			} catch (error) {
				Object.assign(record, { error: (error as Error).message.split('\n')[0] });
			}
			record.ms = Date.now() - begun;
			frames.push(record);
			const note = record.error ? `failed: ${record.error}` : `${(record.ms / 1000).toFixed(1)} s`;
			console.log(`  ${String(i + 1).padStart(3)}/${todo.length} ${plan.name}: ${note}`);
		}
	} finally {
		await browser.close();
		server.stop();
	}
	const times = frames
		.filter((f) => !f.error)
		.map((f) => f.ms)
		.sort((a, b) => a - b);
	const manifest = {
		tool: 'tools/plant-review/render.ts',
		run,
		species,
		commit,
		dirty,
		seed: Number(option('seed', '11')),
		variant: Number(option('variant', '0')),
		...(refs ? { references: refs } : {}),
		server: server.url,
		started: new Date(started).toISOString(),
		...(framing ? { framing } : {}),
		timings: {
			totalSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
			medianFrameMs: times[times.length >> 1] ?? 0,
		},
		frames,
	};
	writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	const failed = frames.filter((f) => f.error);
	console.log(
		`${frames.length - failed.length} of ${frames.length} frames drawn; manifest at ${relative(process.cwd(), join(dir, 'manifest.json'))}`,
	);
	if (failed.length > 0) process.exit(1);
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`error: ${(error as Error).message}`);
		process.exit(1);
	});
}
