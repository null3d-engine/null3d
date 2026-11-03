// Reviews one species against its reference folder: draws every view that a reference shows, with
// the camera, the framing and the background matched to that reference, compares each reference
// file with its render, and writes contact sheets, the measures as JSON, a short summary and the
// coverage list that names each reference file in use and the render it was compared with.
//
//   bun run plants:review <species> [--refs <folder or slug>] [--out <folder>] [--run <name>]
//     [--views a,b | all] [--step <degrees>] [--wind-fps 8] [--cell 480] [--only stills,turns,wind]
//     [--seed 11] [--variant 0] [--preset high] [--gpu webgpu] [--no-matte] [--compare <run folder>]
//
// The species is any registered species id, or any other id, which draws as a stand-in. The dev
// server must serve this copy of the repository on the port that NULL3D_PORT names; one is started
// when none answers there. tools/lib/plant-review/README.md describes every part.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { REPO_ROOT } from '../tests/lib/server.ts';
import type { PlantReviewQuery } from '../tests/pages/lib/plant-review/query.ts';
import {
	CUTTING_VIEWS,
	PLANT_VIEWS,
	type PlantView,
	VIEW_SPECS,
	WHOLE_VIEWS,
} from '../tests/pages/lib/plant-review/views.ts';
import { flag, option, positional } from './lib/plant-review/cli.ts';
import {
	compareStills,
	compareTurn,
	compareWind,
	estimateFraming,
	fixed,
	framingQuery,
	rubricBand,
	type StillResult,
	type TurnResult,
	viewSheets,
	type WindResult,
} from './lib/plant-review/compare.ts';
import { coverageMarkdown, coverageOf } from './lib/plant-review/coverage.ts';
import {
	onColour,
	probeVideo,
	type Rgba,
	readImage,
	videoFrame,
} from './lib/plant-review/image.ts';
import {
	measurePlant,
	plantMask,
	type ReferenceSet,
	readReferenceSet,
	type Slot,
	TURN_VIEW,
	type TurnVideo,
} from './lib/plant-review/references.ts';
import {
	drawShots,
	type RunFrame,
	type Shot,
	singleShot,
	turnShots,
} from './lib/plant-review/render.ts';

/** Where the reference folders are when `--refs` names a slug. */
const REFERENCES =
	process.env.NULL3D_PLANT_REFERENCES ??
	join(REPO_ROOT, '.internal/coordination/tree-corpus/generated');
/** Where runs go by default. */
const RENDERS = join(REPO_ROOT, '.internal/coordination/tree-renders');
/** The sketch time a still holds at, and the wind clock's time at a wind clip's first frame. */
const STILL_HOLD = 1;
const WIND_START = 1;
/** The width of a still's render, in pixels. */
const STILL_WIDTH = 768;
/** How many frames of a video the framing is measured from. */
const FRAMING_FRAMES = 8;

/** A run's manifest: what was drawn, from which commit, against which references. */
interface Manifest {
	readonly tool: string;
	readonly species: string;
	readonly run: string;
	readonly commit: string;
	readonly dirty: boolean;
	readonly references?: string;
	readonly seed: number;
	readonly variant: number;
	readonly preset: string;
	readonly step?: number;
	readonly windFps: number;
	readonly started: string;
	readonly seconds: number;
	readonly frames: readonly RunFrame[];
}

/** The checkout's commit, with a mark when the working tree has changes. */
function commitOf(): { commit: string; dirty: boolean } {
	const git = (args: string[]) => execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
	return {
		commit: git(['rev-parse', 'HEAD']).trim(),
		dirty: git(['status', '--porcelain']).trim().length > 0,
	};
}

/** A frame size of a shape at a width. */
function sizeAt(aspect: number, width: number): [number, number] {
	return [width, Math.max(16, Math.round(width / aspect))];
}

/** The metres a bark view frames, from the species' texture manifest when it has one. */
function barkSpan(species: string): number | undefined {
	const path = join(REPO_ROOT, 'packages/vegetation-textures/textures', species, 'manifest.json');
	if (!existsSync(path)) return undefined;
	const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
		bark?: { layers?: { tile?: [number, number] }[] };
	};
	return manifest.bark?.layers?.[0]?.tile?.[1];
}

