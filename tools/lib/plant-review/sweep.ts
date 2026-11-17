// The sweep: every species at its distance ladder and around it, at four turns and two heights,
// each picture beside the reference's own view at its scale. A row is a species and a view: its
// figures and a pass, a fail or an open fault with its reason. A rung with no reference view, a
// picture that did not draw and a picture with no matte all fail, because a view the sweep cannot
// compare fails. The sweep is the evidence of a species review; a round of hand-picked stills is
// not.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writePng } from '../../../packages/cli/src/png.js';
import type { PlantReviewQuery } from '../../../tests/pages/lib/plant-review/query.ts';
import { type PlantView, VIEW_SPECS } from '../../../tests/pages/lib/plant-review/views.ts';
import {
	contactSheets,
	PIECE_AREA,
	rubricBand,
	type SheetRow,
	type SweepMeasures,
	sweepMeasures,
} from './compare.ts';
import { onColour, readImage } from './image.ts';
import {
	anyPlantMask,
	measurePlant,
	pieceCount,
	plantMask,
	type ReferenceSet,
	type Slot,
	skyMaskable,
	soilMaskable,
} from './references.ts';
import { type RunFrame, type Shot, singleShot } from './render.ts';

/** The turns the sweep stands the camera at, from the reference view's own turn. */
export const SWEEP_TURNS = [0, 90, 180, 270] as const;

/** The two heights the sweep stands the camera at: the view's own rise, and a raised one. */
export const SWEEP_HEIGHTS = [
	{ id: 'low', rise: 0 },
	{ id: 'high', rise: 15 },
] as const;

/** How a rung stands its camera: on the plant's own distance ladder, or fitted close. */
export type SweepDistance = 'far' | 'first-card' | 'near' | 'fit';

/** The level a rung expects the page to draw at its camera, where the ladder fixes it. */
export type SweepLevel = 'far' | 'card' | 'near' | 'any';

/** One rung of the sweep: a scale a species is drawn at and judged at. */
export interface SweepRung {
	/** Its short name, which names its pictures' group. */
	readonly id: string;
	/** The scale in words for the table. */
	readonly label: string;
	/** The reference views that show this scale, best first. A rung with none is uncompared. */
	readonly referenceViews: readonly PlantView[];
	readonly distance: SweepDistance;
	readonly level: SweepLevel;
}

/**
 * The six rungs every species is drawn at: the three rungs of its distance ladder and the three
 * close views its verdict requires. The ladder is drawn at the page's own switches, which the
 * probe frame reads, so a rung is the level the engine draws at that distance and not a level the
 * sweep forces.
 */
export const SWEEP_RUNGS: readonly SweepRung[] = [
	{
		id: 'far-card',
		label: 'the far card',
		referenceViews: ['whole'],
		distance: 'far',
		level: 'far',
	},
	{
		id: 'first-card',
		label: 'the first card level',
		referenceViews: ['whole'],
		distance: 'first-card',
		level: 'card',
	},
	{
		id: 'switch',
		label: 'the near form at its switch',
		referenceViews: ['whole'],
		distance: 'near',
		level: 'near',
	},
	{
		id: 'inside',
		label: 'inside the crown',
		referenceViews: ['inside', 'crown-underside', 'crown'],
		distance: 'fit',
		level: 'any',
	},
	{
		id: 'trunk',
		label: 'the trunk',
		referenceViews: ['trunk', 'bark-mid', 'bark-base', 'bark-limb', 'below'],
		distance: 'fit',
		level: 'any',
	},
	{
		id: 'leaf',
		label: "a leaf's scale",
		referenceViews: [
			'leaf-upper',
			'leaf-under',
			'spike',
			'strands',
			'sheath',
			'cluster',
			'subbranch',
		],
		distance: 'fit',
		level: 'any',
	},
];

/** The pictures a rung draws: a turn and a height each. */
export const SWEEP_PICTURES = SWEEP_TURNS.length * SWEEP_HEIGHTS.length;

