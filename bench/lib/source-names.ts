// Names the functions of a production build in the profiles of Chrome's debugging protocol. The one
// implementation of the source map decoding lives in the command-line package, which the add-on
// check reads its figures with; this module adds the load address that the startup tool serves a
// build under, whose path prefix the build's own file names do not hold.

import { BuildNames as BuiltNames } from '../../packages/cli/src/source-names.js';
import { parseLoadPath } from '../../tests/lib/load-routes.ts';

export type { BuiltFile, Segment, SourceMap } from '../../packages/cli/src/source-names.js';
export {
	decodeMappings,
	nameColumnBefore,
	originalFrame,
} from '../../packages/cli/src/source-names.js';

/** The built file that an address names, from the build's root. */
export class BuildNames extends BuiltNames {
	constructor(buildDir: string) {
		super(buildDir, (url) => parseLoadPath(url.pathname)?.path ?? url.pathname.slice(1));
	}
}
