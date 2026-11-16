// The figures a species' package reads: `fit.ts` in the species' folder, written by the fitting
// tool and kept in git, since the reference set it is measured from is private. It holds the
// envelope, the crown box's spread round the rubric's angles, the all-round band, the crown's
// aspect and base, how well the envelope matches its own views, and why the reference is poor to
// measure from where it is. A species' record takes `envelope` and `roundBand` from it.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../tests/lib/server.ts';
import type { TurnFit } from './turn.ts';

/** The species folders' parent, where each species' figures go. */
export const SPECIES_ROOT = join(REPO_ROOT, 'packages/vegetation/src/species');

/** The path of a species' figures. */
export function fitPath(species: string): string {
	return join(SPECIES_ROOT, species, 'fit.ts');
}

/** The band of the all-round test: the form's, or the reference's own spread where it is wider. */
export function roundBandOf(fit: TurnFit, formBand: number): number {
	const own = Math.max(fit.crownBox.spread.width, fit.crownBox.spread.height);
	return Math.ceil(Math.max(formBand, own) * 100) / 100;
}

/** The text of a species' figures module. */
export function fitModule(species: string, fit: TurnFit, formBand: number): string {
	const hull = fit.hull;
	const json = (value: unknown) => JSON.stringify(value);
	const lines = [
		'// biome-ignore-all lint/suspicious/noApproximativeNumericConstant: measured radii, not constants',
		`// The figures of \`${species}\`, measured from its reference turning video`,
		`// \`${fit.video}\`${fit.stills.length > 0 ? ' and its whole-plant stills' : ''}. Run \`bun run plants:fit ${species}\``,
		'// to measure them again rather than edit them.',
		"import type { RadialEnvelope } from '../../core/record';",
		'',
		'/**',
		` * The outline the plant fills: the visual hull of ${hull?.envelope.source.views ?? 0} views of the turning`,
		` * video and the whole-plant stills, as radii over the plant's height at 16 azimuths; \`source\``,
		' * names the stills and the turn each honours. Undefined when the views give none.',
		' */',
		`export const envelope: RadialEnvelope | undefined = ${hull ? json(hull.envelope) : 'undefined'};`,
		'',
		'/**',
		" * The reference's own crown box at the rubric's angles, as the review tool measures it: the",
		' * spread of its width and of its height, largest less smallest over their mean.',
		' */',
		`export const crownBox = ${json({ angles: fit.crownBox.angles, ...fit.crownBox.spread })} as const;`,
		'',
		"/** The all-round test's band: the form's, or the reference's own crown-box spread where wider. */",
		`export const roundBand = ${roundBandOf(fit, formBand)};`,
		'',
		"/** Crown width over plant height, and the crown's base as a share of the height, over the views. */",
		`export const aspect = ${hull ? hull.aspect : 'undefined'};`,
		`export const crownBase = ${hull ? hull.crownBase : 'undefined'};`,
		'',
		'/**',
		" * How far the envelope's outlines overlap the views it came from: the generated plant drifts",
		' * between views, so no one solid matches them all. Undefined without an envelope.',
		' */',
		`export const consistency = ${hull ? `${json({ lowest: hull.consistency.lowest, mean: hull.consistency.mean, highest: hull.consistency.highest })} as const` : 'undefined'};`,
		'',
		'/** Why the reference is poor to measure the envelope from; empty when it is not. */',
		`export const problems: readonly string[] = ${json(fit.problems)};`,
		'',
	];
	return lines.join('\n');
}

/** Writes a species' figures and formats them as the repository does. */
export function writeFit(species: string, fit: TurnFit, formBand: number): string {
	const path = fitPath(species);
	mkdirSync(join(SPECIES_ROOT, species), { recursive: true });
	writeFileSync(path, fitModule(species, fit, formBand));
	const format = spawnSync('bunx', ['biome', 'format', '--write', path], {
		cwd: REPO_ROOT,
		encoding: 'utf8',
	});
	if (format.status !== 0) throw new Error(`biome could not format ${path}: ${format.stderr}`);
	return path;
}
