// The review step of the image tests. Runs save each image that has no reference, or that differs
// from its reference, as a candidate with its facts, and with the reference and the diff where one
// exists. This module lists the candidates for the terminal, shows them on a page, and turns the
// ones a person accepts into references.
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { percent } from '../../bench/lib/parity.ts';
import { CANDIDATE_FILES, type CandidateFacts, TIERS, type Tier } from './images.ts';
import { REPO_ROOT } from './server.ts';

/** A candidate that a run saved: its facts, and the path of its files without their endings. */
export interface Candidate extends CandidateFacts {
	base: string;
}

const isTier = (value: unknown): value is Tier => TIERS.some((tier) => tier === value);

/** The facts in a candidate's JSON file, or undefined when the file holds something else. */
function factsOf(text: string): CandidateFacts | undefined {
	try {
		const facts = JSON.parse(text) as Partial<CandidateFacts>;
		const named = [facts.test, facts.drawnIn, facts.reference].every((v) => typeof v === 'string');
		const known = facts.status === 'new' || facts.status === 'changed' || facts.status === 'drawn';
		return named && known && isTier(facts.tier) && facts.tolerance
			? (facts as CandidateFacts)
			: undefined;
	} catch {
		return undefined;
	}
}

/** Every candidate in a folder and the folders in it, by test, tier and the place that drew it. */
export function readCandidates(folder: string): Candidate[] {
	if (!existsSync(folder)) return [];
	const candidates: Candidate[] = [];
	for (const entry of readdirSync(folder, { recursive: true, encoding: 'utf8' })) {
		if (!entry.endsWith(CANDIDATE_FILES.facts)) continue;
		const base = join(folder, entry.slice(0, -CANDIDATE_FILES.facts.length));
		const facts = factsOf(readFileSync(`${base}${CANDIDATE_FILES.facts}`, 'utf8'));
		if (facts && existsSync(`${base}${CANDIDATE_FILES.image}`)) candidates.push({ ...facts, base });
	}
	const key = ({ test, tier, drawnIn }: Candidate) => `${test} ${TIERS.indexOf(tier)} ${drawnIn}`;
	return candidates.sort((a, b) => key(a).localeCompare(key(b)));
}

/** A candidate's name in a report: the test, the tier, and where and in which mode it was drawn. */
const titleOf = ({ test, tier, drawnIn, mode }: Candidate) =>
	`${test} on ${tier}, drawn in ${drawnIn}${mode ? `, ${mode}` : ''}`;

/** What a candidate is, in one sentence. */
function statusText({ status, share, tolerance, reference }: Candidate): string {
	if (status === 'new') return `New: there is no reference ${reference} yet.`;
	if (status === 'drawn')
		return share === undefined
			? `Drawn: the renderer drew this image, and there is no reference ${reference} yet.`
			: `Drawn: ${percent(share)} of pixels differ from ${reference}, and at most ${percent(tolerance.maxDiffRatio)} may.`;
	return `Changed: ${percent(share ?? 1)} of pixels differ from ${reference}, and at most ${percent(tolerance.maxDiffRatio)} may.`;
}

/** A candidate's files that exist, each with what it shows. */
function filesOf({ base }: Candidate): { label: string; path: string }[] {
	const files = [
		{ label: 'Reference', path: `${base}${CANDIDATE_FILES.reference}` },
		{ label: 'New image', path: `${base}${CANDIDATE_FILES.image}` },
		{ label: 'Diff', path: `${base}${CANDIDATE_FILES.diff}` },
	];
	return files.filter(({ path }) => existsSync(path));
}

/** A path for people to read: from the repository root inside it, and in full outside it. */
function shown(path: string): string {
	const inside = relative(REPO_ROOT, path);
	return inside.startsWith('..') ? path : inside || '.';
}

/**
 * The review as lines for the terminal: each candidate with its status and files, the candidates
 * that cannot become references and why, and the command that accepts the others. `from` is the
 * folder of the candidates, when the command must name it.
 */
