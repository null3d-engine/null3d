// The baseline of the benchmark run on a push to main. Main runs one benchmark run at a time, and a
// newer push replaces a run that waits, so some commits never get a run of their own. Each run
// therefore compares the new commit with the last commit on main that a run measured with
// success, and so also measures the change of every commit in between.

/**
 * The commit that a new commit on main is compared with: the newest of `measured` that comes
 * before the new commit in its history, or null when none does. `measured` lists the commits that
 * successful benchmark runs on main measured, newest first. The new commit itself never counts,
 * so a new run for a commit that a run already measured still compares it with an older one.
 */
export function chooseBaseline(
	newCommit: string,
	measured: readonly string[],
	isAncestor: (commit: string) => boolean,
): string | null {
	return measured.find((commit) => commit !== newCommit && isAncestor(commit)) ?? null;
}
