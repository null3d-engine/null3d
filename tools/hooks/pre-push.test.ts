import { describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { baseOf, parsePush, pushToMain, refusal, SKIP_TRAILER, skipReason } from './pre-push';

const MAIN = 'refs/heads/main';
const ZERO = '0000000000000000000000000000000000000000';
const HOOK = join(import.meta.dirname, 'pre-push.ts');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

/** The hook's run on one line of git's input: its status and what it printed. */
function runHook(input: string): { status: number | null; said: string } {
	const run = spawnSync('bun', [HOOK], { input, encoding: 'utf8' });
	return { status: run.status, said: `${run.stdout}${run.stderr}` };
}

describe('pushToMain', () => {
	const line = (remoteRef: string, localSha = 'a1', remoteSha = 'b2') =>
		`refs/heads/work ${localSha} ${remoteRef} ${remoteSha}`;

	it('finds the push to main among the pushed refs', () => {
		const refs = parsePush(`${line('refs/heads/work')}\n${line(MAIN)}\n`);
		expect(refs).toHaveLength(2);
		expect(pushToMain(refs)?.remoteRef).toBe(MAIN);
	});

	it('ignores a push that only saves a branch, and one that deletes main', () => {
		expect(pushToMain(parsePush(line('refs/heads/work')))).toBeUndefined();
		expect(pushToMain(parsePush(line(MAIN, ZERO)))).toBeUndefined();
		expect(pushToMain(parsePush(''))).toBeUndefined();
	});
});

describe('the hook', () => {
	it('lets a push to any other branch through at once', () => {
		const { status, said } = runHook(`refs/heads/work ${head} refs/heads/work ${ZERO}\n`);
		expect(status).toBe(0);
		expect(said).toBe('');
	});

	it('refuses a direct push to main, and says to open a pull request', () => {
		// The commit before the push is the pushed commit itself, so the push adds no commit, and no
		// commit can carry the emergency trailer.
		const { status, said } = runHook(`refs/heads/work ${head} ${MAIN} ${head}\n`);
		expect(status).toBe(1);
		expect(said).toContain('work reaches main through a pull request');
		expect(said).toContain('gh pr create --base main');
		expect(said).toContain(`${SKIP_TRAILER}: <reason>`);
	});
});

describe('refusal', () => {
	it('asks for a fetch when the hook cannot read the pushed commits', () => {
		expect(refusal(false)).toContain('git fetch origin main');
		expect(refusal(true)).not.toContain('git fetch origin main');
	});
});

describe('baseOf', () => {
	it('takes the commit that git reports for main', () => {
		expect(baseOf({ localRef: 'HEAD', localSha: head, remoteRef: MAIN, remoteSha: head })).toBe(
			head,
		);
	});

	it('gives nothing when no ref can meet a commit this checkout does not hold', () => {
		const absent = 'a'.repeat(40);
		expect(
			baseOf({ localRef: 'HEAD', localSha: absent, remoteRef: MAIN, remoteSha: absent }),
		).toBeUndefined();
	});
});

describe('skipReason', () => {
	it('reads the reason that a skip trailer gives', () => {
		const message = `fix: restore main\n\nbody\n\n${SKIP_TRAILER}: main is red and the queue is stopped\n`;
		expect(skipReason(['feat: x', message])).toBe('main is red and the queue is stopped');
	});

	it('does not skip on a trailer without a reason, or on no trailer', () => {
		expect(skipReason([`fix: x\n\n${SKIP_TRAILER}:\n`])).toBeUndefined();
		expect(
			skipReason([`fix: x\n\n${SKIP_TRAILER}:\nDocs-Checked: read the guide`]),
		).toBeUndefined();
		expect(skipReason(['fix: x\n\nDocs-Checked: read the guide'])).toBeUndefined();
	});
});
