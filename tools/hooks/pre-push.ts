// Pre-push guard: work reaches main through a pull request, whose CI run judges it before it merges
// (D-379). So the hook refuses a push from this machine that writes main, and says to open a pull
// request instead. A push to any other branch only saves work, and the hook lets it through at once.
// Only in an emergency, which the owner calls, a `Push-Check-Skipped: <reason>` trailer on a commit
// that the push adds to main lets the push through. The hook reads the commits after the commit that
// git reports for main before the push. When this checkout does not hold that commit, and no local
// main ref meets the pushed commit, it cannot read the trailer, and asks for a fetch.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { keptCommits } from './check-trailers';
import { findAckValues } from './commit-ack';

/** The trailer that lets a direct push to main through, with the reason for the emergency. */
export const SKIP_TRAILER = 'Push-Check-Skipped';
const NO_COMMIT = /^0+$/;

/** One line of what git pushes: a local ref and commit to a remote ref and its commit. */
export interface PushedRef {
	localRef: string;
	localSha: string;
	remoteRef: string;
	remoteSha: string;
}

/** The lines that git gives a pre-push hook on its standard input. */
export function parsePush(text: string): PushedRef[] {
	return text
		.split('\n')
		.map((line) => line.trim().split(/\s+/))
		.filter((fields) => fields.length === 4)
		.map(([localRef = '', localSha = '', remoteRef = '', remoteSha = '']) => ({
			localRef,
			localSha,
			remoteRef,
			remoteSha,
		}));
}

/** The push to main among the pushed refs, unless it deletes main. */
export function pushToMain(refs: readonly PushedRef[]): PushedRef | undefined {
	return refs.find((ref) => ref.remoteRef === 'refs/heads/main' && !NO_COMMIT.test(ref.localSha));
}

/** The reason that a `Push-Check-Skipped:` trailer gives on any of the messages, if one does. */
export function skipReason(messages: readonly string[]): string | undefined {
	for (const message of messages) {
		const reason = findAckValues(message, SKIP_TRAILER).find((value) => value.length > 0);
		if (reason) return reason;
	}
	return undefined;
}

/**
 * The commit that main held before the push, if this checkout can name it: the commit git reports, a
 * case that needs no other ref, or the point where the pushed commit and the local main ref meet.
 */
export function baseOf(push: PushedRef): string | undefined {
	if (!NO_COMMIT.test(push.remoteSha)) {
		const known = spawnSync('git', ['cat-file', '-e', `${push.remoteSha}^{commit}`], {
			stdio: 'ignore',
		});
		if (known.status === 0) return push.remoteSha;
	}
	for (const ref of ['origin/main', 'main']) {
		const mergeBase = spawnSync('git', ['merge-base', ref, push.localSha], { encoding: 'utf8' });
		if (mergeBase.status === 0 && mergeBase.stdout.trim()) return mergeBase.stdout.trim();
	}
	return undefined;
}

/**
 * The message that refuses a direct push to main. `readable` says whether the hook could read the
 * pushed commits, which it cannot when this checkout lacks main's commit before the push.
 */
export function refusal(readable: boolean): string {
	return [
		'pre-push: work reaches main through a pull request, so this push to main is refused (D-379).',
		'Push your branch and open a pull request against main:',
		'  git push -u origin HEAD:<branch>',
		'  gh pr create --base main',
		"CI judges the pull request, and it lands when it merges. See .dev/pull-requests.md, 'Landing a branch'.",
		readable
			? `Only in an emergency that the owner calls, add a \`${SKIP_TRAILER}: <reason>\` trailer to a commit of the push.`
			: `This checkout does not hold main's commit before the push, so the hook cannot read the pushed commits' trailers. Fetch main (\`git fetch origin main\`) first. Only in an emergency that the owner calls, add a \`${SKIP_TRAILER}: <reason>\` trailer to a commit of the push.`,
	].join('\n');
}

function main(): void {
	const push = pushToMain(parsePush(readFileSync(0, 'utf8')));
	if (!push) return;
	const base = baseOf(push);
	const reason =
		base === undefined
			? undefined
			: skipReason(keptCommits(`${base}..${push.localSha}`).map(({ message }) => message));
	if (reason) {
		console.log(`pre-push: a direct push to main, in an emergency, as a commit says: ${reason}`);
		return;
	}
	console.error(`${refusal(base !== undefined)}\n`);
	process.exit(1);
}

if (import.meta.main) main();