/**
 * The pictures a draw failed: the shots whose cells the run recorded an error or a matte failure
 * for. A page that navigated under a cell or lost its worker is drawn once more, so a run fault does
 * not read as a species fault in the table.
 */
export function failedSweepShots(
	shots: readonly Shot[],
	frames: readonly RunFrame[],
): readonly Shot[] {
	const failed = new Set(
		frames
			.filter((frame) => frame.error !== undefined || frame.matteError !== undefined)
			.map((frame) => frame.file),
	);
	return shots.filter((shot) => shot.cells.some((cell) => failed.has(cell.file)));
}

/** The reference view a rung is judged beside, the first of its views the folder carries. */
export function sweepReference(set: ReferenceSet, rung: SweepRung): Slot | undefined {
	return set.stills.find(
		(slot) => slot.kind === 'still' && rung.referenceViews.includes(slot.view),
	);
}

/** The three distances of the plant's own ladder, read from a drawn frame. */
export function sweepStarts(frame: RunFrame | undefined): readonly [number, number, number] | null {
	const level = (frame?.cell as { level?: { starts?: readonly unknown[] } } | undefined)?.level;
	const starts = level?.starts;
	if (!Array.isArray(starts)) return null;
	const at = (index: number) => {
		const value = starts[index];
		return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
	};
	const first = at(1);
	const second = at(2);
	const far = at(3);
	if (first === null || second === null || far === null) return null;
	return [first, second, far];
}

/** The distance a rung stands its camera at, from the ladder's three distances. */
export function sweepDistanceOf(
	rung: SweepRung,
	starts: readonly [number, number, number],
): number | null {
	const [first, second, far] = starts;
	switch (rung.distance) {
		case 'far':
			return far * 1.05;
		case 'first-card':
			// The middle of the first card level's band, so the rung draws that level and not its
			// neighbour where the band is narrow.
			return (first + Math.max(first, Math.min(second, far))) / 2;
		case 'near':
			return first * 0.98;
		default:
			return null;
	}
}

/** One rung's drawing plan: its view, its reference and the camera it stands at. */
export interface SweepRungPlan {
	readonly rung: SweepRung;
	readonly slot: Slot | undefined;
	readonly distance: number | null;
}

/** What a sweep run records of its plan, so a replay compares the same rungs. */
export interface SweepManifest {
	readonly starts: readonly [number, number, number];
	readonly rungs: readonly {
		readonly id: string;
		readonly reference?: string;
		readonly distance: number | null;
	}[];
}

/** The probe: one whole view whose frame names the plant's own level distances. */
export function sweepProbe(base: PlantReviewQuery): Shot {
	return singleShot(
		'sweep-probe',
		'probe.png',
		{ ...base, view: 'whole', measure: true },
		VIEW_SPECS.whole.size,
		false,
	);
}

/** One of a rung's cameras: the turn in degrees, the rise and the height's name. */
interface SweepCamera {
	readonly turn: number;
	readonly elevation: number;
	readonly height: string;
}

/** The cameras a rung stands at: every turn and height, from the reference view's own. */
export function sweepCameras(rung: SweepRung, slot: Slot | undefined): readonly SweepCamera[] {
	const view = slot?.view ?? rung.referenceViews[0] ?? 'whole';
	const home = slot?.turn ?? 0;
	const rise = slot?.elevation ?? VIEW_SPECS[view].elevation;
	const cameras: SweepCamera[] = [];
	for (const turn of SWEEP_TURNS)
		for (const height of SWEEP_HEIGHTS)
			cameras.push({
				turn: (home + turn) % 360,
				elevation: Math.max(-89, Math.min(89, rise + height.rise)),
				height: height.id,
			});
	return cameras;
}

/**
 * The sweep's rung plans and pictures: each rung at its reference view, its camera distance and
 * every turn and height. A rung whose folder carries no reference view is planned with no slot, so
 * its row is uncompared rather than absent.
 */
