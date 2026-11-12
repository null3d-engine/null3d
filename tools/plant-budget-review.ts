// Draws the review page for the level triangle budget: each species at three budgets and the
// forest's near-band distances, beside its approved species picture. The page names the commit, the
// distances, the form and the tier, and it puts each species' silhouette divergence, and the extras
// the budget leaves out, beside the forms. The budget is the plant core's `budgets` option, which
// this draws through the same plant review sketch, browser and draw slot as `bun run plants:review`.
//
//   bun run plants:budget-review [--out <folder>] [--run <name>] [--refs <folder>]
//     [--gpu webgpu] [--no-slot]
//
// The dev server must serve this copy of the repository on the port that NULL3D_PORT names; one is
// started when none answers there. The approved pictures are each species' `01-whole-distant.png`
// under the reference root, which is NULL3D_PLANT_REFERENCES or the tree corpus.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writePng } from '../packages/cli/src/png.js';
import type { ShootRows } from '../packages/vegetation/src/asset.ts';
import { loadSpecies } from '../packages/vegetation/src/core/registry.ts';
import { buildKitNow, growPlantNow } from '../packages/vegetation/src/generate.ts';
import {
	plantSilhouette,
	type SilhouetteFrame,
	silhouetteIoU,
} from '../packages/vegetation/src/grow/envelope.ts';
import { cardKeep, cardRowTriangles } from '../packages/vegetation/src/lod/cards.ts';
import type { MeshInput } from '../packages/vegetation/src/stages.ts';
import { REPO_ROOT } from '../tests/lib/server.ts';
import type { PlantReviewQuery } from '../tests/pages/lib/plant-review/query.ts';
import { flag, option } from './lib/plant-review/cli.ts';
import {
	blank,
	drawText,
	fillBox,
	pasteFitted,
	type Rgba,
	readImage,
} from './lib/plant-review/image.ts';
import { drawShots, type RunFrame, singleShot } from './lib/plant-review/render.ts';
import { takeDrawSlot } from './lib/plant-review/slot.ts';

/** The species the forest draws through the add-on. */
const SPECIES = ['pedunculate-oak', 'european-beech', 'silver-birch', 'scots-pine'] as const;
/** The budgets the owner reviews. */
const BUDGETS = [30, 300, 1000] as const;
/**
 * The distances the page draws: the beech's closest whole view, which the forest's 50 degree field
 * of view fits its 21.5 m height at, then the near band's own ends.
 */
const DISTANCES = [23, 30, 70, 117] as const;
/** One render's size, in pixels: enough to read a 30-triangle crown's cards. */
const CELL = [360, 270] as const;
/** The forest's field of view, in degrees: a 20 m tree fits the frame at 30 m. */
const FOV = 50;
/** The tier the approved pictures are drawn at and the page uses. */
const PRESET = 'high';
/** The most of a level's budget the prototype spends on the extras, as a share. */
const EXTRAS_SHARE = 0.15;
/** The ink, dim and paper of a sheet. */
const INK = [235, 235, 235];
const DIM = [150, 150, 150];
const PAPER = [18, 18, 18];
const LABEL_WIDTH = 230;
const GAP = 8;

/** The commit the page draws. */
function commit(): string {
	return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
	}).trim();
}

/** The level a species draws at a distance, from its switch pixels: the pine's second card level
 * starts at 40.6 m, and the broadleaves' starts past their impostor, so they draw the first. */
function levelAt(species: string, distance: number): 1 | 2 {
	return species === 'scots-pine' && distance > 40.6 ? 2 : 1;
}

/** One level's plan: its cards, wood, extras and silhouette divergence. */
interface CardPlan {
	readonly kept: number;
	readonly of: number;
	readonly grow: number;
	readonly cards: number;
	readonly wood: number;
	readonly extras: number;
	/** The silhouette's intersection over union against the record form's near silhouette. */
	readonly divergence: number;
}

/** The kit and the two forms of one species, grown once for its budgets. */
interface Forms {
	readonly kit: ReturnType<typeof buildKitNow>;
	readonly sparse: ReturnType<typeof growPlantNow>;
	readonly record: ReturnType<typeof growPlantNow>;
}

const FORMS = new Map<string, Forms>();

