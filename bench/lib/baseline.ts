// The baseline of the benchmark run on a push to main. Main runs one benchmark run at a time, and a
// newer push replaces a run that waits, so some commits never get a run of their own. Each run
// therefore compares the new commit with the last commit on main that a run measured, and so also
// measures the change of every commit in between. A run measured its commit when it finished the
// comparison, whatever the verdict: a slowdown then fails the one run that holds it, and the next
// run measures from there. A run that stopped before its comparison ended measured nothing.

/** A finished push run of the benchmark workflow on main. */
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
 * The commit that a new commit on main is compared with: the commit of the newest run in `runs`
 * that comes before the new commit in its history and finished its comparison, or null when none
 * does. `runs` lists finished push runs, newest first. The new commit itself never counts, so a new
 * run for a commit that a run already measured still compares it with an older one. `finished` may
 * ask GitHub, so it is asked last, and only until a run qualifies.
 */
export function chooseBaseline(
	newCommit: string,
	runs: readonly MainRun[],
	isAncestor: (commit: string) => boolean,
	finished: (run: MainRun) => boolean,
): string | null {
	return (
		runs.find((run) => run.headSha !== newCommit && isAncestor(run.headSha) && finished(run))
			?.headSha ?? null
	);
}
