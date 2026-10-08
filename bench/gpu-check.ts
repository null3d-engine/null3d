// The GPU check: compares this checkout's GPU time per frame with a baseline's, on S4 and S6 on
// WebGPU at Medium and High, in Chrome on this computer's GPU. CI's benchmark job has no GPU timer,
// so a pull request that changes shaders or how the engine draws runs this before it merges and
// records the line it prints in a GPU-Checked trailer (.dev/pull-requests.md). The nightly
// comparison of main runs it against the night before's build. It needs a computer with a GPU of
// its own; on a machine without a GPU timer, it reports the check as not measured.
//
// Usage:
//   bun run bench:gpu-check
//   bun run bench:gpu-check -- --base ../main-built --no-build
//
// Options:
//   --base <dir>     a built checkout to compare with. The default is a worktree of this branch's
//                    merge base with origin/main, under target/gpu-check, which the check builds
//                    once per commit
//   --no-build       compare this checkout as it is built, without bun run build first
//   --runs <n>       rounds of each page in each build; the default is 3
//   --seconds <n>    warm-up and measured time of each run; the default is 4
//
// It writes its line to target/gpu-check/result.txt too, and fails unless the check passed or was
// not judged, because the benchmark pages changed between the two commits.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from '../tests/lib/server.ts';
import type { Comparison } from './lib/compare';
import {
	GPU_CHECK_PAGE,
	GPU_CHECK_PRESETS,
	GPU_CHECK_SCENES,
	gpuCheckPasses,
	gpuCheckResult,
	type PresetComparison,
} from './lib/gpu-check';

interface GpuCheckOptions {
	base: string | null;
	build: boolean;
	runs: number;
	seconds: number;
}

export function parseGpuCheckArgs(args: readonly string[]): GpuCheckOptions {
	const options: GpuCheckOptions = { base: null, build: true, runs: 3, seconds: 4 };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const value = () => args[++i] ?? '';
		if (arg === '--base') options.base = value();
		else if (arg === '--no-build') options.build = false;
		else if (arg === '--runs') options.runs = Number(value());
		else if (arg === '--seconds') options.seconds = Number(value());
		else throw new Error(`unknown option ${arg}`);
	}
	if (options.base === '') throw new Error('--base: name a built checkout');
	if (!(Number.isInteger(options.runs) && options.runs >= 2))
		throw new Error('--runs: use a whole number of 2 or more');
	if (!(options.seconds > 0)) throw new Error('--seconds: use a number above 0');
	return options;
}

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** Runs a command with its output on this terminal, and throws when it fails. */
function run(cwd: string, command: string, ...args: string[]): void {
	const { status } = spawnSync(command, args, { cwd, stdio: 'inherit' });
	if (status !== 0) throw new Error(`${command} ${args.join(' ')} failed in ${cwd}`);
}

const CHECK_DIR = join(REPO_ROOT, 'target/gpu-check');

/**
 * A built worktree of this branch's merge base with origin/main. The worktree stays between
 * checks, and builds again only when the merge base moves.
 */
function mergeBaseCheckout(): string {
	const sha = git(REPO_ROOT, 'merge-base', 'HEAD', 'origin/main');
	const dir = join(CHECK_DIR, 'base');
	const built = join(CHECK_DIR, 'base-built');
	if (!existsSync(dir)) run(REPO_ROOT, 'git', 'worktree', 'add', '--detach', dir, sha);
	else if (git(dir, 'rev-parse', 'HEAD') !== sha) run(dir, 'git', 'checkout', '--detach', sha);
	if (!existsSync(built) || readFileSync(built, 'utf8') !== sha) {
		run(dir, 'bun', 'install');
		run(dir, 'bun', 'run', 'build');
		writeFileSync(built, sha);
	}
	return dir;
}

const compareFolders = (folder: string) =>
	existsSync(folder) ? readdirSync(folder).filter((name) => name.endsWith('-compare')) : [];

/** Compares the two builds at one preset with the benchmark command, and reads its summary. */
function comparePreset(base: string, preset: string, options: GpuCheckOptions): PresetComparison {
	const folder = join(REPO_ROOT, 'target/bench');
	const before = new Set(compareFolders(folder));
	// The command fails when a CPU measure is slower, which the GPU check leaves to CI's job.
	spawnSync(
		'bun',
		[
			'bench/run.ts',
			'--compare',
			`${base},.`,
			'--scenes',
			GPU_CHECK_SCENES.join(','),
			'--pages',
			GPU_CHECK_PAGE,
			'--runs',
			String(options.runs),
			'--seconds',
			String(options.seconds),
			'--switches',
			`preset=${preset}`,
		],
		{ cwd: REPO_ROOT, stdio: 'inherit' },
	);
	const made = compareFolders(folder).filter((name) => !before.has(name));
	const summaryFile = made.length === 1 ? join(folder, made[0] as string, 'summary.json') : '';
	if (!existsSync(summaryFile)) throw new Error(`the comparison at ${preset} wrote no summary`);
	const summary = JSON.parse(readFileSync(summaryFile, 'utf8')) as {
		comparisons: Comparison[];
		verdict: { measurementChanges: string[] };
	};
	return {
		preset,
		comparisons: summary.comparisons,
		measurementChanges: summary.verdict.measurementChanges,
	};
}

/** The two commits, as short hashes, with a note when this checkout holds uncommitted changes. */
function commitsText(base: string): string {
	const short = (dir: string) => git(dir, 'rev-parse', '--short', 'HEAD');
	const dirty = git(REPO_ROOT, 'status', '--porcelain', '--untracked-files=no') !== '';
	return `${short(base)}..${short(REPO_ROOT)}${dirty ? ' with uncommitted changes' : ''}`;
}

function main(): void {
	const options = parseGpuCheckArgs(process.argv.slice(2));
	mkdirSync(CHECK_DIR, { recursive: true });
	const base = options.base ? resolve(options.base) : mergeBaseCheckout();
	if (options.build) run(REPO_ROOT, 'bun', 'run', 'build');
	const presets = GPU_CHECK_PRESETS.map((preset) => comparePreset(base, preset, options));
	const result = gpuCheckResult(presets, commitsText(base));
	writeFileSync(join(CHECK_DIR, 'result.txt'), `${result.line}\n`);
	console.log(`\n${result.line}`);
	if (!gpuCheckPasses(result)) process.exitCode = 1;
}

if (import.meta.main) {
	try {
		main();
	} catch (e) {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	}
}
