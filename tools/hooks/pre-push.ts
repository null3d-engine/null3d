// Pre-push guard for pushes to main (D-157). A push to the milestone branch is refused unless the
// session that checks each landing sets NULL3D_MILESTONE_LANDING=1: a helper saves its work on its
// own branch, the coordinator merges it, and that session, the CI session (D-259), checks the range
// and pushes it. The landing's push is refused when this checkout does not hold the pushed commit
// as its HEAD, the branch's commit on the remote, or a copy of the remote's main. It first checks
// the commits as a push to main does: the messages and trailers from where the branch left main, as
// CI's `commits` job reads them, and the merges and copies among the commits it adds. Then it runs
// the guards that read the whole repository, which a merge can break with no conflict: the decision
// records' numbers, and the unit tests that hold the release guide, the shipped network calls and
// the timing specs' switches to every package and spec in the tree, and the repository's quick
// check, with the lint, the picture references and the add-on checks. They take seconds, where the
// unit suite takes minutes, and without them each such fault shows only a CI run later.
// With NULL3D_LANDING_CRATE_TESTS=1, a landing that changes Rust also runs the tests of the crates
// it changes, in the queue's CPU lane, which can wait long on a loaded machine. A landing may also
// add no problem to the milestone status: the status tool's check (`bun tools/pr-status.ts
// --check`) runs on the pushed commit and on the branch's commit on the remote, and a `stale:` or
// `owed:` line that only the pushed commit has refuses the push, with the line and its task. A push
// may remove such lines. When the landing changes the status on purpose,
// NULL3D_STATUS_CHANGE=<reason> lets it pass and prints the reason with the lines it lets through.
// The check must run on the pushed commit, which needs the checkout's plan, whatever the reason; a
// base where it does not run, such as where the branch left main on a first push, reads as no
// lines, so such a push needs the reason. Any other branch only saves work, so the hook runs
// nothing for it. A push to
// main runs those guards too, and first checks the commits it adds:
//   1. their messages and trailers, with commitlint and check-trailers.ts over main's commit before
//      the push up to the push, as CI's `commits` job does, their merges, with check-merges.ts,
//      which refuses a merge that carries new work, and with check-copies.ts, any second copy of a
//      commit that the branch already holds;
//   2. when the push changes Rust code or Cargo settings, `cargo check --workspace`, since a merge
//      that keeps both sides of a struct or a constant often looks valid until it compiles;
//   3. then the tests of each crate that the push changes, through cargo-nextest's `ci` profile with
//      --no-fail-fast, or cargo test when nextest is missing. The test that builds every shader
//      runs in CI only: it takes half an hour or more.
// A machine's job queue runs the steps when git's `null3d.jobQueue` setting, or the environment's
// NULL3D_JOB_QUEUE, names its script: the trailer check in its quick lane, the cargo steps in its
// CPU lane, so a push does not load a busy machine outside the queue. The guards over the tree run
// outside it: they are a few seconds of work, and inside it on a loaded machine the wait for a
// quick slot plus their run would pass the lane's five-minute limit and refuse the landing, which
// leaves only the emergency trailer to get past a slow machine. Elsewhere the steps run directly.
// The emergency bypass is a `Push-Check-Skipped: <reason>` trailer on a pushed commit.
// git opens the connection to the remote before it runs this check, and holds it, silent, for the
// whole check, so the machine's ssh must keep that connection alive: a peer closes a quiet one after
// a few minutes, and git then writes the push into a socket that has gone. The push ends with no
// message from git, nothing pushed, and a status that says only that a write failed. The check
// refuses such a push and names the setting, since a queue that makes the check long makes a lost
// connection likely.
// The check compares with the commit that git reports for main before the push. When the remote
// holds no such commit to compare with, and no local main ref meets the pushed commit, it refuses
// the push and asks for a fetch, since it cannot say what the push adds.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { exactTestPath } from '../../tests/lib/test-paths';
import { repositoryEnv } from '../lib/git-env';
import { touchesRust } from './check-rust';
import { keptCommits } from './check-trailers';

