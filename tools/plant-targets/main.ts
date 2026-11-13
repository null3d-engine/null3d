// Measures species' structural targets from their reference folders: the figures a plant generator
// is driven by. For each species it reads the fact sheet, measures every whole-plant picture and
// every frame of the whole plant's turning video, the wood where it shows, and the branch pieces
// with their turning videos, and writes `tools/lib/plant-review/targets/<species>.json`.
//
//   bun run plants:targets <species...> [--refs <folder or slug>] [--out <folder>]
//
// A species' folder is `<id>` under the store that NULL3D_PLANT_REFERENCES names; `--refs` names
// another for a single species. `--out` writes the files into another folder. A figure that a
// picture cannot give is null with its reason, and no figure is filled by hand.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from '../../tests/lib/server.ts';
import { flag, option, positionals } from '../lib/plant-review/cli.ts';
import { readImage } from '../lib/plant-review/image.ts';
import {
	boxOf,
	plantMask,
	type ReferenceSet,
	readReferenceSet,
	type Slot,
	WORK_WIDTH,
} from '../lib/plant-review/references.ts';
import { referenceFolder } from '../lib/plant-review/store.ts';
import { readFacts, type StatedFacts } from './facts.ts';
import { edgesMet, measurePiece } from './piece.ts';
import {
	nullsOf,
	type PieceStill,
	type SpeciesTargets,
	type SpreadRow,
	TARGETS_SCHEMA,
	targetsText,
	type WholeStill,
	type WoodView,
} from './schema.ts';
import { HOLE_CLASSES, LOBE_DEPTH, rounded } from './shape.ts';
import {
	measurePieceTurn,
	measureTurn,
	TURN_FIGURES,
	type TurnFigureName,
	type TurnFigures,
} from './turn.ts';
import { measureView } from './whole.ts';

/** Where the targets files go. */
const TARGETS = join(REPO_ROOT, 'tools/lib/plant-review/targets');
/** Breast height in metres. */
const BREAST_METRES = 1.3;
/** The least plant height, in breast heights, at which a width at breast height is a stem's. */
const BREAST_LEAST = 2;
/** The highest number of a whole view that shows the species' usual habit. */
const HABIT_STILLS = 18;
/** The numbers of the stills that show a branch piece. */
const PIECE_STILLS = new Set([9, 10, 20, 21, 22, 23]);
/** The lowest number of a studio still of a cut piece. */
const STUDIO_FROM = 21;
/** The numbers of the close stills that show the plant's wood. */
const WOOD_STILLS = new Set([3, 5, 7, 8, 17]);
/** The figures whose spread between the pictures is listed. */
const SPREAD_FIGURES: readonly TurnFigureName[] = [
	'heightToWidth',
	'crownHeightToWidth',
	'crownBase',
	'crownWidth',
	'bareTrunk',
	'trunkWidth',
	'flare',
	'lean',
	'lobes',
	'enclosedGap',
	'boxGap',
	'holeShare',
];

/** Whether a still shows the whole plant: its name says so, and it is not one leaf or one flower. */
function wholeView(slot: Slot): boolean {
	return (
		slot.framed &&
		(slot.view === 'whole' || slot.view === 'silhouette') &&
		/whole|silhouette|profile|distant/.test(slot.name) &&
		!/single/.test(slot.name)
	);
}

/** The reason the review's own data gives for a picture with no outline to read. */
const NOT_SEPARABLE =
	"the review's slot file names the picture's outline as not separable from its backdrop";

/**
 * The reference files whose outline the review's slot file for the species names as not separable,
 * such as a plant in front of a far band of scrub that the fitted sky and ground admit.
 */
function unseparable(id: string): ReadonlySet<string> {
	const path = join(REPO_ROOT, 'tools/lib/plant-review/slots', `${id}.json`);
	if (!existsSync(path)) return new Set();
	const slots = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { noOutline?: boolean }>;
	return new Set(
		Object.entries(slots)
			.filter(([, fields]) => fields?.noOutline === true)
			.map(([file]) => file),
	);
}

/** One whole-plant still, measured. */
function wholeStill(
	folder: string,
	slot: Slot,
	breastShare: number | null,
	refused: ReadonlySet<string>,
): WholeStill {
	if (refused.has(slot.file))
		return { file: slot.file, figures: null, missing: { figures: NOT_SEPARABLE } };
	const result = measureView(readImage(join(folder, slot.file)), breastShare);
	return 'figures' in result
		? { file: slot.file, figures: result.figures, missing: {} }
		: { file: slot.file, figures: null, missing: { figures: result.problem } };
}

