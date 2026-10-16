// Pre-push guard for pushes to main (D-157's addendum of 15 October 2026). A push to any other
// branch only saves work, so it runs nothing. A push to main first checks the commits it adds:
//   1. their messages and trailers, with commitlint and check-trailers.ts over main's commit before
//      the push up to the push, as CI's `commits` job does, and their merges, with check-merges.ts,
//      which refuses a merge that carries new work;
//   2. when the push changes Rust code or Cargo settings, `cargo check --workspace`, since a merge
//      that keeps both sides of a struct or a constant often looks valid until it compiles;
//   3. the same crates for the WebAssembly target, `cargo check -p <crate> --target
//      wasm32-unknown-unknown`. A build for this machine compiles the `cfg(not(target_arch =
//      "wasm32"))` items and skips the ones the engine ships, so the workspace check passes while
//      the shipping build fails (15 October 2026, shader-time-1);
//   4. then the tests of each crate that the push changes, through cargo-nextest's `ci` profile with
//      --no-fail-fast, or cargo test when nextest is missing. The test that builds every shader
//      runs in CI only: it takes half an hour or more.
// A machine's job queue runs the steps when git's `null3d.jobQueue` setting, or the environment's
// NULL3D_JOB_QUEUE, names its script: the trailer check in its quick lane, the cargo steps in its
// CPU lane, so a push does not load a busy machine outside the queue. Elsewhere the steps run
// directly. The emergency bypass is a `Push-Check-Skipped: <reason>` trailer on a pushed commit.
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
/** The test that builds every shader, which CI runs in a job of its own. */
const WHOLE_SHADER_BUILD =
	'the_repository_build_is_the_same_each_time_and_keeps_every_portability_rule';
/** The target the engine ships on, which a build for this machine does not compile. */
export const WASM_TARGET = 'wasm32-unknown-unknown';
/**
 * The crates that the engine builds for that target: the shader compiler that a bundler loads, and
 * the engine core. Between them they reach the rest of the workspace, except the asset tool.
 */
export const WASM_CRATES = ['null3d-shaders-wasm', 'null3d-wasm'];
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
	/** Why the step cannot run at all here, or nothing when it can. */
	needs?: () => string | undefined;
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
	];
	if (!touchesRust([...files])) return steps;
	steps.push({
		why: 'the push changes Rust code or Cargo settings, so the merged workspace must compile',
		lane: 'CPU_ONLY',
		command: ['cargo', 'check', '--workspace'],
	});
	steps.push({
		why: `the engine ships for the ${WASM_TARGET} target, which a build for this machine does not compile`,
		lane: 'CPU_ONLY',
		command: [
			'cargo',
			'check',
			...WASM_CRATES.flatMap((name) => ['-p', name]),
			'--target',
			WASM_TARGET,
		],
		needs: wasmTargetProblem,
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

/** The sysroot of the toolchain that answers rustc here, or nothing when none does. */
function rustcSysroot(): string | undefined {
	try {
		return execFileSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' }).trim();
	} catch {
		return undefined;
	}
}

/**
 * Why the WebAssembly check cannot run here, or nothing when it can. Cargo reports a missing target
 * only after it has compiled that target's whole dependency tree, so the check asks the toolchain
 * for the target's own standard library first and says what is missing. A check that passed because
 * its target was absent would be worse than no check.
 */
export function wasmTargetProblem(sysroot = rustcSysroot()): string | undefined {
	if (!sysroot) {
		return [
			`pre-push: no rustc answered, so the check of the ${WASM_TARGET} target cannot run.`,
			'Install the Rust toolchain that rust-toolchain.toml names and push again.',
		].join('\n');
	}
	if (existsSync(join(sysroot, 'lib', 'rustlib', WASM_TARGET))) return undefined;
	return [
		`pre-push: the ${WASM_TARGET} standard library is not installed for the toolchain at ${sysroot}.`,
		`The push changes Rust code, and the engine ships for that target, so the check refuses to pass without it.`,
		`Install it with \`rustup target add ${WASM_TARGET}\` and push again.`,
	].join('\n');
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
	const push = pushToMain(parsePush(readFileSync(0, 'utf8')));
	if (!push) return;
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
	console.log(
		`pre-push: checking the push to main (${range})${queue ? `, through the job queue ${queue}` : ''}`,
	);
	for (const step of plan(base, push.localSha, files, workspaceCrates(), hasNextest())) {
		console.log(`pre-push: ${step.command.join(' ')}\n  because ${step.why}`);
		const problem = step.needs?.();
		if (problem) {
			console.error(`\npush to main refused: \`${step.command.join(' ')}\` cannot run here.\n${problem}`);
			console.error(
				`Only in an emergency, add a \`${SKIP_TRAILER}: <reason>\` trailer to a commit of the push; see .dev/pull-requests.md.\n`,
			);
			process.exit(1);
		}
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
