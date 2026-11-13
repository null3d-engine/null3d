// Draws a grown plant on the CPU, with no browser and no GPU, so a change to a grower or a record
// can be looked at in seconds: the skeleton alone from the front, the side, above and from a
// person's eye height under the crown; the plant with its foliage from the front and the side; and
// the plant's matte laid over each whole-plant reference picture at that picture's framing, with
// the review tool's sky gap and outline overlap beside it.
//
//   bun run plants:preview <species> [--seed <n>] [--variant <n>] [--form <name>] [--season <name>]
//     [--refs <folder or slug>] [--out <dir>] [--name <prefix>] [--no-match]
//
// A species' reference folder is `<id>` under the corpus that NULL3D_PLANT_REFERENCES names, or the
// repository's `.internal/coordination/tree-corpus/generated`; `--refs` names another. The pictures
// go to `target/plant-preview/<species>/`, or the folder `--out` names, as `<prefix>-skeleton.png`,
// `<prefix>-plant.png` and `<prefix>-match.png`, with every figure in `<prefix>.json`. The match
// compares the whole-plant stills the envelope fit reads, each at its own turn. The review's own
// run stays the judge of a species: this preview draws leaves and wood as flat shapes, not as the
// engine shades them.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { writePng } from '../packages/cli/src/png.js';
import type { PlantAsset, SpeciesKitData } from '../packages/vegetation/src/asset.ts';
import {
	isSpeciesId,
	loadSpecies,
	type SpeciesId,
	speciesIds,
} from '../packages/vegetation/src/core/registry.ts';
import type { Season } from '../packages/vegetation/src/core/types.ts';
import { buildKitNow, growPlantNow, loadPlantCode } from '../packages/vegetation/src/generate.ts';
import { REPO_ROOT } from '../tests/lib/server.ts';
import {
	type Bounds,
	flatCamera,
	type PreviewCamera,
	upwardCamera,
} from './lib/plant-preview/camera.ts';
import {
	canvas,
	drawLevelWood,
	drawMarks,
	drawShoots,
	drawWood,
	NATURAL,
	type Paint,
	painted,
} from './lib/plant-preview/draw.ts';
import {
	type MatchFigures,
	matchFigures,
	matchStrip,
	referenceView,
	renderView,
	stacked,
} from './lib/plant-preview/match.ts';
import { flag, option, positionals } from './lib/plant-review/cli.ts';
import { blank, drawText, paste, type Rgba, readImage } from './lib/plant-review/image.ts';
import { readReferenceSet } from './lib/plant-review/references.ts';

const REFERENCES =
	process.env.NULL3D_PLANT_REFERENCES ??
	join(REPO_ROOT, '.internal/coordination/tree-corpus/generated');
/** Pixels a side of one panel of the skeleton and plant sheets, and canvas pixels drawn per pixel. */
const PANEL = 900;
const FACTOR = 2;
/**
 * The camera under the crown: its distance from the stem as a share of the plant's height and the
 * least it stands off, a person's eye height, degrees up and field of view.
 */
const UNDER = { away: 0.3, least: 4, eye: 1.6, pitch: 50, fov: 78 } as const;

const [named] = positionals(new Set(['--no-match']));
if (!named || !isSpeciesId(named)) {
	console.error(
		`Name a species: bun run plants:preview <species> [--seed <n>] [--variant <n>] [--form <name>] [--refs <folder or slug>] [--out <dir>] [--name <prefix>] [--no-match]\n\nspecies: ${speciesIds().join(', ')}`,
	);
	process.exit(2);
}
const species: SpeciesId = named;
const seed = Number(option('seed', '11'));
const variant = Number(option('variant', '0'));
const form = flag('form') ? option('form') : undefined;
const out = resolve(option('out', join(REPO_ROOT, 'target/plant-preview', species)));
const prefix = option('name', `${species}-s${seed}-v${variant}${form ? `-${form}` : ''}`);

