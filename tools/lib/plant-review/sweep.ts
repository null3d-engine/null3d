// The sweep: every species at its distance ladder and around it, orbited at each rung and pulled
// back in one continuous series. A rung is drawn at a full turn's even step and two heights, and
// every picture is compared beside the reference's own view at that scale. The orbit's frames are
// read for the pieces that meet nothing and the crown's covered share, and a frame that jumps
// beyond the round's band from its neighbours fails with its angle. The series reads the share at
// each distance, and a step that opens the crown by more than one point fails. One table carries
// the rungs; a second carries the series. A missing row, a missing picture, an uncompared view and
// any fail or open fault make the command exit 1.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writePng } from '../../../packages/cli/src/png.js';
import type { PlantReviewQuery } from '../../../tests/pages/lib/plant-review/query.ts';
import { type PlantView, VIEW_SPECS } from '../../../tests/pages/lib/plant-review/views.ts';
import {
	contactSheets,
	PIECE_AREA,
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
import { GAP_ABOVE, GAP_BELOW } from './verdict.ts';

/** Degrees between the orbit's frames: a full turn at this even step. */
export const SWEEP_STEP = 30;

/** The turns the orbit stands the camera at, from the reference view's own turn. */
export const SWEEP_TURNS = Array.from(
	{ length: 360 / SWEEP_STEP },
	(_, index) => index * SWEEP_STEP,
);

/** The two heights the orbit stands the camera at: the view's own rise, and a raised one. */
export const SWEEP_HEIGHTS = [
	{ id: 'low', rise: 0 },
	{ id: 'high', rise: 15 },
] as const;

/** The pictures one rung draws at the default step with its orbit: a turn and a height each. */
export const SWEEP_PICTURES = SWEEP_TURNS.length * SWEEP_HEIGHTS.length;

/** The pictures one rung draws at a step, or one alone where the round draws no orbit. */
export function sweepPictures(step: number, orbit = true): number {
	return orbit ? (360 / step) * SWEEP_HEIGHTS.length : 1;
}

/** The distances the pull-back series steps through, before the rungs' own are joined in. */
export const SWEEP_SERIES_STEPS = 24;

/** The most a step of the pull-back may open the crown's covered share. */
export const SERIES_OPEN = 0.01;

/** The most a frame's covered share may stand from its neighbours' in the orbit. */
export const ORBIT_COVERED_BAND = GAP_ABOVE;

/** The most pieces that meet nothing a frame may add over its neighbours in the orbit. */
export const ORBIT_CLUSTER_BAND = 1;

/** How a rung is judged beside its reference view: by the crown's open sky, or by its level. */
export type SweepCompare = 'gap' | 'level';

/** How a rung stands its camera: on the plant's own distance ladder, or fitted close. */
export type SweepDistance = 'far' | 'first-card' | 'near' | 'fit';

/** The level a rung expects the page to draw at its camera, where the ladder fixes it. */
export type SweepLevel = 'far' | 'card' | 'near' | 'any';

/** One rung of the sweep: a scale a species is drawn at, orbited and judged at. */
export interface SweepRung {
	/** Its short name, which names its pictures' group. */
	readonly id: string;
	/** The scale in words for the table. */
	readonly label: string;
	/** The reference views that show this scale, best first. A rung with none is uncompared. */
	readonly referenceViews: readonly PlantView[];
	readonly distance: SweepDistance;
	readonly level: SweepLevel;
	readonly compare: SweepCompare;
	/**
	 * The camera the rung stands where the view's own cannot reach its scale, as a rise and a factor
	 * on the ladder's distance. A rung with none keeps its view's own camera.
	 */
	readonly camera?: { readonly elevation: number; readonly distanceFactor: number };
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
		compare: 'gap',
	},
	{
		id: 'first-card',
		label: 'the first card level',
		referenceViews: ['whole'],
		distance: 'first-card',
		level: 'card',
		compare: 'gap',
	},
	{
		id: 'switch',
		label: 'the near form at its switch',
		// The switch lies near the foot, and a whole view's camera looks at the crown's middle, so it
		// cannot stand that close. The inside-crown camera can, and it is the camera the page draws
		// the near form from at this scale.
		referenceViews: ['inside', 'crown-underside', 'crown', 'whole'],
		distance: 'near',
		level: 'near',
		compare: 'level',
	},
	{
		id: 'inside',
		label: 'inside the crown',
		referenceViews: ['inside', 'crown-underside', 'crown'],
		distance: 'fit',
		level: 'any',
		compare: 'level',
	},
	{
		id: 'trunk',
		label: 'the trunk',
		referenceViews: ['trunk', 'bark-mid', 'bark-base', 'bark-limb', 'below'],
		distance: 'fit',
		level: 'any',
		compare: 'level',
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
		compare: 'level',
	},
];

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
	// The rung's views stand in the order the folder is searched: the closest scale it names wins
	// over a wider one that happens to come first in the folder.
	for (const view of rung.referenceViews) {
		const slot = set.stills.find((still) => still.kind === 'still' && still.view === view);
		if (slot) return slot;
	}
	return undefined;
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
			return first;
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

