// Makes what a package's tarball holds besides the files git keeps: its license copies and, as the
// package needs, its built JavaScript and declarations, the shader modules and a copy of the docs
// (tools/lib/packages.ts). Each package's `prepack` script runs it from the package's folder:
//   bun ../../tools/build-package.ts <package folder name>
import { join } from 'node:path';
import { buildPackage } from './lib/packages';

const [name] = process.argv.slice(2);
try {
	if (!name) throw new Error('usage: bun tools/build-package.ts <package folder name>');
	buildPackage(join(import.meta.dirname, '..'), name);
} catch (e) {
	console.error(`error: ${(e as Error).message}`);
	process.exit(1);
}