/** The commit the plant was grown at, and whether the tree had changes. */
function provenance(): { readonly commit: string; readonly dirty: boolean } {
	const run = (args: readonly string[]): string =>
		spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
	return { commit: run(['rev-parse', 'HEAD']), dirty: run(['status', '--porcelain']) !== '' };
}

/** The reference folder, or undefined when none is there. */
function referenceFolder(): string | undefined {
	const name = flag('refs') ? option('refs') : species;
	const folder = isAbsolute(name) || name.includes('/') ? resolve(name) : join(REFERENCES, name);
	return existsSync(folder) ? folder : undefined;
}

/** A skeleton's wood by order: the stem black, then each finer order its own colour. */
const ORDER_COLOURS: readonly (readonly [number, number, number])[] = [
	[20, 20, 20],
	[150, 40, 30],
	[214, 120, 20],
	[40, 130, 60],
	[40, 90, 190],
	[130, 60, 170],
];
const BY_ORDER: Paint = {
	sky: [255, 255, 255],
	wood: (tone) => ORDER_COLOURS[Math.min(ORDER_COLOURS.length - 1, tone)] ?? [0, 0, 0],
	leaf: NATURAL.leaf,
	mark: [235, 60, 200],
};

/** One panel: a camera's picture of the plant, with a caption. */
function panel(
	asset: PlantAsset,
	kit: SpeciesKitData | undefined,
	camera: PreviewCamera,
	caption: string,
): Rgba {
	const drawing = canvas(camera.width, camera.height);
	if (kit) {
		if (!drawLevelWood(drawing, camera, kit, asset, 0)) drawWood(drawing, camera, asset.skeleton);
		drawShoots(drawing, camera, kit, asset.shoots);
	} else {
		drawWood(drawing, camera, asset.skeleton, { least: FACTOR, tone: (order) => order });
		drawMarks(drawing, camera, asset.skeleton.buds.position, 1, 0);
	}
	const picture = painted(drawing, FACTOR, kit ? NATURAL : BY_ORDER);
	drawText(picture, caption, 8, 8, 2, [30, 30, 30]);
	return picture;
}

/** Four panels in a square. */
function sheet(panels: readonly Rgba[]): Rgba {
	const page = blank(PANEL * 2 + 4, PANEL * 2 + 4, [200, 200, 200]);
	panels.forEach((picture, k) => {
		paste(page, picture, (k % 2) * (PANEL + 4), Math.floor(k / 2) * (PANEL + 4));
	});
	return page;
}

const module = await loadSpecies(species);
await loadPlantCode(module.record);
const started = performance.now();
const kit = buildKitNow(module, {
	detail: 'high',
	placeholders: 'missing',
	...(form ? { form } : {}),
});
const season = (flag('season') ? option('season') : kit.record.seasons.default) as Season;
const asset = growPlantNow(kit, { seed, variant, season, near: true });
const grown = performance.now() - started;
const { skeleton } = asset;
const top = Math.max(skeleton.height, drawShoots(canvas(1, 1), undefined, kit, asset.shoots));
// The crown's reach from the plant's axis: the shoot rows stand past the wood that carries them.
let reach = Math.max(
	Math.abs(skeleton.bounds.min[0]),
	Math.abs(skeleton.bounds.max[0]),
	Math.abs(skeleton.bounds.min[2]),
	Math.abs(skeleton.bounds.max[2]),
);
for (let r = 0; r < asset.shoots.count; r++) {
	const length =
		(kit.prototypes[asset.shoots.prototype[r] as number]?.radius ?? 0) *
		(asset.shoots.scale[r] as number);
	reach = Math.max(
		reach,
		Math.abs(asset.shoots.position[r * 3] as number) + length,
		Math.abs(asset.shoots.position[r * 3 + 2] as number) + length,
	);
}
const bounds: Bounds = { min: [-reach, 0, -reach], max: [reach, top, reach] };
const size = PANEL * FACTOR;
const under = upwardCamera(
	Math.max(UNDER.least, top * UNDER.away),
	UNDER.eye,
	UNDER.pitch,
	UNDER.fov,
	size,
	size,
);
mkdirSync(out, { recursive: true });
const files: string[] = [];
const save = (name: string, picture: Rgba): void => {
	const path = join(out, `${prefix}-${name}.png`);
	writePng(path, picture);
	files.push(path);
};
save(
	'skeleton',
	sheet([
		panel(asset, undefined, flatCamera(bounds, 0, size, size), 'wood, front (turn 0)'),
		panel(asset, undefined, flatCamera(bounds, 90, size, size), 'wood, side (turn 90)'),
		panel(asset, undefined, flatCamera(bounds, 'above', size, size), 'wood, from above'),
		panel(asset, undefined, under, 'wood, from eye height under the crown'),
	]),
);
save(
	'plant',
	sheet([
		panel(asset, kit, flatCamera(bounds, 0, size, size), 'plant, front (turn 0)'),
		panel(asset, kit, flatCamera(bounds, 90, size, size), 'plant, side (turn 90)'),
		panel(asset, kit, flatCamera(bounds, 'above', size, size), 'plant, from above'),
		panel(asset, kit, under, 'plant, from eye height under the crown'),
	]),
);

