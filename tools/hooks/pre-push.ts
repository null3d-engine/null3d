// Pre-push guard for pushes to main (D-157's addendum of 15 October 2026). A push to the milestone
// branch is refused unless the coordinator's landing session sets NULL3D_MILESTONE_LANDING=1: a
// helper saves its work on its own branch, and the coordinator lands it. The landing's push runs
// the guards that read the whole repository, which a merge can break with no conflict: the decision
// records' numbers, and the unit tests that hold the release guide, the shipped network calls and
// the timing specs' switches to every package and spec in the tree. They take seconds, where the
// unit suite takes minutes, and without them each such fault showed only a CI run later. Any other
// branch only saves work, so the hook runs nothing for it. A push to main runs those guards too,
// and first checks the commits it adds:
//   1. their messages and trailers, with commitlint and check-trailers.ts over main's commit before
//      the push up to the push, as CI's `commits` job does, and their merges, with check-merges.ts,
//      which refuses a merge that carries new work;
//   2. when the push changes Rust code or Cargo settings, `cargo check --workspace`, since a merge
//      that keeps both sides of a struct or a constant often looks valid until it compiles;
//   3. then the tests of each crate that the push changes, through cargo-nextest's `ci` profile with
//      --no-fail-fast, or cargo test when nextest is missing. The test that builds every shader
//      runs in CI only: it takes half an hour or more.
// A machine's job queue runs the steps when git's `null3d.jobQueue` setting, or the environment's
// NULL3D_JOB_QUEUE, names its script: the trailer check in its quick lane, the cargo steps in its
// CPU lane, so a push does not load a busy machine outside the queue. The guards over the tree run
// outside it: they are a few seconds of work, and on a loaded machine the wait for a quick slot plus
// their run passed the lane's five-minute limit and refused two landings on 25 October 2026, which
// left only the emergency trailer to get past a slow machine. Elsewhere the steps run
// directly. The emergency bypass is a `Push-Check-Skipped: <reason>` trailer on a pushed commit.
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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { touchesRust } from './check-rust';
import { keptCommits } from './check-trailers';

/** The trailer that skips the check, with the reason for the emergency. */
export const SKIP_TRAILER = 'Push-Check-Skipped';
/** The milestone branch, which only the coordinator's landing session pushes. */
export const MILESTONE_REF = 'refs/heads/m3-start';
/**
 * The variable that names the coordinator's landing session. A helper leaves it unset, so its push
 * to the milestone branch is refused. The landing session sets it for its own push.
 */
export const LANDING_VARIABLE = 'NULL3D_MILESTONE_LANDING';
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
 * The message that refuses a push to the milestone branch from a session that is not the
 * coordinator's landing, or undefined when the push may go ahead. A helper saves its work on its
 * own branch and the coordinator lands it, so a helper's push here would put unfinished work on the
 * branch that every other helper and CI read.
 */
export function milestoneRefusal(refs: readonly PushedRef[], landing: boolean): string | undefined {
	if (landing || !pushToMilestone(refs)) return undefined;
	return `pre-push: this push writes ${MILESTONE_REF}, and only the coordinator's landing session pushes the milestone branch. Push your own branch and let the coordinator land it. If you are that session, set ${LANDING_VARIABLE}=1 for the push.`;
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
 * network calls, the timing specs' switch names, and CI's workflow against the scripts and files
 * that its jobs read.
 * Each file takes a few seconds at most.
 */
export const GUARD_TESTS = [
	'tools/lib/release.test.ts',
	'tools/lib/cdn.test.ts',
	'tools/lib/network-use.test.ts',
	'tests/lib/priority-setup.test.ts',
	'tools/lib/ci-workflow.test.ts',
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
			why: 'a merge can add a package, a network call or a timing spec that a repository-wide guard must know',
			lane: 'DIRECT',
			command: ['bun', 'test', ...GUARD_TESTS],
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
	const range = `${base}..${head}`;
	const steps: Step[] = [
		{
			why: 'the commits that the push adds to main must follow the commit message rules',
			lane: 'QUICK',
			command: ['bunx', 'commitlint', '--from', base, '--to', head],
		},
		{
			why: 'the commits that the push adds to main must carry their trailers',
			lane: 'QUICK',
			command: ['bun', 'tools/hooks/check-trailers.ts', range],
		},
		{
			why: 'a merge commit that the push adds to main must hold only resolutions and mechanical fixes',
			lane: 'QUICK',
			command: ['bun', 'tools/hooks/check-merges.ts', range],
		},
		...guardSteps(),
	];
	if (!touchesRust([...files])) return steps;
	steps.push({
		why: 'the push changes Rust code or Cargo settings, so the merged workspace must compile',
		lane: 'CPU_ONLY',
		command: ['cargo', 'check', '--workspace'],
	});
	const names = changedCrates(files, crates);
	if (names.length === 0) return steps;
	const packages = names.flatMap((name) => ['-p', name]);
	steps.push({
		why: `the push changes these crates, so their tests must pass: ${names.join(', ')}`,
		lane: 'CPU_ONLY',
		command: nextest
			? ['cargo', 'nextest', 'run', '--no-fail-fast', '--profile', 'ci', ...packages]
			: ['cargo', 'test', '--no-fail-fast', ...packages, '--', '--skip', WHOLE_SHADER_BUILD],
	});
	return steps;
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

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
		// The guards read this checkout's tree, which a landing pushes as its HEAD.
		const added = NO_COMMIT.test(landing.remoteSha)
			? []
			: keptCommits(`${landing.remoteSha}..${landing.localSha}`);
		const skipped = skipReason(added.map(({ message }) => message));
		if (skipped) {
			console.log(
				`pre-push: the check before the landing is skipped, as a commit says: ${skipped}`,
			);
			return;
		}
		console.log('pre-push: checking the landing on the milestone branch');
		runSteps(guardSteps(), 'the milestone branch', jobQueue());
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
