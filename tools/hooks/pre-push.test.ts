import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaledBudget } from '../../tests/lib/run-budget.ts';
import { exactTestPath } from '../../tests/lib/test-paths';
import {
	addedStatusLines,
	baseOf,
	changedCrates,
	crateTests,
	GUARD_TESTS,
	guardSteps,
	keepaliveSeconds,
	LANDING_VARIABLE,
	landingRefusal,
	landingSteps,
	MILESTONE_REF,
	milestoneRefusal,
	parsePush,
	plan,
	pushToMain,
	pushToMilestone,
	SKIP_TRAILER,
	STATUS_CHANGE_VARIABLE,
	skipReason,
	sshHost,
	statusAt,
	statusLines,
	statusOf,
	statusRefusal,
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

	it('refuses a helper its push to m3-start, names the CI session and points a landing session elsewhere', () => {
		const message = milestoneRefusal(parsePush(line(MILESTONE_REF)), false);
		expect(message).toContain(MILESTONE_REF);
		expect(message).toContain(LANDING_VARIABLE);
		expect(message).toContain('only the CI session that gates each landing');
		expect(message).toContain('A landing session pushes its own range branch');
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

describe('the milestone status', () => {
	const stale = 'stale: M3-A10 is marked unfinished or on a branch but has evidence';
	const owed = 'owed: M3-G5 landed with no entry in tools/task-evidence.ts, so its box stays empty';

	it("reads only the check's problem lines", () => {
		expect(statusLines(`body\n${stale}\nnote\n${owed}\n`)).toEqual([stale, owed]);
	});

	it('lets a landing remove a problem line, and refuses one that it adds, naming the line and its task', () => {
		expect(addedStatusLines([stale, owed], [stale])).toEqual([]);
		const added = addedStatusLines([stale], [stale, owed]);
		expect(added).toEqual([owed]);
		expect(statusRefusal([], 'a3bbedbb5', undefined)).toBeUndefined();
		const message = statusRefusal(added, 'a3bbedbb5', undefined);
		expect(message).toContain('a3bbedbb5');
		expect(message).toContain(`  M3-G5: ${owed}`);
		expect(message).toContain(STATUS_CHANGE_VARIABLE);
	});

	it('lets a landing that changes the status on purpose pass with a reason', () => {
		expect(statusRefusal([owed], 'a3bbedbb5', 'the landing unticks M3-G5')).toBeUndefined();
	});

	it('says when the check did not run at the base, so every line counts as added', () => {
		const one = statusRefusal([stale], '9369b1380', undefined, false);
		expect(one?.split('\n')[0]).toBe(
			"pre-push: the status check did not run at 9369b1380, such as where the branch left main, so the pushed commit's one problem counts as added:",
		);
		expect(one).toContain(`  M3-A10: ${stale}`);
		const two = statusRefusal([stale, owed], '9369b1380', undefined, false);
		expect(two?.split('\n')[0]).toContain(
			"so each of the pushed commit's 2 problems counts as added:",
		);
		expect(statusRefusal([owed], 'a3bbedbb5', undefined)?.split('\n')[0]).toBe(
			'pre-push: this landing adds a problem to the milestone status that a3bbedbb5 does not have:',
		);
		expect(statusRefusal([stale, owed], 'a3bbedbb5', undefined)?.split('\n')[0]).toBe(
			'pre-push: this landing adds 2 problems to the milestone status that a3bbedbb5 does not have:',
		);
	});

	it('names a task whose id ends in a letter', () => {
		const line =
			'owed: M3-D9a landed with no entry in tools/task-evidence.ts, so its box stays empty';
		expect(statusRefusal([line], 'a3bbedbb5', undefined)).toContain(`  M3-D9a: ${line}`);
	});

	it(
		"reads the same lines from a commit's own worktree as from this checkout at that commit",
		() => {
			const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
			expect(statusAt(head)).toEqual(statusOf('.'));
		},
		scaledBudget(60_000),
	);

	it(
		"reads a base at its own commit, even from a linked worktree's hook, and stages nothing",
		() => {
			// A scratch repository whose status tool prints the lines that its own tools/ hold, and a line
			// that names the commit its git calls read, so a reading shows which commit's tools ran and
			// which history they read.
			const repo = mkdtempSync(join(tmpdir(), 'null3d-status-test-'));
			// The machine's own git settings, such as hooks or signing, play no part in the scratch repository.
			const run = (cwd: string, ...args: string[]) =>
				execFileSync(
					'git',
					['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
					{
						cwd,
						encoding: 'utf8',
					},
				).trim();
			const tool = `import { LINES } from './lines.ts';
const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim();
for (const line of LINES) console.error(line);
console.error(\`stale: M3-H1 reads history at \${head}\`);
process.exit(LINES.some((line) => line.startsWith('owed:')) ? 1 : 0);
`;
			try {
				run(repo, 'init', '--quiet', '-b', 'main');
				run(repo, 'config', 'user.email', 'test@example.com');
				run(repo, 'config', 'user.name', 'test');
				mkdirSync(join(repo, 'tools'));
				mkdirSync(join(repo, '.internal/plan'), { recursive: true });
				writeFileSync(join(repo, '.internal/plan/m3-breakdown.md'), 'plan\n');
				writeFileSync(join(repo, '.gitignore'), '.internal\n');
				writeFileSync(join(repo, 'tools/pr-status.ts'), tool);
				writeFileSync(
					join(repo, 'tools/lines.ts'),
					`export const LINES = [${JSON.stringify(stale)}];\n`,
				);
				run(repo, 'add', '.');
				run(repo, 'commit', '--quiet', '-m', 'base');
				const base = run(repo, 'rev-parse', 'HEAD');
				writeFileSync(
					join(repo, 'tools/lines.ts'),
					`export const LINES = [${JSON.stringify(stale)}, ${JSON.stringify(owed)}];\n`,
				);
				run(repo, 'commit', '--quiet', '-am', 'head');
				const head = run(repo, 'rev-parse', 'HEAD');
				const at = (commit: string) => `stale: M3-H1 reads history at ${commit}`;
				expect(statusOf(repo)).toEqual({ lines: [stale, owed, at(head)], ran: true });
				expect(statusAt(base, repo)).toEqual({ lines: [stale, at(base)], ran: true });
				// A push from a linked worktree runs its hook with GIT_DIR set to that worktree's own folder.
				const linked = join(repo, 'linked');
				run(repo, 'worktree', 'add', '--quiet', linked, 'HEAD');
				symlinkSync(join(repo, '.internal'), join(linked, '.internal'));
				const gitDir = run(linked, 'rev-parse', '--absolute-git-dir');
				const hook = { ...process.env, GIT_DIR: gitDir };
				expect(statusAt(base, linked, hook)).toEqual({ lines: [stale, at(base)], ran: true });
				expect(run(linked, 'status', '--porcelain', '--untracked-files=no')).toBe('');
				expect(run(repo, 'worktree', 'list').split('\n')).toHaveLength(2);
				// Without its plan the check does not run, and the reading says so.
				rmSync(join(linked, '.internal'));
				expect(statusOf(linked).ran).toBe(false);
			} finally {
				rmSync(repo, { recursive: true, force: true });
			}
		},
		scaledBudget(60_000),
	);
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
			['DIRECT', 'bun run check'],
			['DIRECT', `bun test ${GUARD_TESTS.map(exactTestPath).join(' ')}`],
		]);
		for (const file of GUARD_TESTS) expect(existsSync(file), file).toBe(true);
	});
});