export function sweepShots(
	set: ReferenceSet,
	base: PlantReviewQuery,
	starts: readonly [number, number, number],
): { readonly plan: SweepRungPlan[]; readonly shots: Shot[] } {
	if (base.lod !== undefined)
		throw new Error('a sweep reads the page’s own levels, so it cannot force one with --lod');
	const plan: SweepRungPlan[] = [];
	const shots: Shot[] = [];
	for (const rung of SWEEP_RUNGS) {
		const slot = sweepReference(set, rung);
		const distance = sweepDistanceOf(rung, starts);
		plan.push({ rung, slot, distance });
		if (!slot) continue;
		const view = slot.view;
		const [width, height] = VIEW_SPECS[view].size;
		for (const camera of sweepCameras(rung, slot)) {
			const name = `${rung.id}-t${camera.turn}-h${camera.height}`;
			shots.push(
				singleShot(
					`sweep-${rung.id}`,
					`${name}.png`,
					{
						...base,
						view,
						background: slot.background,
						...slot.query,
						turn: camera.turn,
						elevation: camera.elevation,
						...(rung.distance !== 'fit' && distance !== null && { distance }),
						measure: true,
					},
					[width, height],
					true,
					slot.file,
				),
			);
		}
	}
	return { plan, shots };
}

/** The manifest's record of a plan, for a replay. */
export function sweepManifest(
	plan: readonly SweepRungPlan[],
	starts: readonly [number, number, number],
): SweepManifest {
	return {
		starts,
		rungs: plan.map((entry) => ({
			id: entry.rung.id,
			...(entry.slot && { reference: entry.slot.file }),
			distance: entry.distance,
		})),
	};
}

/**
 * A plan rebuilt from a run's manifest: the rung each record names, its reference view and the
 * camera distance it stood at. A replay compares the same rows without drawing again.
 */
export function planFromManifest(
	set: ReferenceSet,
	sweep: SweepManifest,
): readonly SweepRungPlan[] {
	return sweep.rungs.map((entry) => {
		const rung = SWEEP_RUNGS.find((candidate) => candidate.id === entry.id);
		if (!rung) throw new Error(`the manifest names a rung the sweep does not know: ${entry.id}`);
		const slot = set.stills.find((still) => still.file === entry.reference);
		return { rung, slot, distance: entry.distance };
	});
}

/** One drawn picture of a rung, as the table reads it. */
export interface SweepPicture {
	readonly file: string;
	/** The level the page drew, or null where its frame names none. */
	readonly level: number | null;
	/** The distance from the lens to the plant's foot, in metres, where the frame names it. */
	readonly away: number | null;
	/** Why the picture did not draw. */
	readonly error?: string;
	/** Why the picture has no matte, where its picture drew. */
	readonly matteError?: string;
	/** Its connectivity and crown gap, or null where no matte was read. */
	readonly measures: SweepMeasures | null;
}

/** The reference picture a rung is compared beside. */
export interface SweepReference {
	readonly file: string;
	/** Whether the picture separates from its background, so an outline and a crown gap read. */
	readonly separable: boolean;
	/** The open sky inside its crown box, or null where the picture's outline does not read. */
	readonly gap: number | null;
	/** Its separate pieces, or null where the picture's outline does not read. */
	readonly pieces: number | null;
}

/** A row's inputs, before its verdict is drawn. */
export interface SweepRowInput {
	readonly species: string;
	readonly slug: string;
	readonly rung: SweepRung;
	readonly reference: SweepReference | undefined;
	readonly distance: number | null;
	readonly band: number;
	readonly pictures: readonly SweepPicture[];
}

/** One row of the sweep's table. */
export interface SweepRow {
	readonly species: string;
	readonly rung: string;
	readonly reference: string | null;
	readonly pictures: number;
	readonly levels: string;
	readonly distance: number | null;
	readonly gap: { readonly drawn: number; readonly reference: number } | null;
	readonly pieces: { readonly drawn: number; readonly reference: number } | null;
	readonly floating: number;
	readonly verdict: 'pass' | 'fail' | 'open';
	readonly reason: string;
}

/** The level a picture's frame names. */
function levelOf(picture: SweepPicture): number | null {
	return picture.level;
}

