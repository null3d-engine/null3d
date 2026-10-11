// Pull request guard for the `GPU-Checked:` trailer (AGENTS.md, "Commit gates"). CI's benchmark job
// has no GPU timer, so a pull request that changes shaders or how the engine draws runs the GPU
// check on a computer with a GPU of its own, and puts the line it prints on a commit. The trailer
// must sit on the last commit that changes such files or on a later one, so the check measured the
// pull request's final code. CI reads it through check-trailers.ts, over the whole pull request,
// since each commit need not carry a check of its own.
import {
	bearingFiles,
	effectiveMessage,
	findAckValues,
	isBareAck,
	summarizeBearing,
} from './commit-ack';

/** The trailer that records a pull request's GPU check. */
export const GPU_CHECK_TRAILER = 'GPU-Checked';

/**
 * Paths whose changes can change the GPU's work per frame: the shader library and its compiler,
 * the GPU backends, the render loop and the quality presets, less their tests.
 */
export const GPU_BEARING_PATTERNS: RegExp[] = [
	/^crates\/null3d-shaders\/(src|wgsl)\//,
	/^crates\/null3d-shaders\/shaders\.toml$/,
	/^packages\/engine\/src\/(gpu|render|quality)\/(?!.*\.test\.ts$)/,
];

export const gpuBearingFiles = (files: readonly string[]) =>
	bearingFiles([...files], GPU_BEARING_PATTERNS);

/** A commit that main's squash keeps, with the files it changes. */
export interface CommitWithFiles {
	sha: string;
	message: string;
	files: readonly string[];
}

/**
 * Why a pull request's commits lack the GPU check, or null when they need none or have it. The
 * commits come newest first, as `keptCommits` gives them.
 */
export function gpuCheckProblem(commits: readonly CommitWithFiles[]): string | null {
	const last = commits.findIndex((commit) => gpuBearingFiles(commit.files).length > 0);
	const changing = commits[last];
	if (!changing) return null;
	const values = commits
		.slice(0, last + 1)
		.flatMap((commit) => findAckValues(effectiveMessage(commit.message), GPU_CHECK_TRAILER));
	if (values.some((value) => !isBareAck(value))) return null;
	const commit = `${changing.sha.slice(0, 8)} ${changing.message.split('\n')[0]}`;
	return values.length > 0
		? `GPU-Checked value "${values[0]}" records no check: put the line that bun run bench:gpu-check prints on the commit`
		: `${commit} changes how the GPU draws (${summarizeBearing(gpuBearingFiles(changing.files))}), but neither it nor a later commit has a GPU-Checked: trailer. Run bun run bench:gpu-check on a computer with a GPU of its own, and put the line it prints on a plain commit; an empty commit is fine (.dev/pull-requests.md).`;
}
