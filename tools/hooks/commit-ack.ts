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

/**
 * The moment the footer block became the only place a trailer counts. A commit authored before it is
 * read the old way, with the key found at the start of any line, because the commits already on this
 * branch cannot be reworded and a rule that fails its own history blocks every push. The moment is
 * the author date of the commit that made footers read as git reads them.
 */
export const BLOCK_RULE_SINCE = '2026-11-02T15:03:36+08:00';

/** Whether a commit authored at `authoredAt` is held to the footer block, as git reads one. */
export function heldToBlockRule(authoredAt?: string): boolean {
	if (authoredAt === undefined) return true;
	const time = Date.parse(authoredAt);
	if (Number.isNaN(time)) return true;
	return time >= Date.parse(BLOCK_RULE_SINCE);
}

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

/** The line that `git commit --verbose` writes before the diff it shows but does not commit. */
const SCISSORS = '------------------------ >8 ------------------------';

/** The message above git's cut line, or the whole message when it has none. */
function beforeScissors(rawMessage: string): string {
	const scissors = rawMessage.indexOf(SCISSORS);
	return scissors === -1 ? rawMessage : rawMessage.slice(0, scissors);
}

/** Strips git comment lines and everything below a scissors marker. */
export function effectiveMessage(rawMessage: string): string {
	return beforeScissors(rawMessage)
		.split('\n')
		.filter((line) => !line.startsWith('#'))
		.join('\n')
		.trim();
}

/** Commits that git writes itself, or that are squashed away later, are exempt. */
export function isExemptCommit(message: string): boolean {
	return /^(Merge |Revert |fixup!|squash!|amend!)/.test(message);
}

/** One trailer of a commit message: its key, and its value with continuation lines unfolded. */
export interface Trailer {
	key: string;
	value: string;
}

/** A line that continues the line above it: it begins with whitespace. */
const CONTINUATION = /^\s/;

/** A line that ends the part of the message that git reads. */
const DIVIDER = /^---(?:\s|$)/;

/**
 * The lines that git writes itself into a commit's trailers: a sign-off, and the note that a pick
 * brought the commit from another branch. Either counts as a trailer when git finds the block.
 */
const GENERATED = ['Signed-off-by: ', '(cherry picked from commit '];

/** True when the line holds nothing but whitespace. */
function isBlank(line: string): boolean {
	return line.trim() === '';
}

/** True when the line is one of git's commit-template comments. */
function isComment(line: string): boolean {
	return line.startsWith('#');
}

/** A character that a trailer's key may hold. */
const KEY_CHARACTER = /[A-Za-z0-9-]/;

/**
 * The offset of the separator in a trailer line, or -1 when the line is no trailer. A key holds
 * letters, digits and dashes; a space inside it is allowed but then no other key character may
 * follow.
 */
function separatorAt(line: string): number {
	let whitespace = false;
	for (let at = 0; at < line.length; at++) {
		const character = line[at] as string;
		if (character === ':') return at;
		if (!whitespace && KEY_CHARACTER.test(character)) continue;
		if (at > 0 && (character === ' ' || character === '\t')) {
			whitespace = true;
			continue;
		}
		break;
	}
	return -1;
}

/** Collapses a value's line breaks and their indent to one space each, and trims the result. */
function unfold(value: string): string {
	return value.replace(/\n\s*/g, ' ').trim();
}

/**
 * The trailers of a commit message, in order, read the way `git interpret-trailers --parse` reads
 * them. Git takes the last block of non-blank lines above the `---` divider, and accepts it as the
 * trailer block when every line is a trailer, or when the block holds a line that git writes itself
 * and at least a quarter of its lines are trailers. A blank line before the block ends the search,
 * so a footer in the middle of a message is not a trailer, and neither is the subject line, which is
 * the message's first block. A line that continues the one above it begins with whitespace. Keys
 * are kept as written; compare them in any case.
 */
export function trailers(message: string): Trailer[] {
	const lines = beforeScissors(message).split('\n');
	const divider = lines.findIndex((line) => DIVIDER.test(line));
	if (divider >= 0) lines.length = divider;
	while (lines.length > 0) {
		const last = lines[lines.length - 1] as string;
		if (!(isBlank(last) || isComment(last))) break;
		lines.pop();
	}

	// The subject is the first block of lines, so a trailer block cannot start inside it.
	let title = 0;
	while (title < lines.length && !isBlank(lines[title] as string)) title++;

	// Walk back from the end of the message over the lines that git would read as trailers, and
	// stop at the blank line that opens the block.
	let generated = false;
	let trailerLines = 0;
	let otherLines = 0;
	let continuations = 0;
	let start = -1;
	for (let at = lines.length - 1; at >= title && start < 0; at--) {
		const line = lines[at] as string;
		if (isComment(line)) {
			otherLines += continuations;
			continuations = 0;
		} else if (isBlank(line)) {
			otherLines += continuations;
			const enough = generated && trailerLines * 3 >= otherLines;
			if (enough || (trailerLines > 0 && otherLines === 0)) start = at + 1;
			else return [];
		} else {
			if (GENERATED.some((prefix) => line.startsWith(prefix))) {
				trailerLines++;
				continuations = 0;
				generated = true;
			} else if (separatorAt(line) >= 1 && !CONTINUATION.test(line)) {
				trailerLines++;
				continuations = 0;
			} else if (CONTINUATION.test(line)) {
				continuations++;
			} else {
				otherLines += continuations + 1;
				continuations = 0;
			}
		}
	}
	if (start < 0) return [];

	// Fold each continuation line into the line above it, then read every line as a trailer.
	const folded: string[] = [];
	let folds = false;
	for (const line of lines.slice(start)) {
		if (folds && CONTINUATION.test(line)) {
			folded[folded.length - 1] = `${folded[folded.length - 1]}\n${line}`;
			continue;
		}
		folded.push(line);
		folds = separatorAt(line) >= 1;
	}
	const found: Trailer[] = [];
	for (const line of folded) {
		if (isComment(line)) continue;
		const separator = separatorAt(line);
		if (separator < 1) continue;
		found.push({
			key: line.slice(0, separator).trim(),
			value: unfold(line.slice(separator + 1).trim()),
		});
	}
	return found;
}

/**
 * Every value of the trailer in the message's trailer block, in order, the key in any case. A commit
 * authored before the footer block became the rule is read the old way, with the key found at the
 * start of any line, so that the branch's own history is not held to a rule it predates.
 */
export function findAckValues(message: string, trailer: string, authoredAt?: string): string[] {
	if (!heldToBlockRule(authoredAt)) {
		const pattern = new RegExp(`^${trailer}:[ \\t]*(.*)$`, 'gim');
		return [...message.matchAll(pattern)].map((match) => (match[1] ?? '').trim());
	}
	const key = trailer.toLowerCase();
	return trailers(message)
		.filter((entry) => entry.key.toLowerCase() === key)
		.map((entry) => entry.value);
}

export function findAckValue(message: string, trailer: string, authoredAt?: string): string | null {
	return findAckValues(message, trailer, authoredAt)[0] ?? null;
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

	const value = findAckValue(message, rule.trailer, authoredAt);
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
