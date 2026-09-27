// Commit-msg guard: a commit that changes engine code, a package's source or the skills must carry
// a `Docs-Checked:` trailer, the record that the docs pages describing the change were re-read
// (AGENTS.md, "Commit gates"). Generated pages cannot drift; hand-written pages can, and this
// trailer is the only record that someone checked them.
import { type AckRule, bearingFiles, checkAck, runAckHook, summarizeBearing } from './commit-ack';

export { effectiveMessage, isExemptCommit } from './commit-ack';

/** Paths whose changes carry documentation obligations. Docs, tests and CI settings are absent. */
export const DOC_BEARING_PATTERNS: RegExp[] = [
	/^crates\/[^/]+\/src\//,
	/^packages\/[^/]+\/src\//,
	/^packages\/[^/]+\/bin\//,
	/^skills\//,
];

export const DOCS_ACK_RULE: AckRule = {
	trailer: 'Docs-Checked',
	patterns: DOC_BEARING_PATTERNS,
	missingMessage: (bearing) =>
		`This commit changes code or skills (${summarizeBearing(bearing)}) but has no Docs-Checked: ` +
		'trailer. The docs pass covers docs/, the README and AGENTS.md.',
	emptyMessage: (value) =>
		`Docs-Checked value "${value}" acknowledges nothing: name the pages you updated or re-read, or say why no page applies.`,
	guidance: [
		'Every code commit records the docs pass (AGENTS.md, "Commit gates"). Re-read the pages that',
		'describe what you changed: check that they are accurate, that each page status is right,',
		'and run the humanizer on any prose you changed. Then add a trailer, for example:\n',
		'  Docs-Checked: updated docs/concepts/handles.md for the new generation bits',
		'  Docs-Checked: re-read docs/concepts/architecture.md; it still matches',
		'  Docs-Checked: internal refactor; no documented behavior changed',
	],
};

export function docBearingFiles(changedFiles: string[]): string[] {
	return bearingFiles(changedFiles, DOC_BEARING_PATTERNS);
}

export function checkCommitMessage(
	rawMessage: string,
	changedFiles: string[],
): { ok: boolean; error?: string } {
	return checkAck(rawMessage, changedFiles, DOCS_ACK_RULE);
}

if (import.meta.main) runAckHook(DOCS_ACK_RULE, 'check-docs-ack.ts');