/** The trailer that skips the check, with the reason for the emergency. */
export const SKIP_TRAILER = 'Push-Check-Skipped';
/** The milestone branch, which only the session that checks each landing pushes. */
export const MILESTONE_REF = 'refs/heads/m3-start';
/**
 * The variable that names the session that checks and pushes each landing, the CI session
 * (D-259). A helper leaves it unset, so its push to the milestone branch is refused.
 */
export const LANDING_VARIABLE = 'NULL3D_MILESTONE_LANDING';
/**
 * The variable whose reason lets a landing add a problem to the milestone status, for a landing that
 * changes the status on purpose.
 */
export const STATUS_CHANGE_VARIABLE = 'NULL3D_STATUS_CHANGE';
/** The test that builds every shader, which CI runs in a job of its own. */
const WHOLE_SHADER_BUILD =
	'the_repository_build_is_the_same_each_time_and_keeps_every_portability_rule';
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

/** The push to the milestone branch among the pushed refs, including a push that deletes it. */
export function pushToMilestone(refs: readonly PushedRef[]): PushedRef | undefined {
	return refs.find((ref) => ref.remoteRef === MILESTONE_REF);
}

/**
 * The message that refuses a push to the milestone branch from a session that does not check the
 * landings, or undefined when the push may go ahead. A helper saves its work on its own branch, the
 * coordinator merges it, and the CI session checks the range and pushes it, so a helper's push here
 * would put unchecked work on the branch that every other helper and CI read.
 */
export function milestoneRefusal(refs: readonly PushedRef[], landing: boolean): string | undefined {
	if (landing || !pushToMilestone(refs)) return undefined;
	return `pre-push: this push writes ${MILESTONE_REF}, and only the session that checks the landings pushes the milestone branch. Push your own branch and let the coordinator land it. If you are that session, set ${LANDING_VARIABLE}=1 for the push.`;
}

/** The reason that a `Push-Check-Skipped:` trailer gives on any of the messages, if one does. */
export function skipReason(messages: readonly string[]): string | undefined {
	const trailer = new RegExp(`^${SKIP_TRAILER}:[ \\t]*(\\S.*)$`, 'm');
	for (const message of messages) {
		const reason = trailer.exec(message)?.[1]?.trim();
		if (reason) return reason;
	}
	return undefined;
}

/** The host that an ssh remote reaches, or undefined when the remote is another transport. */
export function sshHost(url: string): string | undefined {
	const scheme = /^(?:ssh|git\+ssh):\/\/(?:[^@/]*@)?([^:/]+)/.exec(url);
	if (scheme?.[1]) return scheme[1];
	if (url.includes('://') || /^[./~]/.test(url)) return undefined;
	return /^(?:[^@/]+@)?([^:/]+):/.exec(url)?.[1];
}

/**
 * The keepalive interval that a command line asks ssh for, in seconds, or 0 when it asks for none. A
 * `-o ServerAliveInterval=` option wins over the ssh configuration, as ssh reads it itself.
 */
export function keepaliveSeconds(command: string | undefined): number {
	const asked = /serveraliveinterval[= \t]*(\d+)/i.exec(command ?? '');
	return asked ? Number(asked[1]) : 0;
}

/**
 * The packages of the crates that the changed files belong to, by folder name, from the crate
 * folders and their package names. A change to the workspace's own Cargo files or Rust settings, at
 * the repository's root, reaches every crate.
 */
export function changedCrates(
	files: readonly string[],
	crates: ReadonlyMap<string, string>,
): string[] {
	const everyCrate = files.some((file) => !file.includes('/') && touchesRust([file]));
	const names = new Set<string>();
	for (const [folder, name] of crates)
		if (everyCrate || files.some((file) => file.startsWith(`crates/${folder}/`))) names.add(name);
	return [...names].sort();
}