describe('landingSteps', () => {
	const lanes = (files: string[], withCrateTests = true) =>
		landingSteps(files, CRATES, true, withCrateTests).map((step) => [
			step.lane,
			step.command.join(' '),
		]);

	// The next two tests leave out the commit range, which a real landing always passes, to judge the
	// guards and the crate tests alone; the commit checks come first, as the test after them shows.
	it('adds no crate tests to the guards unless they are asked for', () => {
		const guards = guardSteps().map((step) => [step.lane, step.command.join(' ')]);
		expect(lanes(['crates/null3d-render/src/textures.rs'], false)).toEqual(guards);
		expect(landingSteps(['crates/null3d-render/src/textures.rs'], CRATES, true)).toEqual(
			guardSteps(),
		);
	});

	it('adds no crate tests to the guards for a landing that changes no Rust', () => {
		const guards = guardSteps().map((step) => [step.lane, step.command.join(' ')]);
		expect(lanes(['.dev/x.md'])).toEqual(guards);
		expect(lanes(['packages/engine/src/index.ts', 'tests/lib/x.test.ts'])).toEqual(guards);
	});

	it("checks a landing's messages from where its branch left main, and the commits it adds", () => {
		// An earlier commit of the branch may carry the GPU check's or the Mac references' trailer that a
		// later one needs, so the messages are read over the whole branch, as CI's commits job reads them.
		const added = { base: 'b2', head: 'a1', mainBase: 'm0' };
		const steps = landingSteps(['.dev/x.md'], CRATES, true, false, added).map((step) => [
			step.lane,
			step.command.join(' '),
		]);
		expect(steps).toEqual([
			['DIRECT', 'bunx commitlint --from m0 --to a1'],
			['DIRECT', 'bun tools/hooks/check-trailers.ts m0..a1'],
			['DIRECT', 'bun tools/hooks/check-merges.ts b2..a1'],
			['DIRECT', 'bun tools/hooks/check-copies.ts b2..a1'],
			...guardSteps().map((step) => [step.lane, step.command.join(' ')]),
		]);
	});

	it('refuses a landing that this checkout cannot check, and says what to fetch or check out', () => {
		const landing = { localRef: 'HEAD', localSha: 'a1', remoteRef: MILESTONE_REF, remoteSha: 'b2' };
		expect(landingRefusal(landing, 'a1', true, 'm0')).toBeUndefined();
		expect(landingRefusal(landing, 'c3', true, 'm0')).toContain(
			'Check out the commit that you push',
		);
		expect(landingRefusal(landing, 'a1', false, 'm0')).toContain('git fetch origin m3-start');
		expect(landingRefusal(landing, 'a1', true, undefined)).toContain('git fetch origin main');
		// A first push of the branch has no commit on the remote, and is read from where it left main.
		const first = { ...landing, remoteSha: ZERO };
		expect(landingRefusal(first, 'a1', false, 'm0')).toBeUndefined();
		expect(landingRefusal(first, 'a1', false, undefined)).toContain('git fetch origin main');
	});

	it('tests the crates that a landing changes, in the CPU lane, and checks no whole workspace', () => {
		const steps = lanes(['crates/null3d-render/src/textures.rs', 'packages/engine/src/index.ts']);
		expect(steps.slice(0, -1)).toEqual(
			guardSteps().map((step) => [step.lane, step.command.join(' ')]),
		);
		expect(steps.at(-1)).toEqual([
			'CPU_ONLY',
			'cargo nextest run --no-fail-fast --profile ci -p null3d-render',
		]);
		expect(steps.some(([, command]) => command?.includes('--workspace'))).toBe(false);
	});

	it('shares the crate tests with a push to main', () => {
		const files = ['crates/null3d-render/src/textures.rs'];
		expect(crateTests(files, CRATES, true)).toEqual(plan('b2', 'a1', files, CRATES, true).at(-1));
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
			['QUICK', 'bun tools/hooks/check-copies.ts b2..a1'],
			['DIRECT', 'bun tools/decisions.ts --check'],
			['DIRECT', 'bun run check'],
			[
				'DIRECT',
				'bun test ./tools/lib/release.test.ts ./tools/lib/cdn.test.ts ./tools/lib/network-use.test.ts ./tests/lib/priority-setup.test.ts ./tools/lib/ci-workflow.test.ts ./tools/lib/size-report.test.ts',
			],
		]);
	});

	it('compiles the workspace and tests the changed crates, with every failure reported', () => {
		expect(commands(['crates/null3d-render/src/output.rs'])).toEqual([
			['QUICK', 'bunx commitlint --from b2 --to a1'],
			['QUICK', 'bun tools/hooks/check-trailers.ts b2..a1'],
			['QUICK', 'bun tools/hooks/check-merges.ts b2..a1'],
			['QUICK', 'bun tools/hooks/check-copies.ts b2..a1'],
			['DIRECT', 'bun tools/decisions.ts --check'],
			['DIRECT', 'bun run check'],
			[
				'DIRECT',
				'bun test ./tools/lib/release.test.ts ./tools/lib/cdn.test.ts ./tools/lib/network-use.test.ts ./tests/lib/priority-setup.test.ts ./tools/lib/ci-workflow.test.ts ./tools/lib/size-report.test.ts',
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
		expect(commands(['tools/fixtures/disallowed-clock/src/main.rs'])).toHaveLength(8);
		expect(commands(['tools/fixtures/disallowed-clock/src/main.rs']).at(-1)?.[1]).toBe(
			'cargo check --workspace',
		);
	});
});