/** The kit, the sparse form and the record form of a species, grown once. */
async function formsOf(species: string): Promise<Forms> {
	const known = FORMS.get(species);
	if (known) return known;
	const module = await loadSpecies(species as Parameters<typeof loadSpecies>[0]);
	const kit = buildKitNow(module, { placeholders: 'missing', detail: PRESET });
	const forms = {
		kit,
		sparse: growPlantNow(kit, { seed: 11, variant: 0, sparse: 1 }),
		record: growPlantNow(kit, { seed: 11, variant: 0 }),
	};
	FORMS.set(species, forms);
	return forms;
}

/** The level's own rows, sorted in their space-filling order. */
function levelRows(rows: ShootRows, level: 1 | 2): number[] {
	const own: number[] = [];
	for (let r = 0; r < rows.count; r++)
		if (cardKeep(rows.order[r] as number, level) > 0) own.push(r);
	return own.sort((a, b) => (rows.order[a] as number) - (rows.order[b] as number));
}

/** The rows kept at a budget, each grown to hold the level's cover. */
function thinnedRows(
	rows: ShootRows,
	own: readonly number[],
	kept: number,
	grow: number,
): ShootRows {
	const take = own.slice(0, Math.max(1, kept));
	const out = {
		count: take.length,
		prototype: new Uint8Array(take.length),
		position: new Float32Array(take.length * 3),
		rotation: new Float32Array(take.length * 4),
		scale: new Float32Array(take.length),
		record: new Uint16Array(take.length),
		phase: new Uint8Array(take.length),
		sky: new Uint8Array(take.length),
		bent: new Uint8Array(take.length),
		order: new Uint32Array(take.length),
	} as ShootRows;
	take.forEach((r, i) => {
		out.prototype[i] = rows.prototype[r] as number;
		out.position.set(rows.position.subarray(r * 3, r * 3 + 3), i * 3);
		out.rotation.set(rows.rotation.subarray(r * 4, r * 4 + 4), i * 4);
		out.scale[i] = (rows.scale[r] as number) * grow;
		out.order[i] = rows.order[r] as number;
	});
	return out;
}

/** A frame wide and tall enough for a plant of a height and a reach, at 32 cells. */
function frameOf(height: number, reach: number): SilhouetteFrame {
	const cell = height / 32;
	return {
		left: -reach,
		cell,
		cols: Math.ceil((2 * reach) / cell),
		rows: Math.ceil((height * 1.1) / cell),
	};
}

/** The mean silhouette divergence of a budgeted level against the record form's near form. */
function divergenceOf(
	forms: Forms,
	sparseRows: ShootRows,
	level: 1 | 2,
	kept: number,
	grow: number,
): number {
	try {
		const height = Math.max(forms.record.skeleton.height, 0.001);
		const { min, max } = forms.record.skeleton.bounds;
		const reach =
			Math.max(
				Math.abs(min[0] as number),
				Math.abs(max[0] as number),
				Math.abs(min[2] as number),
				Math.abs(max[2] as number),
				height * 0.1,
			) * 1.25;
		const frame = frameOf(height, reach);
		const lengths = forms.kit.prototypes.map((prototype) => prototype.length);
		const own = levelRows(sparseRows, level);
		const budgeted = thinnedRows(sparseRows, own, kept, grow);
		let sum = 0;
		let turns = 0;
		for (let k = 0; k < 8; k++) {
			const turn = (k * Math.PI) / 4;
			const record = plantSilhouette(
				forms.record.skeleton,
				forms.record.shoots,
				lengths,
				turn,
				frame,
			);
			const budget = plantSilhouette(forms.sparse.skeleton, budgeted, lengths, turn, frame);
			sum += silhouetteIoU(budget, record);
			turns++;
		}
		return sum / Math.max(1, turns);
	} catch {
		return 0;
	}
}