/** The query of a still's render: its view, and the framing and colours measured from the still. */
function stillShot(
	set: ReferenceSet,
	slot: Slot,
	base: PlantReviewQuery,
	matte: boolean,
	span?: number,
): Shot {
	const image = onColour(readImage(join(set.folder, slot.file)), [255, 255, 255]);
	const aspect = image.width / image.height;
	let query: PlantReviewQuery = {
		...base,
		view: slot.view,
		background: slot.background,
		...(slot.turn !== undefined && { turn: slot.turn }),
		...(slot.elevation !== undefined && { elevation: slot.elevation }),
		...(span !== undefined && slot.view.startsWith('bark') && { span }),
		...slot.query,
	};
	const plant = plantMask(image);
	if (plant.background.plain && slot.view !== 'silhouette') {
		const measures = measurePlant(image, plant);
		// A plain background gives its own colour, which the render stands against.
		query = {
			...query,
			sky: measures.sky,
			...(measures.ground && slot.background === 'sky-meadow' && { ground: measures.ground }),
		};
		if (slot.framed && measures.box) {
			const {
				sky: _sky,
				ground: _ground,
				...framing
			} = framingQuery(estimateFraming([measures], [plant]));
			query = { ...query, ...framing };
		}
	}
	const outline = slot.framed || CUTTING_VIEWS.includes(slot.view);
	return singleShot(
		'stills',
		`${slot.file.replace(/\.\w+$/, '')}.png`,
		query,
		sizeAt(aspect, STILL_WIDTH),
		matte && outline,
		slot.file,
		STILL_HOLD,
	);
}

/** Frames of a video at even times, for measuring its framing. */
function sampleFrames(path: string, count: number): Rgba[] {
	const facts = probeVideo(path);
	return Array.from({ length: count }, (_, k) =>
		videoFrame(path, facts, (k * facts.duration) / count),
	);
}

/** The base query of a whole-plant video's render: its framing and colours, measured from its frames. */
function wholeVideoQuery(path: string, base: PlantReviewQuery): PlantReviewQuery {
	const frames = sampleFrames(path, FRAMING_FRAMES);
	const masks = frames.map((frame) => plantMask(frame));
	const estimate = estimateFraming(
		masks.map((mask, k) => measurePlant(frames[k] as Rgba, mask)),
		masks,
	);
	return { ...base, view: 'whole', background: 'sky-meadow', ...framingQuery(estimate) };
}

/** The shots of a turning video: renders round a full circle at the video's own frame step. */
function turnVideoShots(
	video: TurnVideo,
	base: PlantReviewQuery,
	cellWidth: number,
	matte: boolean,
	step?: number,
): Shot[] {
	const facts = probeVideo(video.path);
	const frames = Math.max(1, Math.round(facts.duration * facts.fps));
	const want = step ?? video.arc / frames;
	const count = Math.max(1, Math.round(360 / want));
	const view: PlantView = TURN_VIEW[video.piece];
	let query: PlantReviewQuery;
	if (video.piece === 'whole') query = { ...wholeVideoQuery(video.path, base), measure: true };
	else {
		const first = videoFrame(video.path, facts, 0);
		query = {
			...base,
			view,
			background: 'studio-grey',
			sky: measurePlant(first, plantMask(first)).sky,
		};
	}
	const group = `turn-${video.file.replace(/\.mp4$/, '')}`;
	return turnShots(
		group,
		query,
		sizeAt(facts.width / facts.height, cellWidth),
		0,
		360 / count,
		count,
		matte,
	);
}

/**
 * The shots of a wind video: the whole plant in wind, framed as the video frames it, at even times.
 * A matte holds no wind, so the clip's outlines come from the frames' own colours.
 */
function windShots(
	path: string,
	file: string,
	base: PlantReviewQuery,
	cellWidth: number,
	fps: number,
): Shot[] {
	const facts = probeVideo(path);
	const query: PlantReviewQuery = { ...wholeVideoQuery(path, base), wind: 1 };
	const count = Math.floor((facts.duration - 1e-6) * fps) + 1;
	const group = `wind-${file.replace(/\.mp4$/, '')}`;
	return Array.from({ length: count }, (_, k) => {
		const time = WIND_START + k / fps;
		return singleShot(
			group,
			`${group}-${String(k).padStart(3, '0')}.png`,
			{ ...query, time },
			sizeAt(facts.width / facts.height, cellWidth),
			false,
			undefined,
			time,
		);
	});
}

/** The views a run draws alone, from `--views`. */
function viewList(): PlantView[] {
	if (!flag('views')) return [];
	const text = option('views');
	if (text === 'all') return [...PLANT_VIEWS];
	const views = text.split(',') as PlantView[];
	for (const view of views)
		if (!PLANT_VIEWS.includes(view))
			throw new Error(
				`--views names ${view}, which is not a view: use all, or some of ${PLANT_VIEWS.join(', ')}`,
			);
	return views;
}

