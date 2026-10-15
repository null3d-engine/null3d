// Pre-push guard for pushes to main (D-157's addendum of 15 October 2026). A push to any other
// branch only saves work, so it runs nothing. A push to main first checks the commits it adds:
//   1. their messages and trailers, with commitlint and check-trailers.ts over main's commit before
//      the push up to the push, as CI's `commits` job does;
//   2. when the push changes Rust code or Cargo settings, `cargo check --workspace`, since a merge
//      that keeps both sides of a struct or a constant often looks valid until it compiles;
//   3. then the tests of each crate that the push changes, through cargo-nextest's `ci` profile with
//      --no-fail-fast, or cargo test when nextest is missing. The test that builds every shader
//      runs in CI only: it takes half an hour or more.
// A machine's job queue runs the steps when git's `null3d.jobQueue` setting, or the environment's
// NULL3D_JOB_QUEUE, names its script: the trailer check in its quick lane, the cargo steps in its
// CPU lane, so a push does not load a busy machine outside the queue. Elsewhere the steps run
// directly. The emergency bypass is a `Push-Check-Skipped: <reason>` trailer on a pushed commit.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { touchesRust } from './check-rust';
import { keptCommits } from './check-trailers';

/** The trailer that skips the check, with the reason for the emergency. */
export const SKIP_TRAILER = 'Push-Check-Skipped';
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

/** The reason that a `Push-Check-Skipped:` trailer gives on any of the messages, if one does. */
export function skipReason(messages: readonly string[]): string | undefined {
	const trailer = new RegExp(`^${SKIP_TRAILER}:[ \\t]*(\\S.*)$`, 'm');
	for (const message of messages) {
		const reason = trailer.exec(message)?.[1]?.trim();
		if (reason) return reason;
	}
	return undefined;
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

/** One step of the check: what it runs, why, and the queue lane it takes. */
export interface Step {
	why: string;
	lane: 'QUICK' | 'CPU_ONLY';
	command: string[];
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
	let configured = process.env.NULL3D_JOB_QUEUE;
	if (!configured) {
		try {
			configured = git('config', '--get', 'null3d.jobQueue');
		} catch {
			// No setting: the steps run directly.
		}
	}
	return configured && existsSync(configured) ? configured : undefined;
}

function hasNextest(): boolean {
	return spawnSync('cargo', ['nextest', '--version'], { stdio: 'ignore' }).status === 0;
}

function main(): void {
	const push = pushToMain(parsePush(readFileSync(0, 'utf8')));
	if (!push) return;
	const known =
		!NO_COMMIT.test(push.remoteSha) &&
		spawnSync('git', ['cat-file', '-e', `${push.remoteSha}^{commit}`]).status === 0;
	const base = known ? push.remoteSha : git('merge-base', 'origin/main', push.localSha);
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
	console.log(
		`pre-push: checking the push to main (${range})${queue ? `, through the job queue ${queue}` : ''}`,
	);
	for (const step of plan(base, push.localSha, files, workspaceCrates(), hasNextest())) {
		console.log(`pre-push: ${step.command.join(' ')}\n  because ${step.why}`);
		const command = queue ? ['zsh', queue, ...step.command] : step.command;
		const result = spawnSync(command[0] ?? '', command.slice(1), {
			stdio: ['ignore', 'inherit', 'inherit'],
			env: queue ? { ...process.env, [step.lane]: '1' } : process.env,
		});
		if (result.status !== 0) {
			console.error(`\npush to main refused: \`${step.command.join(' ')}\` failed (above).`);
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
