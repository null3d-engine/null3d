// Draws a species' directed frame on the CPU beside its whole-plant reference pictures and beside
// the skeleton its registered record grows, each from the camera its picture asks for. A species
// has a directed frame when its folder holds a `directed.ts` that exports a `directed` record. The
// frame's wood is drawn by order, and each limb's foliage patch as two rings of marks: its top and
// its underside.
//
//   bun --conditions=null3d-source tools/plant-frame-preview.ts <species> [--seed <n>]
//     [--variant <n>] [--refs <folder>] [--out <dir>] [--name <prefix>]
//
// The reference folder is `<id>` under the corpus that NULL3D_PLANT_REFERENCES names, or the folder
// `--refs` names. The sheet goes to `target/plant-preview/<species>/<prefix>-frame.png`, or into the
// folder `--out` names, with the frame's figures in `<prefix>-frame.json`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writePng } from '../packages/cli/src/png.js';
import type { MacroSkeleton } from '../packages/vegetation/src/core/graph.ts';
import type { Species } from '../packages/vegetation/src/core/record.ts';
import { isSpeciesId, loadSpecies, speciesIds } from '../packages/vegetation/src/core/registry.ts';
import { buildKitNow, growPlantNow, loadPlantCode } from '../packages/vegetation/src/generate.ts';
import {
	type ConiferPlan,
	growConifer,
	planConifer,
} from '../packages/vegetation/src/grow/conifer.ts';
import { REPO_ROOT } from '../tests/lib/server.ts';
import { type PreviewCamera, standingCamera, upwardCamera } from './lib/plant-preview/camera.ts';
import {
	canvas,
	drawMarks,
	drawWood,
	NATURAL,
	type Paint,
	painted,
} from './lib/plant-preview/draw.ts';
import { referenceView } from './lib/plant-preview/match.ts';
import { flag, option, positionals } from './lib/plant-review/cli.ts';
import {
	blank,
	drawText,
	paste,
	type Rgba,
	readImage,
	resizeToWidth,
} from './lib/plant-review/image.ts';
import { readReferenceSet } from './lib/plant-review/references.ts';

const REFERENCES =
	process.env.NULL3D_PLANT_REFERENCES ??
	join(REPO_ROOT, '.internal/coordination/tree-corpus/generated');
/** A panel's width in pixels, and the canvas pixels drawn for each of them. */
const PANEL = 640;
const FACTOR = 2;
/** Marks round each ring of a patch. */
const RING = 72;
/**
 * The camera that looks up the trunk from its foot: its distance from the trunk's line in trunk
 * radii at eye height, a person's eye height, degrees up and the field of view.
 */
const BELOW = { radii: 3.3, eye: 1.6, pitch: 66, fov: 76 } as const;

const [named] = positionals(new Set<string>());
if (!named || !isSpeciesId(named)) {
	console.error(
		`Name a species with a directed frame: bun --conditions=null3d-source tools/plant-frame-preview.ts <species> [--seed <n>] [--variant <n>] [--refs <folder>] [--out <dir>] [--name <prefix>]\n\nspecies: ${speciesIds().join(', ')}`,
	);
	process.exit(2);
}
const species = named;
const seed = Number(option('seed', '11'));
const variant = Number(option('variant', '0'));
const out = resolve(option('out', join(REPO_ROOT, 'target/plant-preview', species)));
const prefix = option('name', `${species}-s${seed}-v${variant}`);
const folder = flag('refs') ? resolve(option('refs')) : join(REFERENCES, species);

const directedPath = join(REPO_ROOT, 'packages/vegetation/src/species', species, 'directed.ts');
if (!existsSync(directedPath)) {
	console.error(`${species} has no directed frame: ${directedPath} is missing`);
	process.exit(2);
}
const directed = ((await import(directedPath)) as { readonly directed: Species }).directed;
if (directed.growth.model !== 'conifer') {
	console.error(
		`${species}'s directed frame grows by '${directed.growth.model}', which this tool does not draw`,
	);
	process.exit(2);
}

/** Wood by order: the stem dark, the limbs red-brown, finer orders their own colours. */
const ORDER_COLOURS: readonly (readonly [number, number, number])[] = [
	[30, 30, 30],
	[160, 60, 30],
	[214, 120, 20],
	[40, 130, 60],
];
const BY_ORDER: Paint = {
	sky: [255, 255, 255],
	wood: (tone) => ORDER_COLOURS[Math.min(ORDER_COLOURS.length - 1, tone)] ?? [0, 0, 0],
	leaf: NATURAL.leaf,
	mark: [40, 150, 70],
};

/** The marks of every patch: a ring round its top and a ring round its underside. */
function patchMarks(plan: ConiferPlan): Float32Array {
	const marks = new Float32Array(plan.limbs.length * RING * 2 * 3);
	let at = 0;
	for (const { patch } of plan.limbs)
		for (const lift of [0.5, -0.5])
			for (let k = 0; k < RING; k++) {
				const angle = (k / RING) * 2 * Math.PI;
				marks[at++] = patch.centre[0] + (Math.cos(angle) * patch.width) / 2;
				marks[at++] = patch.centre[1] + lift * patch.depth;
				marks[at++] = patch.centre[2] + (Math.sin(angle) * patch.width) / 2;
			}
	return marks;
}

/** One skeleton's picture from a camera, with its patches' rings where it has a plan. */
function skeletonPicture(camera: PreviewCamera, skeleton: MacroSkeleton, plan?: ConiferPlan): Rgba {
	const big = {
		...camera,
		width: camera.width * FACTOR,
		height: camera.height * FACTOR,
		focal: camera.focal * FACTOR,
		scale: camera.scale * FACTOR,
	};
	const drawing = canvas(big.width, big.height);
	drawWood(drawing, big, skeleton, { least: FACTOR, tone: (order) => order });
	if (plan) drawMarks(drawing, big, patchMarks(plan), 1, 0);
	return painted(drawing, FACTOR, BY_ORDER);
}

