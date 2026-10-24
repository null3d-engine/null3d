import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
	baseOf,
	changedCrates,
	GUARD_TESTS,
	guardSteps,
	keepaliveSeconds,
	LANDING_VARIABLE,
	MILESTONE_REF,
	milestoneRefusal,
	parsePush,
	plan,
	pushToMain,
	pushToMilestone,
	SKIP_TRAILER,
	skipReason,
	sshHost,
} from './pre-push';

const MAIN = 'refs/heads/main';
const ZERO = '0000000000000000000000000000000000000000';
const CRATES = new Map([
	['null3d-core', 'null3d-core'],
	['null3d-render', 'null3d-render'],
	['null3d-shaders', 'null3d-shaders'],
]);

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

describe('the milestone branch', () => {
	const line = (remoteRef: string, localSha = 'a1', remoteSha = 'b2') =>
		`refs/heads/work ${localSha} ${remoteRef} ${remoteSha}`;

	it('finds the push to m3-start, including one that deletes it', () => {
		const refs = parsePush(`${line('refs/heads/work')}\n${line(MILESTONE_REF)}\n`);
		expect(pushToMilestone(refs)?.remoteRef).toBe(MILESTONE_REF);
		expect(pushToMilestone(parsePush(line(MILESTONE_REF, ZERO)))).toBeDefined();
		expect(pushToMilestone(parsePush(line('refs/heads/work')))).toBeUndefined();
	});

	it('refuses a helper its push to m3-start, and names the variable for the landing', () => {
		const message = milestoneRefusal(parsePush(line(MILESTONE_REF)), false);
		expect(message).toContain(MILESTONE_REF);
		expect(message).toContain(LANDING_VARIABLE);
		expect(message).toContain('only the coordinator');
	});

	it('allows the same push when the coordinator sets the landing variable', () => {
		expect(milestoneRefusal(parsePush(line(MILESTONE_REF)), true)).toBeUndefined();
	});

	it('leaves a push to another branch alone', () => {
		const refs = parsePush(line('refs/heads/fix/platform-claim-gaps'));
		expect(milestoneRefusal(refs, false)).toBeUndefined();
		expect(milestoneRefusal(parsePush(''), false)).toBeUndefined();
	});
});

describe('baseOf', () => {
	const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

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

describe('sshHost', () => {
	it('reads the host of an ssh remote, in either spelling', () => {
		expect(sshHost('git@github.com:null3d-engine/null3d.git')).toBe('github.com');
		expect(sshHost('ssh://git@github.com/null3d-engine/null3d.git')).toBe('github.com');
		expect(sshHost('ssh://git@github.com:22/null3d-engine/null3d.git')).toBe('github.com');
	});

	it('gives nothing for another transport, and for a local path', () => {
		expect(sshHost('https://github.com/null3d-engine/null3d.git')).toBeUndefined();
		expect(sshHost('/tmp/remote.git')).toBeUndefined();
		expect(sshHost('./remote.git')).toBeUndefined();
		expect(sshHost('')).toBeUndefined();
	});
});

describe('keepaliveSeconds', () => {
	it('reads the interval that an ssh command line asks for', () => {
		expect(keepaliveSeconds('ssh -o ServerAliveInterval=20')).toBe(20);
		expect(keepaliveSeconds('ssh -oServerAliveInterval=20')).toBe(20);
		expect(keepaliveSeconds('ssh -o ServerAliveInterval 20')).toBe(20);
	});

	it('reads nothing from a command line that does not ask', () => {
		expect(keepaliveSeconds('ssh -o BatchMode=yes')).toBe(0);
		expect(keepaliveSeconds(undefined)).toBe(0);
	});
});

describe('changedCrates', () => {
	it('names the crates whose files changed', () => {
		const files = [
			'crates/null3d-render/src/output.rs',
			'crates/null3d-core/Cargo.toml',
			'docs/a.md',
		];
		expect(changedCrates(files, CRATES)).toEqual(['null3d-core', 'null3d-render']);
	});

	it('names every crate when the workspace settings change', () => {
		expect(changedCrates(['Cargo.lock'], CRATES)).toEqual([...CRATES.values()].sort());
		expect(changedCrates(['rust-toolchain.toml'], CRATES)).toHaveLength(3);
	});
});

describe('guardSteps', () => {
	it('checks the decision records and runs the tests that read every package and spec', () => {
		expect(guardSteps().map((step) => [step.lane, step.command.join(' ')])).toEqual([
			['DIRECT', 'bun tools/decisions.ts --check'],
			['DIRECT', `bun test ${GUARD_TESTS.join(' ')}`],
		]);
		for (const file of GUARD_TESTS) expect(existsSync(file), file).toBe(true);
	});
});

describe('plan', () => {
	const commands = (files: string[], nextest = true) =>
		plan('b2', 'a1', files, CRATES, nextest).map((step) => [step.lane, step.command.join(' ')]);

	it('checks only the messages, trailers and merges of a push that changes no Rust code', () => {
		expect(commands(['packages/engine/src/index.ts', '.dev/x.md'])).toEqual([
			['QUICK', 'bunx commitlint --from b2 --to a1'],
			['QUICK', 'bun tools/hooks/check-trailers.ts b2..a1'],
			['QUICK', 'bun tools/hooks/check-merges.ts b2..a1'],
			['DIRECT', 'bun tools/decisions.ts --check'],
			[
				'DIRECT',
				'bun test tools/lib/release.test.ts tools/lib/network-use.test.ts tests/lib/priority-setup.test.ts tools/lib/ci-workflow.test.ts',
			],
		]);
	});

	it('compiles the workspace and tests the changed crates, with every failure reported', () => {
		expect(commands(['crates/null3d-render/src/output.rs'])).toEqual([
			['QUICK', 'bunx commitlint --from b2 --to a1'],
			['QUICK', 'bun tools/hooks/check-trailers.ts b2..a1'],
			['QUICK', 'bun tools/hooks/check-merges.ts b2..a1'],
			['DIRECT', 'bun tools/decisions.ts --check'],
			[
				'DIRECT',
				'bun test tools/lib/release.test.ts tools/lib/network-use.test.ts tests/lib/priority-setup.test.ts tools/lib/ci-workflow.test.ts',
			],
			['CPU_ONLY', 'cargo check --workspace'],
			['CPU_ONLY', 'cargo nextest run --no-fail-fast --profile ci -p null3d-render'],
		]);
	});

	it('runs cargo test without the whole shader build when nextest is missing', () => {
		const steps = commands(['crates/null3d-shaders/src/lib.rs'], false);
		expect(steps.at(-1)?.[1]).toBe(
			'cargo test --no-fail-fast -p null3d-shaders -- --skip the_repository_build_is_the_same_each_time_and_keeps_every_portability_rule',
		);
	});

	it('compiles the workspace for a Rust file outside the crates, with no crate to test', () => {
		expect(commands(['tools/fixtures/disallowed-clock/src/main.rs'])).toHaveLength(6);
		expect(commands(['tools/fixtures/disallowed-clock/src/main.rs']).at(-1)?.[1]).toBe(
			'cargo check --workspace',
		);
	});
});
