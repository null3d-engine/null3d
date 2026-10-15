// Builds the shader modules unless they match their inputs (tools/lib/shader-modules.ts). Run from
// anywhere in the repository:
//   bun tools/shaders.ts
// `--cache-keys` builds nothing. It prints the two shared shader caches' folders and the keys that a
// build of this checkout reads them by, as name=value lines, so CI keeps those folders under the
// same keys:
//   bun tools/shaders.ts --cache-keys >> "$GITHUB_OUTPUT"
import { join } from 'node:path';
import {
	compilerStamp,
	ensureShaderModules,
	entryCacheDir,
	inputHash,
	MODULE_DIR,
	modulesCacheDir,
} from './lib/shader-modules';

const root = join(import.meta.dirname, '..');

try {
	if (process.argv.includes('--cache-keys')) {
		console.log(`modules-dir=${modulesCacheDir()}`);
		console.log(`entries-dir=${entryCacheDir()}`);
		console.log(`inputs=${inputHash(root)}`);
		console.log(`stamp=${compilerStamp(root)}`);
	} else if (!ensureShaderModules(root))
		console.log(`The shader modules in ${MODULE_DIR} are up to date.`);
} catch (e) {
	console.error(`error: ${(e as Error).message}`);
	process.exit(1);
}
