// Commit-msg guard for the `Size-Growth:` trailer (AGENTS.md, "Commit gates"). The size check fails
// a file that grew more than 2% after Brotli against main's build, unless a commit since that build
// has a trailer that names the file as the size report prints it and gives the reason. This hook
// rejects a trailer that names no such file or gives no reason, since it would explain nothing.
// The size check reads the trailers through explainedFiles.
import { readFileSync } from 'node:fs';
import { REPORTED_FILES } from '../lib/size-report';
import { effectiveMessage, findAckValues, isBareAck, isExemptCommit } from './commit-ack';

export const SIZE_GROWTH_TRAILER = 'Size-Growth';

/** True when the text names the file as a whole, so `js/page.js` does not match `js/page.jsx`. */
export function namesFile(text: string, file: string): boolean {
	const name = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?<![\\w./-])${name}(?![\\w/-]|\\.\\w)`).test(text);
}

/** A trailer's text without the files it names and without figures: what is left gives the reason. */
export function growthReason(value: string, named: readonly string[]): string {
	return named
		.reduce((text, file) => text.split(file).join(' '), value)
		.replace(/(?<!\w)[+-]?\d[\d,.]*\s*(?:%|kib|kb|bytes|b)?(?!\w)/gi, ' ')
		.replace(/\s+/g, ' ')
		.replace(/^[\s,.;:()+-]+|[\s,.;:()+-]+$/g, '');
}

/** The files of `files` that a trailer value names, and whether it also gives a reason. */
function readTrailer(value: string, files: readonly string[]) {
	const named = files.filter((file) => namesFile(value, file));
	return { named, reasoned: named.length > 0 && !isBareAck(growthReason(value, named)) };
}

/**
 * The commit that explains each file's growth, by file: the first commit in `commits` with a
 * Size-Growth trailer that names the file and gives a reason. Files that no trailer explains are absent.
 */
export function explainedFiles(
	commits: readonly { sha: string; message: string }[],
	files: readonly string[],
): Map<string, string> {
	const explained = new Map<string, string>();
	for (const { sha, message } of commits)
		for (const value of findAckValues(message, SIZE_GROWTH_TRAILER)) {
			const { named, reasoned } = readTrailer(value, files);
			if (reasoned) for (const file of named) if (!explained.has(file)) explained.set(file, sha);
		}
	return explained;
}

/** What is wrong with each Size-Growth trailer in a commit message. */
export function sizeGrowthProblems(
	rawMessage: string,
	files: readonly string[] = REPORTED_FILES,
): string[] {
	const message = effectiveMessage(rawMessage);
	if (message.length === 0 || isExemptCommit(message)) return [];
	return findAckValues(message, SIZE_GROWTH_TRAILER).flatMap((value) => {
		const { named, reasoned } = readTrailer(value, files);
		if (named.length === 0)
			return [`Size-Growth value "${value}" names no file that the size report measures.`];
		return reasoned ? [] : [`Size-Growth value "${value}" gives no reason for the growth.`];
	});
}

/** How to write the trailer, printed under a rejection. */
export const SIZE_GROWTH_GUIDANCE = [
	'A Size-Growth: trailer explains a file that grew more than 2% after Brotli against main',
	'(AGENTS.md, "Commit gates"). Name each file as the size report prints it, such as js/page.js or',
	'threaded/null3d_bg.wasm, then say why it grew. For example:\n',
	'  Size-Growth: js/render-worker.js +3.1%, the render graph and its culling per view',
	'  Size-Growth: threaded/null3d_bg.wasm and single/null3d_bg.wasm +6%, meshes from arrays',
];

if (import.meta.main) {
	const msgFile = process.argv[2];
	if (!msgFile) {
		console.error('usage: bun tools/hooks/check-size-growth.ts <commit-msg-file>');
		process.exit(2);
	}
	const problems = sizeGrowthProblems(readFileSync(msgFile, 'utf8'));
	if (problems.length > 0) {
		console.error('');
		for (const problem of problems) console.error(`commit rejected: ${problem}`);
		console.error('');
		for (const line of SIZE_GROWTH_GUIDANCE) console.error(line);
		console.error('');
		process.exit(1);
	}
}
