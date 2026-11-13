// Draws a species' branch pieces on the CPU beside the studio photographs of its cut wood, with no
// browser and no GPU. Each photograph the species lays out is drawn from its pieces: the cut's bare
// wood with a piece at each socket, or one piece alone. The sheet shows the photograph, the two
// outlines laid over one another and the drawing, with the review tool's outline overlap and the
// width over height of each.
//
//   bun run plants:piece <species> [--still <n,n>] [--refs <folder or slug>] [--out <dir>]
//     [--name <prefix>]
//
// A species' pieces and layouts are `PIECES` and `STUDIO` in its `pieces.ts`. Its reference folder
// is `<id>` under the corpus that NULL3D_PLANT_REFERENCES names, or the repository's
// `.internal/coordination/tree-corpus/generated`; `--refs` names another. The pictures go to
// `target/plant-piece/<species>/`, or the folder `--out` names, as `<prefix>-pieces.png`, with every
// figure in `<prefix>.json`. The review's own run stays the judge of a species: this preview draws
// leaves and wood as flat shapes, not as the engine shades them.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { writePng } from '../packages/cli/src/png.js';
import {
	isSpeciesId,
	loadSpecies,
	type SpeciesId,
	speciesIds,
} from '../packages/vegetation/src/core/registry.ts';
import { buildKitNow, buildPiecesNow, loadPlantCode } from '../packages/vegetation/src/generate.ts';
import {
	layStudio,
	type PieceRule,
	type PieceStudio,
} from '../packages/vegetation/src/leaf/piece.ts';
import { REPO_ROOT } from '../tests/lib/server.ts';
import { matchFigures, matchStrip, referenceView, stacked } from './lib/plant-preview/match.ts';
import { studioScene, studioView } from './lib/plant-preview/piece.ts';
import { flag, option, positionals } from './lib/plant-review/cli.ts';
import { type Rgba, readImage } from './lib/plant-review/image.ts';

const REFERENCES =
	process.env.NULL3D_PLANT_REFERENCES ??
	join(REPO_ROOT, '.internal/coordination/tree-corpus/generated');

const [named] = positionals(new Set());
if (!named || !isSpeciesId(named)) {
	console.error(
		`Name a species: bun run plants:piece <species> [--still <n,n>] [--refs <folder or slug>] [--out <dir>] [--name <prefix>]\n\nspecies: ${speciesIds().join(', ')}`,
	);
	process.exit(2);
}
const species: SpeciesId = named;
const out = resolve(option('out', join(REPO_ROOT, 'target/plant-piece', species)));
const prefix = option('name', species);
const only = flag('still') ? new Set(option('still').split(',').map(Number)) : undefined;

/** The commit the pieces were built at, and whether the tree had changes. */
function provenance(): { readonly commit: string; readonly dirty: boolean } {
	const run = (args: readonly string[]): string =>
		spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
	return { commit: run(['rev-parse', 'HEAD']), dirty: run(['status', '--porcelain']) !== '' };
}

const name = flag('refs') ? option('refs') : species;
const folder = isAbsolute(name) || name.includes('/') ? resolve(name) : join(REFERENCES, name);
if (!existsSync(folder)) {
	console.error(`No reference folder at ${folder}: name one with --refs.`);
	process.exit(2);
}

const source = join(REPO_ROOT, 'packages/vegetation/src/species', species, 'pieces.ts');
if (!existsSync(source)) {
	console.error(`${species} has no pieces yet: ${source} is missing.`);
	process.exit(2);
}
const { PIECES, STUDIO } = (await import(source)) as {
	PIECES: readonly PieceRule[];
	STUDIO: readonly PieceStudio[];
};
const module = await loadSpecies(species);
await loadPlantCode(module.record);
const started = performance.now();
const kit = buildKitNow(module, { detail: 'high', placeholders: 'missing' });
const pieces = buildPiecesNow(module, PIECES);
const built = performance.now() - started;

const strips: Rgba[] = [];
const figures: Record<string, unknown> = {};
for (const studio of STUDIO) {
	if (only && !only.has(studio.still)) continue;
	const lead = `${String(studio.still).padStart(2, '0')}-`;
	const file = readdirSync(folder).find(
		(entry) => entry.startsWith(lead) && entry.endsWith('.png'),
	);
	if (!file) {
		console.log(`  still ${studio.still}: no picture in ${folder}`);
		continue;
	}
	const reference = referenceView(readImage(join(folder, file)));
	if (!reference) {
		console.log(`  ${file}: no outline separates from its background`);
		continue;
	}
	const scene = studioScene(kit, pieces, layStudio(module.record, PIECES, studio));
	const render = studioView(scene, reference, studio.turn ?? 0);
	const match = matchFigures(reference, render);
	const title = `${file}: ${scene.pieces} x ${studio.piece}${studio.stand ? ' on its cut wood' : ' alone'}, ${scene.leaves} leaves, drawn ${render.wide.toFixed(2)} m wide and ${render.tall.toFixed(2)} m tall`;
	strips.push(matchStrip(title, reference, render, match));
	figures[file] = {
		pieces: scene.pieces,
		leaves: scene.leaves,
		wide: render.wide,
		tall: render.tall,
		match,
	};
	if (match)
		console.log(
			`  ${file}: ${scene.pieces} pieces, ${scene.leaves} leaves, outline overlap ${match.shapeIou} (as framed ${match.frameIou}), width over height ${match.plantAspect.render} against ${match.plantAspect.reference}, enclosed gap ${match.gap.render} against ${match.gap.reference}`,
		);
}
mkdirSync(out, { recursive: true });
const { commit, dirty } = provenance();
if (strips.length > 0) {
	const path = join(out, `${prefix}-pieces.png`);
	writePng(path, stacked(strips));
	console.log(`  ${path}`);
}
writeFileSync(
	join(out, `${prefix}.json`),
	`${JSON.stringify(
		{
			species,
			commit,
			dirty,
			milliseconds: Math.round(built),
			pieces: pieces.map((piece) => ({
				piece: piece.piece,
				variant: piece.variant,
				part: piece.part,
				parts: piece.parts,
				attitude: piece.attitude,
				leaves: piece.leaves,
				length: Number(piece.length.toFixed(3)),
				vertices: piece.tiers.map((tier) => tier.positions.length / 3),
			})),
			stills: figures,
		},
		null,
		'\t',
	)}\n`,
);
console.log(
	`${species} at ${commit.slice(0, 9)}${dirty ? ' with changes' : ''}: ${pieces.length} piece prototypes of ${PIECES.length} rules, built in ${Math.round(built)} ms`,
);
