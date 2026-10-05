// The baseline of main's benchmark run. Main's run starts at most once an hour, on main's newest
// commit, so most commits never get a run of their own. Each run therefore compares the new commit
// with the last commit on main that a run measured, and so also measures the change of every commit
// in between. A run measured its commit when it finished the comparison, whatever the verdict: a
// slowdown then fails the one run that holds it, and the next run measures from there. A run that
// stopped before its comparison ended measured nothing.

/** A finished run of the benchmark workflow on main, scheduled or, before the schedule, pushed. */
export interface MainRun {
	/** The run's number on GitHub. */
	id: number;
	/** The commit that the run measured against its baseline. */
	headSha: string;
}

/** A job of a run, with the name and result of each of its steps, as GitHub's API gives them. */
export interface RunJob {
	name: string;
	steps?: readonly { name: string; conclusion: string | null }[];
}

/** The job that merges the shards' records into one comparison. */
export const REPORT_JOB = 'benchmark report';
/**
 * The report job's step that merges the shards' records into one comparison and writes its
 * verdict. It fails only when the comparison is not complete, so its success marks a run that
 * measured its commit. The verdict fails a later step.
 */
export const MERGE_STEP = 'Merge the shards into one comparison';

/** True when a run's jobs show that it finished its comparison, whatever the verdict. */
export function finishedComparison(jobs: readonly RunJob[]): boolean {
	return jobs.some(
		(job) =>
			job.name === REPORT_JOB &&
			(job.steps ?? []).some((step) => step.name === MERGE_STEP && step.conclusion === 'success'),
	);
}

/**
 * The last commit on main that a run measured, as seen from a new commit: the commit of the newest
 * run in `runs` that finished its comparison and whose commit `inHistory` accepts, or null when
 * none does. `inHistory` is true for the new commit and the commits before it. `runs` lists
 * finished runs on main, newest first. When the result is the new commit itself, main has not moved
 * since that run, and there is nothing to measure. `finished` may ask GitHub, so it is asked last,
 * and only until a run qualifies.
 */
export function lastMeasured(
	runs: readonly MainRun[],
	inHistory: (commit: string) => boolean,
	finished: (run: MainRun) => boolean,
): string | null {
	return runs.find((run) => inHistory(run.headSha) && finished(run))?.headSha ?? null;
}
