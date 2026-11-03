// Range guard against stale script image references (AGENTS.md, "Commit gates"). A demo's script
// draws the same page at other times, so a change that moves a demo's pictures moves the script's
// pictures too. `tests/check-references.ts` checks only that each reference exists, so a script
// picture can stay stale while its demo's pictures are made again. This guard refuses a range that
// changes a demo's pictures without the script pictures of the same environment and tier, unless a
// `Script-References:` trailer says why they still hold.
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMOS } from '../../examples/demos.ts';
import { SCRIPT_RUNS } from '../../tests/image/script-runs.ts';
import type { CommitWithFiles } from './check-gpu-ack';
import { effectiveMessage, findAckValues, isBareAck } from './commit-ack';

/** The trailer that says why a demo's script pictures still hold. */
export const SCRIPT_REFERENCES_TRAILER = 'Script-References';

const ROOT = join(import.meta.dirname, '../..');
const REFERENCES = 'tests/image/references';
/** A demo's picture in one environment and tier. */
const DEMO_REFERENCE = /^tests\/image\/references\/([^/]+)\/([^/]+)\/demo-([a-z0-9-]+)\.png$/;

/** Each demo's script tests, by the tier that they draw and keep references on. */
const SCRIPTS = (() => {
	const sketchOfDemo = new Map<string, string>();
	for (const demo of DEMOS) {
		const path = relative(ROOT, fileURLToPath(demo.sketch)).split(sep).join('/');
		sketchOfDemo.set(path, demo.name);
	}
	const scripts = new Map<string, Map<string, string[]>>();
	for (const run of SCRIPT_RUNS) {
		const demo = sketchOfDemo.get(run.scene);
		if (demo === undefined) continue;
		const byTier = scripts.get(demo) ?? new Map<string, string[]>();
		byTier.set(run.tier, [...(byTier.get(run.tier) ?? []), run.test]);
		scripts.set(demo, byTier);
	}
	return scripts;
})();

/**
 * The script pictures that the range leaves stale, as paths below the references folder: a demo's
 * picture changed in an environment and tier, its script test draws that tier, the script's picture
 * exists in the same set, and the range does not change it.
 */
export function unmatchedScriptReferences(commits: readonly CommitWithFiles[]): string[] {
	const changed = new Set(commits.flatMap((commit) => commit.files));
	const missing = new Set<string>();
	for (const file of changed) {
		const match = DEMO_REFERENCE.exec(file);
		if (!match) continue;
		const [, environment = '', tier = '', demo = ''] = match;
		for (const test of SCRIPTS.get(demo)?.get(tier) ?? []) {
			const reference = `${REFERENCES}/${environment}/${tier}/${test}.png`;
			if (changed.has(reference)) continue;
			// A set that keeps no script picture for this test has none to redraw.
			if (!existsSync(join(ROOT, reference))) continue;
			missing.add(`${environment}/${tier}/${test}.png`);
		}
	}
	return [...missing].sort();
}

/**
 * Why a range's commits may leave a demo's script pictures stale, or null when they change both
 * alike or give the reason.
 */
export function scriptReferencesProblem(commits: readonly CommitWithFiles[]): string | null {
	const unmatched = unmatchedScriptReferences(commits);
	if (unmatched.length === 0) return null;
	const values = commits.flatMap((commit) =>
		findAckValues(effectiveMessage(commit.message), SCRIPT_REFERENCES_TRAILER),
	);
	if (values.some((value) => !isBareAck(value))) return null;
	const shown = unmatched.slice(0, 3);
	const more =
		unmatched.length > shown.length ? ` and ${unmatched.length - shown.length} more` : '';
	return values.length > 0
		? `${SCRIPT_REFERENCES_TRAILER} value "${values[0]}" gives no reason: say how you know the script's pictures still hold`
		: `the range changes a demo's pictures without the same set's script pictures (${shown.join(', ')}${more}). Redraw them with bun run test:browser image/cli-script.spec.ts -g '<the script test>' and bun run images:review --accept <test>, or, when the script's pictures still hold, put a ${SCRIPT_REFERENCES_TRAILER}: trailer on a commit that says why (.dev/image-tests.md).`;
}