const { axes } = skeleton;
const perOrder: number[] = [];
for (let a = 0; a < axes.count; a++) {
	const order = axes.order[a] as number;
	perOrder[order] = (perOrder[order] ?? 0) + 1;
}
const figures: Record<string, MatchFigures | undefined> = {};
const folder = flag('no-match') ? undefined : referenceFolder();
if (folder) {
	const strips: Rgba[] = [];
	const stills = readReferenceSet(folder).stills.filter(
		(still) =>
			still.framed && still.number <= 18 && (still.view === 'whole' || still.view === 'silhouette'),
	);
	for (const still of stills) {
		const reference = referenceView(readImage(join(folder, still.file)));
		if (!reference) {
			console.log(`  ${still.file}: no plant separates from its background`);
			continue;
		}
		const turn = still.turn ?? 0;
		const render = renderView(kit, asset, reference.framing, turn, 1, reference.widthShare);
		const match = matchFigures(reference, render);
		figures[still.file] = match;
		strips.push(matchStrip(`${still.file} at turn ${turn}`, reference, render, match));
		if (match)
			console.log(
				`  ${still.file} turn ${turn}: sky gap ${match.gap.render} against ${match.gap.reference} (${match.gap.inBand ? 'inside' : 'OUTSIDE'} the band), outline overlap ${match.shapeIou}, plant w/h ${match.plantAspect.render} against ${match.plantAspect.reference}`,
			);
	}
	if (strips.length > 0) save('match', stacked(strips));
} else if (!flag('no-match'))
	console.log('  no reference folder: name one with --refs to draw the match sheet');

const { commit, dirty } = provenance();
const summary = {
	species,
	form: form ?? null,
	seed,
	variant,
	season,
	commit,
	dirty,
	milliseconds: Math.round(grown),
	height: Number(top.toFixed(3)),
	skeletonHeight: Number(skeleton.height.toFixed(3)),
	crownBase: Number(skeleton.crownBase.toFixed(3)),
	nodes: skeleton.nodeCount,
	axes: axes.count,
	axesByOrder: perOrder.map((count) => count ?? 0),
	buds: skeleton.buds.count,
	rows: asset.shoots.count,
	triangles: asset.stats.triangles,
	match: figures,
};
writeFileSync(join(out, `${prefix}.json`), `${JSON.stringify(summary, null, '\t')}\n`);
console.log(
	`${species}${form ? ` (${form})` : ''} seed ${seed} variant ${variant} at ${commit.slice(0, 9)}${dirty ? ' with changes' : ''}: ${skeleton.nodeCount} nodes, ${axes.count} axes (${summary.axesByOrder.join(', ')} by order), ${skeleton.buds.count} bud sites, ${asset.shoots.count} shoot rows, ${top.toFixed(2)} m tall, kit and growth in ${Math.round(grown)} ms`,
);
for (const file of files) console.log(`  ${file}`);