/** How far the secondary views stand from the primary individual, figure by figure. */
function spreadOf(
	primary: WholeStill | null,
	turn: TurnFigures | null,
	secondary: readonly WholeStill[],
): SpreadRow[] {
	return SPREAD_FIGURES.map((figure) => {
		const read = TURN_FIGURES[figure];
		const first = primary?.figures ? read(primary.figures) : null;
		const range = turn?.stats[figure] ?? null;
		const values: Record<string, number | null> = {};
		let largest: number | null = null;
		const outside: string[] = [];
		for (const view of secondary) {
			const value = view.figures ? read(view.figures) : null;
			values[view.file] = value;
			if (value === null) continue;
			if (range && (value < range.min || value > range.max)) outside.push(view.file);
			if (first !== null && first !== 0)
				largest = Math.max(largest ?? 0, Math.abs(value - first) / Math.abs(first));
		}
		return {
			figure,
			primary: first,
			primaryOutsideTurn:
				first !== null && range !== null && (first < range.min || first > range.max),
			turn: range
				? { min: range.min, low: range.low, median: range.median, high: range.high, max: range.max }
				: null,
			secondary: values,
			largest: largest === null ? null : rounded(largest, 3),
			outsideTurn: outside,
		};
	});
}

/** A close still of the wood: why it gives no limb count, or the count where its outline is whole. */
function woodView(folder: string, slot: Slot, breastShare: number | null): WoodView {
	const image = readImage(join(folder, slot.file));
	const plant = plantMask(image);
	const box = boxOf(plant.mask, plant.width, plant.height);
	const none = (reason: string): WoodView => ({
		file: slot.file,
		limbs: null,
		missing: { limbs: reason },
	});
	if (!box) return none('the background is not plain, so the wood has no outline');
	const edges = edgesMet(box, plant.width, plant.height);
	if (edges.length > 0)
		return none(
			`the wood runs off the frame's ${edges.join(' and ')}, so the stem and its limbs do not show whole`,
		);
	const result = measureView(image, breastShare);
	if ('problem' in result) return none(result.problem);
	return result.figures.limbs
		? { file: slot.file, limbs: result.figures.limbs, missing: {} }
		: none(result.figures.missing.limbs ?? 'the limbs do not show apart');
}

