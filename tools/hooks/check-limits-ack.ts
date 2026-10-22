// Commit guard for the `Limits-Checked:` trailer (AGENTS.md, "Commit gates"). A commit that changes
// what a fixed limit measures, such as a picture test, a memory ceiling or a size budget, can make
// that limit fail long after it lands. The trailer records that the author ran the report and read
// what each limit said, so the failure is caught at the commit rather than in a CI job nobody can
// read. The report itself is `bun run limits`.
import {
	type AckRule,
	bearingFiles,
	checkAck,
	rulePatterns,
	runAckHook,
	summarizeBearing,
} from './commit-ack';

/** The trailer that records the fixed-limit report. */
export const LIMITS_CHECK_TRAILER = 'Limits-Checked';

/**
 * Paths whose change can move a fixed limit: the picture manifest and its tests, the heavy checks'
 * memory ceilings, the size budgets and the build that measures them.
 */
export const LIMIT_BEARING_PATTERNS: RegExp[] = [
	/^tests\/image\/manifest\.ts$/,
	/^tests\/image\/[^/]+\.spec\.ts$/,
	/^tests\/lib\/heavy-checks\.ts$/,
	/^tools\/lib\/size-report\.ts$/,
	/^tools\/lib\/size-check\.ts$/,
	/^tools\/build-wasm\.ts$/,
];

export const LIMITS_ACK_RULE: AckRule = {
	trailer: LIMITS_CHECK_TRAILER,
	// The rule starts with no paths and gains them from today, so the commits that landed before it
	// existed are judged as they were: a rule cannot ask for a trailer that nobody could have known.
	patterns: [],
	added: [{ since: '2026-10-22T13:10:00+08:00', patterns: LIMIT_BEARING_PATTERNS }],
	missingMessage: (bearing) =>
		`This commit changes what a fixed limit measures (${summarizeBearing(bearing)}) but has no ` +
		'Limits-Checked: trailer.',
	emptyMessage: (value) =>
		`Limits-Checked value "${value}" acknowledges nothing: name the limits you measured and what each said.`,
	guidance: [
		'Run `bun run limits` before you commit (AGENTS.md, "Fixed limits"). It reports the picture',
		'references, the commit gates and the download sizes that this checkout last built, and it',
		'names the command for each limit that only a build or a heavy run measures. Then add a',
		'trailer that says what it reported, for example:\n',
		'  Limits-Checked: bun run limits: every reference present, the largest start 182,147 of 186,368 bytes',
		'  Limits-Checked: bun run limits: one missing software-GPU reference, drawn and accepted here',
	],
};

export function limitBearingFiles(changedFiles: string[]): string[] {
	return bearingFiles(changedFiles, rulePatterns(LIMITS_ACK_RULE));
}

export function checkCommitMessage(
	rawMessage: string,
	changedFiles: string[],
): { ok: boolean; error?: string } {
	return checkAck(rawMessage, changedFiles, LIMITS_ACK_RULE);
}

if (import.meta.main) runAckHook(LIMITS_ACK_RULE, 'check-limits-ack.ts');
