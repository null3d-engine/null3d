// The baseline of the benchmark job on a push to main. Main runs one benchmark job at a time, and a
// newer push replaces a job that waits, so some commits never get a job of their own. Each job
// therefore compares the new commit with the last commit on main that a job measured with
// success, and so also measures the change of every commit in between.

/**
 * The commit that a new commit on main is compared with: the newest of `measured` that comes
 * before the new commit in its history, or null when none does. `measured` lists the commits that
 * successful benchmark jobs on main measured, newest first. The new commit itself never counts,
 * so a job run again for a commit it already measured still compares that commit with an older one.
 */
export function chooseBaseline(
	newCommit: string,
	measured: readonly string[],
	isAncestor: (commit: string) => boolean,
): string | null {
	return measured.find((commit) => commit !== newCommit && isAncestor(commit)) ?? null;
}
