// Reviews one species against its reference folder: draws every view that a reference shows, with
// the camera, the framing and the background matched to that reference, compares each reference
// file with its render, and writes contact sheets, the measures as JSON, a short summary and the
// coverage list that names each reference file in use and the render it was compared with.
//
//   bun run plants:review <species> [--refs <folder or slug>] [--out <folder>] [--run <name>]
//     [--views a,b | all] [--step <degrees>] [--wind-fps 8] [--cell <pixels>] [--only stills,turns,wind]
//     [--stills 01,02,18] [--seed 11] [--variant 0] [--preset high] [--lod 0|1|2] [--gpu webgpu]
//     [--no-matte] [--compare <run folder>]
//
// The species is any registered species id, or any other id, which draws as a stand-in. The dev
// server must serve this copy of the repository on the port that NULL3D_PORT names; one is started
// when none answers there. tools/lib/plant-review/README.md describes every part.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { isSpeciesId, loadSpecies } from '../packages/vegetation/src/core/registry.ts';
import { REPO_ROOT } from '../tests/lib/server.ts';
import type { PlantReviewQuery } from '../tests/pages/lib/plant-review/query.ts';
import {
	CUTTING_VIEWS,
	PLANT_VIEWS,
	type PlantBackground,
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
	fittedMaskClause,
	fixed,
	framingQuery,
	rubricBand,
	SHEATH_VIEWS,
	type SheathTarget,
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
	skyMaskable,
	soilMaskable,
	TURN_VIEW,
	type TurnVideo,
	withSlot,
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
/**
 * The most degrees one sheet of a turn spans. A turning reference keeps its light where its camera
 * is, while a sheet has one sun for all its cells, set by its middle turn; within this span every
 * cell's camera stands within half of it of where the reference's light was measured from.
 */
const LIT_SHEET_SPAN = 30;

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

/** The names of a registered species' other forms, which the stills that name one are drawn in. */
async function formsOf(species: string): Promise<readonly string[]> {
	if (!isSpeciesId(species)) return [];
	return Object.keys((await loadSpecies(species)).record.forms ?? {});
}

/**
 * The sheath colours a tuft's record asks its surface to show, when the record names them. The
 * field is read structurally: a species that grows on another model, or names no sheath colour,
 * gives no figure.
 */
async function sheathOf(species: string): Promise<SheathTarget | undefined> {
	if (!isSpeciesId(species)) return undefined;
	const growth = (await loadSpecies(species)).record.growth;
	if (growth.model !== 'tuft') return undefined;
	const named = (
		growth as {
			sheathColour?: {
				readonly foot: readonly [number, number, number];
				readonly collar: readonly [number, number, number];
				readonly reach: number;
			};
		}
	).sheathColour;
	return named;
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
	extra?: Readonly<Record<string, unknown>>,
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
	if (
		plant.background.plain ||
		skyMaskable(plant.background) ||
		soilMaskable(plant.background, plant.height)
	) {
		const measures = measurePlant(image, plant);
		// A plain background gives its own colour, which the render stands against. A silhouette
		// draws black on white whatever its picture's colours and light, so it takes the framing alone.
		if (slot.view !== 'silhouette') {
			query = {
				...query,
				sky: measures.sky,
				...(measures.ground && slot.background === 'sky-meadow' && { ground: measures.ground }),
			};
			// The picture's own light, so a close view is lit as its reference is: a flat light reads a
			// grey-brown branch as pale, where the reference's studio light gives it its modelling.
			if (measures.light)
				query = {
					...query,
					sunAzimuth: measures.light.azimuth,
					sunRise: measures.light.rise,
				};
		}
		if (slot.framed && measures.box) {
			const {
				sky: _sky,
				ground: _ground,
				...framing
			} = framingQuery(estimateFraming([measures], [plant]));
			query = { ...query, ...framing };
		}
	}
	// A still's own query fields, such as a camera its picture needs, go over the rest, and a field
	// given as null is dropped, so a still can trade the framing's fill for a top row and an eye.
	query = withSlot(query, extra);
	// A still whose own picture separates the plant from a plain background can be compared by
	// outline, whatever part of the plant it frames: the render draws the same mask. A texture source
	// is a flat swatch rather than a picture of the plant, so it is not given one. A fruit view keeps
	// its outline whether or not the photograph separates, because a part that hangs from nothing
	// shows only as a piece, and a piece needs the matte.
	const outline =
		(slot.kind !== 'texture' &&
			(plant.background.plain ||
				skyMaskable(plant.background) ||
				soilMaskable(plant.background, plant.height)) &&
			slot.view !== 'silhouette') ||
		slot.framed ||
		slot.query?.fruit === true ||
		CUTTING_VIEWS.includes(slot.view) ||
		// A sheath picture reads its own surface off the plant alone, so its outline must be exact
		// even where the photograph does not separate from its soil.
		SHEATH_VIEWS.has(slot.view);
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

/**
 * The query of a video's render: its view and background, with the framing, the colours and the
 * light measured from its frames. The light is read against each frame's camera and its median
 * kept, as the reference videos keep their light where their camera is.
 */
function videoQuery(
	path: string,
	base: PlantReviewQuery,
	view: PlantView,
	background: PlantBackground,
): PlantReviewQuery {
	const frames = sampleFrames(path, FRAMING_FRAMES);
	const masks = frames.map((frame) => plantMask(frame));
	const estimate = estimateFraming(
		masks.map((mask, k) => measurePlant(frames[k] as Rgba, mask)),
		masks,
	);
	return { ...base, view, background, ...framingQuery(estimate) };
}

/**
 * The shots of a turning video: renders round a full circle at the video's own frame step, framed
 * and lit as its frames are. The reference videos keep their light where their camera is as the
 * piece turns, so a sheet stands its one sun as the light stood to its middle turn, and spans few
 * enough turns that every cell stays near that.
 */
function turnVideoShots(
	video: TurnVideo,
	base: PlantReviewQuery,
	cellWidth: number | undefined,
	matte: boolean,
	step?: number,
	extra?: Readonly<Record<string, unknown>>,
): Shot[] {
	const facts = probeVideo(video.path);
	const frames = Math.max(1, Math.round(facts.duration * facts.fps));
	const want = step ?? video.arc / frames;
	const count = Math.max(1, Math.round(360 / want));
	const view: PlantView = TURN_VIEW[video.piece];
	const query: PlantReviewQuery = withSlot(
		video.piece === 'whole'
			? { ...videoQuery(video.path, base, view, 'sky-meadow'), measure: true }
			: videoQuery(video.path, base, view, 'studio-grey'),
		extra,
	);
	const group = `turn-${video.file.replace(/\.mp4$/, '')}`;
	const turn = 360 / count;
	const lit = query.sunAzimuth !== undefined;
	return turnShots(
		group,
		query,
		sizeAt(facts.width / facts.height, cellWidth ?? STILL_WIDTH),
		0,
		turn,
		count,
		matte,
		1,
		lit ? Math.floor(LIT_SHEET_SPAN / turn) + 1 : undefined,
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
	cellWidth: number | undefined,
	fps: number,
	extra?: Readonly<Record<string, unknown>>,
): Shot[] {
	const facts = probeVideo(path);
	const query: PlantReviewQuery = withSlot(
		{ ...videoQuery(path, base, 'whole', 'sky-meadow'), wind: 1 },
		extra,
	);
	const count = Math.floor((facts.duration - 1e-6) * fps) + 1;
	const group = `wind-${file.replace(/\.mp4$/, '')}`;
	return Array.from({ length: count }, (_, k) => {
		const time = WIND_START + k / fps;
		return singleShot(
			group,
			`${group}-${String(k).padStart(3, '0')}.png`,
			{ ...query, time },
			sizeAt(facts.width / facts.height, cellWidth ?? STILL_WIDTH),
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

/**
 * The reference stills that `--stills` keeps: two-digit numbers or any part of a file's name.
 * Absent, every still in use is drawn. A round that changes one part of a plant needs only the
 * views that part shows, and drawing four of them takes a fraction of the time.
 */
function stillList<T extends { readonly file: string }>(stills: readonly T[]): readonly T[] {
	if (!flag('stills')) return stills;
	const names = option('stills')
		.split(',')
		.map((name) => name.trim().toLowerCase())
		.filter((name) => name.length > 0);
	const kept = stills.filter((still) =>
		names.some((name) => still.file.toLowerCase().includes(name)),
	);
	if (kept.length === 0)
		throw new Error(`--stills names ${option('stills')}, which matches no reference still`);
	return kept;
}

/**
 * The slots a machine draws in: three. Seven shared dev servers on a fourteen-core Mac once pushed
 * the load past thirty, so runs sat on their first page for minutes; one is safe but leaves short
 * tests waiting behind a full turn round. Two held the load under ten while two draws worked. Three
 * measured the load at nine with two draws working and a dozen rounds queued, so the third lane
 * keeps a full round moving without a queue behind it. A run takes a slot before it starts drawing
 * and gives it back when it is done, so no script has to know the rule. `--no-slot` skips the wait
 * for a run that is known to be alone.
 */
const DRAW_SLOTS = 3;
const DRAW_SLOT = '/tmp/null3d-plant-draw.slot-';
/**
 * How long a slot that records no holder counts as taken: long enough for the oldest running
 * review that keeps no record, and far longer than any round's start, since a working run gives its
 * directory back the moment it finishes.
 */
const SLOT_CLAIM_MS = 15 * 60_000;

/** Whether the run that took a slot is still alive, judged by the process it recorded. */
function slotHeld(path: string): boolean {
	let pid: number;
	try {
		pid = Number.parseInt(readFileSync(join(path, 'pid'), 'utf8').trim(), 10);
	} catch {
		// A run writes its record a moment after taking the slot, so a slot without one is taken
		// by a live run at first, and abandoned once that moment has passed.
		try {
			return Date.now() - statSync(path).mtimeMs < SLOT_CLAIM_MS;
		} catch {
			return false;
		}
	}
	if (!Number.isFinite(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// A process this user may not signal still exists; one that does not exist raises ESRCH.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/** Takes the first free draw slot, waiting until one frees, and returns the way to give it back. */
async function takeDrawSlot(): Promise<() => void> {
	if (flag('no-slot')) return () => {};
	for (let attempt = 0; attempt < 720; attempt++) {
		for (let slot = 1; slot <= DRAW_SLOTS; slot++) {
			const path = `${DRAW_SLOT}${slot}`;
			try {
				mkdirSync(path);
			} catch {
				if (slotHeld(path)) continue;
				// A run that was killed leaves its directory behind. Without this the machine would
				// wait on a slot that nothing will ever give back.
				try {
					rmSync(path, { recursive: true, force: true });
					mkdirSync(path);
				} catch {
					continue;
				}
			}
			writeFileSync(join(path, 'pid'), `${process.pid}\n`);
			return () => {
				try {
					rmSync(path, { recursive: true, force: true });
				} catch {
					// Another process reclaimed it; the slot is free either way.
				}
			};
		}
		await new Promise((done) => setTimeout(done, 5000));
	}
	throw new Error('no draw slot freed in an hour: another run is holding the machine');
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
		`- Alignment: the render at turn ${(result.alignment.start * result.renderStep).toFixed(1)}° matches the video's first frame, turning ${result.alignment.direction === 1 ? 'the same way' : 'the other way'}. Shape IoU over the matched frames, mean: ${result.meanShapeIou === null ? '-' : result.meanShapeIou.toFixed(3)} (lowest ${iou.length ? Math.min(...iou).toFixed(3) : '-'}).`,
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
	sheath: SheathTarget | undefined,
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
			sheath,
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
					`- ${pair.file}: shape IoU ${fixed(pair.shapeIou)}, width error ${fixed(pair.profileError, 3)}, gap ${fixed(pair.crownBoxGap?.reference)} against ${fixed(pair.crownBoxGap?.render)} in the crown box, enclosed ${fixed(pair.gap?.reference)} against ${fixed(pair.gap?.render)}, frame ${fixed(pair.frameGap?.reference)} against ${fixed(pair.frameGap?.render)}, leaf colour difference ${fixed(pair.foliageDeltaE, 1)}${barkClause(pair)}${pieceClause(pair)}${fittedMaskClause(pair)}.`,
			),
			...result.pairs.flatMap((pair) =>
				pair.surfaceDeltaE !== null
					? [`- ${pair.file}: surface colour difference ${fixed(pair.surfaceDeltaE, 1)}.`]
					: [],
			),
			...result.pairs.flatMap((pair) =>
				pair.sheath
					? [
							`- ${pair.file}: sheath foot difference ${fixed(pair.sheath.foot, 1)} and collar ${fixed(pair.sheath.collar, 1)} against the record, from ${pair.sheath.footPixels} and ${pair.sheath.collarPixels} pixels.`,
						]
					: [],
			),
			// A picture whose backdrop the tool cannot separate still has edges, and its edges say
			// where its parts run. It gets that figure instead of an outline it cannot trust.
			...edgeLines(result.pairs),
			...framingLines(result.pairs),
			...pieceLines(result.pairs),
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
		"- A turn's renders are drawn as sheets of cells at a still's size, with the sun's shadows; a release build of the page draws the cells without them.",
		'',
	);
	writeFileSync(join(dir, 'metrics.json'), `${JSON.stringify(metrics, null, '\t')}\n`);
	writeFileSync(join(dir, 'coverage.json'), `${JSON.stringify(coverage, null, '\t')}\n`);
	writeFileSync(join(dir, 'coverage.md'), coverageMarkdown(manifest.species, set.slug, coverage));
	writeFileSync(join(dir, 'summary.md'), `${summary.join('\n')}\n`);
	return coverage.complete;
}

/** The edge-direction lines for the stills that give no outline, so a close-up still has a figure. */
function edgeLines(pairs: readonly StillResult[]): string[] {
	const lines: string[] = [];
	for (const pair of pairs)
		if (!pair.masked && pair.edgeDifference !== null)
			lines.push(
				`- ${pair.file}: edge directions ${fixed(pair.edgeDifference, 3)}; 0 is the same mixture of directions in both pictures and 1 is none shared.`,
			);
	return lines;
}

/** What each close view's camera framed, and how much of the plant stood in its way. */
function framingLines(pairs: readonly StillResult[]): string[] {
	return pairs.flatMap((pair) => {
		const framing = pair.framing;
		if (!framing) return [];
		const { front, behind, fill } = framing;
		const clutter =
			front !== null && behind !== null && fill !== null
				? `; the rest of the plant covers ${front.toFixed(2)} of the frame in front of it and ${behind.toFixed(2)} behind it, and the subject fills ${fill.toFixed(2)}`
				: '';
		const warning = framing.warning ? `, as ${framing.warning}` : '';
		return [`- ${pair.file}: the camera framed ${framing.subject}${clutter}${warning}.`];
	});
}

/**
 * The piece count of one still, for the line that carries its other figures: every outlmed view
 * states how many pieces it is drawn as, so a reader never has to infer it from the mismatch lines.
 */
function pieceClause(pair: StillResult): string {
	if (!pair.pieces) return '';
	const { render } = pair.pieces;
	return `, drawn as ${render} piece${render === 1 ? '' : 's'}`;
}

/**
 * A bark close view's two colours, for the line that carries its other figures. The pair states
 * which way the drawn bark is off, which a distance alone cannot, and a bark view that separates
 * from its background measures the same patches as one that does not.
 */
function barkClause(pair: StillResult): string {
	if (!pair.barkColour) return '';
	const show = (lab: readonly number[]) => lab.map((n) => n.toFixed(1)).join(' ');
	const { reference, render } = pair.barkColour;
	return `, bark photographs ${show(reference)} and draws ${show(render)}`;
}

/** Where the render is drawn as more or fewer separate pieces than its reference. */
function pieceLines(pairs: readonly StillResult[]): string[] {
	const lines: string[] = [];
	for (const pair of pairs) {
		if (!pair.pieces) continue;
		const { reference, render } = pair.pieces;
		const hanging =
			'a plant hangs together, so a piece the render has and the reference does not is worth looking at';
		if (reference === null) {
			if (render > 1)
				lines.push(`- ${pair.file}: the render is drawn as ${render} separate pieces; ${hanging}.`);
			continue;
		}
		if (reference === render) continue;
		lines.push(
			`- ${pair.file}: ${reference} piece${reference === 1 ? '' : 's'} in the reference and ${render} in the render; ${hanging}.`,
		);
	}
	return lines;
}

async function main(): Promise<void> {
	const windFps = Number(option('wind-fps', '8'));
	if (flag('compare')) {
		const dir = resolve(option('compare'));
		const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
		const set = manifest.references
			? readReferenceSet(manifest.references, await formsOf(manifest.species))
			: undefined;
		const complete = compareRun(
			dir,
			manifest,
			set,
			manifest.windFps ?? windFps,
			await sheathOf(manifest.species),
		);
		console.log(readFileSync(join(dir, 'summary.md'), 'utf8'));
		if (!complete) process.exitCode = 1;
		return;
	}
	const species = positional(0) ?? option('species');
	const folder = referenceFolder(species);
	const set = folder ? readReferenceSet(folder, await formsOf(species)) : undefined;
	const sheath = await sheathOf(species);
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
		...(flag('lod') && { lod: Number(option('lod')) as PlantReviewQuery['lod'] }),
	};
	const matte = !flag('no-matte');
	// A video's renders are drawn at a still's size unless asked otherwise, and measured as a still
	// is, so a turn's frame and a still from the same camera take the same detail level and give
	// the same figures.
	const cell = flag('cell') ? Number(option('cell')) : undefined;
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
		// A species' own file sits beside the guide, and a round drawn without it loses every
		// override in it: the camera a picture needs and the light it was taken in. Reading the file
		// unasked would move every species that omits the flag, so the miss is named instead.
		const speciesSlots = join(REPO_ROOT, 'tools/lib/plant-review/slots', `${species}.json`);
		if (!flag('slot-query') && existsSync(speciesSlots))
			console.warn(
				`warning: ${species} has a slot file at ${speciesSlots}, and --slot-query did not name it, so this run misses every override in it`,
			);
		// Query fields per reference file, from a JSON object keyed by the file's name.
		const slotQueries = flag('slot-query')
			? (JSON.parse(readFileSync(resolve(option('slot-query')), 'utf8')) as Record<
					string,
					Record<string, unknown>
				>)
			: {};
		if (wanted.has('stills'))
			for (const slot of stillList(set.stills))
				shots.push(stillShot(set, slot, base, matte, span, slotQueries[slot.file]));
		if (wanted.has('turns'))
			for (const video of set.turns)
				shots.push(...turnVideoShots(video, base, cell, matte, step, slotQueries[video.file]));
		if (wanted.has('wind'))
			for (const path of set.winds) {
				const file = path.split('/').pop() as string;
				shots.push(...windShots(path, file, base, cell, windFps, slotQueries[file]));
			}
	}
	if (shots.length === 0)
		throw new Error('nothing to draw: name a species with a reference folder, or --views');
	const cells = shots.reduce((sum, shot) => sum + shot.cells.length, 0);
	console.log(
		`${species}${set ? ` against ${set.slug}` : ''}: ${cells} frames in ${shots.length} pages into ${dir}`,
	);
	const started = Date.now();
	const release = await takeDrawSlot();
	let frames: readonly RunFrame[];
	try {
		frames = await drawShots(dir, shots, { ...(flag('gpu') && { gpu: option('gpu') }) });
	} finally {
		release();
	}
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
	const complete = compareRun(dir, manifest, set, windFps, sheath);
	console.log(readFileSync(join(dir, 'summary.md'), 'utf8'));
	if (failed > 0 || !complete) process.exitCode = 1;
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`error: ${(error as Error).message}`);
		process.exit(1);
	});
}
