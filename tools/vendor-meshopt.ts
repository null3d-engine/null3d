// Writes meshoptimizer's decoder module, and its licence, into packages/engine/vendor/meshopt from
// the installed package. Run it after a change of the meshoptimizer version that the engine pins.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	installedMeshoptWasm,
	MESHOPT_VENDOR,
	MESHOPT_WASM,
	meshoptPackage,
} from './lib/meshopt-wasm.ts';

mkdirSync(MESHOPT_VENDOR, { recursive: true });
const wasm = installedMeshoptWasm();
writeFileSync(join(MESHOPT_VENDOR, MESHOPT_WASM), wasm);
copyFileSync(join(meshoptPackage(), 'LICENSE.md'), join(MESHOPT_VENDOR, 'LICENSE.md'));
console.log(`${MESHOPT_WASM}: ${wasm.length} bytes`);