/** One distance of the pull-back series: the frame it draws and the metres it stands at. */
export interface SweepSeriesStep {
	readonly file: string;
	readonly distance: number;
}

/** What a sweep run records of its plan, so a replay compares the same rungs. */
export interface SweepManifest {
	readonly starts: readonly [number, number, number];
	/** Degrees between the orbit's frames, so a table names the step it drew at. */
	readonly step: number;
	/** Whether the run drew a full turn at each rung, or one picture a rung. */
	readonly orbit: boolean;
	readonly rungs: readonly {
		readonly id: string;
		readonly reference?: string;
		readonly distance: number | null;
	}[];
	readonly series: readonly SweepSeriesStep[];
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

/** One of an orbit's cameras: the turn in degrees, the rise and the height's name. */
interface SweepCamera {
	readonly turn: number;
	readonly elevation: number;
	readonly height: string;
}

/** The cameras a rung stands at: every turn and height, from the reference view's own. */
export function sweepCameras(
	rung: SweepRung,
	slot: Slot | undefined,
	step = SWEEP_STEP,
	orbit = true,
): readonly SweepCamera[] {
	const view = slot?.view ?? rung.referenceViews[0] ?? 'whole';
	const home = slot?.turn ?? 0;
	const rise = slot?.elevation ?? VIEW_SPECS[view].elevation;
	const base = rung.camera?.elevation ?? rise;
	// A round with no time for an orbit draws each rung once, from the reference's own camera.
	if (!orbit)
		return [
			{
				turn: home,
				elevation: Math.max(-89, Math.min(89, base)),
				height: SWEEP_HEIGHTS[0].id,
			},
		];
	const cameras: SweepCamera[] = [];
	for (let turn = 0; turn < 360; turn += step)
		for (const height of SWEEP_HEIGHTS)
			cameras.push({
				turn: (home + turn) % 360,
				elevation: Math.max(-89, Math.min(89, base + height.rise)),
				height: height.id,
			});
	return cameras;
}

/**
 * The sweep's rung plans and orbit pictures: each rung at its reference view, its camera distance
 * and every turn and height. A rung whose folder carries no reference view is planned with no
 * slot, so its row is uncompared rather than absent.
 */
export function sweepShots(
	set: ReferenceSet,
	base: PlantReviewQuery,
	starts: readonly [number, number, number],
	step = SWEEP_STEP,
	orbit = true,
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
		const asked =
			distance === null ? null : rung.camera ? distance * rung.camera.distanceFactor : distance;
		for (const camera of sweepCameras(rung, slot, step, orbit)) {
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
						...(rung.distance !== 'fit' && asked !== null && { distance: asked }),
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

/** The distances the pull-back series stands at: evenly spaced in log distance, rungs joined. */
export function sweepSeriesDistances(
	starts: readonly [number, number, number],
	steps = SWEEP_SERIES_STEPS,
): readonly number[] {
	const [first, second, far] = starts;
	const close = Math.max(0.8, first * 0.5);
	const last = far * 1.05;
	const ratio = (last / close) ** (1 / Math.max(1, steps - 1));
	const distances = new Set<number>();
	for (let step = 0; step < steps; step++)
		distances.add(Number((close * ratio ** step).toFixed(3)));
	// A crossing cannot hide between two rungs the series does not stand at, so the ladder's
	// distances are joined into the series rather than only approached.
	distances.add(Number(first.toFixed(3)));
	distances.add(Number(((first + Math.max(first, Math.min(second, far))) / 2).toFixed(3)));
	distances.add(Number(last.toFixed(3)));
	return [...distances].sort((a, b) => a - b);
}

/** The pull-back series' pictures: one whole frame at each distance, at the page's camera. */
export function sweepSeriesShots(
	base: PlantReviewQuery,
	starts: readonly [number, number, number],
): { readonly shots: Shot[]; readonly steps: SweepSeriesStep[] } {
	const shots: Shot[] = [];
	const steps: SweepSeriesStep[] = [];
	for (const [index, distance] of sweepSeriesDistances(starts).entries()) {
		const name = `step-${String(index + 1).padStart(2, '0')}-${distance.toFixed(2).replace('.', '_')}`;
		const file = `sweep-series/${name}.png`;
		shots.push(
			singleShot(
				'sweep-series',
				`${name}.png`,
				{ ...base, view: 'whole', distance, measure: true },
				VIEW_SPECS.whole.size,
				false,
			),
		);
		steps.push({ file, distance });
	}
	return { shots, steps };
}

/** The manifest's record of a plan, for a replay. */
export function sweepManifest(
	plan: readonly SweepRungPlan[],
	starts: readonly [number, number, number],
	series: readonly SweepSeriesStep[],
	step = SWEEP_STEP,
	orbit = true,
): SweepManifest {
	return {
		starts,
		step,
		orbit,
		rungs: plan.map((entry) => ({
			id: entry.rung.id,
			...(entry.slot && { reference: entry.slot.file }),
			distance: entry.distance,
		})),
		series,
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

/** One drawn picture of an orbit, as the table reads it. */
export interface SweepPicture {
	readonly file: string;
	/** The turn the picture stands at, in degrees. */
	readonly turn: number;
	/** The height it stands at, `low` or `high`. */
	readonly height: string;
	/** The level the page drew, or null where its frame names none. */
	readonly level: number | null;
	/** The distance from the lens to the plant's foot, in metres, where the frame names it. */
	readonly away: number | null;
	/** Why the picture did not draw. */
	readonly error?: string;
	/** Why the picture has no matte, where its picture drew. */
	readonly matteError?: string;
	/** Its connectivity and crown gap, read from its matte, or null where no matte was read. */
	readonly measures: SweepMeasures | null;
	/**
	 * The sky inside the plant's own outline by the photograph's colour rule, or null where the
	 * picture holds no plant. The colour rule is the same on both sides of every switch.
	 */
	readonly skyGap: number | null;
	/** The share of the crown's outline the foliage covers: one less the sky gap. */
	readonly covered: number | null;
}

/** The reference picture a rung is compared beside. */
export interface SweepReference {
	readonly file: string;
	/** Whether the picture separates from its background, so an outline and a sky gap read. */
	readonly separable: boolean;
	/** The sky inside its crown's outline, or null where the picture's outline does not read. */
	readonly skyGap: number | null;
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
	readonly pictures: readonly SweepPicture[];
	/** The pictures the rung was asked to draw at the round's step and orbit. */
	readonly expected?: number;
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
	/** The orbit's covered share, from its least to its most, or null where no frame read one. */
	readonly covered: { readonly least: number; readonly most: number } | null;
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
 * The orbit's jumps: a frame whose covered share stands beyond the band from its same-height
 * neighbours' mean, or whose pieces that meet nothing stand beyond the band over theirs. Each
 * fault names the frame, its angle and the step.
 */
export function sweepOrbitJumps(
	pictures: readonly SweepPicture[],
	cover = true,
): readonly string[] {
	const jumps: string[] = [];
	for (const height of SWEEP_HEIGHTS) {
		const run = pictures
			.filter((picture) => picture.height === height.id)
			.sort((a, b) => a.turn - b.turn);
		if (run.length < 3) continue;
		for (const [index, picture] of run.entries()) {
			const previous = run[(index - 1 + run.length) % run.length] as SweepPicture;
			const next = run[(index + 1) % run.length] as SweepPicture;
			const share = picture.covered;
			const shares = [previous.covered, next.covered].filter(
				(value): value is number => value !== null,
			);
			if (cover && share !== null && shares.length === 2) {
				const around = ((shares[0] as number) + (shares[1] as number)) / 2;
				if (Math.abs(share - around) > ORBIT_COVERED_BAND)
					jumps.push(
						`${picture.file} at ${picture.turn}° ${height.id} covers ${share.toFixed(3)} against its neighbours' ${around.toFixed(3)}`,
					);
			}
			const free = picture.measures?.floating.length ?? 0;
			const neighbours = [
				previous.measures?.floating.length ?? 0,
				next.measures?.floating.length ?? 0,
			];
			if (free > Math.max(...neighbours) + ORBIT_CLUSTER_BAND)
				jumps.push(
					`${picture.file} at ${picture.turn}° ${height.id} holds ${free} pieces that meet nothing, against its neighbours' ${Math.max(...neighbours)}`,
				);
		}
	}
	return jumps;
}

/**
 * One rung's verdict: a pass where every picture drew and stands inside its bars, a fail where a
 * picture is missing, holds no matte or floats, a rung drew another level than the ladder asked,
 * the crown's open sky or its pieces stand outside the reference's band, or the orbit jumps beyond
 * its neighbours' figures, and an open fault where a rung cannot compare its reference at all.
 */
export function sweepRow(input: SweepRowInput): SweepRow {
	const { rung, reference, pictures } = input;
	const drawn = pictures.filter((picture) => picture.error === undefined);
	const failures: string[] = [];
	const floating: { readonly area: number; readonly box: string }[] = [];
	let floatingIn: string | null = null;
	let gap: SweepRow['gap'] = null;
	let pieces: SweepRow['pieces'] = null;
	let covered: SweepRow['covered'] = null;
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
		// The near form's switch lies near the foot, and a camera aimed at the crown's middle cannot
		// always stand that close. A page that draws a card level then is open rather than failed:
		// it names why the near form cannot be drawn from this camera.
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
		if (picture.covered !== null)
			covered =
				covered === null
					? { least: picture.covered, most: picture.covered }
					: {
							least: Math.min(covered.least, picture.covered),
							most: Math.max(covered.most, picture.covered),
						};
	}
	if (floating.length > 0) {
		const largest = floating.reduce((most, piece) => (piece.area > most.area ? piece : most));
		failures.push(
			`${floating.length} piece${floating.length === 1 ? '' : 's'} meet${floating.length === 1 ? 's' : ''} nothing in ${floatingIn ?? 'a picture'}, the largest ${largest.area} px at ${largest.box}`,
		);
	}
	// The row's own copy of the figures, once the reference's are known.
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
		covered,
		verdict,
		reason,
		...over,
	});
	if (reference === undefined)
		return rowOf('fail', `uncompared: the reference folder carries no view for ${rung.label}`, {
			gap: null,
			pieces: null,
		});
	if (reference.separable && rung.compare === 'gap') {
		const referenceGap = reference.skyGap;
		const skyGaps = drawn
			.map((picture) => picture.skyGap)
			.filter((value): value is number => value !== null);
		if (referenceGap !== null && skyGaps.length > 0) {
			// The bar is the still comparison's: a drawn crown may stand two points more closed
			// and five points more open than its photograph's outline.
			const least = Math.min(...skyGaps);
			const most = Math.max(...skyGaps);
			gap = { drawn: most, reference: referenceGap };
			const outside = drawn.filter(
				(picture) =>
					picture.skyGap !== null &&
					(picture.skyGap < referenceGap - GAP_BELOW || picture.skyGap > referenceGap + GAP_ABOVE),
			);
			if (outside.length > 0) {
				const first = outside[0] as SweepPicture;
				const figure = (first.skyGap as number).toFixed(3);
				failures.push(
					`the crown's open sky ${figure} in ${first.file} against the reference's ${referenceGap.toFixed(3)}, past the ${GAP_BELOW.toFixed(2)}/${GAP_ABOVE.toFixed(2)} band (${least.toFixed(3)} to ${most.toFixed(3)} across ${skyGaps.length} pictures)`,
				);
			}
		}
		const drawnPieces = drawn
			.map(piecesDrawn)
			.filter((count): count is number => count !== null)
			.reduce((most, count) => Math.max(most, count), 0);
		if (reference.pieces !== null) {
			pieces = { drawn: drawnPieces, reference: reference.pieces };
			if (drawnPieces > reference.pieces + 1)
				failures.push(
					`${drawnPieces} pieces against the reference's ${reference.pieces}, more than the one-piece band`,
				);
		}
	}
	// The orbit's frames must hold together with the frames either side of them, not only with the
	// photograph: a side that closes while the other opens shows here as a number. The covered
	// share is read at the ladder's crown rungs; a close view frames one piece, whose own
	// silhouette turns, so its share says nothing about the crown's density. A piece that leaves
	// the wood is read at every rung.
	for (const jump of sweepOrbitJumps(pictures, rung.distance !== 'fit'))
		failures.push(`the orbit jumps: ${jump}`);
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
		return `the near form's switch stands ${switchAt} from the foot, and this camera reached ${away}, so the page drew the ${names[nearShort.level] ?? 'far card'}`;
	};
	const expected = input.expected ?? SWEEP_PICTURES;
	if (drawn.length < expected) failures.unshift(`${drawn.length} of ${expected} pictures drew`);
	if (failures.length > 0)
		return rowOf('fail', [failures.join('; '), nearNote()].filter(Boolean).join('; '));
	if (rung.compare === 'gap' && (!reference.separable || reference.skyGap === null))
		return rowOf(
			'open',
			`the reference's outline does not separate, so its open sky cannot be compared; the ${drawn.length} pictures hold no floating piece`,
			{ floating: 0 },
		);
	if (nearShort !== null) return rowOf('open', nearNote(), { floating: 0 });
	const beside =
		gap === null
			? 'no floating piece'
			: `open sky ${gap.drawn.toFixed(3)} against ${gap.reference.toFixed(3)}`;
	return rowOf('pass', `${drawn.length} of ${expected} pictures beside the reference; ${beside}`, {
		floating: 0,
	});
}

/** The coverage of one species' round: a row per rung, and every row compared. */
export interface SweepCoverage {
	readonly species: string;
	/** The rungs with no row, which leave the species unjudged. */
	readonly missingRows: readonly string[];
	/** The rungs whose reference view is missing, so the row is uncompared. */
	readonly uncompared: readonly string[];
	/** The rungs with fewer pictures than the orbit draws. */
	readonly missingPictures: readonly string[];
	readonly failed: readonly string[];
	readonly open: readonly string[];
	/** The series' steps that open the crown, and the steps that did not draw or read. */
	readonly series: readonly string[];
	readonly green: boolean;
}

/** The coverage of a species' round: a missing row or an uncompared view fails it. */
export function sweepCoverage(
	species: string,
	rows: readonly SweepRow[],
	series: readonly SweepSeriesRow[] = [],
	expected = SWEEP_PICTURES,
	seriesExpected = SWEEP_SERIES_STEPS,
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
		if (row.pictures !== expected) missingPictures.push(rung.label);
		if (row.verdict === 'fail') failed.push(`${rung.label}: ${row.reason}`);
		if (row.verdict === 'open') open.push(`${rung.label}: ${row.reason}`);
	}
	const seriesFaults = series
		.filter((step) => step.verdict !== 'pass')
		.map((step) => `${step.file} at ${step.distance.toFixed(2)} m: ${step.reason}`);
	const short = series.length < seriesExpected;
	return {
		species,
		missingRows,
		uncompared,
		missingPictures,
		failed,
		open,
		series: [
			...(short ? [`${series.length} of ${seriesExpected} series steps drew`] : []),
			...seriesFaults,
		],
		green:
			missingRows.length +
				uncompared.length +
				missingPictures.length +
				failed.length +
				open.length ===
				0 &&
			seriesFaults.length === 0 &&
			!short,
	};
}

/** One step of the pull-back series, as the table reads it. */
export interface SweepSeriesRow {
	readonly file: string;
	readonly distance: number;
	readonly level: number | null;
	readonly covered: number | null;
	readonly change: number | null;
	readonly verdict: 'pass' | 'fail' | 'open';
	readonly reason: string;
}

/**
 * The pull-back series' rows: the share at each distance, and a step that opens the crown by more
 * than one point. A step with no readable share is open, since the rule reads every frame.
 */
export function sweepSeriesRows(pictures: readonly SweepSeriesRow[]): readonly SweepSeriesRow[] {
	const rows: SweepSeriesRow[] = [];
	let previous: SweepSeriesRow | null = null;
	for (const picture of [...pictures].sort((a, b) => a.distance - b.distance)) {
		const before = previous === null ? null : previous.covered;
		const change = before !== null && picture.covered !== null ? picture.covered - before : null;
		let verdict: SweepSeriesRow['verdict'] = picture.verdict;
		let reason = picture.reason;
		if (picture.covered === null && verdict === 'pass') {
			verdict = 'open';
			reason = 'no covered share read at this distance';
		} else if (change !== null && change < -SERIES_OPEN) {
			verdict = 'fail';
			reason = `the crown's covered share falls ${(-change).toFixed(3)} from ${previous?.file ?? 'the step before'} (${previous?.covered?.toFixed(3)} to ${picture.covered?.toFixed(3)})`;
		}
		const row: SweepSeriesRow = { ...picture, change, verdict, reason };
		rows.push(row);
		previous = row;
	}
	return rows;
}

/** A number of metres for a table, or a dash. */
function metres(value: number | null): string {
	return value === null ? '—' : `${value.toFixed(1)}`;
}

/** A pair of figures for a table, or a dash. */
function pair(value: { readonly drawn: number; readonly reference: number } | null): string {
	return value === null ? '—' : `${value.drawn} / ${value.reference}`;
}

/** The rung table's columns, as a reader sees them. */
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
	'Orbit covered',
	'Verdict',
	'Reason',
] as const;

