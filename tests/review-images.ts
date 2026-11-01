// Shows the new and changed images that image test runs saved, each with its reference and its
// diff, in the terminal and on a page, and makes the ones you accept into references. Nothing else
// writes references. From the repository root:
//   bun run images:review
//   bun run images:review --accept
//   bun run images:review --accept scene,held
//   bun run images:review --ci 18712345678
// Options:
//   --accept [tests]   make the images that can become references into references: all of them,
//                      or those of the tests named
//   --from <folder>    review the images in another folder, such as an unpacked CI artifact,
//                      instead of test-results/images
//   --ci <run>         fetch the images that a CI run's browser jobs saved, with the GitHub CLI,
//                      then review them. CI draws with SwiftShader, so its references come this way
//   --local-reason <why>  accept SwiftShader images that this machine drew, which --accept refuses
//                      otherwise, and record the reason in tests/image/local-references.json
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HARNESS_DIRS } from './lib/images.ts';
import { acceptCandidates, readCandidates, reviewLines, reviewPage } from './lib/review.ts';
import { REPO_ROOT } from './lib/server.ts';

const USAGE =
	'usage: bun run images:review [--accept [<tests>]] [--from <folder> | --ci <run>] [--local-reason <why>]';

/**
 * The CI artifacts that hold images for review: the browser test shards' and the Safari and Firefox
 * jobs', and the drawings that a run started by hand asked its shards to keep.
 */
const CI_ARTIFACTS = [
	'browser-test-results-*',
	'browser-heavy-test-results-*',
	'real-browser-runs-*',
	'drawn-images-*',
];

export interface ReviewOptions {
	/** Accept the images: undefined to only show them, all of them for [], or those of the tests named. */
	accept?: string[];
	from?: string;
	ci?: string;
	/** Why SwiftShader images that this machine drew become references on purpose. */
	localReason?: string;
}

export function parseReviewArgs(args: readonly string[]): ReviewOptions {
	const options: ReviewOptions = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const next = args[i + 1];
		if (arg === '--accept') {
			const named = next !== undefined && !next.startsWith('--');
			options.accept = named ? next.split(',').filter(Boolean) : [];
			if (named) i++;
		} else if (arg === '--from' && next) {
			options.from = next;
			i++;
		} else if (arg === '--ci' && next && /^\d+$/.test(next)) {
			options.ci = next;
			i++;
		} else if (arg === '--local-reason' && next?.trim() && !next.startsWith('--')) {
			options.localReason = next.trim();
			i++;
		} else
			throw new Error(`${arg === undefined ? 'no option' : `unknown option ${arg}`}\n${USAGE}`);
	}
	if (options.from && options.ci) throw new Error(`use --from or --ci, not both\n${USAGE}`);
	return options;
}

/** Downloads a CI run's artifacts that hold images, and returns their folder. */
function downloadRun(run: string): string {
	const folder = join(REPO_ROOT, 'target/image-candidates', run);
	rmSync(folder, { recursive: true, force: true });
	mkdirSync(folder, { recursive: true });
	const patterns = CI_ARTIFACTS.flatMap((pattern) => ['--pattern', pattern]);
	try {
		execFileSync('gh', ['run', 'download', run, ...patterns, '--dir', folder], {
			stdio: 'inherit',
		});
	} catch {
		throw new Error(
			`could not download the artifacts of CI run ${run}. A run saves its images when a browser test fails, and when a run started by hand asks for its drawn images.`,
		);
	}
	return folder;
}

function main(): void {
	const options = parseReviewArgs(process.argv.slice(2));
	const folder = options.ci ? downloadRun(options.ci) : (options.from ?? HARNESS_DIRS.candidates);
	const page = join(folder, 'review.html');
	rmSync(page, { force: true });
	const candidates = readCandidates(folder);
	if (options.accept) {
		const tests = options.accept.length > 0 ? options.accept : undefined;
		const { written, refused } = acceptCandidates(candidates, HARNESS_DIRS.references, tests, {
			...(options.ci && { ciRun: options.ci }),
			...(options.localReason && { localReason: options.localReason }),
		});
		for (const file of written) console.log(`accepted  ${file}`);
		for (const reason of refused) console.log(`left      ${reason}`);
		if (written.length === 0 && refused.length === 0) console.log('No images to accept.');
		return;
	}
	if (candidates.length > 0) writeFileSync(page, reviewPage(candidates, folder));
	const named = folder === HARNESS_DIRS.candidates ? undefined : folder;
	console.log(reviewLines(candidates, page, named).join('\n'));
}

if (import.meta.main) {
	try {
		main();
	} catch (e) {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	}
}