/** Whether a drawn level is the one a rung expects. */
function levelHolds(rung: SweepRung, level: number | null): boolean {
	if (rung.level === 'any' || level === null) return true;
	if (rung.level === 'far') return level === 3;
	if (rung.level === 'near') return level === 0;
	return level === 1 || level === 2;
}

/** The levels drawn by a row's pictures, in level order, as words. */
function levelsDrawn(pictures: readonly SweepPicture[]): string {
	const names = ['leaf form', 'first card level', 'second card level', 'far card'];
	const counts = new Map<number, number>();
	for (const picture of pictures)
		if (picture.level !== null) counts.set(picture.level, (counts.get(picture.level) ?? 0) + 1);
	if (counts.size === 0) return 'none';
	return [...counts.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([level, count]) => `${names[level] ?? 'far card'} ×${count}`)
		.join(', ');
}

/** The separate pieces a drawn picture reads as, from its matte's components. */
function piecesDrawn(picture: SweepPicture): number | null {
	return picture.measures === null ? null : picture.measures.components;
}

/**
 * One rung's verdict: a pass where every picture drew and no piece meets nothing, a fail where a
 * picture is missing, holds no matte or floats, a rung drew another level than the ladder asked, or
 * the crown's open sky stands past its band, and an open fault where a rung cannot compare its
 * reference at all.
 */
