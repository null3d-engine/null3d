// The address of each demo's code on GitHub, for a "View code" link. A page that shows the demos in
// a layout of its own, such as the website's, passes the release tag that it is built from.
import type { Demo } from '../demos';

/** The repository's address on GitHub, as the `repository` field of its package.json gives it. */
export const REPOSITORY_URL = 'https://github.com/null3d-engine/null3d';

/** The demo's code under the examples folder: a file, or a folder that ends with a slash. */
export const codePath = (demo: Pick<Demo, 'name' | 'code'>) =>
	demo.code ?? `${demo.name}/sketch.ts`;

/**
 * The GitHub address of the demo's code at `ref`, a branch or a tag: the file of a demo that is one
 * file, and the folder of a demo of several files.
 */
export function sourceUrl(demo: Pick<Demo, 'name' | 'code'>, ref = 'main'): string {
	const path = codePath(demo);
	const kind = path.endsWith('/') ? 'tree' : 'blob';
	return `${REPOSITORY_URL}/${kind}/${ref}/examples/${path}`;
}
