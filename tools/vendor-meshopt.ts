// Writes meshoptimizer's modules that the engine runs, and its licence, into
// packages/engine/vendor/meshopt from the installed package. Run it after a change of the
// meshoptimizer version that the engine pins.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	installedMeshoptWasm,
	MESHOPT_MODULES,
	MESHOPT_VENDOR,
	meshoptPackage,
} from './lib/meshopt-wasm.ts';

mkdirSync(MESHOPT_VENDOR, { recursive: true });
for (const { file } of MESHOPT_MODULES) {
	const wasm = installedMeshoptWasm(file);
	writeFileSync(join(MESHOPT_VENDOR, file), wasm);
	console.log(`${file}: ${wasm.length} bytes`);
}
copyFileSync(join(meshoptPackage(), 'LICENSE.md'), join(MESHOPT_VENDOR, 'LICENSE.md'));