/**
 * The unit tests that read every package, spec or crate of the repository, so a merge that adds one
 * can break them: the release guide's package table, the CDN build's add-ons, the record of shipped
 * network calls, the timing specs' switch names, CI's workflow against the scripts and files
 * that its jobs read, and the size report's list of the engine's parts, which two landings can each
 * change so that a name repeats or a part finds the wrong file.
 * Each file takes a few seconds at most.
 */
export const GUARD_TESTS = [
	'tools/lib/release.test.ts',
	'tools/lib/cdn.test.ts',
	'tools/lib/network-use.test.ts',
	'tests/lib/priority-setup.test.ts',
	'tools/lib/ci-workflow.test.ts',
	'tools/lib/size-report.test.ts',
] as const;

/** One step of the check: what it runs, why, and the queue lane it takes, or none. */
export interface Step {
	why: string;
	lane: 'QUICK' | 'CPU_ONLY' | 'DIRECT';
	command: string[];
}

/** The checks of the whole tree that a push to main and a landing on the milestone branch run. */
export function guardSteps(): Step[] {
	return [
		{
			why: 'two decision records must not share a number, which a merge can bring together',
			lane: 'DIRECT',
			command: ['bun', 'tools/decisions.ts', '--check'],
		},
		{
			why: 'a merge can add a picture test without its references, or code that the lint and the add-on checks refuse',
			lane: 'DIRECT',
			command: ['bun', 'run', 'check'],
		},
		{
			why: 'a merge can add a package, a network call or a timing spec that a repository-wide guard must know',
			lane: 'DIRECT',
			command: ['bun', 'test', ...GUARD_TESTS.map(exactTestPath)],
		},
	];
}

/** The steps for a push that adds `base..head` to main and changes `files`. */
export function plan(
	base: string,
	head: string,
	files: readonly string[],
	crates: ReadonlyMap<string, string>,
	nextest: boolean,
): Step[] {
	const steps: Step[] = [...commitSteps(base, base, head, 'main', 'QUICK'), ...guardSteps()];
	if (!touchesRust([...files])) return steps;
	steps.push({
		why: 'the push changes Rust code or Cargo settings, so the merged workspace must compile',
		lane: 'CPU_ONLY',
		command: ['cargo', 'check', '--workspace'],
	});
	const tests = crateTests(files, crates, nextest);
	return tests ? [...steps, tests] : steps;
}

/**
 * The checks of the commits that a push adds to `target` up to `head`: the messages and trailers of
 * every commit since `messagesFrom`, and of every commit since `added`, its merges, which must hold
 * only resolutions and mechanical fixes, and that none is a second copy of a commit that the branch
 * already holds. A push to main reads both from main's commit before the push. A landing reads the
 * messages from where its branch left main, as CI's `commits` job does: the GPU check's and the Mac
 * references' trailers are read over the whole range, so an earlier commit of the branch may carry
 * the trailer that a later one needs.
 */
function commitSteps(
	messagesFrom: string,
	added: string,
	head: string,
	target: string,
	lane: Step['lane'],
): Step[] {
	return [
		{
			why: `the commits that the push adds to ${target} must follow the commit message rules`,
			lane,
			command: ['bunx', 'commitlint', '--from', messagesFrom, '--to', head],
		},
		{
			why: `the commits that the push adds to ${target} must carry their trailers`,
			lane,
			command: ['bun', 'tools/hooks/check-trailers.ts', `${messagesFrom}..${head}`],
		},
		{
			why: `a merge commit that the push adds to ${target} must hold only resolutions and mechanical fixes`,
			lane,
			command: ['bun', 'tools/hooks/check-merges.ts', `${added}..${head}`],
		},
		{
			why: `a branch from before a history rewrite would put second copies of commits on ${target}`,
			lane,
			command: ['bun', 'tools/hooks/check-copies.ts', `${added}..${head}`],
		},
	];
}

