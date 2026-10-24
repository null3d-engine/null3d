// One report of the fixed limits that judge this branch, so that a limit which is about to fail
// names itself here instead of in CI. A branch can pass one limit and fail another without anyone
// noticing, and each failure then reads as a mystery in a job log (AGENTS.md, "Commands").
// This measures what needs no browser and no build: the picture references, the commit gates over
// the commits that a merge into main would keep, and the download sizes of the last build that this
// checkout wrote. A limit that only a build or a heavy run can measure is listed with its command,
// so no limit is silently missing from the report.
// From the repository root:
//   bun run limits
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { IMAGE_RUNS } from '../tests/image/manifest.ts';
import { SCRIPT_RUNS } from '../tests/image/script-runs.ts';
import { referenceProblemsOnDisk } from '../tests/lib/images.ts';
import { budgetProblems, downloadSizes, type SizeEntry, START_BUDGET } from './lib/size-report.ts';

/** How a limit stands: within it, past it, or not measurable without a build or a run. */
type State = 'within' | 'past' | 'unmeasured';

interface Row {
	limit: string;
	owner: string;
	state: State;
	detail: string;
}

const SIZE_RECORD = 'target/size-report.json';

const bytes = (n: number) => n.toLocaleString('en-US');

/** The base that a merge into main would add this branch's commits to. */
function baseRef(): string {
	try {
		return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], {
			encoding: 'utf8',
		}).trim();
	} catch {
		return execFileSync('git', ['merge-base', 'HEAD', 'main'], { encoding: 'utf8' }).trim();
	}
}

/** The picture references, which a test without both sets of files fails without a browser. */
function referenceRow(): Row {
	const { files, problems } = referenceProblemsOnDisk([...IMAGE_RUNS, ...SCRIPT_RUNS]);
	return {
		limit: 'picture references',
		owner: 'tests/image/manifest.ts',
		state: problems.length === 0 ? 'within' : 'past',
		detail:
			problems.length === 0
				? `${files} files, one for each test in each place`
				: `${problems.length} problems, the first is: ${problems[0]}`,
	};
}

/** The acknowledgement and growth trailers of the commits that main's squash would keep. */
function trailerRow(): Row {
	const range = `${baseRef()}..HEAD`;
	try {
		execFileSync('bun', ['tools/hooks/check-trailers.ts', range], { encoding: 'utf8' });
		return {
			limit: 'commit gates',
			owner: 'tools/hooks/check-trailers.ts',
			state: 'within',
			detail: `every kept commit in ${range} carries its trailers`,
		};
	} catch (error) {
		const output = `${(error as { stderr?: string }).stderr ?? ''}`.trim().split('\n');
		const first = output.find((line) => line.length > 0) ?? 'the check failed';
		return {
			limit: 'commit gates',
			owner: 'tools/hooks/check-trailers.ts',
			state: 'past',
			detail: `${output.length} problems, the first is: ${first}`,
		};
	}
}

/** The download sizes of the last build this checkout wrote, against their budgets. */
function budgetRows(): Row[] {
	if (!existsSync(SIZE_RECORD))
		return [
			{
				limit: 'start download',
				owner: 'tools/lib/size-report.ts',
				state: 'unmeasured',
				detail: `no ${SIZE_RECORD} in this checkout; bun run build writes it`,
			},
		];
	// The download plans name a part by its file in the build's `js/` folder, without that prefix.
	const sizes = new Map(
		Object.entries(JSON.parse(readFileSync(SIZE_RECORD, 'utf8')) as Record<string, SizeEntry>).map(
			([file, size]) => [file.startsWith('js/') ? file.slice('js/'.length) : file, size],
		),
	);
	const biggest = downloadSizes(sizes).sort((a, b) => b.size.brotli - a.size.brotli)[0];
	if (!biggest) return [];
	const problems = budgetProblems(sizes);
	return [
		{
			limit: 'start download',
			owner: 'tools/lib/size-report.ts',
			state: problems.length === 0 ? 'within' : 'past',
			detail: `the largest start is ${biggest.mode} at ${bytes(biggest.size.brotli)} of ${bytes(START_BUDGET.brotli)} bytes after Brotli, ${bytes(START_BUDGET.brotli - biggest.size.brotli)} left; ${problems.length} budgets are past their limit`,
		},
	];
}

/** The limits that only a build or a heavy run measures, with the command that measures each. */
function unmeasuredRows(): Row[] {
	return [
		{
			limit: 'growth against main',
			owner: 'tools/lib/size-check.ts',
			state: 'unmeasured',
			detail: 'bun run build --check-size compares each file with a build of the base commit',
		},
		{
			limit: 'heavy check memory',
			owner: 'tests/lib/heavy-checks.ts',
			state: 'unmeasured',
			detail: 'bun run test:heavy reports the peak of each suite against its ceiling',
		},
		{
			limit: 'docs and skills style',
			owner: 'tools/lib/docs-style.ts',
			state: 'unmeasured',
			detail: 'bun run docs:style and bun run skills:check',
		},
	];
}

function main(): void {
	const rows = [referenceRow(), trailerRow(), ...budgetRows(), ...unmeasuredRows()];
	const width = Math.max(...rows.map(({ limit }) => limit.length));
	const mark = { within: 'ok  ', past: 'OVER', unmeasured: '--  ' } as const;
	for (const { limit, state, detail, owner } of rows)
		console.log(`${mark[state]}  ${limit.padEnd(width)}  ${detail}\n${' '.repeat(6)}${owner}`);
	const past = rows.filter(({ state }) => state === 'past');
	const measured = rows.filter(({ state }) => state === 'within').length;
	console.log(
		past.length === 0
			? `\nEvery measured limit is within its limit: ${measured} measured here, the rest named above with the command that measures them.`
			: `\n${past.length} limit(s) are past their limit: ${past.map(({ limit }) => limit).join(', ')}.`,
	);
	if (past.length > 0) process.exit(1);
}

if (import.meta.main) main();
