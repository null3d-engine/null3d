// Range guard against stale docs screenshots (AGENTS.md, hard rule 44). A demo, scene or page that a
// screenshot shows decides what that picture looks like. A range that changes one of those sources
// updates the picture in the same range, unless a `Screenshots-Checked:` trailer says why it still
// holds. The docs check pairs each shown picture with its entry and file; this guard moves the same
// rule to the change itself.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readShots, SHOTS_DIR, type ShotEntry } from '../lib/docs';
import type { CommitWithFiles } from './check-gpu-ack';
import { effectiveMessage, findAckValues, isBareAck } from './commit-ack';

/** The trailer that says why a shot's picture still holds. */
export const SCREENSHOTS_TRAILER = 'Screenshots-Checked';

const ROOT = join(import.meta.dirname, '../..');

/** Whether a range's changed files touch a shot's source, which may name a folder. */
function touchedBy(changed: ReadonlySet<string>, source: string): boolean {
	if (!source.endsWith('/')) return changed.has(source);
	for (const file of changed) if (file.startsWith(source)) return true;
	return false;
}

/**
 * The pictures that a range leaves stale, as paths below the repository: a shot's source changed,
 * its picture exists, and the range does not change that picture.
 */
export function unmatchedScreenshots(
	commits: readonly CommitWithFiles[],
	entries: readonly ShotEntry[],
	exists: (path: string) => boolean = (path) => existsSync(join(ROOT, path)),
): string[] {
	const changed = new Set(commits.flatMap((commit) => commit.files));
	const stale = new Set<string>();
	for (const entry of entries) {
		const picture = `${SHOTS_DIR}/${entry.id}.webp`;
		if (!exists(picture)) continue;
		if (!entry.files.some((source) => touchedBy(changed, source))) continue;
		if (changed.has(picture)) continue;
		stale.add(picture);
	}
	return [...stale].sort();
}

/**
 * Why a range may leave a screenshot stale, or null when it updates every picture it moves or gives
 * the reason. `entries` and `exists` are given by the tests; the hook reads the tree.
 */
export function screenshotsProblem(
	commits: readonly CommitWithFiles[],
	entries: readonly ShotEntry[] = readShots(ROOT).entries,
	exists: (path: string) => boolean = (path) => existsSync(join(ROOT, path)),
): string | null {
	const stale = unmatchedScreenshots(commits, entries, exists);
	if (stale.length === 0) return null;
	const values = commits.flatMap((commit) =>
		findAckValues(effectiveMessage(commit.message), SCREENSHOTS_TRAILER),
	);
	if (values.some((value) => !isBareAck(value))) return null;
	const shown = stale.slice(0, 3);
	const more = stale.length > shown.length ? ` and ${stale.length - shown.length} more` : '';
	return values.length > 0
		? `${SCREENSHOTS_TRAILER} value "${values[0]}" gives no reason: say how you know the picture still holds`
		: `the range changes what a screenshot shows without redrawing it (${shown.join(', ')}${more}). Run bun tools/docs-screenshots.ts, or, when the picture still holds, put a ${SCREENSHOTS_TRAILER}: trailer on a commit that says why (.dev/screenshots.md).`;
}