export function reviewLines(
	candidates: readonly Candidate[],
	page: string,
	from?: string,
): string[] {
	if (candidates.length === 0) return ['No new or changed images to review.'];
	const lines: string[] = [];
	for (const candidate of candidates) {
		lines.push(`${titleOf(candidate)}`, `  ${statusText(candidate)}`);
		if (candidate.fixed) lines.push(`  It cannot become the reference: ${candidate.fixed}.`);
		for (const { label, path } of filesOf(candidate)) lines.push(`  ${label}: ${shown(path)}`);
	}
	const open = candidates.filter((candidate) => !candidate.fixed);
	lines.push('', `The review page: ${shown(page)}`);
	const accept = `bun run images:review${from ? ` --from ${shown(from)}` : ''} --accept`;
	if (open.length > 0)
		lines.push(
			`Accept ${open.length === 1 ? 'the image' : `the ${open.length} images`} that can become references with ${accept}, or only some tests' images with --accept ${open[0]?.test}.`,
		);
	return lines;
}

const escapeHtml = (text: string) =>
	text.replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
	);

/**
 * The review page, which lives in `folder`: each candidate with its reference, its new image and
 * its diff side by side, and why it cannot become the reference where it cannot.
 */
export function reviewPage(candidates: readonly Candidate[], folder: string): string {
	const sections = candidates.map((candidate) => {
		const figures = filesOf(candidate)
			.map(({ label, path }) => {
				const src = escapeHtml(relative(folder, path));
				return `<figure><a href="${src}"><img src="${src}" alt="${label}"></a><figcaption>${label}</figcaption></figure>`;
			})
			.join('');
		const fixed = candidate.fixed
			? `<p class="fixed">It cannot become the reference: ${escapeHtml(candidate.fixed)}.</p>`
			: '';
		return `<section><h2>${escapeHtml(titleOf(candidate))}</h2><p>${escapeHtml(statusText(candidate))}</p>${fixed}<div class="row">${figures}</div></section>`;
	});
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Image review</title>
<style>
:root { color-scheme: light dark; --bg: #f4f4f2; --card: #fff; --text: #1d1f21; --muted: #5c6166; --warn: #9a5b00; }
@media (prefers-color-scheme: dark) { :root { --bg: #16181b; --card: #202328; --text: #e6e6e3; --muted: #9aa0a6; --warn: #f0b35a; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 0 0 4px; }
p { margin: 0 0 8px; color: var(--muted); }
p.fixed { color: var(--warn); }
section { background: var(--card); border-radius: 8px; padding: 16px; margin: 16px 0; }
.row { display: flex; flex-wrap: wrap; gap: 16px; }
figure { margin: 0; }
img { display: block; min-width: 256px; max-width: 100%; image-rendering: pixelated; }
figcaption { color: var(--muted); font-size: 13px; }
code { font-size: 13px; }
</style>
</head>
<body>
<h1>Image review</h1>
<p>${candidates.length} new or changed ${candidates.length === 1 ? 'image' : 'images'}. Accept them with <code>bun run images:review --accept</code>, or name tests after it.</p>
${sections.join('\n')}
</body>
</html>
`;
}

/** What accepting did: the references written, and the candidates left as they were, with why. */
export interface Accepted {
	written: string[];
	refused: string[];
}

/** The software GPU's set, whose references come only from CI's own drawing. */
const CI_DRAWN = 'chromium-swiftshader';

/** The file that records each software-GPU reference drawn outside CI on purpose, from the root. */
export const LOCAL_REFERENCES = 'tests/image/local-references.json';

/** A software-GPU reference drawn outside CI on purpose: its test, tier, day and the reason. */
export interface LocalReference {
	test: string;
	tier: Tier;
	date: string;
	reason: string;
}

/** How a review accepts candidates that a software GPU drew. */
export interface AcceptOptions {
	/** The CI run whose images the review fetched, which drew every candidate in its folder. */
	ciRun?: string;
	/** Why software-GPU references are taken from this machine's drawing on purpose. */
	localReason?: string;
	/** The record of local software-GPU references; the repository's file by default. */
	record?: string;
	/** The day that a local reference records, in the form `2026-10-25`. */
	today?: string;
}

function readRecord(path: string): Record<string, LocalReference> {
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as Record<string, LocalReference>;
	} catch {
		return {};
	}
}

function writeRecord(path: string, record: Record<string, LocalReference>): void {
	const sorted = Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
	writeFileSync(path, `${JSON.stringify(sorted, null, '\t')}\n`);
}

/**
 * Makes candidates into references in `referenceDir`: every candidate that can become one, or only
 * those of the tests named. A reference that two candidates would both write is left alone, as the
 * two images disagree. An accepted candidate's files go away.
 *
 * A software-GPU reference comes only from CI's own drawing: a candidate whose facts name the CI run
 * that drew it, or one in a CI run's images that the review fetched. CI's Linux machines draw some
 * pictures otherwise than the Mac's SwiftShader, so a local drawing is refused, unless `localReason`
 * says why it is taken on purpose; the record then keeps that reason beside the reference, and a
 * later drawing from CI removes it.
 */
export function acceptCandidates(
	candidates: readonly Candidate[],
	referenceDir: string,
	tests?: readonly string[],
	{ ciRun, localReason, record = join(REPO_ROOT, LOCAL_REFERENCES), today }: AcceptOptions = {},
): Accepted {
	const chosen = candidates.filter((c) => !tests || tests.includes(c.test));
	const refused = chosen
		.filter((c) => c.fixed)
		.map((c) => `${titleOf(c)}: it cannot become the reference: ${c.fixed}`);
	const needsCi = (c: Candidate) => c.reference.startsWith(`${CI_DRAWN}/`);
	const drawnByCi = (c: Candidate) => Boolean(c.ciRun ?? ciRun);
	const local = chosen.filter((c) => !c.fixed && needsCi(c) && !drawnByCi(c));
	if (!localReason)
		for (const c of local)
			refused.push(
				`${titleOf(c)}: ${c.reference} was drawn on this machine, not by CI, and a SwiftShader reference comes from CI's own drawing. Run the test in a CI run, on a branch with \`gh workflow run ci.yml --ref <branch>\`, then take its image with \`bun run images:review --ci <run> --accept ${c.test}\`. To keep this drawing on purpose, accept it with \`--local-reason "<why>"\`, which records the reason in ${LOCAL_REFERENCES}.`,
			);
	const kept = localReason ? chosen : chosen.filter((c) => !local.includes(c));
	const notes = readRecord(record);
	const noted = JSON.stringify(notes);
	for (const test of tests ?? [])
		if (!chosen.some((c) => c.test === test)) refused.push(`${test}: no candidate to accept`);
	const byReference = new Map<string, Candidate[]>();
	for (const candidate of kept.filter((c) => !c.fixed))
		byReference.set(candidate.reference, [
			...(byReference.get(candidate.reference) ?? []),
			candidate,
		]);
	const written: string[] = [];
	for (const [reference, list] of byReference) {
		if (list.length > 1) {
			refused.push(
				`${reference}: ${list.map(titleOf).join(' and ')} would both write it; delete the files of the one you do not want, and accept again`,
			);
			continue;
		}
		const [candidate] = list as [Candidate];
		const target = join(referenceDir, reference);
		mkdirSync(dirname(target), { recursive: true });
		copyFileSync(`${candidate.base}${CANDIDATE_FILES.image}`, target);
		for (const ending of Object.values(CANDIDATE_FILES))
			rmSync(`${candidate.base}${ending}`, { force: true });
		written.push(shown(target));
		if (!needsCi(candidate)) continue;
		if (drawnByCi(candidate)) delete notes[reference];
		else
			notes[reference] = {
				test: candidate.test,
				tier: candidate.tier,
				date: today ?? new Date().toISOString().slice(0, 10),
				reason: localReason ?? '',
			};
	}
	if (JSON.stringify(notes) !== noted) writeRecord(record, notes);
	return { written, refused };
}