/** The tests of the crates that `files` change, or none when they change no crate. */
export function crateTests(
	files: readonly string[],
	crates: ReadonlyMap<string, string>,
	nextest: boolean,
): Step | undefined {
	const names = changedCrates(files, crates);
	if (names.length === 0) return undefined;
	const packages = names.flatMap((name) => ['-p', name]);
	return {
		why: `the push changes these crates, so their tests must pass: ${names.join(', ')}`,
		lane: 'CPU_ONLY',
		command: nextest
			? ['cargo', 'nextest', 'run', '--no-fail-fast', '--profile', 'ci', ...packages]
			: ['cargo', 'test', '--no-fail-fast', ...packages, '--', '--skip', WHOLE_SHADER_BUILD],
	};
}

/** The variable that asks a landing's push to test the crates it changes as well. */
export const LANDING_CRATE_TESTS = 'NULL3D_LANDING_CRATE_TESTS';

/**
 * The steps of a landing on the milestone branch that changes `files`: the checks of its commits,
 * the guards over the tree, and, when `crateTests` asks for them and the landing changes Rust, the
 * tests of the crates it changes, in the queue's CPU lane. With `added`, the commits are those after
 * `added.base`, and their messages are read from `added.mainBase`, where the branch left main. The
 * commit and guard checks run outside the queue and take seconds. The crate tests are opt-in: on a
 * loaded machine the CPU lane's slots stay busy for an hour, so a landing's push can wait there 27
 * minutes or more without starting cargo, until its timeout kills the push and leaves the hook
 * waiting. CI's Rust tests still catch a crate's fault, one run after the landing.
 */
export function landingSteps(
	files: readonly string[],
	crates: ReadonlyMap<string, string>,
	nextest: boolean,
	withCrateTests = false,
	added?: { base: string; head: string; mainBase: string },
): Step[] {
	const checks = [
		...(added
			? commitSteps(added.mainBase, added.base, added.head, 'the milestone branch', 'DIRECT')
			: []),
		...guardSteps(),
	];
	const tests =
		withCrateTests && touchesRust([...files]) ? crateTests(files, crates, nextest) : undefined;
	return tests ? [...checks, tests] : checks;
}

/**
 * How much a `git log` of the pull request's range may print. The default of one mebibyte is lost
 * once the range holds a night's worth of commits with their evidence in the messages, and the read
 * then fails with ENOBUFS rather than a verdict on the range.
 */
const BUFFER = 64 * 1024 * 1024;

const git = (...args: string[]) =>
	execFileSync('git', args, { encoding: 'utf8', maxBuffer: BUFFER }).trim();

/** The status check's problem lines in its output: each `stale: …` or `owed: …` line, in order. */
export function statusLines(output: string): string[] {
	return output.split('\n').filter((line) => /^(stale|owed): /.test(line));
}

/** The problem lines that `head` has and `base` lacks, which a landing may not add. */
export function addedStatusLines(base: readonly string[], head: readonly string[]): string[] {
	const had = new Set(base);
	return head.filter((line) => !had.has(line));
}

/**
 * Why a landing may not go, when it adds a problem line to the milestone status and no reason lets it,
 * with each line and its task. Undefined when it adds none, or when `reason` lets it. When the check
 * did not run at the base, every line counts as added, and the refusal says why.
 */
export function statusRefusal(
	added: readonly string[],
	base: string,
	reason: string | undefined,
	baseRan = true,
): string | undefined {
	if (added.length === 0 || reason) return undefined;
	const lines = added.map(
		(line) => `  ${/\bM\d+-[A-Z0-9]+[a-z]?/.exec(line)?.[0] ?? 'no task'}: ${line}`,
	);
	const count = added.length === 1 ? 'a problem' : `${added.length} problems`;
	return [
		baseRan
			? `pre-push: this landing adds ${count} to the milestone status that ${base} does not have:`
			: `pre-push: the status check did not run at ${base}, such as where the branch left main, so ${added.length === 1 ? "the pushed commit's one problem counts" : `each of the pushed commit's ${added.length} problems counts`} as added:`,
		...lines,
		`Fix each one, with the task's evidence line or its mark in tools/pr-status.ts. When the landing changes the status on purpose, push with ${STATUS_CHANGE_VARIABLE}=<reason>.`,
	].join('\n');
}