/** The parts of the review that `--only` keeps: stills, turns and wind, all by default. */
function parts(): Set<string> {
	const all = ['stills', 'turns', 'wind'];
	if (!flag('only')) return new Set(all);
	const asked = option('only').split(',');
	for (const part of asked)
		if (!all.includes(part)) throw new Error(`--only names ${part}: use some of ${all.join(', ')}`);
	return new Set(asked);
}

/** The reference folder that `--refs` names, as a folder or as a slug under the corpus. */
function referenceFolder(species: string): string | undefined {
	const text = flag('refs') ? option('refs') : undefined;
	const named = text ?? species;
	const folder =
		isAbsolute(named) || named.includes('/') ? resolve(named) : join(REFERENCES, named);
	if (existsSync(join(folder, 'INDEX.md')) || existsSync(folder)) return folder;
	if (text)
		throw new Error(`--refs ${text} is not a reference folder, and ${folder} does not exist`);
	return undefined;
}

/** The summary's lines for one turn. */
function turnSummary(result: TurnResult, limit: number): string[] {
	const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
	const ref = result.spread.reference;
	const ren = result.spread.render;
	const wide = Math.max(limit, ref.width);
	const tall = Math.max(limit, ref.height);
	const verdict = (render: number, allowed: number) =>
		`${pct(allowed)}${allowed > limit ? " (the reference's own)" : ''}, so ${render <= allowed ? 'inside' : 'outside'}`;
	const iou = result.pairs.flatMap((p) => (p.shapeIou === null ? [] : [p.shapeIou]));
	const meanOf = (values: readonly number[], digits: number) =>
		values.length === 0 ? '-' : (values.reduce((a, b) => a + b, 0) / values.length).toFixed(digits);
	return [
		`### ${result.video}`,
		'',
		...(result.error ? [`- ${result.error}.`, ''] : []),
		`- ${result.frames} frames over ${result.arc}°, one every ${result.frameStep.toFixed(2)}°, against ${result.renders} renders every ${result.renderStep.toFixed(2)}°. ${result.covered} of ${result.frames} frames have a render at their own angle.`,
		`- Alignment: the render at turn ${(result.alignment.start * result.renderStep).toFixed(1)}° matches the video's first frame, turning ${result.alignment.direction === 1 ? 'the same way' : 'the other way'}; mean shape IoU ${result.alignment.meanIou.toFixed(3)} (lowest ${iou.length ? Math.min(...iou).toFixed(3) : '-'}).`,
		`- Width-profile error, mean: ${meanOf(
			result.pairs.flatMap((p) => (p.profileError === null ? [] : [p.profileError])),
			3,
		)} plant heights. Leaf colour difference, mean: ${meanOf(
			result.pairs.flatMap((p) => (p.foliageDeltaE === null ? [] : [p.foliageDeltaE])),
			1,
		)}.`,
		`- Crown box spread at ${result.spread.angles.join(', ')}°: reference ${pct(ref.width)} wide and ${pct(ref.height)} tall; render ${pct(ren.width)} wide and ${pct(ren.height)} tall. The band is ${pct(limit)}: in width ${verdict(ren.width, wide)}; in height ${verdict(ren.height, tall)}.`,
		...(result.spread.metres.some((m) => m)
			? [
					`- The render's crown box in metres at those angles: ${result.spread.metres.map((m) => (m ? `${m.width.toFixed(2)} × ${m.height.toFixed(2)}` : '-')).join('; ')}.`,
				]
			: []),
		...(result.maskCheck !== null
			? [
					`- Mask check: the colour outline of the render frames overlaps their matte by ${result.maskCheck.toFixed(3)} IoU.`,
				]
			: []),
		`- Sheets: ${result.sheets.join(', ')}.`,
		'',
	];
}

/** The summary's lines for one wind clip. */
function windSummary(result: WindResult): string[] {
	return [
		`### ${result.video}`,
		'',
		...(result.error ? [`- ${result.error}.`] : []),
		`- ${result.frames} frames over ${result.span.toFixed(2)} of the video's ${result.duration.toFixed(2)} s, one every ${result.interval.toFixed(3)} s.`,
		`- Motion by height band, base first (the share of the outline that changes frame to frame): reference ${result.motion.reference.map((v) => v.toFixed(3)).join(', ')}; render ${result.motion.render.map((v) => v.toFixed(3)).join(', ')}.`,
		`- Sheets: ${result.sheets.join(', ')}.`,
		'',
	];
}

