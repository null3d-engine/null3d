// The paths that the dev server does not watch. The repository's own folders are anchored to its
// root, so a git worktree kept under the root's `.claude` folder still watches its own files.
export function watchIgnored(root: string): string[] {
	return [
		'**/target/**',
		'**/test-results/**',
		`${root}/.claude/**`,
		`${root}/.dev/**`,
		`${root}/.internal/**`,
	];
}