/** The grown plan of one species at one budget, for the labels. */
async function plans(
	species: string,
	budget: number,
	extrasShare?: number,
): Promise<CardPlan[] | undefined> {
	try {
		const forms = await formsOf(species);
		const { kit } = forms;
		const asset = growPlantNow(kit, {
			seed: 11,
			variant: 0,
			sparse: 1,
			budgets: [0, budget, budget],
			...(extrasShare !== undefined && { extrasShare }),
		});
		const input = {
			record: kit.record,
			seed: 11,
			variant: 0,
			season: 'summer',
			kit,
			skeleton: asset.skeleton,
			coarseness: asset.coarseness,
			rows: asset.shoots,
			detail: PRESET,
			budgets: [0, budget, budget],
			...(extrasShare !== undefined && { extrasShare }),
		} as unknown as MeshInput;
		return [1, 2].map((level) => {
			const perRow = cardRowTriangles(input, 0);
			const own = levelRows(asset.shoots, level as 1 | 2).length;
			const parts = asset.levels[level as 1 | 2].parts;
			const sum = (name: string) =>
				parts
					.filter((part) => part.name === name)
					.reduce((total, part) => total + part.arrays.indices.length / 3, 0);
			const cards = sum('cards');
			const kept = Math.max(1, Math.round(cards / perRow));
			const grow = (level === 2 ? Math.SQRT2 : 1) * Math.sqrt(own / kept);
			// The unbudgeted sparse form holds every extra the level can draw.
			const extras = (forms.sparse.levels[level as 1 | 2].parts ?? [])
				.filter((part) => part.name === 'extras')
				.reduce((total, part) => total + part.arrays.indices.length / 3, 0);
			return {
				kept,
				of: own,
				grow,
				cards,
				wood: sum('wood'),
				extras,
				divergence: divergenceOf(forms, asset.shoots, level as 1 | 2, kept, grow),
			};
		});
	} catch {
		return undefined;
	}
}

/** A label line, split to a sheet's width. */
function lines(text: string, width: number, scale: number): string[] {
	const perLine = Math.max(8, Math.floor(width / (6 * scale)));
	const words = text.split(' ');
	const out: string[] = [];
	let line = '';
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (next.length > perLine && line) {
			out.push(line);
			line = word;
		} else line = next;
	}
	if (line) out.push(line);
	return out;
}

/** The title block. */
function title(page: Rgba, sha: string): number {
	const rows = [
		`BUDGET REVIEW   COMMIT ${sha}`,
		`DISTANCES ${DISTANCES.join(', ')} M   SPARSE FORM   TIER ${PRESET.toUpperCase()}`,
	];
	for (const [k, line] of rows.entries()) drawText(page, line, GAP, 12 + k * 24, 3, INK);
	drawText(
		page,
		'CLOSEST WHOLE VIEW 23 M (BEECH 21.5 M AT 50 DEG)   DIVERGENCE = SILHOUETTE IOU VS APPROVED',
		GAP,
		64,
		2,
		DIM,
	);
	return 96;
}

/** The note on the extras: their cost, and the budget their share would need. */
function extrasNote(plans: readonly CardPlan[] | undefined): string {
	if (!plans) return 'EXTRAS -';
	const notes: string[] = [];
	for (const [k, plan] of plans.entries())
		if (plan.extras > 0) {
			const needed = Math.ceil(plan.extras / EXTRAS_SHARE);
			notes.push(
				`L${k + 1} EXTRAS ${plan.extras} BY VISIBLE SHARE: DROPPED HERE, MIN SHARE NEEDS ${needed}`,
			);
		}
	if (notes.length === 0) return 'EXTRAS 0';
	return notes.join('   ');
}

/** The cell label for one render. */
function cellLabel(
	budget: number,
	distance: number,
	plan: CardPlan | undefined,
	triangles: number | undefined,
	level: 1 | 2,
): string[] {
	const parts = plan ? `WOOD ${plan.wood} CARDS ${plan.cards}` : 'WOOD - CARDS -';
	const growth = plan ? `CARDS ${plan.kept}/${plan.of} GROWN ${plan.grow.toFixed(1)}X` : 'CARDS -';
	const drawn = triangles === undefined ? 'NOT DRAWN' : `DRAWN ${triangles}`;
	const divergence = plan ? `DIVERGENCE ${plan.divergence.toFixed(2)}` : 'DIVERGENCE -';
	const extras = plan
		? plan.extras > 0
			? `EXTRAS DROPPED ${plan.extras}`
			: 'NO EXTRAS'
		: 'EXTRAS -';
	return [
		`${budget} TRIANGLES AT ${distance} M`,
		`LEVEL ${level}   ${drawn}   ${divergence}`,
		`${parts}   ${growth}`,
		extras,
	];
}