/** Compares a run with its references and writes every result into the run folder. */
function compareRun(
	dir: string,
	manifest: Manifest,
	set: ReferenceSet | undefined,
	windFps: number,
): boolean {
	const byGroup = new Map<string, RunFrame[]>();
	for (const frame of manifest.frames) {
		const list = byGroup.get(frame.group) ?? [];
		list.push(frame);
		byGroup.set(frame.group, list);
	}
	const label = `${manifest.species.toUpperCase()} VS ${(set?.slug ?? 'NO REFERENCES').toUpperCase()}`;
	const metrics: Record<string, unknown> = {
		run: manifest.run,
		commit: manifest.commit,
		species: manifest.species,
		references: set?.folder ?? null,
	};
	const summary = [
		`# ${manifest.species} against ${set?.slug ?? 'no references'}`,
		'',
		`Run \`${manifest.run}\` at commit \`${manifest.commit.slice(0, 8)}\`${manifest.dirty ? ' with changes' : ''}, seed ${manifest.seed}, variant ${manifest.variant}, preset ${manifest.preset}. Shape IoU compares outlines scaled to the same height and centred on the trunk; frame IoU compares them as framed. Colour differences are CIEDE2000, where about 2 is a visible step.`,
		'',
	];
	const views = byGroup.get('views');
	if (views) {
		const sheets = viewSheets(dir, 'views', views, `${manifest.species.toUpperCase()}  VIEWS`);
		metrics.views = { sheets };
		summary.push('### Views', '', `- Sheets: ${sheets.join(', ')}.`, '');
	}
	if (!set) {
		writeFileSync(join(dir, 'metrics.json'), `${JSON.stringify(metrics, null, '\t')}\n`);
		writeFileSync(join(dir, 'summary.md'), `${summary.join('\n')}\n`);
		return true;
	}
	const stills = new Map<string, StillResult>();
	if (byGroup.has('stills')) {
		const result = compareStills(
			dir,
			set,
			byGroup.get('stills') ?? [],
			`${label}  STILLS AND TEXTURE SOURCES`,
		);
		for (const pair of result.pairs) stills.set(pair.file, pair);
		metrics.stills = result;
		const masked = result.pairs.filter((pair) => pair.masked);
		summary.push(
			'### Stills and texture sources',
			'',
			`- ${result.pairs.length} files beside a render of their view; ${masked.length} give an outline on a plain background in both pictures.`,
			...masked.map(
				(pair) =>
					`- ${pair.file}: shape IoU ${fixed(pair.shapeIou)}, width error ${fixed(pair.profileError, 3)}, gap ${fixed(pair.gap?.reference)} against ${fixed(pair.gap?.render)}, leaf colour difference ${fixed(pair.foliageDeltaE, 1)}.`,
			),
			...result.pairs.flatMap((pair) =>
				pair.surfaceDeltaE !== null
					? [`- ${pair.file}: surface colour difference ${fixed(pair.surfaceDeltaE, 1)}.`]
					: [],
			),
			...result.pairs.flatMap((pair) => (pair.note ? [`- ${pair.file}: ${pair.note}.`] : [])),
			`- Sheets: ${result.sheets.join(', ')}.`,
			'',
		);
	}
	const turns = new Map<string, TurnResult>();
	const limit = rubricBand(manifest.species, set.slug);
	for (const video of set.turns) {
		const group = `turn-${video.file.replace(/\.mp4$/, '')}`;
		const frames = byGroup.get(group);
		if (!frames) continue;
		console.log(`comparing ${video.file}`);
		const result = compareTurn(dir, group, video, frames, `${label}  ${video.file.toUpperCase()}`);
		turns.set(video.file, result);
		summary.push(...turnSummary(result, limit));
	}
	metrics.turns = Object.fromEntries(turns);
	const winds = new Map<string, WindResult>();
	for (const path of set.winds) {
		const file = path.split('/').pop() as string;
		const group = `wind-${file.replace(/\.mp4$/, '')}`;
		const frames = byGroup.get(group);
		if (!frames) continue;
		console.log(`comparing ${file}`);
		const result = compareWind(
			dir,
			group,
			path,
			frames,
			WIND_START,
			`${label}  ${file.toUpperCase()}`,
		);
		winds.set(file, result);
		summary.push(...windSummary(result));
	}
	metrics.winds = Object.fromEntries(winds);
	const coverage = coverageOf(set, { stills, turns, winds }, 1 / windFps);
	metrics.coverage = coverage;
	summary.push(
		'### Coverage',
		'',
		coverage.complete
			? `- Every one of the ${coverage.inUse} reference files in use was compared. coverage.md lists each with its render.`
			: `- ${coverage.compared} of ${coverage.inUse} reference files in use were compared in full, so the species cannot pass. coverage.md lists each file and what it lacks.`,
		'',
		'### Limits of the measures',
		'',
		"- The reference outline comes from colour against a plain background. Below the horizon it keeps only the plant that hangs down from above and is not a darker copy of the meadow, so foliage that sweeps the ground can be lost and a trunk's foot can be cut short.",
		"- The render outline comes from the run's matte where the run drew one, so it is exact.",
		'- A turning video is taken to turn at a steady rate over its arc; the alignment cannot repair a video that speeds up or stops short.',
		"- A turn's renders are drawn as sheets of cells, which draw without the sun's shadows.",
		'',
	);
	writeFileSync(join(dir, 'metrics.json'), `${JSON.stringify(metrics, null, '\t')}\n`);
	writeFileSync(join(dir, 'coverage.json'), `${JSON.stringify(coverage, null, '\t')}\n`);
	writeFileSync(join(dir, 'coverage.md'), coverageMarkdown(manifest.species, set.slug, coverage));
	writeFileSync(join(dir, 'summary.md'), `${summary.join('\n')}\n`);
	return coverage.complete;
}

