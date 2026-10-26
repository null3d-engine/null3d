// The GPU check: compares this checkout's GPU time per frame with a baseline's, on S4 and S6 on
// WebGPU at Medium and High, in Chrome on this computer's GPU. CI's benchmark job has no GPU timer,
// so a pull request that changes shaders or how the engine draws runs this before it merges and
// records the line it prints in a GPU-Checked trailer (.dev/pull-requests.md). The nightly
// comparison of main runs it against the night before's build. It needs a computer with a GPU of
// its own; on a machine without a GPU timer, it reports the check as not measured.
//
// The check has two steps. The first prepares both builds, which takes only the CPU: it builds this
// checkout and its benchmark pages, and makes sure that the shared cache holds a prepared baseline
// of the merge base with origin/main (bench/lib/baseline-cache.ts). The second only measures, so a
// quiet Mac is needed only for it. With neither step named, the check runs both in turn.
//
// Usage:
//   bun run bench:gpu-check -- --prepare     (CPU only: the builds)
//   bun run bench:gpu-check -- --measure     (the timing, on a quiet Mac)
//   bun run bench:gpu-check                  (both)
//   bun run bench:gpu-check -- --base ../main-built --no-build
//
// Options:
//   --prepare        only prepare: build this checkout, its pages and the baseline
//   --measure        only measure; it fails when a build that it needs is missing or older than
//                    the sources, and names the step that makes it
//   --base <dir>     a built checkout, or a prepared baseline, to compare with. The default is the
//                    shared cache's prepared baseline of this branch's merge base with origin/main
//   --no-build       prepare without bun run build of this checkout first
//   --runs <n>       rounds of each page in each build; the default is 3
//   --seconds <n>    warm-up and measured time of each run; the default is 4
//
// It writes its line to target/gpu-check/result.txt too, and fails unless the check passed or was
// not judged, because the benchmark pages changed between the two commits.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from '../tests/lib/server.ts';
import { refuseInQuietWindow } from '../tools/lib/quiet-window.ts';
import { cachedBaseline, prepareBaseline, readPreparedBaseline, run } from './lib/baseline-cache';
import type { Comparison } from './lib/compare';
import {
	GPU_CHECK_PAGE,
	GPU_CHECK_PRESETS,
	GPU_CHECK_SCENES,
	gpuCheckPasses,
	gpuCheckResult,
	type PresetComparison,
} from './lib/gpu-check';
import { benchPagesFresh, comparePagesDir, ensureBenchPages } from './lib/serve';

/** The steps of the check that a run takes: both by default. */
export type GpuCheckSteps = 'both' | 'prepare' | 'measure';

interface GpuCheckOptions {
	steps: GpuCheckSteps;
	base: string | null;
	build: boolean;
	runs: number;
	seconds: number;
}

export function parseGpuCheckArgs(args: readonly string[]): GpuCheckOptions {
	const options: GpuCheckOptions = {
		steps: 'both',
		base: null,
		build: true,
		runs: 3,
		seconds: 4,
	};
	const steps = new Set<GpuCheckSteps>();
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const value = () => args[++i] ?? '';
		if (arg === '--prepare') steps.add('prepare');
		else if (arg === '--measure') steps.add('measure');
		else if (arg === '--base') options.base = value();
		else if (arg === '--no-build') options.build = false;
		else if (arg === '--runs') options.runs = Number(value());
		else if (arg === '--seconds') options.seconds = Number(value());
		else throw new Error(`unknown option ${arg}`);
	}
	if (steps.size === 1) options.steps = [...steps][0] as GpuCheckSteps;
	if (options.base === '') throw new Error('--base: name a built checkout');
	if (!(Number.isInteger(options.runs) && options.runs >= 2))
		throw new Error('--runs: use a whole number of 2 or more');
	if (!(options.seconds > 0)) throw new Error('--seconds: use a number above 0');
	return options;
}

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const CHECK_DIR = join(REPO_ROOT, 'target/gpu-check');
/** The step that makes the builds, as a command, for the messages that name it. */
const PREPARE = 'bun run bench:gpu-check -- --prepare';

const mergeBase = () => git(REPO_ROOT, 'merge-base', 'HEAD', 'origin/main');

/**
 * Removes the worktree of the merge base that older checks kept beside this checkout: the shared
 * cache holds the baseline now.
 */
function removeOldBaseCheckout(): void {
	const old = `${REPO_ROOT.replace(/\/$/, '')}-gpu-check-base`;
	if (!existsSync(old)) return;
	console.log(`removing ${old}, which older checks built; the shared cache replaces it`);
	spawnSync('git', ['worktree', 'remove', '--force', old], { cwd: REPO_ROOT, stdio: 'inherit' });
}

/** Builds this checkout and its pages, and the baseline's pages or the cache's prepared baseline. */
async function prepare(options: GpuCheckOptions): Promise<void> {
	if (options.build) run(REPO_ROOT, 'bun', 'run', 'build');
	const base = options.base && resolve(options.base);
	if (!base) await prepareBaseline(REPO_ROOT, mergeBase());
	else if (!readPreparedBaseline(base)) ensureBenchPages(base, comparePagesDir('baseline'));
	ensureBenchPages(REPO_ROOT, comparePagesDir('new'));
	removeOldBaseCheckout();
}

/** The baseline that the measurement compares with, which must be prepared already. */
function preparedBase(options: GpuCheckOptions): string {
	if (options.base) {
		const base = resolve(options.base);
		if (!(readPreparedBaseline(base) || benchPagesFresh(base, comparePagesDir('baseline'))))
			throw new Error(`the pages of ${base} are not built from its sources: run ${PREPARE}`);
		return base;
	}
	const sha = mergeBase();
	const base = cachedBaseline(sha);
	if (!base)
		throw new Error(
			`the cache holds no prepared baseline of the merge base ${sha.slice(0, 9)}: run ${PREPARE}`,
		);
	return base;
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
	const baseCommit = readPreparedBaseline(base)?.commit ?? git(base, 'rev-parse', 'HEAD');
	const short = (commit: string) => git(REPO_ROOT, 'rev-parse', '--short', commit);
	const dirty = git(REPO_ROOT, 'status', '--porcelain', '--untracked-files=no') !== '';
	return `${short(baseCommit)}..${short('HEAD')}${dirty ? ' with uncommitted changes' : ''}`;
}

/** Times both builds at each preset, and writes and prints the trailer line. */
function measure(options: GpuCheckOptions): void {
	const base = preparedBase(options);
	if (!benchPagesFresh(REPO_ROOT, comparePagesDir('new')))
		throw new Error(
			`this checkout's pages are not built from its sources as they are: run ${PREPARE}`,
		);
	mkdirSync(CHECK_DIR, { recursive: true });
	const presets = GPU_CHECK_PRESETS.map((preset) => comparePreset(base, preset, options));
	const result = gpuCheckResult(presets, commitsText(base));
	writeFileSync(join(CHECK_DIR, 'result.txt'), `${result.line}\n`);
	console.log(`\n${result.line}`);
	if (!gpuCheckPasses(result)) process.exitCode = 1;
}

async function main(): Promise<void> {
	refuseInQuietWindow('The GPU check');
	const options = parseGpuCheckArgs(process.argv.slice(2));
	if (options.steps !== 'measure') await prepare(options);
	if (options.steps !== 'prepare') measure(options);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
