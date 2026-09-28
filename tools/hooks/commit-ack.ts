// Shared machinery for the commit-msg acknowledgement hooks (AGENTS.md, "Commit gates").
//
// Each rule answers the same question: this commit changed files that carry an obligation, so did
// the author discharge it? The classification, message parsing and command-line plumbing live here
// once, and each rule contributes only its trailer name, its paths and its guidance text.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Trailer values that name a rule without acknowledging anything. */
const BARE_VALUES = new Set([
	'yes',
	'y',
	'no',
	'n',
	'true',
	'ok',
	'done',
	'checked',
	'n/a',
	'na',
	'none',
	'-',
]);

const MIN_ACK_LENGTH = 10;

export interface AckRule {
	/** Trailer key, without the colon, for example `Docs-Checked`. */
	trailer: string;
	/** Paths whose changes carry this rule's obligation. */
	patterns: RegExp[];
	/**
	 * Paths the rule gained later, with the moment it gained them. A commit authored before that
	 * moment is judged without them, so a stricter rule does not fail commits made under the old one.
	 */
	added?: readonly { since: string; patterns: RegExp[] }[];
	/** Rejection text for a commit that changed bearing files and has no trailer. */
	missingMessage: (bearing: string[]) => string;
	/** Rejection text for a trailer that is present but acknowledges nothing. */
	emptyMessage: (value: string) => string;
	/** Printed under a rejection: what the pass is, with example trailers. */
	guidance: string[];
}

export function bearingFiles(changedFiles: string[], patterns: RegExp[]): string[] {
	return changedFiles.filter((f) => patterns.some((p) => p.test(f)));
}

/** The rule's patterns for a commit authored at `authoredAt`, or all of them without a time. */
export function rulePatterns(rule: AckRule, authoredAt?: string): RegExp[] {
	const time = authoredAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(authoredAt);
	const later = (rule.added ?? []).filter((a) => time >= Date.parse(a.since));
	return [...rule.patterns, ...later.flatMap((a) => a.patterns)];
}

/** Strips git comment lines and everything below a scissors marker. */
export function effectiveMessage(rawMessage: string): string {
	const scissors = rawMessage.indexOf('------------------------ >8 ------------------------');
	const body = scissors === -1 ? rawMessage : rawMessage.slice(0, scissors);
	return body
		.split('\n')
		.filter((line) => !line.startsWith('#'))
		.join('\n')
		.trim();
}

/** Commits that git writes itself, or that are squashed away later, are exempt. */
export function isExemptCommit(message: string): boolean {
	return /^(Merge |Revert |fixup!|squash!|amend!)/.test(message);
}

export function findAckValue(message: string, trailer: string): string | null {
	const match = message.match(new RegExp(`^${trailer}:[ \\t]*(.*)$`, 'im'));
	return match?.[1] !== undefined ? match[1].trim() : null;
}

/** True when the value is a rubber stamp rather than the record of a real pass. */
export function isBareAck(value: string): boolean {
	return value.length < MIN_ACK_LENGTH || BARE_VALUES.has(value.toLowerCase());
}

/**
 * Whether a commit message discharges the rule for the changed files. `authoredAt` is the commit's
 * author time, which decides the paths the rule covered then; a commit being made now omits it.
 */
export function checkAck(
	rawMessage: string,
	changedFiles: string[],
	rule: AckRule,
	authoredAt?: string,
): { ok: boolean; error?: string } {
	const message = effectiveMessage(rawMessage);
	if (message.length === 0 || isExemptCommit(message)) return { ok: true };

	const bearing = bearingFiles(changedFiles, rulePatterns(rule, authoredAt));
	if (bearing.length === 0) return { ok: true };

	const value = findAckValue(message, rule.trailer);
	if (value === null) return { ok: false, error: rule.missingMessage(bearing) };
	if (isBareAck(value)) return { ok: false, error: rule.emptyMessage(value) };
	return { ok: true };
}

/** Renders `foo.ts and 3 more` for a rejection message. */
export function summarizeBearing(bearing: string[]): string {
	return `${bearing[0]}${bearing.length > 1 ? ` and ${bearing.length - 1} more` : ''}`;
}

export function stagedFiles(): string[] {
	return execSync('git diff --cached --name-only', { encoding: 'utf8' })
		.split('\n')
		.filter(Boolean);
}

/** Command-line entry shared by every acknowledgement hook: read the message, check it, exit. */
export function runAckHook(rule: AckRule, scriptName: string): void {
	const msgFile = process.argv[2];
	if (!msgFile) {
		console.error(`usage: bun tools/hooks/${scriptName} <commit-msg-file>`);
		process.exit(2);
	}
	const result = checkAck(readFileSync(msgFile, 'utf8'), stagedFiles(), rule);
	if (!result.ok) {
		console.error(`\ncommit rejected: ${result.error}\n`);
		for (const line of rule.guidance) console.error(line);
		console.error('');
		process.exit(1);
	}
}
