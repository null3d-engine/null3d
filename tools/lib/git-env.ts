// A hook hands the repository that started it to every process it starts, and git obeys those
// variables over the directory a command runs in. A tool that must read the tree it stands in drops
// them here, so every caller clears the same list that the helper rules name.

/** The variables that name a repository, a work tree or an index to git. */
const REPOSITORY_VARIABLES = [
	'GIT_DIR',
	'GIT_WORK_TREE',
	'GIT_INDEX_FILE',
	'GIT_COMMON_DIR',
	'GIT_OBJECT_DIRECTORY',
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_NAMESPACE',
	'GIT_PREFIX',
] as const;

/**
 * `env` without the variables that pin git to another repository.
 *
 * A linked worktree's hook sets `GIT_DIR` to that worktree's own folder, and a git or tool run in
 * another worktree would then read the hook's history and write into its index.
 */
export function repositoryEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const copy = { ...env };
	for (const name of REPOSITORY_VARIABLES) delete copy[name];
	return copy;
}
