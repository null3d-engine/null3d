// Commit-msg guard for the `Task:` footer (AGENTS.md, "Commit gates"). The footer names the
// milestone task that a commit delivers part of, as an ID from the list in task-ids.txt, or says
// `none`. Free text such as "main CI repair" or an invented ID makes the footer useless for finding
// a task's commits, so this hook refuses it. A footer is optional; a commit that has one must use
// one of these forms. check-trailers.ts runs the same rule over a range of commits.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveMessage, findAckValues, isExemptCommit } from './commit-ack';

export const TASK_TRAILER = 'Task';

/** Commits authored before this moment were made under the old, free-text footer. */
export const TASK_RULE_SINCE = '2026-10-15T14:00:00+08:00';

/** The task IDs a footer may name, from the list beside this hook in a checkout at `root`. */
export function knownTaskIds(root = process.cwd()): Set<string> {
	const text = readFileSync(join(root, 'tools/hooks/task-ids.txt'), 'utf8');
	return new Set(
		text
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line && !line.startsWith('#')),
	);
}

/**
 * Why a commit message's `Task:` footers break the rule, or null when they keep it. Each footer is
 * `none`, or one or more listed task IDs separated by commas. `authoredAt` is the commit's author
 * time; a commit being made now omits it.
 */
export function taskProblem(
	rawMessage: string,
	known: ReadonlySet<string>,
	authoredAt?: string,
): string | null {
	const message = effectiveMessage(rawMessage);
	if (isExemptCommit(message)) return null;
	if (authoredAt !== undefined && Date.parse(authoredAt) < Date.parse(TASK_RULE_SINCE)) return null;
	for (const value of findAckValues(message, TASK_TRAILER)) {
		if (value === 'none') continue;
		const ids = value.split(',').map((id) => id.trim());
		const unknown = ids.filter((id) => !known.has(id));
		if (unknown.length === 0) continue;
		return /^M\d+-[A-Z]+\d+$/.test(unknown[0] ?? '')
			? `Task: ${value} names ${unknown.join(', ')}, which is not in tools/hooks/task-ids.txt. Check the ID in the milestone plan; when the task is new, add it to the list in this commit.`
			: `Task: ${value} is not a task ID. Write the milestone task ID the commit delivers part of, such as Task: M2-J4, or Task: none for work that belongs to no task. Put any other note in the body.`;
	}
	return null;
}

if (import.meta.main) {
	const msgFile = process.argv[2];
	if (!msgFile) {
		console.error('usage: bun tools/hooks/check-task.ts <commit-msg-file>');
		process.exit(2);
	}
	const problem = taskProblem(readFileSync(msgFile, 'utf8'), knownTaskIds());
	if (problem) {
		console.error(`\ncommit rejected: ${problem}\n`);
		process.exit(1);
	}
}
