// Writes the vegetation add-on's species registry and species page from the species folders
// (tools/lib/vegetation-registry.ts). `bun run docs`, the install step and the git hooks write them
// with every other generated file; this writes the two alone, after a species folder is added or
// removed. Run from the repository root:
//   bun tools/vegetation-registry.ts
import { join } from 'node:path';
import { writeGeneratedDocs } from './lib/docs';
import { vegetationRegistryFiles } from './lib/vegetation-registry';

const root = join(import.meta.dirname, '..');
const written = writeGeneratedDocs(root, vegetationRegistryFiles(root));
for (const path of written) console.log(`wrote ${path}`);
console.log(`vegetation registry: ${written.length} file(s) changed`);