async function main(): Promise<void> {
	const windFps = Number(option('wind-fps', '8'));
	if (flag('compare')) {
		const dir = resolve(option('compare'));
		const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
		const set = manifest.references ? readReferenceSet(manifest.references) : undefined;
		const complete = compareRun(dir, manifest, set, manifest.windFps ?? windFps);
		console.log(readFileSync(join(dir, 'summary.md'), 'utf8'));
		if (!complete) process.exitCode = 1;
		return;
	}
	const species = positional(0) ?? option('species');
	const folder = referenceFolder(species);
	const set = folder ? readReferenceSet(folder) : undefined;
	const { commit, dirty } = commitOf();
	const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
	const run = option('run', `${species}-${stamp}`);
	const dir = resolve(option('out', RENDERS), run);
	mkdirSync(dir, { recursive: true });
	const base: PlantReviewQuery = {
		species,
		seed: Number(option('seed', '11')),
		variant: Number(option('variant', '0')),
		preset: option('preset', 'high') as PlantReviewQuery['preset'],
	};
	const matte = !flag('no-matte');
	const cell = Number(option('cell', '480'));
	const step = flag('step') ? Number(option('step')) : undefined;
	const wanted = parts();
	const shots: Shot[] = [];
	for (const view of viewList()) {
		const [w, h] = VIEW_SPECS[view].size;
		shots.push(
			singleShot(
				'views',
				`${view}.png`,
				{ ...base, view, measure: true },
				[w, h],
				matte && WHOLE_VIEWS.includes(view) && view !== 'silhouette',
			),
		);
	}
	if (set) {
		const span = barkSpan(species);
		if (wanted.has('stills'))
			for (const slot of set.stills) shots.push(stillShot(set, slot, base, matte, span));
		if (wanted.has('turns'))
			for (const video of set.turns) shots.push(...turnVideoShots(video, base, cell, matte, step));
		if (wanted.has('wind'))
			for (const path of set.winds)
				shots.push(...windShots(path, path.split('/').pop() as string, base, cell, windFps));
	}
	if (shots.length === 0)
		throw new Error('nothing to draw: name a species with a reference folder, or --views');
	const cells = shots.reduce((sum, shot) => sum + shot.cells.length, 0);
	console.log(
		`${species}${set ? ` against ${set.slug}` : ''}: ${cells} frames in ${shots.length} pages into ${dir}`,
	);
	const started = Date.now();
	const frames = await drawShots(dir, shots, { ...(flag('gpu') && { gpu: option('gpu') }) });
	const manifest: Manifest = {
		tool: 'tools/plant-review.ts',
		species,
		run,
		commit,
		dirty,
		...(set && { references: set.folder }),
		seed: base.seed ?? 11,
		variant: base.variant ?? 0,
		preset: base.preset ?? 'high',
		...(step !== undefined && { step }),
		windFps,
		started: new Date(started).toISOString(),
		seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
		frames,
	};
	writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
	const failed = frames.filter((frame) => frame.error).length;
	console.log(
		`${frames.length - failed} of ${frames.length} frames drawn in ${manifest.seconds} s`,
	);
	const complete = compareRun(dir, manifest, set, windFps);
	console.log(readFileSync(join(dir, 'summary.md'), 'utf8'));
	if (failed > 0 || !complete) process.exitCode = 1;
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`error: ${(error as Error).message}`);
		process.exit(1);
	});
}