async function main(): Promise<void> {
	const sha = commit();
	const run = option('run', `${sha}`);
	const out = option(
		'out',
		join(REPO_ROOT, '.internal/coordination/tree-renders', `budget-${run}`),
	);
	const refs = option(
		'refs',
		process.env.NULL3D_PLANT_REFERENCES ??
			join(REPO_ROOT, '.internal/coordination/tree-corpus/generated'),
	);
	const gpu = option('gpu', 'webgpu');
	mkdirSync(out, { recursive: true });
	const release = await takeDrawSlot(flag('no-slot'));
	try {
		// The plans of each species and budget, for the labels and the extras cells.
		const grown = new Map<string, CardPlan[] | undefined>();
		for (const species of SPECIES)
			for (const budget of BUDGETS) grown.set(`${species}:${budget}`, await plans(species, budget));
		// The extras cells: the birch and the pine at the closest view, the extras given a share that
		// holds them beside the same budget without them.
		const withBudget = new Map<string, number>();
		for (const species of ['silver-birch', 'scots-pine'] as const) {
			const cost = grown.get(`${species}:${BUDGETS[1]}`)?.[0]?.extras ?? 0;
			if (cost <= 0) continue;
			const budget = cost + BUDGETS[1];
			withBudget.set(species, budget);
			grown.set(`${species}:with`, await plans(species, budget, 1));
		}

		// The shots, one page each: the species, the budget and the distance.
		const shots = SPECIES.flatMap((species) =>
			BUDGETS.flatMap((budget) =>
				DISTANCES.map((distance) => {
					const level = levelAt(species, distance);
					const query: PlantReviewQuery = {
						species,
						view: 'whole',
						distance,
						fov: FOV,
						lod: level,
						budgets: [0, budget, budget],
						sparse: 1,
						seed: 11,
						variant: 0,
						preset: PRESET as PlantReviewQuery['preset'],
						size: [CELL[0], CELL[1]],
					};
					return singleShot(
						`budget-${species}`,
						`${budget}-${distance}.png`,
						query,
						CELL,
						false,
						undefined,
						1,
					);
				}),
			),
		);
		// The beech's closest view: its base at the first card level, where a trunk the outline hides
		// at a distance shows.
		const baseShot = (budget: number) =>
			singleShot(
				'budget-european-beech',
				`base-${budget}.png`,
				{
					species: 'european-beech',
					view: 'bark-base',
					lod: 1,
					budgets: [0, budget, budget],
					sparse: 1,
					seed: 11,
					variant: 0,
					preset: PRESET as PlantReviewQuery['preset'],
					size: [CELL[0], CELL[1]],
				},
				CELL,
				false,
				undefined,
				1,
			);
		const beechBases = BUDGETS.map(baseShot);
		shots.push(...beechBases);
		for (const species of ['silver-birch', 'scots-pine'] as const) {
			const budget = withBudget.get(species);
			if (budget === undefined) continue;
			shots.push(
				singleShot(
					`budget-${species}`,
					`extras-with-${budget}.png`,
					{
						species,
						view: 'whole',
						distance: DISTANCES[0],
						fov: FOV,
						lod: 1,
						budgets: [0, budget, budget],
						extrasShare: 1,
						sparse: 1,
						seed: 11,
						variant: 0,
						preset: PRESET as PlantReviewQuery['preset'],
						size: [CELL[0], CELL[1]],
					},
					CELL,
					false,
					undefined,
					1,
				),
			);
		}
		console.log(`drawing ${shots.length} cells for ${SPECIES.length} species at commit ${sha}`);
		const frames = await drawShots(out, shots, { gpu });
		const byFile = new Map(frames.map((frame) => [frame.file, frame]));
		const readings: Record<string, unknown>[] = [];
		const sheets: string[] = [];

		const renderOf = (species: string, budget: number, distance: number): Rgba | undefined => {
			const file = join(`budget-${species}`, `${budget}-${distance}.png`);
			return existsSync(join(out, file)) ? readImage(join(out, file)) : undefined;
		};
		const frameOf = (species: string, budget: number, distance: number) =>
			byFile.get(join(`budget-${species}`, `${budget}-${distance}.png`));
		const trianglesOf = (frame: RunFrame | undefined, level: number): number | undefined => {
			const facts = frame?.facts as { triangles?: number[] } | undefined;
			return facts?.triangles?.[level];
		};
		const approvedOf = (species: string): Rgba | undefined => {
			const file = join(refs, species, '01-whole-distant.png');
			return existsSync(file) ? readImage(file) : undefined;
		};

		// The summary page: each species beside its approved picture and the three budgets at the
		// closest whole view.
		{
			const cellW = 300;
			const cellH = 240;
			const rowH = cellH + 46;
			const pageW = LABEL_WIDTH + GAP + 4 * (cellW + GAP);
			const page = blank(pageW, 96 + SPECIES.length * rowH + GAP, PAPER);
			title(page, sha);
			const heads = [
				'APPROVED PICTURE',
				...BUDGETS.map((budget) => `${budget} TRI AT ${DISTANCES[0]} M`),
			];
			for (const [c, head] of heads.entries()) {
				drawText(page, head, LABEL_WIDTH + GAP + c * (cellW + GAP), 78, 2, DIM);
			}
			SPECIES.forEach((species, r) => {
				const y = 96 + r * rowH;
				drawText(page, species.toUpperCase(), GAP, y + 4, 2, INK);
				const divs = BUDGETS.map(
					(budget) => grown.get(`${species}:${budget}`)?.[0]?.divergence,
				).map((v) => (v === undefined ? '-' : v.toFixed(2)));
				lines(`DIVERGENCE ${divs.join(' / ')}`, LABEL_WIDTH - GAP, 1).forEach((line, k) => {
					drawText(page, line, GAP, y + 24 + k * 12, 1, DIM);
				});
				const cells = [
					approvedOf(species),
					renderOf(species, BUDGETS[0], DISTANCES[0]),
					renderOf(species, BUDGETS[1], DISTANCES[0]),
					renderOf(species, BUDGETS[2], DISTANCES[0]),
				];
				cells.forEach((image, c) => {
					const x = LABEL_WIDTH + GAP + c * (cellW + GAP);
					if (image) pasteFitted(page, image, x, y, cellW, cellH);
					else {
						fillBox(page, x, y, cellW, cellH, [34, 34, 34]);
						drawText(page, 'NONE', x + 10, y + 10, 2, DIM);
					}
				});
			});
			writePng(join(out, 'summary.png'), page);
			sheets.push('summary.png');
		}

		// One detail page for each species: the approved picture and the grid of budgets by
		// distances. The beech also has its base drawn at the closest view.
		for (const species of SPECIES) {
			const approvedW = 330;
			const pageW = approvedW + GAP + 3 * (CELL[0] + GAP);
			const tailRow = species === 'european-beech' || withBudget.has(species) ? CELL[1] + 56 : 0;
			const pageH = 100 + DISTANCES.length * (CELL[1] + 56) + tailRow + GAP;
			const page = blank(pageW, pageH, PAPER);
			title(page, sha);
			drawText(page, species.toUpperCase(), GAP, 80, 2, INK);
			lines(extrasNote(grown.get(`${species}:${BUDGETS[0]}`)), approvedW, 1).forEach((line, k) => {
				drawText(page, line, GAP, 96 + k * 12, 1, DIM);
			});
			const approved = approvedOf(species);
			if (approved) pasteFitted(page, approved, GAP, 128, approvedW, pageH - 128 - GAP);
			else {
				fillBox(page, GAP, 128, approvedW, pageH - 128 - GAP, [34, 34, 34]);
				drawText(page, 'NO APPROVED PICTURE', GAP + 8, 144, 2, DIM);
			}
			for (const [c, budget] of BUDGETS.entries()) {
				drawText(
					page,
					`${budget} TRIANGLES`,
					GAP + approvedW + GAP + c * (CELL[0] + GAP),
					80,
					2,
					DIM,
				);
			}
			BUDGETS.forEach((budget, c) => {
				DISTANCES.forEach((distance, r) => {
					const x = GAP + approvedW + GAP + c * (CELL[0] + GAP);
					const y = 100 + r * (CELL[1] + 56);
					const image = renderOf(species, budget, distance);
					if (image) pasteFitted(page, image, x, y, CELL[0], CELL[1]);
					else fillBox(page, x, y, CELL[0], CELL[1], [34, 34, 34]);
					const level = levelAt(species, distance);
					const plan = grown.get(`${species}:${budget}`)?.[level - 1];
					const frame = frameOf(species, budget, distance);
					const label = cellLabel(budget, distance, plan, trianglesOf(frame, level), level);
					lines(label.join(' | '), CELL[0], 1).forEach((line, k) => {
						drawText(page, line, x, y + CELL[1] + 4 + k * 12, 1, k === 0 ? INK : DIM);
					});
					readings.push({
						species,
						budget,
						distance,
						level,
						triangles: trianglesOf(frame, level),
						plan,
						query: frame?.query,
						error: frame?.error,
					});
				});
			});
			if (species === 'european-beech') {
				const y = 100 + DISTANCES.length * (CELL[1] + 56) + 8;
				drawText(
					page,
					'BEECH BASE AT THE CLOSEST VIEW, LEVEL 1: THE TRUNK THE WHOLE OUTLINE HIDES',
					GAP + approvedW + GAP,
					y,
					2,
					INK,
				);
				BUDGETS.forEach((budget, c) => {
					const x = GAP + approvedW + GAP + c * (CELL[0] + GAP);
					const file = join('budget-european-beech', `base-${budget}.png`);
					const image = existsSync(join(out, file)) ? readImage(join(out, file)) : undefined;
					if (image) pasteFitted(page, image, x, y + 18, CELL[0], CELL[1]);
					else fillBox(page, x, y + 18, CELL[0], CELL[1], [34, 34, 34]);
					const plan = grown.get(`european-beech:${budget}`)?.[0];
					drawText(
						page,
						`${budget} TRIANGLES   WOOD ${plan?.wood ?? '-'}   DIVERGENCE ${plan?.divergence.toFixed(2) ?? '-'}`,
						x,
						y + 18 + CELL[1] + 4,
						1,
						INK,
					);
				});
			}
			if (withBudget.has(species)) {
				const y = 100 + DISTANCES.length * (CELL[1] + 56) + 8;
				drawText(
					page,
					'EXTRAS: WITH AND WITHOUT THEM AT THE CLOSEST VIEW 23 M',
					GAP + approvedW + GAP,
					y,
					2,
					INK,
				);
				const withValue = withBudget.get(species) as number;
				const withoutPlan = grown.get(`${species}:${BUDGETS[1]}`)?.[0];
				const withPlan = grown.get(`${species}:with`)?.[0];
				const withFile = join(`budget-${species}`, `extras-with-${withValue}.png`);
				const cells = [
					{
						image: renderOf(species, BUDGETS[1], DISTANCES[0]),
						label: `WITHOUT EXTRAS: ${BUDGETS[1]} TRIANGLES, EXTRAS DROPPED ${withoutPlan?.extras ?? '-'}`,
						plan: withoutPlan,
					},
					{
						image: existsSync(join(out, withFile)) ? readImage(join(out, withFile)) : undefined,
						label: `WITH EXTRAS: ${withValue} TRIANGLES, ${withPlan?.cards ?? '-'} CARDS + ${withPlan?.extras ?? '-'} EXTRAS`,
						plan: withPlan,
					},
				];
				cells.forEach((cell, c) => {
					const x = GAP + approvedW + GAP + c * (CELL[0] + GAP);
					if (cell.image) pasteFitted(page, cell.image, x, y + 18, CELL[0], CELL[1]);
					else fillBox(page, x, y + 18, CELL[0], CELL[1], [34, 34, 34]);
					lines(cell.label, CELL[0], 1).forEach((line, k) => {
						drawText(page, line, x, y + 18 + CELL[1] + 4 + k * 12, 1, INK);
					});
					readings.push({
						species,
						extras: c === 0 ? 'without' : 'with',
						budget: withValue,
						plan: cell.plan,
					});
				});
			}
			const name = `sheet-${species}.png`;
			writePng(join(out, name), page);
			sheets.push(name);
		}

		writeFileSync(
			join(out, 'manifest.json'),
			`${JSON.stringify(
				{
					commit: sha,
					distances: DISTANCES,
					budgets: BUDGETS,
					preset: PRESET,
					fov: FOV,
					cell: CELL,
					extrasShare: EXTRAS_SHARE,
					extrasBudgets: Object.fromEntries(withBudget),
					species: SPECIES,
					sheets,
					readings,
				},
				null,
				'\t',
			)}\n`,
		);
		console.log(`commit ${sha}`);
		console.log(`distances ${DISTANCES.join(', ')} m`);
		for (const sheet of sheets) console.log(join(out, sheet));
	} finally {
		release();
	}
}

await main();