export function sweepRow(input: SweepRowInput): SweepRow {
	const { rung, reference, pictures, band } = input;
	const drawn = pictures.filter((picture) => picture.error === undefined);
	const failures: string[] = [];
	const floating: { readonly area: number; readonly box: string }[] = [];
	/** The first picture a piece meets nothing in, which the reason names. */
	let floatingIn: string | null = null;
	let gap: SweepRow['gap'] = null;
	let pieces: SweepRow['pieces'] = null;
	let worstGap: number | null = null;
	/** A near-form rung whose page drew a card level, with the foot distances it stood at. */
	let nearShort: { readonly level: number; awayLeast: number; awayMost: number } | null = null;
	for (const picture of pictures) {
		if (picture.error !== undefined) {
			failures.push(`${picture.file} did not draw: ${picture.error}`);
			continue;
		}
		if (picture.matteError !== undefined) {
			failures.push(
				`${picture.file} has no matte, so its pieces cannot be read: ${picture.matteError}`,
			);
			continue;
		}
		// The near form's switch can lie inside a crown whose whole camera cannot stand that close
		// to the foot, since that camera looks at the crown's middle. The page then draws a card
		// level, and the rung is open rather than failed: it names why the near form cannot be drawn
		// from this scale.
		if (rung.level === 'near' && levelOf(picture) !== null && levelOf(picture) !== 0) {
			const level = levelOf(picture) as number;
			const away = picture.away;
			nearShort ??= {
				level,
				awayLeast: away ?? Number.POSITIVE_INFINITY,
				awayMost: away ?? 0,
			};
			if (away !== null) {
				nearShort.awayLeast = Math.min(nearShort.awayLeast, away);
				nearShort.awayMost = Math.max(nearShort.awayMost, away);
			}
		} else if (!levelHolds(rung, levelOf(picture)))
			failures.push(
				`${picture.file} drew level ${levelOf(picture) ?? 'unknown'}, not ${rung.label}`,
			);
		if (picture.measures === null) {
			failures.push(`${picture.file} read no pieces`);
			continue;
		}
		if (picture.measures.floating.length > 0) floatingIn ??= picture.file;
		floating.push(...picture.measures.floating);
		const pictureGap = picture.measures.crownBoxGap;
		if (pictureGap !== null && (worstGap === null || pictureGap > worstGap)) worstGap = pictureGap;
	}
	if (floating.length > 0) {
		const largest = floating.reduce((most, piece) => (piece.area > most.area ? piece : most));
		failures.push(
			`${floating.length} piece${floating.length === 1 ? '' : 's'} meet${floating.length === 1 ? 's' : ''} nothing in ${floatingIn ?? 'a picture'}, the largest ${largest.area} px at ${largest.box}`,
		);
	}
	/** The row as the figures read so far state it, with its verdict and reason. */
	const rowOf = (
		verdict: SweepRow['verdict'],
		reason: string,
		over: Partial<SweepRow> = {},
	): SweepRow => ({
		species: input.species,
		rung: rung.label,
		reference: reference?.file ?? null,
		pictures: drawn.length,
		levels: levelsDrawn(pictures),
		distance: input.distance,
		gap,
		pieces,
		floating: floating.length,
		verdict,
		reason,
		...over,
	});
	if (reference === undefined)
		return rowOf('fail', `uncompared: the reference folder carries no view for ${rung.label}`, {
			gap: null,
			pieces: null,
		});
	if (reference.separable && rung.distance !== 'fit') {
		const referenceGap = reference.gap;
		if (referenceGap !== null && worstGap !== null) {
			gap = { drawn: worstGap, reference: referenceGap };
			if (Math.abs(worstGap - referenceGap) > band)
				failures.push(
					`the crown's open sky ${worstGap.toFixed(3)} against the reference's ${referenceGap.toFixed(3)}, past the ${band.toFixed(2)} band`,
				);
		}
		const drawnPieces = drawn
			.map(piecesDrawn)
			.filter((count): count is number => count !== null)
			.reduce((most, count) => Math.max(most, count), 0);
		if (reference.pieces !== null) pieces = { drawn: drawnPieces, reference: reference.pieces };
	}
	if (drawn.length < SWEEP_PICTURES)
		failures.unshift(`${drawn.length} of ${SWEEP_PICTURES} pictures drew`);
	/** The near form's switch could not be reached from the whole camera's height. */
	const nearNote = (): string => {
		if (nearShort === null) return '';
		const names = ['leaf form', 'first card level', 'second card level', 'far card'];
		const least = Number.isFinite(nearShort.awayLeast) ? nearShort.awayLeast : null;
		const away =
			least === null
				? 'farther'
				: least === nearShort.awayMost
					? `${least.toFixed(1)} m`
					: `${least.toFixed(1)} to ${nearShort.awayMost.toFixed(1)} m`;
		const switchAt = input.distance === null ? 'unread' : `${input.distance.toFixed(1)} m`;
		return `the near form's switch stands ${switchAt} from the foot, and the whole camera reached ${away}, so the page drew the ${names[nearShort.level] ?? 'far card'}`;
	};
	if (failures.length > 0)
		return rowOf('fail', [failures.join('; '), nearNote()].filter(Boolean).join('; '));
	if (rung.distance !== 'fit' && (!reference.separable || reference.gap === null))
		return rowOf(
			'open',
			`the reference's outline does not separate, so its open sky cannot be compared; the ${drawn.length} pictures hold no floating piece`,
			{ floating: 0 },
		);
	if (nearShort !== null) return rowOf('open', nearNote(), { floating: 0 });
	const beside =
		gap === null
			? `no floating piece`
			: `open sky ${gap.drawn.toFixed(3)} against ${gap.reference.toFixed(3)}`;
	return rowOf(
		'pass',
		`${drawn.length} of ${SWEEP_PICTURES} pictures beside the reference; ${beside}`,
		{
			floating: 0,
		},
	);
}

/** The coverage of one species' round: a row per rung, and every row compared. */
export interface SweepCoverage {
	readonly species: string;
	/** The rungs with no row, which leave the species unjudged. */
	readonly missingRows: readonly string[];
	/** The rungs whose reference view is missing, so the row is uncompared. */
	readonly uncompared: readonly string[];
	/** The rungs with fewer pictures than the sweep draws. */
	readonly missingPictures: readonly string[];
	readonly failed: readonly string[];
	readonly open: readonly string[];
	readonly green: boolean;
}

