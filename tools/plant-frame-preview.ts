// Draws a species' directed frame on the CPU beside its whole-plant reference pictures and beside
// the skeleton its registered record grows, each from the camera its picture asks for. A species
// has a directed frame when its folder holds a `directed.ts` that exports a `directed` record, which
// grows by the conifer schedule, or a `frame`, which is a tree of axis rules. The frame's wood is
// drawn by order, and each foliage patch as two rings of marks: its top and its underside.
//
//   bun --conditions=null3d-source tools/plant-frame-preview.ts <species> [--seed <n>]
//     [--variant <n>] [--refs <folder>] [--out <dir>] [--name <prefix>] [--also <n,n>]
//
// The sheet shows the whole-plant stills numbered up to 18. `--also` names further whole-plant
// stills by number, for a species whose primary plant stands in a later one.
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
import { growConifer, planConifer } from '../packages/vegetation/src/grow/conifer.ts';
import { type FrameSpec, frameSkeleton, planFrame } from '../packages/vegetation/src/grow/frame.ts';
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
const also = new Set(
	option('also', '')
		.split(',')
		.filter((word) => word !== '')
		.map(Number),
);

const directedPath = join(REPO_ROOT, 'packages/vegetation/src/species', species, 'directed.ts');
if (!existsSync(directedPath)) {
	console.error(`${species} has no directed frame: ${directedPath} is missing`);
	process.exit(2);
}
const stated = (await import(directedPath)) as {
	readonly directed?: Species;
	readonly frame?: FrameSpec;
};
if (!stated.frame && stated.directed?.growth.model !== 'conifer') {
	console.error(
		`${species}'s directed.ts exports neither a frame nor a record that grows by the conifer schedule`,
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

/** A foliage patch as the sheet rings it. */
interface Ringed {
	readonly centre: readonly [number, number, number];
	readonly width: number;
	readonly depth: number;
}

/** A directed frame as the sheet draws it, whichever planner made it. */
interface Drawn {
	/** The plant's height in metres. */
	readonly height: number;
	readonly skeleton: MacroSkeleton;
	readonly patches: readonly Ringed[];
	/** The trunk's radius at a person's eye height, in metres. */
	readonly eyeRadius: number;
	/** The frame's figures for the sheet's record, and one line that sums it up. */
	readonly figures: Record<string, unknown>;
	readonly summary: string;
}

/** The marks of every patch: a ring round its top and a ring round its underside. */
function patchMarks(patches: readonly Ringed[]): Float32Array {
	const marks = new Float32Array(patches.length * RING * 2 * 3);
	let at = 0;
	for (const patch of patches)
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
function skeletonPicture(
	camera: PreviewCamera,
	skeleton: MacroSkeleton,
	patches?: readonly Ringed[],
): Rgba {
	const big = {
		...camera,
		width: camera.width * FACTOR,
		height: camera.height * FACTOR,
		focal: camera.focal * FACTOR,
		scale: camera.scale * FACTOR,
	};
	const drawing = canvas(big.width, big.height);
	drawWood(drawing, big, skeleton, { least: FACTOR, tone: (order) => order });
	if (patches) drawMarks(drawing, big, patchMarks(patches), 1, 0);
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
const kit = buildKitNow(module, { detail: 'high', placeholders: 'missing' });
const grown = growPlantNow(kit, { seed, variant, season: kit.record.seasons.default, near: true });

/** A share of the plant's height, to four places. */
const share = (metres: number, height: number): number => Number((metres / height).toFixed(4));

/** A frame that a tree of axis rules states, planned on the registered record's size and seed. */
function ruleFrame(spec: FrameSpec): Drawn {
	const plan = planFrame(spec, {
		record: module.record,
		seed,
		variant,
		season: module.record.seasons.default,
	});
	const skeleton = frameSkeleton(plan);
	const H = plan.height;
	const stem = plan.axes[0];
	const byRule = new Map<string, number>();
	for (const axis of plan.axes) byRule.set(axis.rule, (byRule.get(axis.rule) ?? 0) + 1);
	const counts = [...byRule].map(([rule, count]) => `${count} ${rule}`).join(', ');
	return {
		height: H,
		skeleton,
		patches: plan.patches,
		eyeRadius: stem?.nodes.find((node) => node.y >= BELOW.eye)?.radius ?? 0.5,
		figures: {
			height: Number(H.toFixed(3)),
			crownBase: share(plan.crownBase, H),
			nodes: skeleton.nodeCount,
			axes: skeleton.axes.count,
			patches: plan.patches.length,
			axesByRule: Object.fromEntries(byRule),
			firstOrder: plan.axes
				.filter((axis) => axis.order === 1)
				.map((axis) => {
					const end = axis.nodes[axis.nodes.length - 1];
					const from = plan.axes[axis.parent]?.nodes[axis.parentNode];
					return {
						rule: axis.rule,
						index: axis.index,
						azimuth: Number((((axis.azimuth % 360) + 360) % 360).toFixed(1)),
						leaves: share(from?.y ?? 0, H),
						length: share(axis.length, H),
						reach: share(Math.hypot(end?.x ?? 0, end?.z ?? 0), H),
						ends: share(end?.y ?? 0, H),
					};
				}),
		},
		summary: `directed frame ${H.toFixed(2)} m tall, ${counts}, ${plan.patches.length} patches, ${skeleton.nodeCount} nodes`,
	};
}

/** A frame that the conifer schedule grows from a directed record. */
async function coniferFrame(directed: Species): Promise<Drawn> {
	await loadPlantCode(directed);
	const input = { record: directed, seed, variant, season: directed.seasons.default } as const;
	const plan = planConifer(input);
	const skeleton = growConifer(input);
	const H = plan.height;
	const topLimbs = plan.limbs.filter((limb) => limb.top).length;
	return {
		height: H,
		skeleton,
		patches: plan.limbs.map((limb) => limb.patch),
		eyeRadius: plan.trunk.find((node) => node.y >= BELOW.eye)?.radius ?? 0.5,
		figures: {
			height: Number(H.toFixed(3)),
			crownBase: share(plan.crownBase, H),
			trunkNodes: plan.trunk.length,
			limbsPerLevel: plan.perLevel,
			topLimbs,
			nodes: skeleton.nodeCount,
			axes: skeleton.axes.count,
			limbs: plan.limbs.map((limb) => ({
				level: limb.level,
				slot: limb.slot,
				azimuth: Number((((limb.azimuth % 360) + 360) % 360).toFixed(1)),
				place: Number(limb.place.toFixed(3)),
				reach: share(limb.reach, H),
				leaves: share(plan.trunk[limb.trunkNode]?.y ?? 0, H),
				patchWidth: share(limb.patch.width, H),
				patchDepth: share(limb.patch.depth, H),
			})),
		},
		summary: `directed frame ${H.toFixed(2)} m tall, ${plan.limbs.length} limbs (${plan.perLevel.join(', ')} by level and ${topLimbs} at the top), ${skeleton.nodeCount} nodes`,
	};
}

const drawn = stated.frame
	? ruleFrame(stated.frame)
	: await coniferFrame(stated.directed as Species);

const strips: Rgba[] = [];
if (existsSync(folder)) {
	const stills = readReferenceSet(folder).stills;
	for (const still of stills) {
		const whole = still.framed && (still.view === 'whole' || still.view === 'silhouette');
		const shown = still.number <= 18 || also.has(still.number);
		if (!shown || !(whole || still.view === 'below')) continue;
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
						caption: 'directed frame, with each foliage patch ringed',
						picture: skeletonPicture(camera(drawn.height), drawn.skeleton, drawn.patches),
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
				BELOW.radii * drawn.eyeRadius,
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
						caption: 'directed frame, with each foliage patch ringed',
						picture: skeletonPicture(camera, drawn.skeleton, drawn.patches),
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
const figures = { species, seed, variant, commit, dirty, ...drawn.figures };
writeFileSync(join(out, `${prefix}-frame.json`), `${JSON.stringify(figures, null, '\t')}\n`);
console.log(
	`${species} seed ${seed} variant ${variant} at ${commit.slice(0, 9)}${dirty ? ' with changes' : ''}: ${drawn.summary}; the registered record's skeleton holds ${grown.skeleton.nodeCount} nodes on ${grown.skeleton.axes.count} axes`,
);