/** The series table's columns. */
export const SERIES_COLUMNS = [
	'Species',
	'Frame',
	'Distance (m)',
	'Level',
	'Covered share',
	'Change',
	'Verdict',
	'Reason',
] as const;

/** The sweep's tables: one row a species and a view, one row a series step. */
export function sweepMarkdown(
	rows: readonly SweepRow[],
	coverage: readonly SweepCoverage[],
	series: readonly (SweepSeriesRow & { readonly species: string })[] = [],
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
				row.covered === null
					? '—'
					: `${row.covered.least.toFixed(3)} to ${row.covered.most.toFixed(3)}`,
				row.verdict,
				row.reason,
			].join(' | ')} |`,
		);
	if (series.length > 0) {
		lines.push('', '## The pull-back series', '');
		lines.push(`| ${SERIES_COLUMNS.join(' | ')} |`);
		lines.push(`| ${SERIES_COLUMNS.map(() => '---').join(' | ')} |`);
		for (const step of series)
			lines.push(
				`| ${[
					step.species,
					step.file.split('/').pop() ?? step.file,
					step.distance.toFixed(2),
					step.level === null ? '—' : String(step.level),
					step.covered === null ? '—' : step.covered.toFixed(3),
					step.change === null ? '—' : step.change.toFixed(3),
					step.verdict,
					step.reason,
				].join(' | ')} |`,
			);
	}
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
			...(species.series.length > 0 ? [`series: ${species.series.join('; ')}`] : []),
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
	if (!separable) return { file: slot.file, separable: false, skyGap: null, pieces: null };
	const measures = measurePlant(image, plant);
	return {
		file: slot.file,
		separable: true,
		skyGap: measures.box === null ? null : measures.gapFraction,
		pieces:
			measures.box === null
				? null
				: pieceCount(anyPlantMask(plant), plant.width, plant.height, PIECE_AREA),
	};
}

/** A drawn picture's figures: its matte's pieces and, by the colour rule, its covered share. */
function pictureOf(runDir: string, frame: RunFrame, baseElevation?: number): SweepPicture {
	const record = (frame.cell as { level?: { level?: unknown; distance?: unknown } } | undefined)
		?.level;
	const level = record?.level;
	const away = record?.distance;
	const elevation = (frame.query as { elevation?: number } | undefined)?.elevation;
	const height =
		baseElevation !== undefined && elevation !== undefined && elevation > baseElevation + 0.5
			? 'high'
			: 'low';
	const picture: SweepPicture = {
		file: frame.file,
		turn: frame.turn,
		height,
		level: typeof level === 'number' ? level : null,
		away: typeof away === 'number' ? away : null,
		measures: null,
		skyGap: null,
		covered: null,
	};
	if (frame.error !== undefined || frame.matteError !== undefined)
		return {
			...picture,
			...(frame.error !== undefined && { error: frame.error }),
			...(frame.matteError !== undefined && { matteError: frame.matteError }),
		};
	try {
		const measures = sweepMeasures(runDir, frame);
		const image = readImage(join(runDir, frame.file));
		const plant = plantMask(image);
		const read = measurePlant(image, plant);
		const skyGap = read.box === null ? null : read.gapFraction;
		return {
			...picture,
			measures,
			skyGap,
			covered: skyGap === null ? null : 1 - skyGap,
		};
	} catch (error) {
		return {
			...picture,
			matteError: error instanceof Error ? error.message : String(error),
		};
	}
}

/** One species' round: its rows, its series, its coverage and its sheets, written into the run. */
export function sweepRun(
	runDir: string,
	species: string,
	set: ReferenceSet,
	frames: readonly RunFrame[],
	plan: readonly SweepRungPlan[],
	series: readonly SweepSeriesStep[],
	options: {
		readonly head?: { readonly commit: string; readonly dirty: boolean };
		readonly step?: number;
		readonly orbit?: boolean;
	} = {},
): {
	readonly rows: readonly SweepRow[];
	readonly coverage: SweepCoverage;
	readonly series: readonly SweepSeriesRow[];
} {
	const step = options.step ?? SWEEP_STEP;
	const orbit = options.orbit ?? true;
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
		const view = entry.slot?.view ?? entry.rung.referenceViews[0] ?? 'whole';
		const baseElevation =
			entry.rung.camera?.elevation ?? entry.slot?.elevation ?? VIEW_SPECS[view].elevation;
		const pictures = rungFrames.map((frame) => pictureOf(runDir, frame, baseElevation));
		const row = sweepRow({
			species,
			slug: set.slug,
			rung: entry.rung,
			reference,
			distance: entry.distance,
			pictures,
			expected: sweepPictures(step, orbit),
		});
		rows.push(row);
		if (entry.slot) {
			const referenceImage = onColour(
				readImage(join(set.folder, entry.slot.file)),
				[255, 255, 255],
			);
			const sheetRows: SheetRow[] = rungFrames.map((frame, index) => {
				const picture = pictures[index];
				const render =
					picture?.error === undefined && picture?.matteError === undefined
						? readImage(join(runDir, frame.file))
						: undefined;
				return {
					reference: referenceImage,
					...(render && { render }),
					lines: [
						`${entry.rung.label}  ${frame.file.split('/').pop() ?? frame.file}  ${frame.turn}°`,
						`level ${picture?.level ?? '—'}   floating ${picture?.measures?.floating.length ?? '—'}   covered ${picture?.covered?.toFixed(3) ?? '—'}   verdict ${row.verdict}`,
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
	// The pull-back's frames are read one by one, then stepped against one another.
	const seriesRows: SweepSeriesRow[] = [];
	for (const step of series) {
		const frame = frames.find((candidate) => candidate.file === step.file);
		if (!frame || frame.error !== undefined) {
			seriesRows.push({
				file: step.file,
				distance: step.distance,
				level: null,
				covered: null,
				change: null,
				verdict: 'fail',
				reason: `did not draw: ${frame?.error ?? 'no frame'}`,
			});
			continue;
		}
		const picture = pictureOf(runDir, frame);
		seriesRows.push({
			file: step.file,
			distance: step.distance,
			level: picture.level,
			covered: picture.covered,
			change: null,
			verdict: 'pass',
			reason: '',
		});
	}
	const stepped = sweepSeriesRows(seriesRows);
	const coverage = sweepCoverage(
		species,
		rows,
		stepped,
		sweepPictures(step, orbit),
		orbit ? SWEEP_SERIES_STEPS : 0,
	);
	for (const sheet of sheets) {
		const pages = contactSheets(
			`${species}  ${sheet.rung}  against its reference`,
			sheet.rows,
			sheet.aspect,
		);
		for (const [index, page] of pages.entries())
			writePng(join(runDir, `sweep-${sheet.rung}-sheet-${index + 1}.png`), page);
	}
	const withSpecies = stepped.map((step) => ({ ...step, species }));
	writeFileSync(
		join(runDir, 'sweep.json'),
		`${JSON.stringify({ rows, coverage, series: withSpecies }, null, '\t')}\n`,
	);
	writeFileSync(
		join(runDir, 'sweep.md'),
		`${headLine(species, options.head, step, orbit)}${sweepMarkdown(rows, [coverage], withSpecies)}`,
	);
	return { rows, coverage, series: stepped };
}

/** The line above a species' table: the head it drew at and the orbit's step, or none. */
function headLine(
	species: string,
	head: { readonly commit: string; readonly dirty: boolean } | undefined,
	step: number,
	orbit: boolean,
): string {
	const where = head ? `Head: ${head.commit.slice(0, 12)}${head.dirty ? ' (dirty)' : ''}. ` : '';
	const drawn = orbit
		? `Orbit step: ${step} degrees. Pictures a rung: ${sweepPictures(step, orbit)}.`
		: 'Rungs only: one picture a rung, no orbit.';
	return `${species}. ${where}${drawn}\n\n`;
}

/** Whether every row and every series step of a round is green. */
export function sweepGreen(rows: readonly SweepRow[], coverage: readonly SweepCoverage[]): boolean {
	return coverage.every((entry) => entry.green) && rows.every((row) => row.verdict === 'pass');
}
