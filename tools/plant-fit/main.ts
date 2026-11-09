// Measures species from their reference sets: the envelope from the whole plant's turning video,
// the reference's own crown-box spread round the rubric's angles, and a check of the leaf contour
// against slot 24. Each species' figures go to `packages/vegetation/src/species/<id>/fit.ts`.
//
//   bun run plants:fit <species...> [--refs <folder or slug>] [--video <file>] [--sheet <dir>]
//     [--report <file>] [--no-write]
//
// A species' folder is `<id>` under the corpus that NULL3D_PLANT_REFERENCES names, or the
// repository's `.internal/coordination/tree-corpus/generated`; `--refs` names another for a single
// species. The in-use files are those INDEX.md does not mark superseded. `--video` measures a named
// video of the folder in place of the in-use turn, `--sheet` writes a contact sheet per species,
// `--report` writes every figure as JSON and `--no-write` leaves the species' figures as they are.
import { existsSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { REPO_ROOT } from '../../tests/lib/server.ts';
import { flag, option, positionals } from '../lib/plant-review/cli.ts';
import { rubricBand } from '../lib/plant-review/compare.ts';
import { probeVideo, readImage, videoFrames } from '../lib/plant-review/image.ts';
import {
	classifyTurn,
	readReferenceSet,
	type TurnVideo,
	WORK_WIDTH,
} from '../lib/plant-review/references.ts';
import { roundBandOf, writeFit } from './fit-file.ts';
import { checkLeaf, type LeafCheck } from './leaf.ts';
import { writeTurnSheet } from './sheet.ts';
import { fitTurn, type TurnFit } from './turn.ts';

const REFERENCES =
	process.env.NULL3D_PLANT_REFERENCES ??
	join(REPO_ROOT, '.internal/coordination/tree-corpus/generated');

const species = positionals(new Set(['--no-write']));
if (species.length === 0) {
	console.error(
		'Name one or more species: bun run plants:fit <species...> [--refs <folder or slug>] [--video <file>] [--sheet <dir>] [--report <file>] [--no-write]',
	);
	process.exit(2);
}
const refs = flag('refs') ? option('refs') : undefined;
if (refs && species.length > 1) throw new Error('--refs names the folder of a single species');
const named = flag('video') ? option('video') : undefined;
const sheets = flag('sheet') ? resolve(option('sheet')) : undefined;
const report = flag('report') ? resolve(option('report')) : undefined;
const write = !flag('no-write');

/** The reference folder of a species. */
function folderOf(id: string): string {
	const name = refs ?? id;
	const folder = isAbsolute(name) || name.includes('/') ? resolve(name) : join(REFERENCES, name);
	if (!existsSync(folder)) throw new Error(`${folder} does not exist: name the folder with --refs`);
	return folder;
}

/** The turning video of the whole plant to measure, and a note when the choice was not plain. */
function videoOf(
	folder: string,
	turns: readonly TurnVideo[],
): { video?: TurnVideo; note?: string } {
	if (named) {
		const kind = classifyTurn(named);
		if (!kind) throw new Error(`--video ${named} is not a turning video`);
		return { video: { ...kind, path: join(folder, named) } };
	}
	const whole = turns.filter((t) => t.piece === 'whole');
	if (whole.length === 0)
		return { note: 'the folder has no turning video of the whole plant in use' };
	const video = whole[whole.length - 1] as TurnVideo;
	return whole.length > 1
		? {
				video,
				note: `${whole.length} turning videos of the whole plant are in use; measured ${video.file}`,
			}
		: { video };
}

/** A fit without its views' masks, for the report. */
function withoutOutlines({ outlines, ...rest }: TurnFit): Omit<TurnFit, 'outlines'> {
	return rest;
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const results: Record<
	string,
	{ readonly fit?: Omit<TurnFit, 'outlines'>; readonly leaf: LeafCheck; readonly note?: string }
> = {};
let failed = false;
for (const id of species) {
	const folder = folderOf(id);
	const set = readReferenceSet(folder);
	console.log(`${id}:`);
	const { video, note } = videoOf(folder, set.turns);
	if (note) console.log(`  ${note}`);
	const leaf = checkLeaf(id, folder, set.stills);
	let fit: TurnFit | undefined;
	if (video) {
		const frames = videoFrames(video.path, probeVideo(video.path), WORK_WIDTH);
		// The whole-plant stills bound the crown's broad sides: a mean over the turn alone hides
		// the difference they exist to record.
		const stills = set.stills
			.filter(
				(still) =>
					still.framed &&
					still.number <= 18 &&
					(still.view === 'whole' || still.view === 'silhouette'),
			)
			.map((still) => ({
				file: still.file,
				image: readImage(join(folder, still.file)),
				turn: still.turn ?? 0,
			}));
		fit = fitTurn(video, frames, stills);
		const hull = fit.hull;
		console.log(
			`  ${video.file}: ${fit.views.length} views over ${video.arc} degrees` +
				(fit.closing === null ? '' : `; the last frame overlaps the first by ${fit.closing}`),
		);
		if (hull)
			console.log(
				`  envelope: crown base ${hull.crownBase}, aspect ${hull.aspect}; its outlines overlap the views by ${hull.consistency.lowest} to ${hull.consistency.highest}, mean ${hull.consistency.mean}`,
			);
		const span = Math.max(1, fit.frames - 1);
		if (fit.stills.length > 0)
			console.log(
				`  stills: ${fit.stills
					.map(
						(s) =>
							`${s.file} at ${s.turn} degrees (nearest frame ${((360 * s.frame) / span).toFixed(1)}, overlap ${s.overlap.toFixed(3)})`,
					)
					.join(', ')}`,
			);
		const band = rubricBand(id, set.slug);
		console.log(
			`  crown box at ${fit.crownBox.angles.join(', ')} degrees: spreads ${pct(fit.crownBox.spread.width)} wide and ${pct(fit.crownBox.spread.height)} tall; the all-round band is ${pct(roundBandOf(fit, band))} (the form's ${pct(band)})`,
		);
		if (fit.camera)
			console.log(
				`  camera: ${fit.camera.distance} heights out, ${fit.camera.height} up, looking down ${fit.camera.down} degrees`,
			);
		for (const problem of fit.problems) console.log(`  poor reference: ${problem}`);
		if (sheets) console.log(`  sheet: ${writeTurnSheet(fit, frames, sheets, id)}`);
		if (write) console.log(`  wrote ${writeFit(id, fit, band)}`);
	} else failed = true;
	console.log(
		`  leaf (${leaf.file ?? 'none'}): contour of ${leaf.contour.points} points overlaps the leaf by ${leaf.contour.iou}` +
			(leaf.manifest
				? `; the shipped contour (from ${leaf.manifest.from}) by ${leaf.manifest.iou}`
				: ''),
	);
	for (const problem of leaf.problems) console.log(`  leaf problem: ${problem}`);
	results[id] = { ...(fit ? { fit: withoutOutlines(fit) } : {}), leaf, ...(note ? { note } : {}) };
}
if (report) {
	writeFileSync(report, `${JSON.stringify(results, null, '\t')}\n`);
	console.log(`Report: ${report}`);
}
process.exit(failed ? 1 : 0);