/** The coverage of a species' round: a missing row or an uncompared view fails it. */
export function sweepCoverage(
	species: string,
	rows: readonly SweepRow[],
	rungs: readonly SweepRung[] = SWEEP_RUNGS,
): SweepCoverage {
	const byRung = new Map(rows.map((row) => [row.rung, row]));
	const missingRows: string[] = [];
	const uncompared: string[] = [];
	const missingPictures: string[] = [];
	const failed: string[] = [];
	const open: string[] = [];
	for (const rung of rungs) {
		const row = byRung.get(rung.label);
		if (!row) {
			missingRows.push(rung.label);
			continue;
		}
		if (row.reference === null) uncompared.push(rung.label);
		if (row.pictures !== SWEEP_PICTURES) missingPictures.push(rung.label);
		if (row.verdict === 'fail') failed.push(`${rung.label}: ${row.reason}`);
		if (row.verdict === 'open') open.push(`${rung.label}: ${row.reason}`);
	}
	return {
		species,
		missingRows,
		uncompared,
		missingPictures,
		failed,
		open,
		green:
			missingRows.length +
				uncompared.length +
				missingPictures.length +
				failed.length +
				open.length ===
			0,
	};
}

/** A number of metres for a table, or a dash. */
function metres(value: number | null): string {
	return value === null ? '—' : `${value.toFixed(1)}`;
}

/** A pair of figures for a table, or a dash. */
function pair(value: { readonly drawn: number; readonly reference: number } | null): string {
	return value === null ? '—' : `${value.drawn} / ${value.reference}`;
}

/** The table's columns, as a reader sees them. */
export const SWEEP_COLUMNS = [
	'Species',
	'View',
	'Reference',
	'Pictures',
	'Levels drawn',
	'Distance (m)',
	'Open sky drawn / ref',
	'Pieces drawn / ref',
	'Floating',
	'Verdict',
	'Reason',
] as const;

/** The sweep's table, one row a species and a view. */
export function sweepMarkdown(
	rows: readonly SweepRow[],
	coverage: readonly SweepCoverage[],
): string {
	const lines: string[] = [
		'# The sweep',
		'',
		`| ${SWEEP_COLUMNS.join(' | ')} |`,
		`| ${SWEEP_COLUMNS.map(() => '---').join(' | ')} |`,
	];
	for (const row of rows)
		lines.push(
			`| ${[
				row.species,
				row.rung,
				row.reference ?? '—',
				`${row.pictures} / ${SWEEP_PICTURES}`,
				row.levels,
				metres(row.distance),
				row.gap === null ? '—' : `${row.gap.drawn.toFixed(3)} / ${row.gap.reference.toFixed(3)}`,
				pair(row.pieces),
				String(row.floating),
				row.verdict,
				row.reason,
			].join(' | ')} |`,
		);
	lines.push('');
	for (const species of coverage) {
		const faults = [
			...(species.missingRows.length > 0
				? [`missing rows: ${species.missingRows.join(', ')}`]
				: []),
			...(species.uncompared.length > 0 ? [`uncompared: ${species.uncompared.join(', ')}`] : []),
			...(species.missingPictures.length > 0
				? [`missing pictures: ${species.missingPictures.join(', ')}`]
				: []),
			...(species.failed.length > 0 ? [`failing rows: ${species.failed.join('; ')}`] : []),
			...(species.open.length > 0 ? [`open faults: ${species.open.join('; ')}`] : []),
		];
		lines.push(
			`${species.species}: ${species.green ? 'every row drawn and compared' : faults.join('. ')}.`,
		);
	}
	lines.push('');
	return lines.join('\n');
}

/** One reference picture's measures, read once and shared by the rungs that draw beside it. */
function referenceOf(set: ReferenceSet, slot: Slot | undefined): SweepReference | undefined {
	if (!slot) return undefined;
	const image = onColour(readImage(join(set.folder, slot.file)), [255, 255, 255]);
	const plant = plantMask(image);
	const separable =
		plant.background.plain ||
		skyMaskable(plant.background) ||
		soilMaskable(plant.background, plant.height);
	if (!separable) return { file: slot.file, separable: false, gap: null, pieces: null };
	const measures = measurePlant(image, plant);
	return {
		file: slot.file,
		separable: true,
		gap: measures.box === null ? null : measures.crownBoxGap,
		pieces:
			measures.box === null
				? null
				: pieceCount(anyPlantMask(plant), plant.width, plant.height, PIECE_AREA),
	};
}