/** Measures one species. */
function measureSpecies(id: string, set: ReferenceSet): SpeciesTargets {
	const folder = set.folder;
	const factsPath = join(folder, 'FACTS.md');
	const missing: Record<string, string> = {};
	const stated: StatedFacts | null = existsSync(factsPath)
		? readFacts(readFileSync(factsPath, 'utf8'))
		: null;
	if (!stated) missing.stated = 'the reference folder has no FACTS.md';
	const sourceMissing: Record<string, string> = {};
	let breastShare: number | null = null;
	if (!stated?.heightMetres)
		sourceMissing.breastHeight = stated
			? 'the fact sheet states no height'
			: 'the reference folder has no FACTS.md, so no stated height places breast height';
	else {
		const height = (stated.heightMetres[0] + stated.heightMetres[1]) / 2;
		if (height < BREAST_METRES * BREAST_LEAST)
			sourceMissing.breastHeight = `the stated height, ${rounded(height, 2)} m, is under ${BREAST_LEAST} breast heights`;
		else breastShare = rounded(BREAST_METRES / height);
	}
	const whole = set.stills.filter(wholeView);
	const primarySlot = whole.find((slot) => slot.number === 1);
	const primaryMissing: Record<string, string> = {};
	const refused = unseparable(id);
	const still = primarySlot ? wholeStill(folder, primarySlot, breastShare, refused) : null;
	if (!still) primaryMissing.still = 'the folder has no picture 01 of the whole plant in use';
	const secondary = whole
		.filter((slot) => slot.number > 1 && slot.number <= HABIT_STILLS)
		.map((slot) => wholeStill(folder, slot, breastShare, refused));
	const others = whole
		.filter((slot) => slot.number > HABIT_STILLS)
		.map((slot) => wholeStill(folder, slot, breastShare, refused));
	const turns = set.turns.filter((video) => video.piece === 'whole');
	const video = turns.at(-1);
	let turn: TurnFigures | null = null;
	if (!video) primaryMissing.turn = 'the folder has no turning video of the whole plant in use';
	else if (refused.has(video.file)) primaryMissing.turn = NOT_SEPARABLE;
	else
		turn = measureTurn(
			video,
			breastShare,
			whole
				.filter((slot) => slot.number <= HABIT_STILLS && !refused.has(slot.file))
				.map((slot) => ({
					file: slot.file,
					image: readImage(join(folder, slot.file)),
					turn: slot.turn ?? 0,
				})),
		);
	const woodViews: WoodView[] = set.stills
		.filter(
			(slot) =>
				slot.kind === 'still' &&
				!wholeView(slot) &&
				(WOOD_STILLS.has(slot.number) || /winter|bare/.test(slot.name)),
		)
		.map((slot) => woodView(folder, slot, breastShare));
	const pieceStills: PieceStill[] = set.stills
		.filter((slot) => slot.kind === 'still' && PIECE_STILLS.has(slot.number) && !wholeView(slot))
		.map((slot): PieceStill => {
			const inPlace = slot.number < STUDIO_FROM;
			const season = slot.query?.season;
			const result = measurePiece(
				readImage(join(folder, slot.file)),
				inPlace,
				season !== 'autumn' && season !== 'blossom',
				slot.view !== 'cluster',
			);
			return 'figures' in result
				? { file: slot.file, view: slot.view, inPlace, figures: result.figures, missing: {} }
				: {
						file: slot.file,
						view: slot.view,
						inPlace,
						figures: null,
						missing: { figures: result.problem },
					};
		});
	const targets: SpeciesTargets = {
		schema: TARGETS_SCHEMA,
		species: id,
		source: {
			command: `bun run plants:targets ${id}`,
			references: set.slug,
			workWidth: WORK_WIDTH,
			lobeDepth: LOBE_DEPTH,
			holeClasses: HOLE_CLASSES,
			breastHeight: breastShare,
			missing: sourceMissing,
		},
		stated,
		whole: {
			primary: { still, turn, missing: primaryMissing },
			secondary,
			others,
			spread: spreadOf(still, turn, secondary),
		},
		wood: { views: woodViews },
		pieces: {
			stills: pieceStills,
			turns: set.turns
				.filter((piece) => piece.piece !== 'whole')
				.map((piece) => measurePieceTurn(piece)),
		},
		nulls: [],
		missing,
	};
	return { ...targets, nulls: nullsOf(targets) };
}

const species = positionals();
if (species.length === 0) {
	console.error(
		'Name one or more species: bun run plants:targets <species...> [--refs <folder or slug>] [--out <folder>]',
	);
	process.exit(2);
}
const refs = flag('refs') ? option('refs') : undefined;
if (refs && species.length > 1) throw new Error('--refs names the folder of a single species');
const out = flag('out') ? resolve(option('out')) : TARGETS;
mkdirSync(out, { recursive: true });
const fixed = (value: number | null | undefined, digits = 3): string =>
	typeof value === 'number' ? value.toFixed(digits) : 'null';
for (const id of species) {
	const folder = referenceFolder(refs ?? id);
	if (!existsSync(folder))
		throw new Error(
			`${folder} does not exist: name the folder with --refs, or the store with NULL3D_PLANT_REFERENCES`,
		);
	const targets = measureSpecies(id, readReferenceSet(folder));
	const path = join(out, `${id}.json`);
	writeFileSync(path, targetsText(targets));
	const first = targets.whole.primary.still?.figures;
	const turn = targets.whole.primary.turn;
	const aspect = targets.whole.spread.find((row) => row.figure === 'heightToWidth');
	console.log(`${id}:`);
	console.log(
		`  picture 01: height to width ${fixed(first?.heightToWidth)}, crown base ${fixed(first?.crown.base)}, stem width ${fixed(first?.trunk.width)}, lumps ${first?.lobes.count ?? 'null'}, enclosed gap ${fixed(first?.sky.enclosedGap)}`,
	);
	if (turn)
		console.log(
			`  ${turn.video}: ${turn.read} of ${turn.frames} frames read; height to width ${fixed(turn.stats.heightToWidth?.min)} to ${fixed(turn.stats.heightToWidth?.max)}, lumps ${turn.stats.lobes?.min ?? 'null'} to ${turn.stats.lobes?.max ?? 'null'}, enclosed gap ${fixed(turn.stats.enclosedGap?.min)} to ${fixed(turn.stats.enclosedGap?.max)}`,
		);
	console.log(
		`  secondary views: ${targets.whole.secondary.length}; height to width stands up to ${fixed(aspect?.largest)} of the primary's away`,
	);
	console.log(`  null figures: ${targets.nulls.length}`);
	console.log(`  wrote ${path}`);
}
