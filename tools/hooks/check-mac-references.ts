// Pull request guard against stale real-GPU image references (AGENTS.md, "Commit gates"). CI draws
// the image tests on SwiftShader only. A change that alters an image therefore fails CI until its
// SwiftShader references are made again, but the references from the Mac's GPU, which other browsers
// and devices compare with, can stay stale unseen. So a pull request that changes a test's SwiftShader
// reference must change the same test's real-GPU reference too, or carry a `Mac-References:` trailer
// that says why the real-GPU reference still holds, such as an image test run on the Mac's GPU that
// passes with it. CI reads it through check-trailers.ts, over the whole pull request.
import type { CommitWithFiles } from './check-gpu-ack';
import { effectiveMessage, findAckValues, isBareAck } from './commit-ack';

/** The trailer that says why a real-GPU reference still holds. */
export const MAC_REFERENCES_TRAILER = 'Mac-References';

const REFERENCES = 'tests/image/references';
const SWIFTSHADER = `${REFERENCES}/chromium-swiftshader/`;
const REAL_GPU = `${REFERENCES}/chrome-real-gpu/`;

/**
 * The SwiftShader references that the commits change while the same test's real-GPU reference in
 * the same tier stays as it was.
 */
export function unmatchedSwiftShaderReferences(commits: readonly CommitWithFiles[]): string[] {
	const changed = new Set(commits.flatMap((commit) => commit.files));
	return [...changed]
		.filter((file) => file.startsWith(SWIFTSHADER))
		.filter((file) => !changed.has(`${REAL_GPU}${file.slice(SWIFTSHADER.length)}`))
		.sort();
}

/**
 * Why a pull request's commits may leave a real-GPU reference stale, or null when they change both
 * sets alike or give the reason.
 */
export function macReferencesProblem(commits: readonly CommitWithFiles[]): string | null {
	const unmatched = unmatchedSwiftShaderReferences(commits);
	if (unmatched.length === 0) return null;
	const values = commits.flatMap((commit) =>
		findAckValues(effectiveMessage(commit.message), MAC_REFERENCES_TRAILER),
	);
	if (values.some((value) => !isBareAck(value))) return null;
	const shown = unmatched.slice(0, 3).map((file) => file.slice(SWIFTSHADER.length));
	const more =
		unmatched.length > shown.length ? ` and ${unmatched.length - shown.length} more` : '';
	return values.length > 0
		? `${MAC_REFERENCES_TRAILER} value "${values[0]}" gives no reason: say how you know the real-GPU references still hold`
		: `the pull request changes SwiftShader references without the same tests' real-GPU references (${shown.join(', ')}${more}). Make them again on the Mac's GPU with bun run test:images -g <test> and bun run images:review --accept <test>, or, when the Mac's images still match, put a ${MAC_REFERENCES_TRAILER}: trailer on a commit that says so (.dev/image-tests.md).`;
}