/** One species' round: its rows, its coverage and its sheets, written into the run's folder. */
export function sweepRun(
	runDir: string,
	species: string,
	set: ReferenceSet,
	frames: readonly RunFrame[],
	plan: readonly SweepRungPlan[],
	band = rubricBand(species, set.slug),
): { readonly rows: readonly SweepRow[]; readonly coverage: SweepCoverage } {
	const rows: SweepRow[] = [];
	const sheets: {
		readonly rung: string;
		readonly rows: readonly SheetRow[];
		readonly aspect: number;
	}[] = [];
	const references = new Map<string, SweepReference | undefined>();
	const beside = (slot: Slot | undefined) => {
		if (!slot) return undefined;
		if (!references.has(slot.file)) references.set(slot.file, referenceOf(set, slot));
		return references.get(slot.file);
	};
	for (const entry of plan) {
		const rungFrames = frames.filter((frame) => frame.group === `sweep-${entry.rung.id}`);
		const reference = beside(entry.slot);
		const pictures: SweepPicture[] = rungFrames.map((frame) => {
			const record = (frame.cell as { level?: { level?: unknown; distance?: unknown } } | undefined)
				?.level;
			const level = record?.level;
			const away = record?.distance;
			const picture: SweepPicture = {
				file: frame.file,
				level: typeof level === 'number' ? level : null,
				away: typeof away === 'number' ? away : null,
				...(frame.error !== undefined && { error: frame.error }),
				...(frame.matteError !== undefined && { matteError: frame.matteError }),
				measures: null,
			};
			if (picture.error !== undefined || picture.matteError !== undefined) return picture;
			try {
				return { ...picture, measures: sweepMeasures(runDir, frame) };
			} catch (error) {
				return {
					...picture,
					matteError: error instanceof Error ? error.message : String(error),
				};
			}
		});
		const row = sweepRow({
			species,
			slug: set.slug,
			rung: entry.rung,
			reference,
			distance: entry.distance,
			band,
			pictures,
		});
		rows.push(row);
		if (entry.slot) {
			const referenceImage = onColour(
				readImage(join(set.folder, entry.slot.file)),
				[255, 255, 255],
			);
			const sheetRows: SheetRow[] = rungFrames.map((frame, index) => {
				const picture = pictures[index];
				// A picture that did not draw keeps its row, so the sheet names the gap rather than
				// leaving the reader to count the rows.
				const render =
					picture?.error === undefined && picture?.matteError === undefined
						? readImage(join(runDir, frame.file))
						: undefined;
				return {
					reference: referenceImage,
					...(render && { render }),
					lines: [
						`${entry.rung.label}  ${frame.file.split('/').pop() ?? frame.file}`,
						`level ${picture?.level ?? '—'}   floating ${picture?.measures?.floating.length ?? '—'}   verdict ${row.verdict}`,
					],
				};
			});
			sheets.push({
				rung: entry.rung.id,
				rows: sheetRows,
				aspect: referenceImage.width / referenceImage.height,
			});
		}
	}
	const coverage = sweepCoverage(species, rows);
	for (const sheet of sheets) {
		const pages = contactSheets(
			`${species}  ${sheet.rung}  against its reference`,
			sheet.rows,
			sheet.aspect,
		);
		for (const [index, page] of pages.entries())
			writePng(join(runDir, `sweep-${sheet.rung}-sheet-${index + 1}.png`), page);
	}
	writeFileSync(join(runDir, 'sweep.json'), `${JSON.stringify({ rows, coverage }, null, '\t')}\n`);
	writeFileSync(join(runDir, 'sweep.md'), sweepMarkdown(rows, [coverage]));
	return { rows, coverage };
}

/** Whether every row of a round is green. */
export function sweepGreen(rows: readonly SweepRow[], coverage: readonly SweepCoverage[]): boolean {
	return coverage.every((entry) => entry.green) && rows.every((row) => row.verdict === 'pass');
}