/** The plan that the status check reads, relative to the tree that it runs in. */
const STATUS_PLAN = '.internal/plan/m3-breakdown.md';

/** A reading of the status check: its problem lines, and whether the check ran at all. */
export interface StatusReading {
	lines: string[];
	ran: boolean;
}

/**
 * The status check's reading of the tree in `dir`. The check ran when the tree holds its plan, and it
 * either passed or printed a problem line: it fails for a problem only after it prints one, so a
 * failure with no line means it did not run.
 */
export function statusOf(dir: string, env: NodeJS.ProcessEnv = process.env): StatusReading {
	const run = spawnSync('bun', ['tools/pr-status.ts', '--check'], {
		cwd: dir,
		env: repositoryEnv(env),
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
	const lines = statusLines(`${run.stdout ?? ''}\n${run.stderr ?? ''}`);
	return {
		lines,
		ran: existsSync(join(dir, STATUS_PLAN)) && (run.status === 0 || lines.length > 0),
	};
}

/**
 * The status check's reading at `commit`, from a worktree of its own beside the checkout at `root`.
 * The worktree holds only the tools, and the checkout's plan through a link. Hooks stay off, so
 * making it runs no generator.
 */
export function statusAt(
	commit: string,
	root = '.',
	env: NodeJS.ProcessEnv = process.env,
): StatusReading {
	const clean = repositoryEnv(env);
	const run = (cwd: string, ...args: string[]) =>
		execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
			cwd,
			env: clean,
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	const dir = mkdtempSync(join(tmpdir(), 'null3d-status-'));
	try {
		run(root, 'worktree', 'add', '--quiet', '--no-checkout', '--detach', dir, commit);
		run(dir, 'checkout', commit, '--', 'tools');
		const plan = resolve(root, '.internal');
		if (existsSync(plan)) symlinkSync(plan, join(dir, '.internal'));
		return statusOf(dir, clean);
	} catch {
		return { lines: [], ran: false };
	} finally {
		spawnSync('git', ['worktree', 'remove', '--force', dir], {
			cwd: root,
			env: clean,
			stdio: 'ignore',
		});
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Why a landing cannot be checked here, or undefined when it can. The guards read this checkout's
 * tree, so it must hold the pushed commit as its HEAD. The commit checks read from the branch's
 * commit on the remote and from where the branch left main, so the checkout must hold both. A first
 * push of the branch has no commit on the remote, and is read from where it left main.
 */
export function landingRefusal(
	landing: PushedRef,
	head: string,
	holdsRemote: boolean,
	mainBase: string | undefined,
): string | undefined {
	if (landing.localSha !== head)
		return `pre-push: the checks read this checkout's tree, whose HEAD is ${head}, not the pushed commit ${landing.localSha}. Check out the commit that you push, and push again.`;
	if (!NO_COMMIT.test(landing.remoteSha) && !holdsRemote)
		return `pre-push: this checkout does not hold ${landing.remoteSha}, the branch's commit on the remote, so the check cannot tell which commits the push adds. Fetch the branch (\`git fetch origin m3-start\`) and push again.`;
	if (!mainBase)
		return "pre-push: the checks read the commit messages from where the branch left main, as CI does, and this checkout has no copy of the remote's main. Fetch it (`git fetch origin main`) and push again.";
	return undefined;
}

/** Where the branch at `head` left main, by this checkout's copy of the remote's main, if it has one. */
function mainBaseOf(head: string): string | undefined {
	try {
		return git('merge-base', 'refs/remotes/origin/main', head) || undefined;
	} catch {
		return undefined;
	}
}

/** The crate folders of the workspace and their package names. */
function workspaceCrates(): Map<string, string> {
	const crates = new Map<string, string>();
	for (const folder of readdirSync('crates')) {
		const manifest = join('crates', folder, 'Cargo.toml');
		if (!existsSync(manifest)) continue;
		const name = /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(manifest, 'utf8'))?.[1];
		if (name) crates.set(folder, name);
	}
	return crates;
}

/** The job queue's script, when this machine names one. */
function jobQueue(): string | undefined {
	const configured = process.env.NULL3D_JOB_QUEUE || gitConfig('null3d.jobQueue');
	return configured && existsSync(configured) ? configured : undefined;
}

function hasNextest(): boolean {
	return spawnSync('cargo', ['nextest', '--version'], { stdio: 'ignore' }).status === 0;
}

/**
 * Whether ssh keeps a connection to this host alive while no other data flows. git opens the
 * connection before this check runs and holds it, silent, until the check passes, so a host whose
 * ssh sends nothing while the check runs loses the connection part way through it. Either the ssh
 * command line or the ssh configuration may name the setting. When ssh cannot say, the check lets
 * the push through rather than hold it for a reason it cannot read.
 */
function keepsAlive(host: string): boolean {
	const command = process.env.GIT_SSH_COMMAND || gitConfig('core.sshCommand');
	if (keepaliveSeconds(command) > 0) return true;
	const listed = spawnSync('ssh', ['-G', host], { encoding: 'utf8' });
	if (listed.status !== 0) return true;
	const seconds = /^serveraliveinterval\s+(\d+)/m.exec(listed.stdout)?.[1];
	return Number(seconds ?? 0) > 0;
}

/** A git setting's value, or undefined when it is not set here. */
function gitConfig(key: string): string | undefined {
	try {
		return git('config', '--get', key) || undefined;
	} catch {
		return undefined;
	}
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

function main(): void {
	const refs = parsePush(readFileSync(0, 'utf8'));
	const refusedMilestone = milestoneRefusal(refs, process.env[LANDING_VARIABLE] === '1');
	if (refusedMilestone) {
		console.error(refusedMilestone);
		process.exit(1);
	}
	const push = pushToMain(refs);
	if (!push) {
		const landing = pushToMilestone(refs);
		if (!landing || NO_COMMIT.test(landing.localSha)) return;
		const holdsRemote =
			spawnSync('git', ['cat-file', '-e', `${landing.remoteSha}^{commit}`], { stdio: 'ignore' })
				.status === 0;
		const mainBase = mainBaseOf(landing.localSha);
		const refused = landingRefusal(landing, git('rev-parse', 'HEAD'), holdsRemote, mainBase);
		if (refused || !mainBase) {
			console.error(refused);
			process.exit(1);
		}
		// A first push of the branch adds every commit since it left main.
		const base = NO_COMMIT.test(landing.remoteSha) ? mainBase : landing.remoteSha;
		const skipped = skipReason(
			keptCommits(`${base}..${landing.localSha}`).map(({ message }) => message),
		);
		if (skipped) {
			console.log(
				`pre-push: the check before the landing is skipped, as a commit says: ${skipped}`,
			);
			return;
		}
		const files = git('diff', '--name-only', base, landing.localSha).split('\n').filter(Boolean);
		const withCrateTests = process.env[LANDING_CRATE_TESTS] === '1';
		const steps = landingSteps(
			files,
			workspaceCrates(),
			withCrateTests && touchesRust(files) && hasNextest(),
			withCrateTests,
			{ base, head: landing.localSha, mainBase },
		);
		const reason = process.env[STATUS_CHANGE_VARIABLE];
		const pushed = statusOf('.');
		if (!pushed.ran) {
			console.error(
				`pre-push: the status check did not run on the pushed commit: this checkout needs its plan at ${STATUS_PLAN} and a working \`bun tools/pr-status.ts --check\`. Push from the checkout that holds the plan.`,
			);
			process.exit(1);
		}
		// A base whose check does not run, such as where the branch left main, reads as no lines, so
		// every line of the pushed commit counts as added and the push needs a reason.
		const atBase = statusAt(base);
		const added = addedStatusLines(atBase.lines, pushed.lines);
		const refusedStatus = statusRefusal(added, base.slice(0, 9), reason, atBase.ran);
		if (refusedStatus) {
			console.error(refusedStatus);
			process.exit(1);
		}
		if (added.length > 0)
			console.log(
				[
					`pre-push: the landing changes the milestone status on purpose: ${reason}`,
					...added.map((line) => `  ${line}`),
				].join('\n'),
			);
		console.log('pre-push: checking the landing on the milestone branch');
		runSteps(steps, 'the milestone branch', jobQueue());
		return;
	}
	const base = baseOf(push);
	if (!base) {
		console.error(
			'pre-push: the push replaces main with a history that this checkout does not hold, so the check has nothing to compare with.',
		);
		console.error('Fetch main (`git fetch origin main`) and push again.');
		console.error(
			`Only in an emergency, add a \`${SKIP_TRAILER}: <reason>\` trailer to a commit of the push; see .dev/pull-requests.md.\n`,
		);
		process.exit(1);
	}
	const range = `${base}..${push.localSha}`;
	const reason = skipReason(keptCommits(range).map(({ message }) => message));
	if (reason) {
		console.log(
			`pre-push: the check before a push to main is skipped, as a commit says: ${reason}`,
		);
		return;
	}
	const files = git('diff', '--name-only', base, push.localSha).split('\n').filter(Boolean);
	const queue = jobQueue();
	// git names the remote it pushes to on the hook's command line: its name, then its URL.
	const host = sshHost(process.argv[3] ?? '');
	if (host && !keepsAlive(host)) {
		console.error(
			`pre-push: this check leaves the connection to ${host} open and silent while it runs, and ssh here sends nothing to keep it alive.`,
		);
		console.error(
			'A peer closes a quiet connection after a few minutes. The push would then end with no message from git, nothing pushed, and a status that says only that a write failed.',
		);
		console.error(
			`pre-push: add \`ServerAliveInterval 20\` under \`Host ${host}\` in ~/.ssh/config, or name it on the ssh command, as \`git config core.sshCommand "ssh -o ServerAliveInterval=20"\` does. See .dev/pull-requests.md.`,
		);
		console.error(
			`Only in an emergency, add a \`${SKIP_TRAILER}: <reason>\` trailer to a commit of the push.\n`,
		);
		process.exit(1);
	}
	console.log(
		`pre-push: checking the push to main (${range})${queue ? `, through the job queue ${queue}` : ''}`,
	);
	runSteps(plan(base, push.localSha, files, workspaceCrates(), hasNextest()), 'main', queue);
}

/** Runs each step in turn, through the job queue when one is set, and refuses the push at a failure. */
function runSteps(steps: readonly Step[], target: string, queue: string | undefined): void {
	for (const step of steps) {
		console.log(`pre-push: ${step.command.join(' ')}\n  because ${step.why}`);
		const queued = queue !== undefined && step.lane !== 'DIRECT';
		const command = queued ? ['zsh', queue, ...step.command] : step.command;
		const result = spawnSync(command[0] ?? '', command.slice(1), {
			stdio: ['ignore', 'inherit', 'inherit'],
			env: queued ? { ...process.env, [step.lane]: '1' } : process.env,
		});
		if (result.status !== 0) {
			console.error(`\npush to ${target} refused: \`${step.command.join(' ')}\` failed (above).`);
			console.error(`It ran because ${step.why}. Fix the cause, commit, and push again.`);
			console.error(
				`Only in an emergency, add a \`${SKIP_TRAILER}: <reason>\` trailer to a commit of the push; see .dev/pull-requests.md.\n`,
			);
			process.exit(1);
		}
	}
	console.log('pre-push: every check passed');
}

if (import.meta.main) main();