/** A row of pictures under a caption each, on one strip. */
function strip(panels: readonly { readonly caption: string; readonly picture: Rgba }[]): Rgba {
	const height = Math.max(...panels.map((panel) => panel.picture.height));
	const page = blank(panels.length * (PANEL + 6) + 6, height + 34, [40, 40, 40]);
	panels.forEach((panel, k) => {
		const x = 6 + k * (PANEL + 6);
		drawText(page, panel.caption, x, 8, 2, [235, 235, 235]);
		paste(page, panel.picture, x, 28);
	});
	return page;
}

/** The commit the frame was drawn at, and whether the tree had changes. */
function provenance(): { readonly commit: string; readonly dirty: boolean } {
	const run = (args: readonly string[]): string =>
		spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
	return { commit: run(['rev-parse', 'HEAD']), dirty: run(['status', '--porcelain']) !== '' };
}

const module = await loadSpecies(species);
await loadPlantCode(module.record);
await loadPlantCode(directed);
const kit = buildKitNow(module, { detail: 'high', placeholders: 'missing' });
const grown = growPlantNow(kit, { seed, variant, season: kit.record.seasons.default, near: true });
const input = { record: directed, seed, variant, season: directed.seasons.default } as const;
const plan = planConifer(input);
const frame = growConifer(input);

const strips: Rgba[] = [];
if (existsSync(folder)) {
	const stills = readReferenceSet(folder).stills;
	for (const still of stills) {
		const whole = still.framed && (still.view === 'whole' || still.view === 'silhouette');
		if (still.number > 18 || !(whole || still.view === 'below')) continue;
		const image = readImage(join(folder, still.file));
		const turn = still.turn ?? 0;
		if (whole) {
			const reference = referenceView(image);
			if (!reference) continue;
			// Both skeletons stand at the framing of the reference, each to its own height, so each
			// one's top and foot land on the reference's rows.
			const camera = (height: number) => standingCamera(reference.framing, height, turn, PANEL);
			strips.push(
				strip([
					{ caption: `${still.file} (turn ${turn})`, picture: resizeToWidth(image, PANEL) },
					{
						caption: 'directed frame, with each limb patch ringed',
						picture: skeletonPicture(camera(plan.height), frame, plan),
					},
					{
						caption: "the registered record's skeleton",
						picture: skeletonPicture(camera(grown.skeleton.height), grown.skeleton),
					},
				]),
			);
		} else {
			const reference = resizeToWidth(image, PANEL);
			const camera = upwardCamera(
				BELOW.radii * (plan.trunk.find((node) => node.y >= BELOW.eye)?.radius ?? 0.5),
				BELOW.eye,
				BELOW.pitch,
				BELOW.fov,
				PANEL,
				reference.height,
			);
			strips.push(
				strip([
					{ caption: `${still.file} (from the foot, looking up)`, picture: reference },
					{
						caption: 'directed frame, with each limb patch ringed',
						picture: skeletonPicture(camera, frame, plan),
					},
					{
						caption: "the registered record's skeleton",
						picture: skeletonPicture(camera, grown.skeleton),
					},
				]),
			);
		}
	}
} else console.log(`  no reference folder at ${folder}: name one with --refs`);

mkdirSync(out, { recursive: true });
const { commit, dirty } = provenance();
if (strips.length > 0) {
	const width = Math.max(...strips.map((picture) => picture.width));
	const page = blank(
		width,
		strips.reduce((sum, picture) => sum + picture.height + 6, 0),
		[40, 40, 40],
	);
	let y = 0;
	for (const picture of strips) {
		paste(page, picture, 0, y);
		y += picture.height + 6;
	}
	const path = join(out, `${prefix}-frame.png`);
	writePng(path, page);
	console.log(`  ${path}`);
}
const H = plan.height;
const figures = {
	species,
	seed,
	variant,
	commit,
	dirty,
	height: Number(H.toFixed(3)),
	crownBase: Number((plan.crownBase / H).toFixed(4)),
	trunkNodes: plan.trunk.length,
	limbsPerLevel: plan.perLevel,
	topLimbs: plan.limbs.filter((limb) => limb.top).length,
	nodes: frame.nodeCount,
	axes: frame.axes.count,
	limbs: plan.limbs.map((limb) => ({
		level: limb.level,
		slot: limb.slot,
		azimuth: Number((((limb.azimuth % 360) + 360) % 360).toFixed(1)),
		place: Number(limb.place.toFixed(3)),
		reach: Number((limb.reach / H).toFixed(4)),
		leaves: Number(((plan.trunk[limb.trunkNode]?.y ?? 0) / H).toFixed(4)),
		patchWidth: Number((limb.patch.width / H).toFixed(4)),
		patchDepth: Number((limb.patch.depth / H).toFixed(4)),
	})),
};
writeFileSync(join(out, `${prefix}-frame.json`), `${JSON.stringify(figures, null, '\t')}\n`);
console.log(
	`${species} seed ${seed} variant ${variant} at ${commit.slice(0, 9)}${dirty ? ' with changes' : ''}: directed frame ${H.toFixed(2)} m tall, ${plan.limbs.length} limbs (${plan.perLevel.join(', ')} by level and ${figures.topLimbs} at the top), ${frame.nodeCount} nodes; the registered record's skeleton holds ${grown.skeleton.nodeCount} nodes on ${grown.skeleton.axes.count} axes`,
);
