// Builds the shader modules unless they match their inputs (tools/lib/shader-modules.ts). Run from
// anywhere in the repository:
//   bun tools/shaders.ts
import { join } from 'node:path';
import { ensureShaderModules, MODULE_DIR } from './lib/shader-modules';

try {
	if (!ensureShaderModules(join(import.meta.dirname, '..')))
		console.log(`The shader modules in ${MODULE_DIR} are up to date.`);
} catch (e) {
	console.error(`error: ${(e as Error).message}`);
	process.exit(1);
}
