// Playwright's global setup that refuses a run whose dev server serves another copy of the
// repository. The dev server entry reuses a server that already answers on its port, off CI, and
// every copy takes the same port unless NULL3D_PORT names another. A run could then draw another
// copy's code and judge it against this copy's references. Playwright starts its web servers
// before the global setups, so the server that the run will use already answers here.
import { execFileSync } from 'node:child_process';
import { HTTP_PORT, REPO_ROOT, refuseOtherCopy } from './server.ts';

/** Prints the branch and commit that the run draws, so its log names the code it judged. */
function printCheckout(): void {
	const git = (...args: string[]): string =>
		execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
	const commit = git('rev-parse', '--short', 'HEAD');
	const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
	const dirty = git('status', '--porcelain') !== '';
	console.log(`checkout: ${branch} at ${commit}${dirty ? ', with uncommitted changes' : ''}`);
}

export default function globalSetup(): Promise<void> {
	printCheckout();
	return refuseOtherCopy(`http://localhost:${HTTP_PORT}`);
}
